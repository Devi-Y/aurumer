const bundledSnapshot = require("./live-snapshot");

const REMOTE_TTL_MS = 10 * 60 * 1000;
// 快照超过这个年龄，就算 status=live 也不能再叫「自动更新」——批量刷新一天就两趟，
// 周末还可能空窗 50 小时，用户必须能一眼看出这是「上一份可用数据」。
const FRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

let memorySnapshot = bundledSnapshot;
let memorySource = "离线备用数据";
let memoryWarning = "";
let fetchedAt = 0;
let refreshPromise = null;

const INVESTOR_MINIMUM = 6;
const INVESTOR_EXPECTED = 9;

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
      && snapshot.aShare.quotes.length >= 5
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
  if (warning || baseSource === "缓存回退" || /UPSTREAM|TEMPORARILY|stale/i.test(String(warning || ""))) {
    return "cached";
  }
  if (baseSource === "离线备用数据") return "offline";
  if (age > STALE_MAX_AGE_MS) return "stale";
  if (age > FRESH_MAX_AGE_MS) return "aging";
  if (baseSource === "自动更新") return "fresh";
  return "aging";
}

function sourceLabel(snapshot, baseSource, warning) {
  const stamp = formatSnapshotDate(snapshot && snapshot.updatedAt);
  const kind = freshnessKind(snapshot, baseSource, warning);
  // 「自动更新」「离线备用数据」字面必须保留给审计；陈旧时加诚实前缀，不伪装成刚刷的。
  if (kind === "fresh") return `自动更新 · ${stamp}`;
  if (kind === "offline") return `离线备用数据 · ${stamp}`;
  if (kind === "cached") return `缓存回退（上游暂不可用）· ${stamp}`;
  if (kind === "stale") return `数据已陈旧 · ${stamp}`;
  return `上一份可用数据 · ${stamp}`;
}

function isRemoteNewerOrEqual(next, current) {
  const nextTime = Date.parse(next && next.updatedAt);
  const currentTime = Date.parse(current && current.updatedAt);
  return !Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime >= currentTime);
}

function fetchLatest(force) {
  const now = Date.now();
  if (!force && fetchedAt && now - fetchedAt < REMOTE_TTL_MS) {
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
    if (isRemoteNewerOrEqual(result.data, memorySnapshot)) {
      memorySnapshot = result.data;
      memorySource = warning ? "缓存回退" : "自动更新";
      memoryWarning = warning;
    }
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
  let initialSnapshot = memorySnapshot;
  let initialSource = memorySource;
  let initialWarning = memoryWarning;
  if (!isUsableSnapshot(initialSnapshot) && isUsableSnapshot(bundledSnapshot)) {
    initialSnapshot = bundledSnapshot;
    initialSource = "离线备用数据";
    initialWarning = "";
  }
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
};
