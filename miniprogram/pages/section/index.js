const { loadSnapshot } = require("../../data/store");
const { groupDefinitions } = require("../../utils/answers");

const META = {
  hk: { title: "港股打新", one: "先选结论，再看具体新股。", tone: "hk" },
  us: { title: "美股投资", one: "只看七姐妹和热度前三。", tone: "us" },
  a: { title: "A股收息", one: "先看买入、等待还是回避。", tone: "a" },
  gold: { title: "黄金投资", one: "第 4 个模块：先看答案，再看价格与驱动。", tone: "gold" },
  guru: { title: "聪明人持仓", one: "最后一个模块：港股 3、美股 5、A股 3。", tone: "guru" },
};

Page({
  data: { market: "hk", meta: META.hk, groups: [], source: "正在读取同步数据" },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    this.setData({ market, meta: META[market] });
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh());
  },
  refresh(done) {
    loadSnapshot((snapshot, source) => {
      this.setData({ groups: groupDefinitions(snapshot, this.data.market), source });
    }, done);
  },
  openGroup(event) {
    const group = event.currentTarget.dataset.group;
    wx.navigateTo({ url: `/pages/list/index?market=${this.data.market}&group=${group}` });
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.meta.title}｜望潮 Aurum`, path: `/pages/section/index?market=${this.data.market}` };
  },
  onShareTimeline() {
    return { title: `${this.data.meta.title}｜望潮 Aurum`, query: `market=${this.data.market}` };
  },
});
