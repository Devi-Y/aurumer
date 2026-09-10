const { loadSnapshot } = require("../../data/store");
const { loadWorkspace } = require("../../services/member");
const { buildHomeDigest } = require("../../utils/daily-answers");
const { buildDailyCard } = require("../../utils/daily-card");
const { readPrevious, persist, diffText } = require("../../utils/daily-digest-history");
const { track } = require("../../utils/analytics");
const { openPage, goHome } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");

// 未开通/查询失败时看到的完整样例，逐字对齐已确认原型 today() 里的演示数据——
// 这一份本来就是演示内容，原型标了"示例"两个字，忠实照抄就是这里唯一该做的事。
const SAMPLE_ITEMS = [
  {
    no: "01",
    marketId: "hk",
    marketLabel: "港股打新",
    title: "云帆机器人即将截止",
    change: "从「继续观察」到「值得关注」",
    reason: "示例：发行估值更具吸引力，订单增速提供支持。",
    next: "截止前复核最终认购热度与发行定价。",
    risk: "暗盘成交深度可能不足。",
  },
  {
    no: "02",
    marketId: "us",
    marketLabel: "美股投资",
    title: "把云业务投入跟到订单兑现",
    change: "关注点由投入规模转向回报",
    reason: "示例：资本开支增加后，订单增长成为下一阶段重点。",
    next: "跟踪下一次财报中的订单、收入与利润率。",
    risk: "投入可能先压低自由现金流。",
  },
  {
    no: "03",
    marketId: "gold",
    marketLabel: "黄金追踪",
    title: "接近参考区，等待趋势确认",
    change: "价格回落，长期判断暂未改变",
    reason: "示例：价格距离买入参考区收窄，短期仍在调整。",
    next: "观察是否进入参考区并出现企稳迹象。",
    risk: "美元与利率变化可能放大波动。",
  },
];

Page({
  data: {
    memberState: "loading", // loading | active | inactive | error
    dataAsOf: "",
    items: [],
    todayEmpty: false,
    dailyCardPreview: "",
    footerDisclaimer: FOOTER_DISCLAIMER,
    sampleItems: SAMPLE_ITEMS,
  },
  onLoad() {
    this._snapshot = null;
    this.refreshAnswers();
    this.refreshMember();
  },
  onShow() {
    this.refreshAnswers();
    this.refreshMember();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
    this.refreshMember();
  },
  refreshMember() {
    loadWorkspace()
      .then((workspace) => {
        this.setData({ memberState: workspace.active ? "active" : "inactive" });
        this.applyDigest();
      })
      .catch(() => this.setData({ memberState: "error" }));
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        this._snapshot = data;
        this.setData({ dataAsOf: this.formatAsOf(data.updatedAt, meta.kind || "aging") });
        this.applyDigest();
      },
      done,
      { force },
    );
  },
  applyDigest() {
    if (this.data.memberState !== "active" || !this._snapshot) return;
    const digest = buildHomeDigest(this._snapshot, { holdings: [] });
    const highlights = digest.highlights || [];
    const previous = readPrevious();
    const items = highlights.map((item) => ({
      ...item,
      change: diffText(previous, item.id, item.title, item.tone),
    }));
    const nextEntries = {};
    highlights.forEach((item) => {
      if (item.id) nextEntries[item.id] = { title: item.title, tone: item.tone };
    });
    persist(nextEntries);
    this.setData({
      items,
      todayEmpty: !items.length,
      dailyCardPreview: buildDailyCard({
        points: digest.points || [],
        extraLines: digest.cardLines || [],
        asOf: this.data.dataAsOf,
      }),
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
  openResearch(event) {
    const marketId = event.currentTarget.dataset.market;
    if (!marketId) return;
    track("section_open", { market: String(marketId), from: "today_detail" });
    wx.navigateTo({ url: `/pages/section/index?market=${marketId}` });
  },
  openMember() {
    track("member_open", { from: "today_detail" });
    openPage("/pages/member/index");
  },
  copyDailyCard() {
    const text = this.data.dailyCardPreview;
    if (!text) {
      wx.showToast({ title: "今日文案尚未就绪", icon: "none" });
      return;
    }
    track("daily_card_copy");
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "已复制群卡片", icon: "success" }),
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
    track("share_tap", { page: "today" });
    return { title: "望潮 Aurum｜今日重点", path: "/pages/today/index" };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜今日重点" };
  },
});
