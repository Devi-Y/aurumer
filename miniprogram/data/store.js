const bundledSnapshot = require("./live-snapshot");

const REMOTE_TTL_MS = 10 * 60 * 1000;
let memorySnapshot = bundledSnapshot;
let memorySource = "离线备用数据";
let fetchedAt = 0;
let refreshPromise = null;

function isUsableSnapshot(snapshot) {
  return Boolean(
    snapshot
      && snapshot.status === "live"
      && !Number.isNaN(Date.parse(snapshot.updatedAt))
      && Array.isArray(snapshot.us && snapshot.us.stocks)
      && snapshot.us.stocks.length >= 20
      && Array.isArray(snapshot.aShare && snapshot.aShare.quotes)
      && snapshot.aShare.quotes.length >= 5
      && Array.isArray(snapshot.investors)
      && snapshot.investors.length >= 9
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
