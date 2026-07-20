const bundledSnapshot = require("./live-snapshot");

function isUsableSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      Array.isArray(snapshot.us && snapshot.us.stocks) &&
      Array.isArray(snapshot.aShare && snapshot.aShare.quotes) &&
      Array.isArray(snapshot.investors),
  );
}

function formatSnapshotDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "更新时间待核验";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function loadSnapshot(onUpdate, onComplete) {
  if (isUsableSnapshot(bundledSnapshot)) {
    const updatedAt = formatSnapshotDate(bundledSnapshot.updatedAt);
    onUpdate(bundledSnapshot, `公开数据快照 · ${updatedAt}`);
  }
  if (typeof onComplete === "function") onComplete();
}

module.exports = { bundledSnapshot, loadSnapshot };
