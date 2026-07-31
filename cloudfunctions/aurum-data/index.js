"use strict";

const https = require("node:https");
const { sanitizeSnapshot } = require("./sanitize");

const SOURCE_URL = "https://devi-y.github.io/aurumer/data/live-snapshot.json";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8 * 1000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

// 内存缓存只在同一个函数实例里有效，冷启动后必然为空。此时唯一的数据来源是
// GitHub Pages，境内访问慢且不稳定，8 秒超时一旦没抢到就直接对用户报错。
// 这里补一层数据库缓存：净化后仅约 80KB，可以整条存下，冷启动和回源失败都能兜住。
const CACHE_COLLECTION = "data_snapshot_cache";
const CACHE_DOC_ID = "live-snapshot";
const PERSISTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
    // 集合不存在或首次部署时会走到这里，属于预期情况，不影响主链路。
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
    console.warn("写入数据库缓存失败", error && error.message);
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

exports.main = async (event = {}) => {
  if (event.action && event.action !== "getSnapshot") {
    return { ok: false, error: "UNSUPPORTED_ACTION" };
  }

  // 冷启动且数据库里已有足够新的快照时直接返回，省掉一次跨境回源。
  if (!event.force && !cachedResult) {
    const persisted = await readPersistedSnapshot();
    if (persisted && Date.now() - persisted.storedAt < CACHE_TTL_MS) {
      cachedResult = persisted;
      cachedAt = persisted.storedAt;
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
