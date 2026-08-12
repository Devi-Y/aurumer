const { loadSnapshot } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { shortCompanyName, allItems } = require("../../utils/answers");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { loadWorkspace } = require("../../services/member");
const { homeMemberSummary } = require("../../utils/change-center");
const { listHoldings, upsertHolding, removeHolding } = require("../../utils/local-holdings");
const { viewHoldings, holdingsReminder } = require("../../utils/holding-observe");
const { buildThesisTicker } = require("../../utils/thesis-ticker");
const { findPlaybook } = require("../../utils/master-playbooks");
const { buildDailyCard } = require("../../utils/daily-card");

const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "值不值得打·中签",
    detail: "申购结论",
    tone: "hk",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "价格与财报对照",
    detail: "公开资料",
    tone: "us",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "股息与现金流",
    detail: "股息清单",
    tone: "a",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "价格位置观察",
    detail: "买卖观察区",
    tone: "gold",
  },
  {
    id: "member",
    action: "member",
    icon: "/assets/home/member.svg",
    title: "年费会员",
    help: "关注·变化·复盘",
    detail: "365天 · ¥1288",
    badge: "¥1288/年",
    tone: "member",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "机构持仓",
    help: "学思路对照仓",
    detail: "港3 · 美5 · A3",
    tone: "guru",
  },
];

const MARKET_OPTIONS = [
  { id: "us", label: "美股" },
  { id: "hk", label: "港股" },
  { id: "a", label: "A股" },
  { id: "gold", label: "黄金" },
];

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function bestByScore(items) {
  return [...items]
    .map((item) => ({ item, scored: scoreForItem(item) }))
    .filter((entry) => entry.scored.score != null)
    .sort((left, right) => Number(right.scored.score) - Number(left.scored.score))[0]?.item
    || items[0]
    || null;
}

function buildToday(data) {
  // 今日重点按研究观察分排序，仅作资料对照，不是收益预测。
  const hkLive = allItems(data, "hk").filter((item) => (
    item.group !== "ended" && item.group !== "cancelled"
  ));
  const hkPrefer = hkLive.filter((item) => item.group === "worth");
  const hkLead = bestByScore(hkPrefer.length ? hkPrefer : hkLive);

  const usItems = allItems(data, "us");
  const usLead = bestByScore(usItems);

  const aItems = allItems(data, "a");
  const aLead = bestByScore(aItems);

  const gold = data.gold || {};
  const internationalGold = gold.quotes?.international || {};
  const goldPrice = hasNumber(internationalGold.price)
    ? Math.round(Number(internationalGold.price))
    : null;

  const hkId = hkLead
    ? String(hkLead.id || hkLead.code || "").replace(/\.HK$/i, "")
    : "";
  const hkName = hkLead
    ? shortCompanyName(hkLead.name, "新股", 4)
    : "暂无";
  const usId = usLead ? String(usLead.code || usLead.id || "") : "";
  const aId = aLead
    ? String(aLead.id || aLead.code || "").replace(/\.(SH|SZ)$/i, "")
    : "";
  const aName = aLead
    ? shortCompanyName(aLead.name, "收息", 4)
    : "待更新";

  return {
    points: [
      {
        id: "hk",
        label: "港股",
        value: hkName,
        targetId: hkId,
        hasTarget: Boolean(hkId),
        ariaCategory: "打开港股打新栏目",
        ariaTarget: hkId ? `打开港股标的 ${hkName}` : "港股暂无标的",
      },
      {
        id: "us",
        label: "美股",
        value: usId || "—",
        targetId: usId,
        hasTarget: Boolean(usId),
        ariaCategory: "打开美股投资栏目",
        ariaTarget: usId ? `打开美股标的 ${usId}` : "美股暂无标的",
      },
      {
        id: "a",
        label: "A股",
        value: aName,
        targetId: aId,
        hasTarget: Boolean(aId),
        ariaCategory: "打开A股收息栏目",
        ariaTarget: aId ? `打开A股标的 ${aName}` : "A股暂无标的",
      },
      {
        id: "gold",
        label: "黄金",
        value: goldPrice != null ? String(goldPrice) : "—",
        targetId: "track",
        hasTarget: true,
        ariaCategory: "打开黄金追踪栏目",
        ariaTarget: goldPrice != null ? `打开黄金观察 ${goldPrice}` : "打开黄金追踪",
      },
    ],
  };
}

const TODAY_HELP_FRESH = "今天重点关注标的";
const EMPTY_HOLDING_FORM = { name: "", code: "", cost: "", quantity: "", market: "us" };

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
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
        const entries = this.data.entries.map((item) => {
          if (item.id !== "member") return item;
          return {
            ...item,
            help: summary.help,
            detail: summary.detail,
          };
        });
        this.setData({ entries });
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
        const thesisLines = buildThesisTicker(data);
        const today = buildToday(data);
        this.setData({
          today,
          dataAsOf: asOf,
          freshnessKind: kind,
          todayHelp: TODAY_HELP_FRESH,
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
    if (line.kind === "playbook") {
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
      return;
    }
    if (entry.action === "member") openPage("/pages/member/index");
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
