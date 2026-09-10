const { loadSnapshot } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { loadWorkspace } = require("../../services/member");
const { buildHomeDigest } = require("../../utils/daily-answers");

// 首页第一块就是这六个入口，照微信「服务」页的分组图标网格：只有图标和名字，
// 没有副标题也没有箭头。help 不再上屏，但留着当读屏标签用。
const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "上新·值得打",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七姐妹·低估与高估",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "分红稳定·分红收益",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "金价·买卖·拐点",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "机构持仓",
    help: "持仓·动向·趋势",
  },
  {
    id: "news",
    action: "page",
    url: "/pages/news/index",
    icon: "/assets/home/news.svg",
    title: "新闻资讯",
    help: "披露·公告·影响",
  },
];

// 未开通时展示的是标注为示例的占位条目，不是真实结论——今日重点是会员内容，
// 不该在免费态就已经把真实判断算出来晾在那里等着被扒。
const SAMPLE_HIGHLIGHTS = [
  { no: "01", marketLabel: "港股打新", title: "新股临近截止时怎么判断参与" },
  { no: "02", marketLabel: "美股投资", title: "七姐妹估值状态发生变化时" },
  { no: "03", marketLabel: "黄金追踪", title: "金价进入参考区间时的提示" },
];

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    dataAsOf: "",
    freshnessKind: "offline",
    memberActive: false,
    memberNote: "365天 · ¥1288",
    memberQueryFailed: false,
    todayItems: SAMPLE_HIGHLIGHTS.map((item) => ({ ...item })),
    todayEmpty: false,
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    trackHomeVisit();
    this._snapshot = null;
    this.refreshAnswers();
    this.refreshMemberCard();
  },
  onShow() {
    // 从详情/section 页返回时结论要跟着同一份数据走，不停在打开小程序那一刻。
    this.refreshAnswers();
    this.refreshMemberCard();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
    this.refreshMemberCard();
  },
  refreshMemberCard() {
    loadWorkspace()
      .then((workspace) => {
        const active = !!workspace.active;
        this.setData({
          memberActive: active,
          memberQueryFailed: false,
          memberNote: active ? this.memberNote(workspace) : "365天 · ¥1288",
        });
        this.applyToday();
      })
      // 查询失败不能悄悄当成「未开通」——那会把「不知道」冒充成一个确定结论。
      .catch(() => this.setData({ memberQueryFailed: true }));
  },
  memberNote(workspace) {
    const expires = workspace && workspace.expiresAt ? new Date(workspace.expiresAt) : null;
    if (expires && !Number.isNaN(expires.getTime())) {
      const pad = (value) => String(value).padStart(2, "0");
      return `有效期至 ${expires.getFullYear()}-${pad(expires.getMonth() + 1)}-${pad(expires.getDate())}`;
    }
    return "会员已开通";
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        this._snapshot = data;
        this.setData({
          dataAsOf: this.formatAsOf(data.updatedAt, kind),
          freshnessKind: kind,
        });
        this.applyToday();
      },
      done,
      { force },
    );
  },
  // 今日重点是会员内容：没开通就不算，连算都不算——省掉一次全量摘要，
  // 首页也就少了一段开屏计算，非会员看到的是标注为示例的占位条目。
  applyToday() {
    if (!this.data.memberActive) {
      if (this.data.todayItems.length !== SAMPLE_HIGHLIGHTS.length || this.data.todayEmpty) {
        this.setData({
          todayItems: SAMPLE_HIGHLIGHTS.map((item) => ({ ...item })),
          todayEmpty: false,
        });
      }
      return;
    }
    if (!this._snapshot) return;
    const digest = buildHomeDigest(this._snapshot, { holdings: [] });
    this.setData({
      todayItems: digest.highlights || [],
      todayEmpty: !(digest.highlights || []).length,
    });
  },
  formatTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
  formatAsOf(value, kind = "aging") {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "数据截至待核验";
    const stamp = this.formatTime(date);
    if (kind === "stale") return `数据截至 ${stamp} · 已偏旧`;
    return `数据截至 ${stamp}`;
  },
  // 未开通时行数据没有 marketId（示例条目只标了方向文字，不接真实市场），
  // 点了直接引导去开通,而不是假装能跳转到一个不存在的目标。
  openTodayRow(event) {
    const marketId = event.currentTarget.dataset.market;
    if (!this.data.memberActive || !marketId) {
      this.openMemberBanner();
      return;
    }
    const targetId = String(event.currentTarget.dataset.target || "");
    if (targetId) {
      track("detail_open", { market: String(marketId), from: "today_highlight" });
      wx.navigateTo({
        url: `/pages/detail/index?market=${encodeURIComponent(marketId)}&id=${encodeURIComponent(targetId)}`,
      });
      return;
    }
    track("section_open", { market: String(marketId), from: "today_highlight" });
    wx.navigateTo({ url: `/pages/section/index?market=${marketId}` });
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "section") {
      track("section_open", { market: String(entry.id), from: "grid" });
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
      return;
    }
    // 新闻资讯不是行情栏目，走自己的页面。
    if (entry.action === "page" && entry.url) {
      openPage(entry.url);
    }
  },
  openMemberBanner() {
    track("member_open", { from: this.data.memberActive ? "home_today_member" : "home_today_lock" });
    openPage("/pages/member/index");
  },
  openTodayPage() {
    track("today_expand", { from: "home_today_foot" });
    wx.navigateTo({ url: "/pages/today/index" });
  },
  onShareAppMessage() {
    track("share_tap", { page: "home" });
    return {
      title: "望潮 Aurum｜今日重点与市场研究",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜今日重点与市场研究" };
  },
});
