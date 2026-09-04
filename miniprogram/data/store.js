const bundledSnapshot = require("./live-snapshot");
const { degradeStaleActions } = require("../utils/action-freshness");

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
const ACTION_SYNC_WARNING = "云端动作结论待同步";
// 公开快照工作日约两趟（09:30 / 16:30），周末空窗更长。
// 在云函数仍可服务的 36 小时窗口内，「自动更新」就是当前已发布结论，不要误报成故障。
const CURRENT_PUBLISH_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const STALE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

let memorySnapshot = degradeStaleActions(bundledSnapshot);
let memorySource = "离线备用数据";
let memoryWarning = "";
let fetchedAt = 0;
let fetchTtlMs = REMOTE_TTL_MS;
let refreshPromise = null;

const INVESTOR_MINIMUM = 6;
const INVESTOR_EXPECTED = 9;

function prepareSnapshot(snapshot) {
  return degradeStaleActions(snapshot);
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
      && snapshot.status === "live"
      && !Number.isNaN(Date.parse(snapshot.updatedAt))
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
  const age = snapshotAgeMs(snapshot);
  const warnText = String(warning || "");
  // 仅上游不可用 / 明确缓存回退才算异常；后台回源中、内容偏旧都不是故障。
  if (baseSource === "缓存回退" || UPSTREAM_DOWN_RE.test(warnText)) {
    return "cached";
  }
  if (age > STALE_MAX_AGE_MS) {
    return baseSource === "离线备用数据" ? "offline" : "stale";
  }
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
  if (kind === "offline") return `离线备用数据 · ${stamp}`;
  if (kind === "cached") return `缓存回退（上游暂不可用）· ${stamp}`;
  if (kind === "stale") return `数据已陈旧 · ${stamp}`;
  return `最近同步 · ${stamp}`;
}

function isRemoteNewerOrEqual(next, current) {
  const nextTime = Date.parse(next && next.updatedAt);
  const currentTime = Date.parse(current && current.updatedAt);
  return !Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime >= currentTime);
}

function hasActionSurface(snapshot) {
  return Boolean(
    snapshot
    && snapshot.gold
    && snapshot.gold.answer
    && snapshot.gold.answer.pricePlan
    && snapshot.gold.answer.pricePlan.internationalWatch
  );
}

function fetchLatest(force) {
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
  if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
    return Promise.resolve(null);
  }
  refreshPromise = wx.cloud.callFunction({
    name: "aurum-data",
    data: { action: "getSnapshot", force: Boolean(force) },
  }).then((response) => {
    const result = response && response.result;
    fetchedAt = Date.now();
    if (!result || !result.ok || !isUsableSnapshot(result.data)) return null;
    const warning = result.warning || "";
    const remoteSnapshot = prepareSnapshot(result.data);
    // 云函数若仍是旧清洗层，会剥掉黄金买卖观察区与港股申购结论。
    // 此时保留随包/本机动作版快照，避免「能用」被在线回源刷没。
    if (!hasActionSurface(remoteSnapshot) && hasActionSurface(memorySnapshot)
      && memorySnapshot.actionsFresh !== false) {
      // 云函数是通的，只是这一轮的结论面不完整。保留本机可用结论，但不要按
      // 「上游不可用」报警——顺带把重试间隔缩短，下次进页面就再问一次。
      fetchTtlMs = DEGRADED_TTL_MS;
      memoryWarning = ACTION_SYNC_WARNING;
      return {
        snapshot: memorySnapshot,
        source: memorySource,
        warning: memoryWarning,
      };
    }
    if (isRemoteNewerOrEqual(remoteSnapshot, memorySnapshot)) {
      memorySnapshot = remoteSnapshot;
      // CACHE_REFRESHING（后台回源中）以前也被算成「缓存回退」，等于每次云端
      // 顺手刷新都在七个页面顶上挂一条橙色告警。只有取不到数才是回退。
      memorySource = UPSTREAM_DOWN_RE.test(warning) ? "缓存回退" : "自动更新";
      memoryWarning = warning;
    }
    fetchTtlMs = REMOTE_TTL_MS;
    return {
      snapshot: memorySnapshot,
      source: memorySource,
      warning: memoryWarning,
    };
  }).catch(() => null).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function loadSnapshot(onUpdate, onComplete, options = {}) {
  let initialSnapshot = prepareSnapshot(memorySnapshot);
  let initialSource = memorySource;
  let initialWarning = memoryWarning;
  if (!isUsableSnapshot(initialSnapshot) && isUsableSnapshot(bundledSnapshot)) {
    initialSnapshot = prepareSnapshot(bundledSnapshot);
    initialSource = "离线备用数据";
    initialWarning = "";
  }
  memorySnapshot = initialSnapshot;
  if (isUsableSnapshot(initialSnapshot)) {
    onUpdate(
      initialSnapshot,
      sourceLabel(initialSnapshot, initialSource, initialWarning),
      { warning: initialWarning, kind: freshnessKind(initialSnapshot, initialSource, initialWarning) },
    );
  }
  fetchLatest(Boolean(options.force))
    .then((latest) => {
      if (!latest || latest.reused || !isUsableSnapshot(latest.snapshot)) return;
      onUpdate(
        latest.snapshot,
        sourceLabel(latest.snapshot, latest.source, latest.warning),
        { warning: latest.warning || "", kind: freshnessKind(latest.snapshot, latest.source, latest.warning) },
      );
    })
    .finally(() => {
      if (typeof onComplete === "function") onComplete();
    });
}

module.exports = {
  bundledSnapshot,
  isUsableSnapshot,
  loadSnapshot,
  sourceLabel,
  freshnessKind,
  prepareSnapshot,
};
