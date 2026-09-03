const { loadSnapshot } = require("../../data/store");
const { track } = require("../../utils/analytics");
const { goHome } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { buildNewsFeed } = require("../../utils/news-feed");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatAsOf(value, kind) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "数据截至待核验";
  const stamp = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (kind === "stale") return `数据截至 ${stamp} · 已偏旧`;
  return `数据截至 ${stamp}`;
}

function filterItems(items, filterId) {
  if (!filterId || filterId === "all") return items;
  return items.filter((item) => item.kind === filterId);
}

Page({
  data: {
    items: [],
    visible: [],
    filters: [],
    activeFilter: "all",
    dataAsOf: "",
    freshnessKind: "offline",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    track("news_open");
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  refresh(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const feed = buildNewsFeed(data);
        // 数据换一批之后，原来选中的分类可能整类都没有了，这时回到"全部"，
        // 而不是让用户对着一个空列表以为页面坏了。
        const active = feed.filters.some((item) => item.id === this.data.activeFilter)
          ? this.data.activeFilter
          : "all";
        this.setData({
          items: feed.items,
          filters: feed.filters,
          activeFilter: active,
          visible: filterItems(feed.items, active),
          dataAsOf: formatAsOf(data.updatedAt, kind),
          freshnessKind: kind,
        });
      },
      done,
      { force },
    );
  },
  selectFilter(event) {
    const id = String(event.currentTarget.dataset.id || "all");
    if (id === this.data.activeFilter) return;
    this.setData({
      activeFilter: id,
      visible: filterItems(this.data.items, id),
    });
  },
  openItem(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const item = (this.data.items || []).find((row) => row.id === id);
    if (!item || !item.market) return;
    track("news_item_open", { market: String(item.market) });
    if (item.targetId) {
      track("detail_open", { market: String(item.market), from: "news" });
      wx.navigateTo({
        url: `/pages/detail/index?market=${encodeURIComponent(item.market)}&id=${encodeURIComponent(item.targetId)}`,
      });
      return;
    }
    // 这条披露的标的不在当前样本池里（例如 A 股只做深度收息样本），
    // 落回它所属的栏目，总比点了没反应好。
    track("section_open", { market: String(item.market), from: "news" });
    wx.navigateTo({ url: `/pages/section/index?market=${item.market}` });
  },
  copySource(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const item = (this.data.items || []).find((row) => row.id === id);
    if (!item) return;
    if (!item.sourceUrl) {
      wx.showToast({ title: item.sourceName || "来源待核验", icon: "none" });
      return;
    }
    // 小程序打不开任意外链，所以来源只能复制出去自己核对。
    track("news_source_copy", { market: String(item.market || "") });
    wx.setClipboardData({
      data: item.sourceUrl,
      success: () => wx.showToast({ title: "已复制来源链接", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "news" });
    return {
      title: "望潮 Aurum｜公开披露与数据变化",
      path: "/pages/news/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜公开披露与数据变化" };
  },
});
