const TARGETS = {
  hk: { title: "港股打新", url: "https://devi-y.github.io/aurumer/hk-ipo/" },
  us: { title: "美股投资", url: "https://devi-y.github.io/aurumer/us-stocks/" },
  a: { title: "A股收息", url: "https://devi-y.github.io/aurumer/a-shares/" },
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
