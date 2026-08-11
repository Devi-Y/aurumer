"use strict";

const https = require("node:https");
const { sanitizeSnapshot } = require("./sanitize");
const { writeFactVersions } = require("./fact-versions");
const { degradeStaleActions, snapshotAgeMs, ACTION_MAX_AGE_MS } = require("./action-freshness");
const { alertOpsOnce } = require("./ops-alert");

/** 部署后可用 health 核对：必须与 Git 该文件一致。 */
const SOURCE_REVISION = "2026-08-11-multisource-strategy-signals-b4";
const SOURCE_URL = "https://devi-y.github.io/aurumer/data/live-snapshot.json";
// GitHub Pages 偶发超时不能让前台只能看到旧缓存；备用源仍指向同一份公开快照。
// 顺序固定：先走发布页，再走 GitHub 原始文件，最后走当前开发分支。
const SOURCE_URLS = [
  SOURCE_URL,
  "https://raw.githubusercontent.com/Devi-Y/aurumer/main/data/live-snapshot.json",
  "https://raw.githubusercontent.com/Devi-Y/aurumer/agent/wangchao-risk-gold-member-20260811/data/live-snapshot.json",
];
/** 10 分钟内视为新鲜；超过则后台回源，前台仍先读缓存。 */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** 可读的陈旧缓存上限；超过则不再当作可用交付。 */
const SERVE_STALE_MAX_MS = 36 * 60 * 60 * 1000;
/**
 * 平台默认超时常为 3 秒，CLI 不一定写入 config.json 的超时。
 * 前台读路径必须在该预算内结束；回源放后台。
 */
const PLATFORM_SAFE_MS = 2500;
// 留出数据库缓存与事实版本写入时间，避免 warm 把 20 秒函数预算全部耗在回源上。
const WARM_REQUEST_TIMEOUT_MS = 8000;
const PERSISTENCE_BUDGET_MS = 5000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

const CACHE_COLLECTION = "data_snapshot_cache";
const CACHE_DOC_ID = "live-snapshot";
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

function ageMs(storedAt) {
  const stamp = Number(storedAt || 0);
  if (!Number.isFinite(stamp) || stamp <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - stamp);
}

async function readPersistedSnapshot() {
  const db = getDatabase();
  if (!db) return null;
  try {
    const result = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).get();
    const record = result && result.data;
    if (!record || !record.payload) return null;
    if (ageMs(record.storedAt) > SERVE_STALE_MAX_MS) return null;
    return { ...record.payload, storedAt: record.storedAt };
  } catch (error) {
    return null;
  }
}

async function writePersistedSnapshot(payload) {
  const db = getDatabase();
  if (!db) return;
  const record = { payload, storedAt: Date.now(), updatedAt: payload.updatedAt, revision: SOURCE_REVISION };
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

function readJson(url, timeoutMs, redirectsLeft = 2) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "user-agent": "Aurum-WeChat-MiniProgram/1.0",
      },
      timeout: timeoutMs,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectsLeft > 0) {
        response.resume();
        resolve(readJson(new URL(response.headers.location, url).toString(), timeoutMs, redirectsLeft - 1));
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

async function readLatestSnapshot(timeoutMs) {
  const attempts = SOURCE_URLS.map((url) => {
    const separator = url.includes("?") ? "&" : "?";
    return readJson(`${url}${separator}mini=${Date.now()}`, timeoutMs)
      .then((data) => ({ data, url }));
  });
  try {
    return await Promise.any(attempts);
  } catch (error) {
    const reasons = Array.isArray(error?.errors)
      ? error.errors.map((reason, index) => `${new URL(SOURCE_URLS[index]).hostname}: ${reason?.message || reason}`)
      : [error?.message || "unknown error"];
    throw new Error(`公开快照多源回源失败；${reasons.join(" | ")}`);
  }
}

async function persistWarmSideEffects(payload) {
  const db = getDatabase();
  if (!db) return null;
  const tasks = [
    writePersistedSnapshot(payload).catch((error) => {
      console.warn("写入数据库缓存失败", error && error.message);
      return null;
    }),
    writeFactVersions(db, payload.data || payload).catch((error) => {
      console.warn("事实版本写入失败", error && error.message);
      return null;
    }),
  ];
  let timeout;
  const budget = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(null), PERSISTENCE_BUDGET_MS);
  });
  const result = await Promise.race([Promise.all(tasks), budget]);
  clearTimeout(timeout);
  if (!result) console.warn(`数据库副作用超过 ${PERSISTENCE_BUDGET_MS}ms，已让出 warm 主路径`);
  return result;
}

async function refreshSnapshot(timeoutMs = WARM_REQUEST_TIMEOUT_MS) {
  const result = await readLatestSnapshot(timeoutMs);
  const raw = result.data;
  const data = sanitizeSnapshot(raw);
  const fetchedAt = new Date().toISOString();
  cachedResult = {
    ok: true,
    data,
    source: "望潮最新公开数据",
    sourceUrl: result.url,
    updatedAt: data.updatedAt,
    fetchedAt,
    revision: SOURCE_REVISION,
  };
  cachedAt = Date.now();
  const sideEffects = await persistWarmSideEffects(cachedResult);
  if (sideEffects && sideEffects[1]) cachedResult.factStats = sideEffects[1];
  return cachedResult;
}

