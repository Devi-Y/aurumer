const bundledSnapshot = require("./live-snapshot");

const REMOTE_TTL_MS = 10 * 60 * 1000;
let memorySnapshot = bundledSnapshot;
let memorySource = "离线备用数据";
let fetchedAt = 0;
let refreshPromise = null;

// 快照当前正好是 9 位机构，阈值也卡在 9，等于完全没有余量：任何一份 13F 延迟披露
// 都会让整份实时数据被判为不可用，静默退回打包时的离线数据。留出余量，并在数量
// 明显偏少时告警，而不是直接丢弃全部行情。
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

function sourceLabel(snapshot, source) {
  return `${source} · ${formatSnapshotDate(snapshot && snapshot.updatedAt)}`;
}

function isRemoteNewerOrEqual(next, current) {
  const nextTime = Date.parse(next && next.updatedAt);
  const currentTime = Date.parse(current && current.updatedAt);
  return !Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime >= currentTime);
}

function fetchLatest(force) {
  const now = Date.now();
  if (!force && fetchedAt && now - fetchedAt < REMOTE_TTL_MS) {
    return Promise.resolve({ snapshot: memorySnapshot, source: memorySource, reused: true });
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
    if (isRemoteNewerOrEqual(result.data, memorySnapshot)) {
      memorySnapshot = result.data;
      memorySource = "自动更新";
    }
    return { snapshot: memorySnapshot, source: memorySource };
  }).catch(() => null).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function loadSnapshot(onUpdate, onComplete, options = {}) {
  let initialSnapshot = memorySnapshot;
  let initialSource = memorySource;
  if (!isUsableSnapshot(initialSnapshot) && isUsableSnapshot(bundledSnapshot)) {
    initialSnapshot = bundledSnapshot;
    initialSource = "离线备用数据";
  }
  if (isUsableSnapshot(initialSnapshot)) {
    onUpdate(initialSnapshot, sourceLabel(initialSnapshot, initialSource));
  }
  fetchLatest(Boolean(options.force))
    .then((latest) => {
      if (!latest || latest.reused || !isUsableSnapshot(latest.snapshot)) return;
      onUpdate(latest.snapshot, sourceLabel(latest.snapshot, latest.source));
    })
    .finally(() => {
      if (typeof onComplete === "function") onComplete();
    });
}

module.exports = { bundledSnapshot, isUsableSnapshot, loadSnapshot };
