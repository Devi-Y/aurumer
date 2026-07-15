const bundledSnapshot = require("./live-snapshot");
const { PUBLIC_ORIGIN } = require("../config");

function isUsableSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      Array.isArray(snapshot.us && snapshot.us.stocks) &&
      Array.isArray(snapshot.aShare && snapshot.aShare.quotes) &&
      Array.isArray(snapshot.investors),
  );
}

function loadSnapshot(onUpdate, onComplete) {
  if (isUsableSnapshot(bundledSnapshot)) {
    onUpdate(bundledSnapshot, "本地同步数据");
  }

  wx.request({
    url: `${PUBLIC_ORIGIN}/data/live-snapshot.json`,
    timeout: 8000,
    success: ({ data }) => {
      if (isUsableSnapshot(data)) onUpdate(data, "在线公开数据");
    },
    fail: () => {},
    complete: () => {
      if (typeof onComplete === "function") onComplete();
    },
  });
}

module.exports = { bundledSnapshot, loadSnapshot };
