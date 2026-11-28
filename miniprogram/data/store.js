const bundledSnapshot = require("./live-snapshot");
const { degradeStaleActions, compareSnapshotVersions, weekdayAgeMs } = require("../utils/action-freshness");
let runtimeConfig = {};
let cdnTransport = null;
try { runtimeConfig = require("../config/runtime"); } catch (error) { runtimeConfig = {}; }
try { cdnTransport = require("./cdn-transport"); } catch (error) { cdnTransport = null; }

const REMOTE_TTL_MS = 10 * 60 * 1000;
// 云端本轮结论不完整时的重试间隔。这种情况多半是云函数冷启动先读到旧的
// 数据库缓存，几十秒后后台回源就好了，不该被 10 分钟 TTL 钉住。
const DEGRADED_TTL_MS = 60 * 1000;
// 云函数只会回三种 warning，含义完全不同，之前被同一条正则一网打尽：
//   UPSTREAM_TEMPORARILY_UNAVAILABLE —— 真的取不到数，该报「数据源暂时不可用」
//   CACHE_REFRESHING              —— 后台正在回源，数据照常可用，属于正常态
//   SNAPSHOT_CONTENT_STALE        —— 内容本身超过 36 小时，交给下面的时效判断
// 只有第一种是故障；另外两种以前也会把全站七个页面刷成橙色告警条。
const UPSTREAM_DOWN_RE = /UPSTREAM_TEMPORARILY_UNAVAILABLE|上游暂不可用/i;
// 公开快照工作日约两趟（09:30 / 16:30），周末空窗更长。
// 在云函数仍可服务的 36 小时窗口内，「自动更新」就是当前已发布结论，不要误报成故障。
const CURRENT_PUBLISH_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const STALE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

const STORAGE_CACHE_KEY = "aurum_snapshot_cache_v1";
const STORAGE_META_KEY = "aurum_snapshot_meta_v1";

let memorySnapshot = null;
let memorySource = "离线备用数据";
let memoryWarning = "";
let fetchedAt = 0;
let fetchTtlMs = REMOTE_TTL_MS;
let refreshPromise = null;
let preparedRef = null;
let preparedMinute = -1;
let preparedValue = null;
let storageChecked = false;

const INVESTOR_MINIMUM = 6;
const INVESTOR_EXPECTED = 9;

function prepareSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const minute = Math.floor(Date.now() / 60000);
  if (snapshot === preparedRef && minute === preparedMinute && preparedValue) {
    return preparedValue;
  }
  const next = degradeStaleActions(snapshot);
  if (
    next
    && next.us
    && (!Array.isArray(next.us.sleeveQuotes) || !next.us.sleeveQuotes.length)
    && Array.isArray(bundledSnapshot?.us?.sleeveQuotes)
    && bundledSnapshot.us.sleeveQuotes.length
  ) {
    next.us = { ...next.us, sleeveQuotes: bundledSnapshot.us.sleeveQuotes };
  }
  preparedRef = snapshot;
  preparedMinute = minute;
  preparedValue = next;
  return next;
}

function hydrateFromStorage() {
  if (storageChecked) return;
  storageChecked = true;
  memorySnapshot = prepareSnapshot(bundledSnapshot);
  if (typeof wx === "undefined" || !wx || typeof wx.getStorageSync !== "function") return;
  try {
    // 先读百字节级元信息，若本地缓存不比随包快照更新，直接跳过数百 KB 大 JSON 同步反序列化。
    const meta = wx.getStorageSync(STORAGE_META_KEY);
    if (meta && meta.updatedAt && compareSnapshotVersions(meta, memorySnapshot) <= 0) {
      return;
    }
    const cached = wx.getStorageSync(STORAGE_CACHE_KEY);
    if (cached && isUsableSnapshot(cached.snapshot)) {
      if (compareSnapshotVersions(cached.snapshot, memorySnapshot) > 0) {
        memorySnapshot = prepareSnapshot(cached.snapshot);
        memorySource = cached.source || "自动更新";
        memoryWarning = cached.warning || "";
      } else if (typeof wx.setStorage === "function") {
        wx.setStorage({
          key: STORAGE_META_KEY,
          data: { updatedAt: cached.snapshot.updatedAt || "", revisionAt: cached.snapshot.revisionAt || "" },
        });
      }
    }
  } catch (error) {
    // 忽略本地缓存异常，回退随包数据
  }
}

