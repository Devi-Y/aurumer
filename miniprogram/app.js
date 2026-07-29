const runtime = require("./config/runtime");

App({
  onLaunch() {
    if (!runtime.cloudEnv || !wx.cloud) return;
    wx.cloud.init({
      env: runtime.cloudEnv,
    });
  },
  globalData: {
    dataMode: "cloud-live-with-bundled-fallback",
    memberBackendReady: Boolean(runtime.cloudEnv),
  },
});
