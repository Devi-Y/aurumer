"use strict";

const https = require("node:https");
const { sanitizeSnapshot } = require("./sanitize");

const SOURCE_URL = "https://devi-y.github.io/aurumer/data/live-snapshot.json";
const CACHE_TTL_MS = 10 * 60 * 1000;
// 函数超时 10 秒：回源留足时间，失败后再读数据库缓存。
const FUNCTION_TIMEOUT_MS = 10 * 1000;
const DATABASE_FALLBACK_BUDGET_MS = 1500;
const REQUEST_TIMEOUT_MS = FUNCTION_TIMEOUT_MS - DATABASE_FALLBACK_BUDGET_MS;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

const CACHE_COLLECTION = "data_snapshot_cache";
const CACHE_DOC_ID = "live-snapshot";
const PERSISTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WARM_TRIGGER_NAME = "data-snapshot-warm";

let cachedResult = null;
let cachedAt = 0;
let pendingRefresh = null;
let database = null;

function getDatabase() {
  if (database !== null) return database;
  try {
    const cloud = require("wx-server-sdk");
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    database = cloud.database();
  } catch (error) {
    console.warn("数据库缓存不可用，仅使用内存缓存", error && error.message);
    database = false;
  }
  return database;
}

async function readPersistedSnapshot() {
  const db = getDatabase();
  if (!db) return null;
  try {
    const result = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).get();
    const record = result && result.data;
    if (!record || !record.payload) return null;
    const age = Date.now() - Number(record.storedAt || 0);
    if (!Number.isFinite(age) || age > PERSISTED_MAX_AGE_MS) return null;
    return { ...record.payload, storedAt: record.storedAt };
  } catch (error) {
    return null;
  }
}

async function writePersistedSnapshot(payload) {
  const db = getDatabase();
  if (!db) return;
  const record = { payload, storedAt: Date.now(), updatedAt: payload.updatedAt };
  try {
    await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).set({ data: record });
  } catch (error) {
    if (await ensureCollection(error)) {
      try {
        await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).set({ data: record });
        return;
      } catch (retryError) {
        console.warn("建集合后写入数据库缓存仍失败", retryError && retryError.message);
        return;
      }
    }
    console.warn("写入数据库缓存失败", error && error.message);
  }
}

async function ensureCollection(error) {
  const message = String((error && error.message) || "");
  if (!/collection not exists|not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message)) return false;
  const db = getDatabase();
  if (!db || typeof db.createCollection !== "function") return false;
  try {
    await db.createCollection(CACHE_COLLECTION);
    return true;
  } catch (createError) {
    return /already exist/i.test(String((createError && createError.message) || ""));
  }
}

function readJson(url, redirectsLeft = 2) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "user-agent": "Aurum-WeChat-MiniProgram/1.0",
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectsLeft > 0) {
        response.resume();
        resolve(readJson(new URL(response.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`公开快照返回 HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("公开快照超过安全大小"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new Error("公开快照不是有效 JSON"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("公开快照请求超时")));
    request.on("error", reject);
  });
}

async function refreshSnapshot() {
  const separator = SOURCE_URL.includes("?") ? "&" : "?";
  const raw = await readJson(`${SOURCE_URL}${separator}mini=${Date.now()}`);
  const data = sanitizeSnapshot(raw);
  const fetchedAt = new Date().toISOString();
  cachedResult = {
    ok: true,
    data,
    source: "望潮最新公开数据",
    updatedAt: data.updatedAt,
    fetchedAt,
  };
  cachedAt = Date.now();
  await writePersistedSnapshot(cachedResult);
  return cachedResult;
}

function getSnapshot(force) {
  if (!force && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve({ ...cachedResult, cache: "memory" });
  }
  if (!pendingRefresh) {
    pendingRefresh = refreshSnapshot().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

function isWarmTimer(event) {
  return Boolean(
    event
    && (event.Type === "Timer" || event.triggerType === "timer")
    && (event.TriggerName === WARM_TRIGGER_NAME || event.triggerName === WARM_TRIGGER_NAME),
  );
}

exports.main = async (event = {}) => {
  const action = event.action || (isWarmTimer(event) ? "warm" : "getSnapshot");

  if (action === "warm") {
    try {
      const result = await getSnapshot(true);
      return { ok: true, warmed: true, updatedAt: result.updatedAt, cache: "refreshed" };
    } catch (error) {
      console.error("aurum-data warm failed", error && error.message);
      const persisted = await readPersistedSnapshot();
      if (persisted) {
        cachedResult = persisted;
        cachedAt = Number(persisted.storedAt || Date.now());
        return {
          ok: true,
          warmed: false,
          warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
          updatedAt: persisted.updatedAt,
          cache: "stale-database",
        };
      }
      return { ok: false, error: "DATA_TEMPORARILY_UNAVAILABLE" };
    }
  }

  if (action !== "getSnapshot") {
    return { ok: false, error: "UNSUPPORTED_ACTION" };
  }

  // 普通读请求：内存 → 10 分钟内 DB 缓存 → 再回源；失败再兜底更旧的 DB。
  if (!event.force) {
    if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
      return { ...cachedResult, cache: "memory" };
    }
    const persisted = await readPersistedSnapshot();
    if (persisted && Date.now() - Number(persisted.storedAt || 0) < CACHE_TTL_MS) {
      cachedResult = persisted;
      cachedAt = Number(persisted.storedAt || Date.now());
      return { ...persisted, cache: "database" };
    }
  }

  try {
    return await getSnapshot(Boolean(event.force));
  } catch (error) {
    console.error("aurum-data refresh failed", error && error.message);
    if (cachedResult) {
      return {
        ...cachedResult,
        cache: "stale-memory",
        warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      };
    }
    const persisted = await readPersistedSnapshot();
    if (persisted) {
      return {
        ...persisted,
        cache: "stale-database",
        warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      };
    }
    return { ok: false, error: "DATA_TEMPORARILY_UNAVAILABLE" };
  }
};
