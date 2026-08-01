const { loadSnapshot } = require("../../data/store");
const { listHoldings, upsertHolding, removeHolding } = require("../../utils/local-holdings");

const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "新股资料与历史复盘",
    detail: "招股资料",
    tone: "hk",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股机会",
    help: "价格、热度与财务",
    detail: "价格与财报",
    tone: "us",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "股息与现金流",
    detail: "分红与现金流",
    tone: "a",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金机会",
    help: "价格位置与驱动",
    detail: "位置与驱动",
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
    help: "代表机构、公开持仓与方法",
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

function buildToday(data) {
  const researchOrder = { complete: 0, review: 1, limited: 2, withdrawn: 9 };
  const listings = [...(data.hk?.listings || [])].filter((item) => item.researchView?.state !== "withdrawn");
  const listing = listings
    .sort((left, right) =>
      (researchOrder[left.researchView?.state] ?? 9) -
      (researchOrder[right.researchView?.state] ?? 9),
    )[0];
  const hotStock = [...(data.us?.stocks || [])]
    .sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0))[0];
  const dividendStock = [...(data.aShare?.quotes || [])]
    .sort((left, right) => Number(right.currentDividendYield || 0) - Number(left.currentDividendYield || 0))[0];
  const gold = data.gold || {};
  const internationalGold = gold.quotes?.international || {};
  const domesticGold = gold.quotes?.domestic || {};
  const goldConclusion = gold.answer?.researchConclusion || "先核对价格位置与宏观驱动。";

  const hkWindow = listing ? formatOfferWindow(listing) : "";
  const hkNext = listing
    ? (listing.offerPrice
      ? `招股价 ${listing.offerPrice}${listing.entryFee ? ` · 一手约 ${listing.entryFee}` : ""}`
      : (listing.researchView?.label || "先核招股价与认购期"))
    : "暂无在售新股可核";

  // 首屏一句话：优先港股在售动作，其次黄金位置——避免整天只剩一句黄金资料。
  let headline;
  if (listing) {
    headline = `港股：${shortName(listing.name, "新股")} · ${hkNext}${hkWindow ? ` · ${hkWindow}` : ""}`;
  } else {
    headline = /^黄金/.test(goldConclusion) ? goldConclusion : `黄金：${goldConclusion}`;
  }

  return {
    headline,
    metrics: [
      {
        label: "黄金位置",
        value: hasNumber(internationalGold.percentile180) ? `${Number(internationalGold.percentile180)}%` : "待更新",
        hint: "近半年分位",
      },
      {
        label: "美股热度",
        value: hotStock ? hotStock.symbol : "待更新",
        hint: hotStock ? `${hotStock.heatScore} 分` : "公开热度",
      },
      {
        label: "A股股息",
        value: dividendStock && hasNumber(dividendStock.currentDividendYield)
          ? `${Number(dividendStock.currentDividendYield).toFixed(2)}%`
          : "待更新",
        hint: dividendStock ? shortName(dividendStock.name, "公开资料") : "公开资料",
      },
    ],
    points: [
      {
        id: "hk",
        label: "港股",
        value: listing ? `${shortName(listing.name)} · ${hkNext}` : "暂无可核验在售新股",
        note: hkWindow || (listing ? (listing.researchView?.label || "点开核验招股字段") : "去历史复盘看已结束样本"),
      },
      {
        id: "us",
        label: "美股",
        value: hotStock
          ? `${hotStock.symbol} ${signedPercent(hotStock.changePercent)} · 热度 ${hotStock.heatScore}`
          : "市场热度待更新",
        note: hotStock?.marketState === "CLOSED" ? "常规时段已收盘，未含盘后价" : "点开看价格与财务",
      },
      {
        id: "a",
        label: "A股",
        value: dividendStock
          ? `${shortName(dividendStock.name)} · 股息 ${Number(dividendStock.currentDividendYield || 0).toFixed(2)}%`
          : "收息资料待更新",
        note: "下一步：核对自由现金流是否支撑分红",
      },
      {
        id: "gold",
        label: "黄金",
        value: hasNumber(internationalGold.price)
          ? `国际金 ${Number(internationalGold.price).toFixed(1)} · ${signedPercent(internationalGold.changePercent)}`
          : "国际金与上海金资料待更新",
        note: hasNumber(domesticGold.price)
          ? `上海金 ${Number(domesticGold.price).toFixed(2)} 元/克 · ${gold.answer?.macroAvailable === false ? "宏观指标暂缺" : "核利率与持仓"}`
          : (gold.answer?.researchConclusion || "先看价格位置"),
      },
    ],
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
    ].filter(Boolean).join(" · ") || "本机记录",
  }));
}

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    today: {
      headline: "正在整理今天最值得先看的资料",
      summary: "先看结论，再看数据与风险。",
      metrics: [],
      points: [],
    },
    todayExpanded: false,
    refreshedAt: "",
    source: "",
    freshnessKind: "offline",
    holdings: [],
    showHoldingForm: false,
    holdingForm: { name: "", code: "", market: "hk" },
  },
  onLoad() {
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
        this.setData({
          today: buildToday(data),
          refreshedAt: this.formatTime(new Date(data.updatedAt)),
          source,
          freshnessKind: meta.kind || "aging",
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
  toggleTodayDetails() {
    this.setData({ todayExpanded: !this.data.todayExpanded });
  },
  toggleHoldingForm() {
    this.setData({ showHoldingForm: !this.data.showHoldingForm });
  },
  inputHoldingName(event) {
    this.setData({ "holdingForm.name": event.detail.value });
  },
  inputHoldingCode(event) {
    this.setData({ "holdingForm.code": event.detail.value });
  },
  saveHolding() {
    try {
      upsertHolding(this.data.holdingForm);
      this.setData({
        holdingForm: { name: "", code: "", market: "hk" },
        showHoldingForm: false,
        holdings: viewHoldings(listHoldings()),
      });
      wx.showToast({ title: "已加入本机持仓", icon: "success" });
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
    const market = event.currentTarget.dataset.market;
    if (market) wx.navigateTo({ url: `/pages/section/index?market=${market}` });
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "section") {
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
      return;
    }
    if (entry.action === "member") wx.navigateTo({ url: "/pages/member/index" });
  },
  openWorkspace() {
    wx.navigateTo({ url: "/pages/workspace/index?focus=watch" });
  },
  onShareAppMessage() {
    return {
      title: "望潮 Aurum｜今日重点与市场研究",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜今日重点与市场研究" };
  },
});
