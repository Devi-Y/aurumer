const { loadSnapshot } = require("../../data/store");
const { allItems, groupDefinitions } = require("../../utils/answers");

Page({
  data: { market: "hk", group: "worth", title: "答案列表", one: "一句话看懂，再进详情。", items: [], source: "正在读取同步数据" },
  onLoad(options) {
    this.setData({ market: options.market || "hk", group: options.group || "worth" });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh()); },
  refresh(done) {
    loadSnapshot((snapshot, source) => {
      const group = groupDefinitions(snapshot, this.data.market).find((item) => item.id === this.data.group);
      const items = allItems(snapshot, this.data.market)
        .filter((item) => item.group === this.data.group)
        .map((item, index) => ({
          id: item.id, name: item.name, code: item.code, badge: item.badge,
          scoreText: item.scoreText || (item.score > 0 ? `${item.score} 分` : "资料待核验"),
          rankText: item.rankText || (item.rank ? `第 ${item.rank} 名` : "暂不排名"),
          one: item.one,
        }));
      this.snapshot = snapshot;
      this.setData({ title: group ? group.title : "答案列表", one: group ? group.one : "一句话看懂，再进详情。", items, source });
    }, done);
  },
  openItem(event) {
    wx.navigateTo({ url: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.title}｜望潮 Aurum`, path: `/pages/list/index?market=${this.data.market}&group=${this.data.group}` };
  },
});
