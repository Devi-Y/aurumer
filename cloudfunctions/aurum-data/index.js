"use strict";

const https = require("node:https");
const { sanitizeSnapshot } = require("./sanitize");

const SOURCE_URL = "https://devi-y.github.io/aurumer/data/live-snapshot.json";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8 * 1000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

let cachedResult = null;
let cachedAt = 0;
let pendingRefresh = null;

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
    return { ok: false, error: "DATA_TEMPORARILY_UNAVAILABLE" };
  }
};