function persistToStorage(snapshot, source, warning) {
  if (typeof wx === "undefined" || !wx || typeof wx.setStorage !== "function") return;
  if (!isUsableSnapshot(snapshot)) return;
  try {
    wx.setStorage({
      key: STORAGE_META_KEY,
      data: { updatedAt: snapshot.updatedAt || "", revisionAt: snapshot.revisionAt || "" },
    });
    wx.setStorage({
      key: STORAGE_CACHE_KEY,
      data: { snapshot, source, warning: warning || "", savedAt: Date.now() },
    });
  } catch (error) {
    // 存储空间不足或受限时静默降级
  }
}

function snapshotVersionKey(snapshot, kind = "") {
  if (!snapshot) return `empty|${kind}`;
  return [
    snapshot.updatedAt || "",
    snapshot.revisionAt || "",
    snapshot.status || "",
    snapshot.actionsFresh === false ? "0" : "1",
    kind || "",
  ].join("|");
}

function isUsableSnapshot(snapshot) {
  const investors = snapshot && Array.isArray(snapshot.investors) ? snapshot.investors : null;
  if (investors && investors.length >= INVESTOR_MINIMUM && investors.length < INVESTOR_EXPECTED) {
    console.warn(
      `[望潮] 机构持仓只有 ${investors.length} 位（预期 ${INVESTOR_EXPECTED} 位），其余数据照常展示`,
    );
  }
  return Boolean(
    snapshot
      && ["live", "partial"].includes(snapshot.status)
      && !Number.isNaN(Date.parse(snapshot.updatedAt))
      && Date.parse(snapshot.updatedAt) <= Date.now() + 5 * 60 * 1000
      && (!Object.prototype.hasOwnProperty.call(snapshot, "revisionAt")
        || (typeof snapshot.revisionAt === "string" && Number.isFinite(Date.parse(snapshot.revisionAt))
          && Date.parse(snapshot.revisionAt) <= Date.now() + 5 * 60 * 1000))
      && Array.isArray(snapshot.us && snapshot.us.stocks)
      && snapshot.us.stocks.length >= 20
      && Array.isArray(snapshot.aShare && snapshot.aShare.quotes)
      && snapshot.aShare.quotes.length >= 20
      && investors
      && investors.length >= INVESTOR_MINIMUM
      && snapshot.gold
      && snapshot.gold.quotes
      && snapshot.gold.quotes.international
      && snapshot.gold.quotes.domestic,
  );
}

function formatSnapshotDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "更新时间待核验";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function snapshotAgeMs(snapshot) {
  const time = Date.parse(snapshot && snapshot.updatedAt);
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - time);
}

function freshnessKind(snapshot, baseSource, warning) {
  const age = weekdayAgeMs(snapshot && snapshot.updatedAt);
  const warnText = String(warning || "");
  // 仅上游不可用 / 明确缓存回退才算异常；后台回源中、内容偏旧都不是故障。
  if (baseSource === "缓存回退" || UPSTREAM_DOWN_RE.test(warnText)) {
    return "cached";
  }
  if (age > STALE_MAX_AGE_MS) {
    return baseSource === "离线备用数据" ? "offline" : "stale";
  }
  if (snapshot.status === "partial") return "partial";
  // 随包/已发布快照仍在服务窗口内：这是当前可用结论，不是故障。
  // 冷启动先读随包时也不要闪「未连云端」橙条，等云端失败且数据已陈旧再提示。
  if (baseSource === "离线备用数据" || baseSource === "自动更新") {
    return "fresh";
  }
  if (age > CURRENT_PUBLISH_MAX_AGE_MS) return "aging";
  return "fresh";
}

