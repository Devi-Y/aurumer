const { loadSnapshot } = require("../../data/store");
const { track } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { shortCompanyName } = require("../../utils/answers");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");

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

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
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

  const hkId = listing
    ? String(listing.rawCode || listing.code || listing.id || "").replace(/\.HK$/i, "")
    : "";
  const hkName = listing
    ? shortCompanyName(listing.shortName || listing.name, "新股", 4)
    : "暂无";
  const usId = hotStock ? String(hotStock.symbol || "") : "";
  const aId = dividendStock
    ? String(dividendStock.code || "").replace(/\.(SH|SZ)$/i, "")
    : "";
  const aName = dividendStock
    ? shortCompanyName(dividendStock.name, "收息", 4)
    : "待更新";
  const goldPrice = hasNumber(internationalGold.price)
    ? Math.round(Number(internationalGold.price))
    : null;

  return {
    points: [
      {
        id: "hk",
        label: "港股",
        value: hkName,
        targetId: hkId,
        hasTarget: Boolean(hkId),
        ariaTarget: hkId ? `港股 ${hkName}` : "港股暂无",
      },
      {
        id: "us",
        label: "美股",
        value: usId || "—",
        targetId: usId,
        hasTarget: Boolean(usId),
        ariaTarget: usId ? `美股 ${usId}` : "美股暂无",
      },
      {
        id: "a",
        label: "A股",
        value: aName,
        targetId: aId,
        hasTarget: Boolean(aId),
        ariaTarget: aId ? `A股 ${aName}` : "A股暂无",
      },
      {
        id: "gold",
        label: "黄金",
        value: goldPrice != null ? String(goldPrice) : "—",
        targetId: "track",
        hasTarget: true,
        ariaTarget: goldPrice != null ? `黄金国际金价 ${goldPrice} 美元` : "黄金追踪",
      },
    ],
  };
}

const TODAY_HELP_FRESH = "今天先看这几件事";

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    today: { points: [] },
    dataAsOf: "",
    freshnessKind: "offline",
    todayHelp: TODAY_HELP_FRESH,
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    track("home_open");
    this.refreshAnswers();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const asOf = this.formatAsOf(data.updatedAt, kind);
        this.setData({
          today: buildToday(data),
          dataAsOf: asOf,
          freshnessKind: kind,
          todayHelp: TODAY_HELP_FRESH,
        });
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
  openTodayPoint(event) {
    this.openTodayCategory(event);
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
