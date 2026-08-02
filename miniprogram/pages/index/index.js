const { loadSnapshot } = require("../../data/store");
const { listHoldings, upsertHolding, removeHolding } = require("../../utils/local-holdings");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { track } = require("../../utils/analytics");
const { openTab } = require("../../utils/nav");

const MARKET_OPTIONS = [
  { id: "hk", label: "港股" },
  { id: "us", label: "美股" },
  { id: "a", label: "A股" },
  { id: "gold", label: "黄金" },
  { id: "other", label: "其他" },
];

const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "有哪些新股、能不能打",
    detail: "申购结论",
    tone: "hk",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七姐妹与热度前三",
    detail: "价格与财报",
    tone: "us",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "谁分红高、稳不稳",
    detail: "股息清单",
    tone: "a",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "何时买、买多少、何时卖",
    detail: "买卖观察",
    tone: "gold",
  },
  {
    id: "member",
    action: "member",
    icon: "/assets/home/member.svg",
    title: "年费会员",
    help: "365天会员与记录工具",
    detail: "365天 · ¥1288",
    badge: "¥1288/年",
    tone: "member",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "机构持仓",
    help: "学思路、对照持仓",
    detail: "港3 · 美5 · A3",
    tone: "guru",
  },
];

const MARKET_LABELS = {
  hk: "港股",
  us: "美股",
  a: "A股",
  gold: "黄金",
  other: "其他",
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function shortName(value, fallback) {
  const name = String(value || fallback || "待更新");
  return name.length > 10 ? `${name.slice(0, 10)}…` : name;
}

function signedPercent(value) {
  if (!hasNumber(value)) return "涨跌待更新";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatOfferWindow(listing) {
  const start = listing.offerStart || listing.offerPeriodStart;
  const end = listing.offerDeadline || listing.offerEnd || listing.offerPeriodEnd;
  if (start && end) return `认购 ${start} 至 ${end}`;
  if (end) return `认购截止 ${end}`;
  if (listing.listingDate) return `上市日 ${listing.listingDate}`;
  return "";
}

function listingId(listing) {
  return String(listing?.rawCode || listing?.code || listing?.id || "").replace(/\.HK$/i, "");
}

function aShareId(quote) {
  return String(quote?.code || quote?.id || "").replace(/\.(SH|SZ)$/i, "");
}

function buildToday(data) {
  const listings = [...(data.hk?.listings || [])].filter((item) => item.researchView?.state !== "withdrawn");
  const listing = [...listings].sort((left, right) => {
    const rank = (item) => {
      const verdict = item.publicAnswer?.verdict;
      if (verdict === "值得打") return 0;
      if (verdict === "谨慎打") return 1;
      if (verdict === "不建议") return 2;
      if (item.researchView?.state === "complete") return 3;
      if (item.researchView?.state === "review") return 4;
      return 5;
    };
    return rank(left) - rank(right);
  })[0];
  const hotStock = [...(data.us?.stocks || [])]
    .sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0))[0];
  const dividendStock = [...(data.aShare?.quotes || [])]
    .sort((left, right) => Number(right.currentDividendYield || 0) - Number(left.currentDividendYield || 0))[0];
  const gold = data.gold || {};
  const internationalGold = gold.quotes?.international || {};
  const domesticGold = gold.quotes?.domestic || {};
  const goldAction = gold.answer?.action || "继续观察";
  const hkVerdictMap = { 值得打: "建议申购", 谨慎打: "暂缓观察", 不建议: "暂不建议", 待核验: "资料不够" };
  const hkBadge = listing
    ? (hkVerdictMap[listing.publicAnswer?.verdict] || listing.researchView?.label || "先看资料")
    : "";
  const hkWindow = listing ? formatOfferWindow(listing) : "";
  const hkBits = listing
    ? [
      listing.offerPrice ? `招股价 ${listing.offerPrice}` : null,
      listing.entryFee ? `一手约 ${listing.entryFee} 港元` : null,
    ].filter(Boolean).join(" · ")
    : "";

  let headline;
  if (listing) {
    headline = `港股「${shortName(listing.name, "新股")}」${hkBadge}${hkBits ? `，${hkBits}` : ""}${hkWindow ? `，${hkWindow}` : ""}`;
  } else if (dividendStock) {
    headline = `价格与收息：A股「${shortName(dividendStock.name)}」股息 ${Number(dividendStock.currentDividendYield || 0).toFixed(2)}%；黄金${goldAction}。`;
  } else {
    headline = `黄金现在：${goldAction}${hasNumber(internationalGold.price) ? `；国际金 ${Number(internationalGold.price).toFixed(0)} 美元/盎司` : ""}`;
  }

  const goldPrice = hasNumber(internationalGold.price)
    ? Number(internationalGold.price).toFixed(0)
    : "";
  const hero = goldPrice
    ? {
        label: "国际金价",
        value: goldPrice,
        unit: "美元/盎司",
        note: goldAction,
      }
    : {
        label: "今日重点",
        value: listing ? (hkBadge || "先看资料") : goldAction,
        unit: listing ? shortName(listing.name, "港股新股") : "黄金追踪",
        note: todayHelp("fresh"),
      };

  const points = [
    {
      id: "hk",
      market: "hk",
      targetId: listing ? listingId(listing) : "",
      label: "港股",
      value: listing ? shortName(listing.name) : "暂无在售",
      note: listing ? (hkBadge || "点开看认购") : "去历史收录复盘",
      interactive: Boolean(listing),
    },
    {
      id: "us",
      market: "us",
      targetId: hotStock ? String(hotStock.symbol) : "",
      label: "美股",
      value: hotStock ? hotStock.symbol : "待更新",
      note: hotStock
        ? `热度 ${hotStock.heatScore}${signedPercent(hotStock.changePercent) ? ` · ${signedPercent(hotStock.changePercent)}` : ""}`
        : "公开热度待更新",
      interactive: Boolean(hotStock),
    },
    {
      id: "a",
      market: "a",
      targetId: dividendStock ? aShareId(dividendStock) : "",
      label: "A股",
      value: dividendStock && hasNumber(dividendStock.currentDividendYield)
        ? `${Number(dividendStock.currentDividendYield).toFixed(2)}%`
        : (dividendStock ? shortName(dividendStock.name) : "待更新"),
      note: dividendStock ? shortName(dividendStock.name) : "收息资料待更新",
      interactive: Boolean(dividendStock),
    },
    {
      id: "gold",
      market: "gold",
      targetId: "track",
      label: "黄金",
      value: hasNumber(internationalGold.percentile180)
        ? `${Number(internationalGold.percentile180)}%`
        : goldAction,
      note: hasNumber(internationalGold.percentile180)
        ? `半年位置 · ${goldAction}`
        : (hasNumber(domesticGold.price) ? `上海金 ${Number(domesticGold.price).toFixed(2)}` : "点开看买卖点"),
      interactive: true,
    },
  ];

  return {
    headline,
    hero,
    metrics: points.map((item) => ({
      label: item.label,
      value: item.value,
      hint: item.note,
      market: item.market,
      targetId: item.targetId,
      interactive: item.interactive,
    })),
    points,
  };
}