function sourceLabel(snapshot, baseSource, warning) {
  const stamp = formatSnapshotDate(snapshot && snapshot.updatedAt);
  const kind = freshnessKind(snapshot, baseSource, warning);
  // 「自动更新」「离线备用数据」字面必须保留给审计；仅在真异常时改前缀。
  if (kind === "fresh") {
    return baseSource === "离线备用数据"
      ? `离线备用数据 · ${stamp}`
      : `自动更新 · ${stamp}`;
  }
  if (kind === "partial") return `部分数据暂缺 · ${stamp}`;
  if (kind === "offline") return `离线备用数据 · ${stamp}`;
  if (kind === "cached") return `缓存回退（上游暂不可用）· ${stamp}`;
  if (kind === "stale") return `数据已陈旧 · ${stamp}`;
  return `最近同步 · ${stamp}`;
}

function isRemoteNewerOrEqual(next, current) {
  return Number.isFinite(Date.parse(next && next.updatedAt)) && compareSnapshotVersions(next, current) >= 0;
}

// 每日自动更新在工作日早上跑一次；超过 30 个工作小时说明直连文件没跟上，改问云函数。
const CDN_ACCEPT_MAX_AGE_MS = 30 * 60 * 60 * 1000;
function isCdnCurrent(snapshot) {
  const updatedAt = snapshot && snapshot.updatedAt;
  return Number.isFinite(Date.parse(updatedAt)) && weekdayAgeMs(updatedAt) <= CDN_ACCEPT_MAX_AGE_MS;
}