function scheduleBackgroundRefresh() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = refreshSnapshot(WARM_REQUEST_TIMEOUT_MS)
    .catch(async (error) => {
      console.warn("后台回源失败", error && error.message);
      await alertOpsOnce("background-refresh-failed", {
        error: error && error.message,
        revision: SOURCE_REVISION,
      });
      return null;
    })
    .finally(() => {
      pendingRefresh = null;
    });
  return pendingRefresh;
}

function applyServeFreshness(result) {
  if (!result || !result.data) return result;
  const data = degradeStaleActions(result.data);
  const contentAge = snapshotAgeMs(data.updatedAt);
  const next = {
    ...result,
    data,
    actionsFresh: data.actionsFresh !== false,
    contentAgeMs: contentAge,
  };
  if (contentAge > ACTION_MAX_AGE_MS) {
    next.warning = next.warning || "SNAPSHOT_CONTENT_STALE";
    next.actionDegradeReason = data.actionDegradeReason || "数据过期，暂不提供动作";
  }
  return next;
}

function withCacheMeta(result, cache, extra = {}) {
  const fresh = applyServeFreshness(result);
  return {
    ...fresh,
    cache,
    revision: SOURCE_REVISION,
    ...extra,
  };
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

  if (action === "health") {
    const persisted = await readPersistedSnapshot();
    return {
      ok: true,
      revision: SOURCE_REVISION,
      memoryUpdatedAt: cachedResult && cachedResult.updatedAt || null,
      databaseUpdatedAt: persisted && persisted.updatedAt || null,
      cache: cachedResult ? "memory" : (persisted ? "database" : "empty"),
      platformSafeMs: PLATFORM_SAFE_MS,
    };
  }

  if (action === "warm") {
    try {
      const result = await refreshSnapshot(WARM_REQUEST_TIMEOUT_MS);
      const contentAge = snapshotAgeMs(result.updatedAt);
      if (contentAge > ACTION_MAX_AGE_MS) {
        await alertOpsOnce("warm-content-stale", {
          error: `公开快照内容已过期 ${(contentAge / 3_600_000).toFixed(1)} 小时`,
          updatedAt: result.updatedAt,
          revision: SOURCE_REVISION,
        });
      }
      return withCacheMeta({
        ok: true,
        warmed: true,
        updatedAt: result.updatedAt,
      }, "refreshed");
    } catch (error) {
      console.error("aurum-data warm failed", error && error.message);
      await alertOpsOnce("warm-failed", {
        error: error && error.message,
        revision: SOURCE_REVISION,
      });
      const persisted = await readPersistedSnapshot();
      if (persisted) {
        cachedResult = persisted;
        cachedAt = Number(persisted.storedAt || Date.now());
        return withCacheMeta({
          ok: true,
          warmed: false,
          warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
          updatedAt: persisted.updatedAt,
        }, "stale-database");
      }
      return { ok: false, error: "DATA_TEMPORARILY_UNAVAILABLE", revision: SOURCE_REVISION };
    }
  }

  if (action !== "getSnapshot") {
    return { ok: false, error: "UNSUPPORTED_ACTION", revision: SOURCE_REVISION };
  }

  // 前台：内存 → 数据库缓存立刻返回；过期则后台回源，不阻塞。
  if (!event.force) {
    if (cachedResult && ageMs(cachedAt) < CACHE_TTL_MS) {
      return withCacheMeta(cachedResult, "memory");
    }
    if (cachedResult && ageMs(cachedAt) < SERVE_STALE_MAX_MS) {
      scheduleBackgroundRefresh();
      return withCacheMeta(cachedResult, "stale-memory", {
        warning: ageMs(cachedAt) > CACHE_TTL_MS ? "CACHE_REFRESHING" : undefined,
      });
    }

    const persisted = await readPersistedSnapshot();
    if (persisted) {
      cachedResult = persisted;
      cachedAt = Number(persisted.storedAt || Date.now());
      if (ageMs(cachedAt) >= CACHE_TTL_MS) scheduleBackgroundRefresh();
      return withCacheMeta(persisted, ageMs(cachedAt) < CACHE_TTL_MS ? "database" : "stale-database", {
        warning: ageMs(cachedAt) >= CACHE_TTL_MS ? "CACHE_REFRESHING" : undefined,
      });
    }
  }

  // 无缓存或强制刷新：短超时回源；仍失败再兜底。
  try {
    const result = await refreshSnapshot(event.force ? WARM_REQUEST_TIMEOUT_MS : Math.min(PLATFORM_SAFE_MS, 2000));
    return withCacheMeta(result, "refreshed");
  } catch (error) {
    console.error("aurum-data refresh failed", error && error.message);
    await alertOpsOnce("refresh-failed", {
      error: error && error.message,
      revision: SOURCE_REVISION,
    });
    if (cachedResult) {
      return withCacheMeta({
        ...cachedResult,
        warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      }, "stale-memory");
    }
    const persisted = await readPersistedSnapshot();
    if (persisted) {
      cachedResult = persisted;
      cachedAt = Number(persisted.storedAt || Date.now());
      return withCacheMeta({
        ...persisted,
        warning: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      }, "stale-database");
    }
    return { ok: false, error: "DATA_TEMPORARILY_UNAVAILABLE", revision: SOURCE_REVISION };
  }
};

module.exports.SOURCE_REVISION = SOURCE_REVISION;