function viewHoldings(items) {
  return (items || []).map((item) => ({
    ...item,
    marketLabel: MARKET_LABELS[item.market] || "其他",
    meta: [
      item.code || null,
      hasNumber(item.cost) ? `成本 ${item.cost}` : null,
      hasNumber(item.quantity) ? `${item.quantity} 股/克` : null,
    ].filter(Boolean).join(" · ") || "本机速记",
  }));
}

function todayTitle(kind) {
  if (kind === "stale" || kind === "offline") return "上一份可用重点";
  if (kind === "cached" || kind === "aging") return "上一份可用重点";
  return "今日重点";
}

function todayHelp(kind) {
  if (kind === "fresh") return "今天先看这几件事";
  if (kind === "offline") return "当前为随包备用数据";
  if (kind === "cached") return "上游暂不可用，显示缓存";
  return "数据非实时，先看结论再下钻";
}

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    today: {
      headline: "正在整理今天先看的几件事",
      summary: "先看结论，再点进去。",
      hero: { label: "今日重点", value: "更新中", unit: "", note: "" },
      metrics: [],
      points: [],
    },
    todayTitle: "今日重点",
    todayHelp: "今天先看这几件事",
    todayExpanded: false,
    showHoldingsPanel: false,
    refreshedAt: "",
    dataAsOf: "",
    source: "",
    freshnessKind: "offline",
    footerDisclaimer: FOOTER_DISCLAIMER,
    holdings: [],
    showHoldingForm: false,
    marketOptions: MARKET_OPTIONS,
    marketIndex: 0,
    holdingForm: { name: "", code: "", cost: "", quantity: "" },
  },
  onLoad() {
    track("home_open");
    this.refreshHoldings();
    this.refreshAnswers();
  },
  onShow() {
    this.refreshHoldings();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
  },
  refreshHoldings() {
    this.setData({ holdings: viewHoldings(listHoldings()) });
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        this.setData({
          today: buildToday(data),
          refreshedAt: this.formatTime(new Date(data.updatedAt)),
          dataAsOf: this.formatAsOf(data.updatedAt),
          source,
          freshnessKind: kind,
          todayTitle: todayTitle(kind),
          todayHelp: todayHelp(kind),
        });
      },
      done,
      { force },
    );
  },
  formatTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
  formatAsOf(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "更新时间待核验";
    return `数据截至 ${this.formatTime(date)}`;
  },
  toggleTodayDetails() {
    const next = !this.data.todayExpanded;
    this.setData({ todayExpanded: next });
    if (next) track("today_expand");
  },
  toggleHoldingsPanel() {
    this.setData({ showHoldingsPanel: !this.data.showHoldingsPanel });
  },
  toggleHoldingForm() {
    this.setData({
      showHoldingForm: !this.data.showHoldingForm,
      showHoldingsPanel: true,
    });
  },
  changeHoldingMarket(event) {
    this.setData({ marketIndex: Number(event.detail.value) || 0 });
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
      const market = MARKET_OPTIONS[this.data.marketIndex] || MARKET_OPTIONS[0];
      upsertHolding({
        ...this.data.holdingForm,
        market: market.id,
      });
      this.setData({
        holdingForm: { name: "", code: "", cost: "", quantity: "" },
        marketIndex: 0,
        showHoldingForm: false,
        holdings: viewHoldings(listHoldings()),
      });
      wx.showToast({ title: "已加入本机速记", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "未能保存", icon: "none" });
    }
  },
  deleteHolding(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    removeHolding(id);
    this.setData({ holdings: viewHoldings(listHoldings()) });
  },
  openTodayPoint(event) {
    const { market, id, interactive } = event.currentTarget.dataset;
    if (!market) return;
    if (interactive === false || interactive === "false" || !id) {
      track("section_open", { market: String(market), from: "today" });
      wx.navigateTo({ url: `/pages/section/index?market=${market}` });
      return;
    }
    track("detail_open", { market: String(market), from: "today" });
    wx.navigateTo({
      url: `/pages/detail/index?market=${market}&id=${encodeURIComponent(id)}`,
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
    if (entry.action === "member") openTab("/pages/member/index");
  },
  openWorkspace() {
    track("workspace_open", { from: "home" });
    openTab("/pages/workspace/index?focus=watch");
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
