const { loadSnapshot } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { loadWorkspace } = require("../../services/member");
const { homeMemberSummary } = require("../../utils/change-center");
const { listHoldings, upsertHolding, removeHolding } = require("../../utils/local-holdings");
const { viewHoldings, holdingsReminder } = require("../../utils/holding-observe");
const { buildThesisTicker } = require("../../utils/thesis-ticker");
const { findPlaybook } = require("../../utils/master-playbooks");
const { buildDailyCard } = require("../../utils/daily-card");
const { buildHomeDigest } = require("../../utils/daily-answers");

const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "上新·值不值得·卖点",
    detail: "申购结论",
    tone: "hk",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七姐妹·底仓配置",
    detail: "公开资料",
    tone: "us",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "底仓·周期·价位",
    detail: "股息清单",
    tone: "a",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "人民币金·美元金",
    detail: "买卖观察区",
    tone: "gold",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "机构持仓",
    help: "持仓·思路·边界",
    detail: "港3 · 美5 · A3",
    tone: "guru",
  },
];

const MEMBER_ENTRY = {
  id: "member",
  icon: "/assets/home/member.svg",
  title: "年费会员",
  help: "关注·变化·复盘",
  detail: "365天 · ¥1288",
  badge: "¥1288/年",
};

const MARKET_OPTIONS = [
  { id: "us", label: "美股" },
  { id: "hk", label: "港股" },
  { id: "a", label: "A股" },
  { id: "gold", label: "黄金" },
];

function buildToday(data, holdings = []) {
  const digest = buildHomeDigest(data, { holdings });
  return {
    points: digest.points,
    cardLines: digest.cardLines,
    help: digest.help,
  };
}

