const runtime = require("./config/runtime");
const { prefetchSnapshot } = require("./data/store");

App({
  onLaunch() {
    if (!runtime.cloudEnv || !wx.cloud) return;
    wx.cloud.init({
      env: runtime.cloudEnv,
    });
    // 启动后异步预热云端快照，与首页随包首帧渲染并行，不阻塞打开速度。
    setTimeout(() => prefetchSnapshot(), 0);
  },
  globalData: {
    dataMode: "cloud-live-with-bundled-fallback",
    memberBackendReady: Boolean(runtime.cloudEnv),
  },
});
