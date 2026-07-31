const { loadSnapshot } = require("../../data/store");

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

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function shortName(value, fallback) {
  const name = String(value || fallback || "待更新");
  return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}

function signedPercent(value) {
  if (!hasNumber(value)) return "涨跌待更新";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
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
  },
  onLoad() {
    this.refreshAnswers();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source) => {
        const researchOrder = { complete: 0, review: 1, limited: 2 };
        const listings = [...(data.hk?.listings || [])];
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

        const today = {
          // 这句结论只讲黄金，不带主语时会被读成对整个市场的判断，所以显式点名。
          headline: /^黄金/.test(goldConclusion) ? goldConclusion : `黄金：${goldConclusion}`,
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
              id: "gold",
              label: "黄金",
              value: hasNumber(internationalGold.price)
                ? `国际金 ${Number(internationalGold.price).toFixed(1)}，${signedPercent(internationalGold.changePercent)}`
                : "国际金与上海金资料待更新",
              note: hasNumber(domesticGold.price) ? `上海金 ${Number(domesticGold.price).toFixed(2)} 元/克` : "",
            },
            {
              id: "us",
              label: "美股",
              value: hotStock ? `${hotStock.symbol} 热度 ${hotStock.heatScore} 分` : "市场热度待更新",
              note: hotStock ? `今日 ${signedPercent(hotStock.changePercent)}` : "",
            },
            {
              id: "a",
              label: "A股",
              value: dividendStock ? `${dividendStock.name} · 股息率 ${Number(dividendStock.currentDividendYield || 0).toFixed(2)}%` : "收息资料待更新",
              note: dividendStock?.researchView?.label || "先核对现金流",
            },
            {
              id: "hk",
              label: "港股",
              value: listing ? `${listing.name} · ${listing.researchView?.label || "查看资料"}` : "暂无可核验新股",
              note: `当前 ${listings.length} 只 · 不用占位数字凑结论`,
            },
          ],
        };

        this.setData({
          today,
          refreshedAt: this.formatTime(new Date(data.updatedAt)),
          source,
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