const TODAY_HELP_FRESH = "先看结论再进栏目";
const EMPTY_HOLDING_FORM = { name: "", code: "", cost: "", quantity: "", market: "us" };

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    member: { ...MEMBER_ENTRY },
    today: { points: [] },
    dataAsOf: "",
    freshnessKind: "offline",
    todayHelp: TODAY_HELP_FRESH,
    footerDisclaimer: FOOTER_DISCLAIMER,
    holdings: [],
    holdingsReminder: holdingsReminder([]),
    thesisLines: [],
    thesisIndex: 0,
    showHoldingForm: false,
    marketOptions: MARKET_OPTIONS,
    marketIndex: 0,
    holdingForm: { ...EMPTY_HOLDING_FORM },
    dailyCardPreview: "",
  },
  onLoad() {
    trackHomeVisit();
    this._snapshot = null;
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
        const summary = homeMemberSummary({
          active: workspace.active,
          todayBrief: workspace.todayBrief,
          reviewTasks: workspace.reviewTasks,
        });
        this.setData({
          member: {
            ...this.data.member,
            help: summary.help,
            detail: summary.detail,
          },
        });
      })
      .catch(() => {});
  },
  refreshHoldings(snapshot = this._snapshot, todayPoints = null) {
    const views = viewHoldings(listHoldings(), snapshot || {});
    const reminder = holdingsReminder(views);
    const points = todayPoints || this.data.today?.points || [];
    this.setData({
      holdings: views,
      holdingsReminder: reminder,
      dailyCardPreview: buildDailyCard({
        points,
        extraLines: this.data.today?.cardLines || [],
        asOf: this.data.dataAsOf,
        holdingsReminder: reminder,
      }),
    });
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const asOf = this.formatAsOf(data.updatedAt, kind);
        this._snapshot = data;
        const holdings = listHoldings();
        const thesisLines = buildThesisTicker(data, holdings);
        const today = buildToday(data, holdings);
        this.setData({
          today,
          dataAsOf: asOf,
          freshnessKind: kind,
          todayHelp: today.help || TODAY_HELP_FRESH,
          thesisLines,
          thesisIndex: 0,
        });
        this.refreshHoldings(data, today.points);
        this.startThesisRotate(thesisLines.length);
      },
      done,
      { force },
    );
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
  startThesisRotate(count) {
    if (this._thesisTimer) {
      clearInterval(this._thesisTimer);
      this._thesisTimer = null;
    }
    if (!count || count < 2) return;
    this._thesisTimer = setInterval(() => {
      const next = ((this.data.thesisIndex || 0) + 1) % count;
      this.setData({ thesisIndex: next });
    }, 3800);
  },
  onUnload() {
    if (this._thesisTimer) {
      clearInterval(this._thesisTimer);
      this._thesisTimer = null;
    }
  },
  onHide() {
    if (this._thesisTimer) {
      clearInterval(this._thesisTimer);
      this._thesisTimer = null;
    }
  },
  onShow() {
    this.refreshHoldings();
    this.refreshMemberCard();
    if ((this.data.thesisLines || []).length > 1) {
      this.startThesisRotate(this.data.thesisLines.length);
    }
  },
  openThesisLine() {
    const line = (this.data.thesisLines || [])[this.data.thesisIndex || 0];
    if (!line) return;
    track("detail_open", { market: String(line.market || ""), from: "thesis_ticker" });
    if (line.kind === "playbook" || (line.kind === "answer" && line.modal)) {
      if (line.kind === "answer" && line.modal) {
        wx.showModal({
          title: line.title,
          content: line.modal,
          showCancel: Boolean(line.market),
          cancelText: "关闭",
          confirmText: "打开栏目",
          success: (result) => {
            if (result.confirm && line.market) {
              wx.navigateTo({ url: `/pages/section/index?market=${line.market}` });
            }
          },
        });
        return;
      }
      const book = findPlaybook(line.targetId || line.id);
      if (!book) {
        wx.navigateTo({ url: "/pages/section/index?market=guru" });
        return;
      }
      wx.showModal({
        title: `${book.name} · 策略摘要`,
        content: [
          book.principle,
          `敏感度：${book.sensitivity}`,
          `价值透镜：${book.valueLens}`,
          `边界：${book.doNot}`,
          `来源：${book.sourceNote}`,
        ].join("\n"),
        showCancel: true,
        cancelText: "关闭",
        confirmText: "机构持仓",
        success: (result) => {
          if (result.confirm) wx.navigateTo({ url: "/pages/section/index?market=guru" });
        },
      });
      return;
    }
    if (line.targetId && line.market) {
      wx.navigateTo({
        url: `/pages/detail/index?market=${encodeURIComponent(line.market)}&id=${encodeURIComponent(line.targetId)}`,
      });
      return;
    }
    if (line.market) {
      wx.navigateTo({ url: `/pages/section/index?market=${line.market}` });
    }
  },
  openTodayCategory(event) {
    const market = event.currentTarget.dataset.market;
    if (!market) return;
    track("section_open", { market: String(market), from: "today_category" });
    wx.navigateTo({ url: `/pages/section/index?market=${market}` });
  },
  openTodayTarget(event) {
    const market = event.currentTarget.dataset.market;
    const targetId = String(event.currentTarget.dataset.target || "");
    if (!market) return;
    if (!targetId) {
      this.openTodayCategory({ currentTarget: { dataset: { market } } });
      return;
    }
    track("detail_open", { market: String(market), from: "today_target" });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(market)}&id=${encodeURIComponent(targetId)}`,
    });
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "section") {
      track("section_open", { market: String(entry.id), from: "grid" });
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
    }
  },
  openMemberBanner() {
    track("member_open", { from: "home_banner" });
    openPage("/pages/member/index");
  },
  toggleHoldingForm() {
    this.setData({ showHoldingForm: !this.data.showHoldingForm });
  },
  changeHoldingMarket(event) {
    const index = Number(event.detail.value) || 0;
    const option = MARKET_OPTIONS[index] || MARKET_OPTIONS[0];
    this.setData({
      marketIndex: index,
      "holdingForm.market": option.id,
    });
  },
  inputHoldingName(event) {
    this.setData({ "holdingForm.name": event.detail.value });
  },
  inputHoldingCode(event) {
    this.setData({ "holdingForm.code": event.detail.value });
  },
  inputHoldingCost(event) {
    this.setData({ "holdingForm.cost": event.detail.value });
  },
  inputHoldingQuantity(event) {
    this.setData({ "holdingForm.quantity": event.detail.value });
  },
  saveHolding() {
    try {
      const form = this.data.holdingForm || {};
      const market = form.market || "us";
      const name = String(form.name || "").trim()
        || (market === "gold" ? "黄金" : String(form.code || "").trim().toUpperCase());
      upsertHolding({
        name,
        code: market === "gold" ? (String(form.code || "").trim() || "TRACK") : form.code,
        market,
        cost: form.cost,
        quantity: form.quantity,
      });
      track("add_holding", { market: String(market) });
      this.setData({
        holdingForm: { ...EMPTY_HOLDING_FORM, market },
        showHoldingForm: false,
        marketIndex: Math.max(0, MARKET_OPTIONS.findIndex((item) => item.id === market)),
      });
      this.refreshHoldings();
      wx.showToast({ title: "已加入本机持仓", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "未能保存", icon: "none" });
    }
  },
  deleteHolding(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    removeHolding(id);
    track("holding_delete");
    this.refreshHoldings();
  },
  openHoldingDetail(event) {
    const id = event.currentTarget.dataset.id;
    const row = (this.data.holdings || []).find((item) => item.id === id);
    if (!row) return;
    if (!row.hasDetail || !row.detailMarket || !row.detailId) {
      wx.showToast({ title: "暂无匹配详情", icon: "none" });
      return;
    }
    track("holding_detail_open", { market: String(row.detailMarket) });
    track("detail_open", { market: String(row.detailMarket), from: "holding" });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(row.detailMarket)}&id=${encodeURIComponent(row.detailId)}`,
    });
  },
  copyDailyCard() {
    const text = this.data.dailyCardPreview
      || buildDailyCard({
        points: this.data.today?.points || [],
        extraLines: this.data.today?.cardLines || [],
        asOf: this.data.dataAsOf,
        holdingsReminder: this.data.holdingsReminder,
      });
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