function fetchLatest(force) {
  hydrateFromStorage();
  const now = Date.now();
  if (!force && fetchedAt && now - fetchedAt < fetchTtlMs) {
    return Promise.resolve({
      snapshot: memorySnapshot,
      source: memorySource,
      warning: memoryWarning,
      reused: true,
    });
  }
  if (refreshPromise) return refreshPromise;
  const cdnUrl = runtimeConfig && runtimeConfig.snapshotCdnUrl;
  const canUseCdn = Boolean(cdnTransport && cdnTransport.isValidCdnUrl(cdnUrl));
  const canUseCloud = Boolean(typeof wx !== "undefined" && wx && wx.cloud && typeof wx.cloud.callFunction === "function");
  if (!canUseCdn && !canUseCloud) {
    return Promise.resolve(null);
  }
  const payload = { action: "getSnapshot", force: Boolean(force) };
  if (!force && isUsableSnapshot(memorySnapshot) && memorySnapshot.updatedAt) {
    payload.clientUpdatedAt = memorySnapshot.updatedAt;
    payload.clientRevisionAt = memorySnapshot.revisionAt || memorySnapshot.updatedAt;
  }
  const requestRemote = async () => {
    // 方案 A 优先：国内直连文件只在「不比手上旧、且仍在新鲜窗口内」时直接采用；
    // 直连文件停更时继续问云函数（云函数每 30 分钟从公开仓库回源），不让全站钉在旧数据上。
    let cdnFallback = null;
    if (canUseCdn) {
      const cdnResult = await cdnTransport.fetchSnapshotFromCdn(cdnUrl, {
        force: Boolean(force),
        clientUpdatedAt: payload.clientUpdatedAt || "",
        clientRevisionAt: payload.clientRevisionAt || "",
      });
      if (cdnResult && cdnResult.ok) {
        if (cdnResult.unchanged && isUsableSnapshot(memorySnapshot) && isCdnCurrent(memorySnapshot)) return cdnResult;
        if (!cdnResult.unchanged && isUsableSnapshot(cdnResult.data)) {
          if (isCdnCurrent(cdnResult.data) && isRemoteNewerOrEqual(cdnResult.data, memorySnapshot)) return cdnResult;
          cdnFallback = cdnResult;
        }
      }
    }
    if (!canUseCloud) {
      if (cdnFallback) return cdnFallback;
      throw new Error("云端快照暂不可用");
    }
    try {
      const response = await wx.cloud.callFunction({
        name: "aurum-data",
        data: payload,
      });
      const result = response && response.result;
      if ((!result || !result.ok) && cdnFallback) return cdnFallback;
      return result;
    } catch (error) {
      if (cdnFallback) return cdnFallback;
      throw error;
    }
  };
  refreshPromise = requestRemote().then((result) => {
    fetchedAt = Date.now();
    if (!result || !result.ok) throw new Error("云端快照暂不可用");
    const warning = result.warning || "";
    if (result.unchanged && isUsableSnapshot(memorySnapshot)) {
      memorySnapshot = prepareSnapshot(memorySnapshot);
      memorySource = UPSTREAM_DOWN_RE.test(warning) ? "缓存回退" : "自动更新";
      memoryWarning = warning;
      fetchTtlMs = REMOTE_TTL_MS;
      return {
        snapshot: memorySnapshot,
        source: memorySource,
        warning: memoryWarning,
        unchanged: true,
      };
    }
    if (!isUsableSnapshot(result.data)) throw new Error("云端快照暂不可用");
    const remoteSnapshot = prepareSnapshot(result.data);
    // 资料暂缺也是有效的新状态；不能因为黄金区间暂停，就拒收其他市场的新行情。
    if (isRemoteNewerOrEqual(remoteSnapshot, memorySnapshot)) {
      memorySnapshot = remoteSnapshot;
      // CACHE_REFRESHING（后台回源中）以前也被算成「缓存回退」，等于每次云端
      // 顺手刷新都在七个页面顶上挂一条橙色告警。只有取不到数才是回退。
      memorySource = UPSTREAM_DOWN_RE.test(warning) ? "缓存回退" : "自动更新";
      memoryWarning = warning;
      persistToStorage(remoteSnapshot, memorySource, memoryWarning);
    }
    fetchTtlMs = REMOTE_TTL_MS;
    return {
      snapshot: memorySnapshot,
      source: memorySource,
      warning: memoryWarning,
    };
  }).catch(() => {
    fetchedAt = Date.now();
    fetchTtlMs = DEGRADED_TTL_MS;
    memoryWarning = "UPSTREAM_TEMPORARILY_UNAVAILABLE";
    memorySource = "缓存回退";
    return { snapshot: prepareSnapshot(memorySnapshot), source: memorySource, warning: memoryWarning };
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function prefetchSnapshot() {
  hydrateFromStorage();
  return fetchLatest(false).catch(() => null);
}

function loadSnapshot(onUpdate, onComplete, options = {}) {
  hydrateFromStorage();
  let initialSnapshot = prepareSnapshot(memorySnapshot);
  let initialSource = memorySource;
  let initialWarning = memoryWarning;
  if (!isUsableSnapshot(initialSnapshot) && isUsableSnapshot(bundledSnapshot)) {
    initialSnapshot = prepareSnapshot(bundledSnapshot);
    initialSource = "离线备用数据";
    initialWarning = "";
  }
  memorySnapshot = initialSnapshot;
  let deliveredKey = "";
  if (isUsableSnapshot(initialSnapshot)) {
    const initialKind = freshnessKind(initialSnapshot, initialSource, initialWarning);
    deliveredKey = snapshotVersionKey(initialSnapshot, initialKind);
    onUpdate(
      initialSnapshot,
      sourceLabel(initialSnapshot, initialSource, initialWarning),
      { warning: initialWarning, kind: initialKind, versionKey: deliveredKey },
    );
  }
  const force = Boolean(options.force);
  if (!force && deliveredKey && fetchedAt && Date.now() - fetchedAt < fetchTtlMs) {
    if (typeof onComplete === "function") onComplete();
    return;
  }
  const runRemote = () => {
    fetchLatest(force)
      .then((latest) => {
        if (!latest || latest.reused || !isUsableSnapshot(latest.snapshot)) return;
        const nextKind = freshnessKind(latest.snapshot, latest.source, latest.warning);
        const nextKey = snapshotVersionKey(latest.snapshot, nextKind);
        if (latest.unchanged && nextKey === deliveredKey && !force) return;
        onUpdate(
          latest.snapshot,
          sourceLabel(latest.snapshot, latest.source, latest.warning),
          { warning: latest.warning || "", kind: nextKind, versionKey: nextKey },
        );
      })
      .finally(() => {
        if (typeof onComplete === "function") onComplete();
      });
  };
  if (!force && deliveredKey && typeof wx !== "undefined" && wx && typeof wx.canIUse === "function" && typeof setTimeout === "function") {
    setTimeout(runRemote, 48);
  } else {
    runRemote();
  }
}

module.exports = {
  bundledSnapshot,
  isUsableSnapshot,
  loadSnapshot,
  prefetchSnapshot,
  snapshotVersionKey,
  sourceLabel,
  freshnessKind,
  prepareSnapshot,
};
