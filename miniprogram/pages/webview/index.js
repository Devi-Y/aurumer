const { PUBLIC_ORIGIN } = require("../../config");

const TARGETS = {
  hk: { title: "港股打新", path: "hk-ipo/" },
  us: { title: "美股投资", path: "us-stocks/" },
  a: { title: "A股收息", path: "a-shares/" },
  ipo: { title: "港股新股完整分析", path: "hk-ipo/:id/" },
  stock: { title: "美股完整分析", path: "stocks/:id/" },
  ashare: { title: "A股收息完整分析", path: "a-shares/:id/" },
  guru: { title: "聪明人持仓完整分析", path: "gurus/:id/" },
};

function safeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9.-]/g, "");
}

Page({
  data: { src: `${PUBLIC_ORIGIN}/${TARGETS.hk.path}`, target: "hk", id: "" },
  onLoad(options) {
    const target = TARGETS[options.target] ? options.target : "hk";
    const entry = TARGETS[target];
    const id = safeId(options.id);
    const path = entry.path.replace(":id", encodeURIComponent(id));
    this.setData({ src: `${PUBLIC_ORIGIN}/${path}`, target, id });
    wx.setNavigationBarTitle({ title: entry.title });
  },
  onShareAppMessage() {
    const entry = TARGETS[this.data.target];
    return {
      title: `${entry.title}｜望潮 Aurum`,
      path: `/pages/webview/index?target=${this.data.target}${this.data.id ? `&id=${this.data.id}` : ""}`,
    };
  },
  onShareTimeline() {
    const entry = TARGETS[this.data.target];
    return { title: `${entry.title}｜望潮 Aurum`, query: `target=${this.data.target}${this.data.id ? `&id=${this.data.id}` : ""}` };
  },
});
