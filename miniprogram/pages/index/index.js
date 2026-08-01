const { loadSnapshot } = require("../../data/store");
const { listHoldings, upsertHolding, removeHolding } = require("../../utils/local-holdings");

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
  } else {
    headline = `黄金现在：${goldAction}${hasNumber(internationalGold.price) ? `；国际金 ${Number(internationalGold.price).toFixed(0)} 美元/盎司` : ""}`;
  }

  return {
    headline,
    metrics: [
      {
        label: "黄金动作",
        value: goldAction,
        hint: hasNumber(internationalGold.percentile180) ? `半年位置 ${Number(internationalGold.percentile180)}%` : "价格追踪",
      },
      {
        label: "美股最热",
        value: hotStock ? hotStock.symbol : "待更新",
        hint: hotStock ? `热度 ${hotStock.heatScore}` : "公开热度",
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
        value: listing ? `${shortName(listing.name)} · ${hkBadge}` : "今天没有在售新股",
        note: listing ? (hkBits || hkWindow || "点开看认购细节") : "去历史复盘看以前打新结果",
      },
      {
        id: "us",
        label: "美股",
        value: hotStock
          ? `${hotStock.symbol} ${signedPercent(hotStock.changePercent)} · 今天最热闹`
          : "市场热度待更新",
        note: "下一步：看七姐妹和热度前三",
      },
      {
        id: "a",
        label: "A股",
        value: dividendStock
          ? `${shortName(dividendStock.name)} · 股息 ${Number(dividendStock.currentDividendYield || 0).toFixed(2)}%`
          : "收息资料待更新",
        note: "下一步：看股息稳不稳、现金流够不够",
      },
      {
        id: "gold",
        label: "黄金",
        value: `${goldAction}${hasNumber(internationalGold.price) ? ` · 国际金 ${Number(internationalGold.price).toFixed(0)}` : ""}`,
        note: hasNumber(domesticGold.price)
          ? `上海金 ${Number(domesticGold.price).toFixed(2)} 元/克 · 点开看买点卖点`
          : "点开看买点、卖点和原因",
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
      headline: "正在整理今天先看的几件事",
      summary: "先看结论，再点进去。",
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
