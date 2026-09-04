const { loadSnapshot } = require("../../data/store");
const { track } = require("../../utils/analytics");
const { goHome } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { buildNewsFeed, groupFeedByAge } = require("../../utils/news-feed");
// 「数据截至」这句话抬到了 utils/dates.js：栏目页、明细页的页头现在也挂同一句，
// 同一份快照在几个页面上说的时间得是同一个。
const { asOfText } = require("../../utils/dates");

// 一屏放得下、又不至于一次铺 30 多条把页面拉到四千多像素。剩下的按需展开。
const PAGE_SIZE = 12;
// 「上次看到哪儿」只存在本机，不上报。存的是 id@日期 的指纹而不是纯 id：
// 金价这类条目 id 固定、内容每天换，只记 id 会让它永远显示成"看过了"。
const SEEN_KEY = "aurum_news_seen_keys";
const SEEN_VERSION = 1;
// 指纹上限。条目会随时间滚出 feed，但旧指纹留着也没坏处，
// 只是不能无限涨——超了就丢最早写进去的那批。
const SEEN_LIMIT = 240;

// "new" 不是快照里的类目，是本机算出来的一档：上次离开这一页之后才出现的条目。
// 单独给它一个筛选口，页头那句"新增 N 条"才是能点开的，而不只是一句提示。
const NEW_FILTER = "new";

function filterItems(items, filterId) {
  if (!filterId || filterId === "all") return items;
  if (filterId === NEW_FILTER) return items.filter((item) => item.isNew);
  return items.filter((item) => item.kind === filterId);
}

function readSeenKeys() {
  try {
    const raw = wx.getStorageSync(SEEN_KEY);
    if (!raw || raw.version !== SEEN_VERSION || !Array.isArray(raw.keys)) return null;
    return raw.keys;
  } catch (error) {
    // 存储读不出来就当"没有上次记录"，页面照常显示，只是这一次不标新增。
    return null;
  }
}

Page({
  data: {
    items: [],
    sections: [],
    filters: [],
    activeFilter: "all",
    shown: PAGE_SIZE,
    restCount: 0,
    matchCount: 0,
    newCount: 0,
    scopeLabel: "",
    dataAsOf: "",
    freshnessKind: "offline",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    track("news_open");
    // 基线在进页面时读一次就固定住：下拉刷新、切分类都不该让"新增"标记跳走。
    const stored = readSeenKeys();
    this.seen = stored ? new Set(stored) : null;
    this.refresh();
  },
  onUnload() {
    // 离开页面才写回，所以整个浏览过程里"新"这个标记是稳定的；
    // 切到详情页再返回（onHide/onShow）不会把标记清掉。
    this.persistSeen();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  persistSeen() {
    const keys = (this.data.items || []).map((item) => item.key).filter(Boolean);
    if (!keys.length) return;
    const merged = [];
    const dedupe = new Set();
    // 这次看到的排前面，旧指纹接在后面，超出上限时先丢最旧的。
    keys.concat(this.seen ? Array.from(this.seen) : []).forEach((key) => {
      if (dedupe.has(key)) return;
      dedupe.add(key);
      merged.push(key);
    });
    try {
      wx.setStorageSync(SEEN_KEY, { version: SEEN_VERSION, keys: merged.slice(0, SEEN_LIMIT) });
    } catch (error) {
      // 写不进去只影响下次的"新增"提示，不影响这一页能不能看，静默即可。
    }
  },
  refresh(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const feed = buildNewsFeed(data);
        const seen = this.seen;
        // 第一次进这一页没有基线，把 34 条全标成"新增"是噪音不是信息，
        // 所以首访只默默记下指纹，不标任何一条。
        const items = feed.items.map((item) => ({
          ...item,
          isNew: !!seen && !seen.has(item.key),
        }));
        const newCount = items.filter((item) => item.isNew).length;
        const filters = newCount
          ? [{ id: NEW_FILTER, label: "新增", count: newCount }].concat(feed.filters)
          : feed.filters;
        // 数据换一批之后，原来选中的分类可能整类都没有了，这时回到"全部"，
        // 而不是让用户对着一个空列表以为页面坏了。
        const active = filters.some((item) => item.id === this.data.activeFilter)
          ? this.data.activeFilter
          : "all";
        this.setData(
          {
            items,
            filters,
            activeFilter: active,
            newCount,
            scopeLabel: items.length
              ? `共 ${items.length} 条 · ${items[items.length - 1].date} 起`
              : "",
            dataAsOf: asOfText(data.updatedAt, kind),
            freshnessKind: kind,
          },
          () => this.applyView(active, PAGE_SIZE),
        );
      },
      done,
      { force },
    );
  },
  // 过滤 → 截断 → 按新鲜度分段。分段只在已展开的这批上算，
  // 段头写的条数就是它下面真实渲染的条数，不会出现"标 7 条只看到 2 条"。
  applyView(filterId, shown) {
    const matched = filterItems(this.data.items || [], filterId);
    const limit = Math.min(shown, matched.length);
    this.setData({
      sections: groupFeedByAge(matched.slice(0, limit), new Date()),
      shown: limit,
      matchCount: matched.length,
      restCount: matched.length - limit,
    });
  },
  showNewOnly() {
    if (!this.data.newCount || this.data.activeFilter === NEW_FILTER) return;
    this.setData({ activeFilter: NEW_FILTER });
    this.applyView(NEW_FILTER, PAGE_SIZE);
  },
  selectFilter(event) {
    const id = String(event.currentTarget.dataset.id || "all");
    if (id === this.data.activeFilter) return;
    this.setData({ activeFilter: id });
    this.applyView(id, PAGE_SIZE);
  },
  loadMore() {
    if (!this.data.restCount) return;
    track("news_more");
    this.applyView(this.data.activeFilter, this.data.shown + PAGE_SIZE);
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
    this.persistSeen();
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    this.persistSeen();
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
