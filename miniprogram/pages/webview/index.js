const { PUBLIC_ORIGIN } = require("../../config");

const TARGETS = {
  hk: { title: "港股打新", url: `${PUBLIC_ORIGIN}/hk-ipo/` },
  us: { title: "美股投资", url: `${PUBLIC_ORIGIN}/us-stocks/` },
  a: { title: "A股收息", url: `${PUBLIC_ORIGIN}/a-shares/` },
};

Page({
  data: { src: TARGETS.hk.url, target: "hk" },
  onLoad(options) {
    const target = TARGETS[options.target] ? options.target : "hk";
    const entry = TARGETS[target];
    this.setData({ src: entry.url, target });
    wx.setNavigationBarTitle({ title: entry.title });
  },
  onShareAppMessage() {
    const entry = TARGETS[this.data.target];
    return {
      title: `${entry.title}｜望潮 Aurum`,
      path: `/pages/webview/index?target=${this.data.target}`,
    };
  },
  onShareTimeline() {
    const entry = TARGETS[this.data.target];
    return { title: `${entry.title}｜望潮 Aurum`, query: `target=${this.data.target}` };
  },
});
