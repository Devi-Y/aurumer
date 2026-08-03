const { loadSnapshot } = require("../../data/store");
const { allItems, groupDefinitions, shortCompanyName } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");

const META = {
  hk: {
    title: "港股打新",
    one: "值不值得打、中签率",
    tone: "hk",
    icon: "/assets/home/hk.svg",
    kicker: "新股申购",
  },
  us: {
    title: "美股投资",
    one: "高潜力对照样本",
    tone: "us",
    icon: "/assets/home/us.svg",
    kicker: "全球公司",
  },
  a: {
    title: "A股收息",
    one: "高股息稳现金流",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    one: "买卖观察提收益",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "买卖观察",
  },
  guru: {
    title: "机构持仓",
    one: "学思路、对照持仓",
    tone: "guru",
    icon: "/assets/home/guru.svg",
    kicker: "学习与对照",
  },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function buildOverview(snapshot, market) {
  if (market === "hk") {
    const items = allItems(snapshot, "hk").filter((item) => item.group !== "ended");
    const live = items.filter((item) => item.group !== "cancelled");
    const suggest = items.filter((item) => item.group === "worth");
    const lead = suggest[0] || live[0];
    const scored = scoreForItem(lead);
    return {
      metrics: [
        { label: "在售", value: `${live.length}` },
        { label: "建议申购", value: `${suggest.length}` },
        { label: "研究分", value: scored.score != null ? `${scored.score}` : "—" },
      ],
      target: lead ? shortCompanyName(lead.name, "新股", 6) : "暂无在售",
      grade: lead ? (lead.badge || "待定") : "—",
    };
  }

  if (market === "us") {
    const items = allItems(snapshot, "us");
    const hot = items.filter((item) => item.group === "hot");
    const seven = items.filter((item) => item.group === "seven");
    const lead = [...hot, ...seven].sort(
      (left, right) => Number(right.raw?.heatScore || 0) - Number(left.raw?.heatScore || 0),
    )[0];
    const scored = scoreForItem(lead);
    return {
      metrics: [
        { label: "七姐妹", value: `${seven.length}` },
        { label: "热度前三", value: `${hot.length}` },
        { label: "综合分", value: scored.score != null ? `${scored.score}` : "—" },
      ],
      target: lead ? (lead.code || shortCompanyName(lead.name, "美股", 6)) : "待更新",
      grade: lead
        ? (lead.group === "hot" ? `热度 ${lead.raw?.heatScore ?? "—"}` : "七姐妹")
        : "—",
    };
  }

  if (market === "a") {
    const items = allItems(snapshot, "a");
    const top = items[0];
    const scored = scoreForItem(top);
    return {
      metrics: [
        { label: "收息样本", value: `${items.length}` },
        { label: "最高股息", value: top && hasNumber(top.raw?.currentDividendYield) ? `${Number(top.raw.currentDividendYield).toFixed(1)}%` : "—" },
        { label: "收息分", value: scored.score != null ? `${scored.score}` : "—" },
      ],
      target: top ? shortCompanyName(top.name, "收息", 6) : "待更新",
      grade: top ? (top.scoreText || top.badge || "先看分红") : "—",
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const answer = gold.answer || {};
    const international = gold.quotes?.international || {};
    const domestic = gold.quotes?.domestic || {};
    const scored = scoreForItem({ market: "gold", raw: gold });
    return {
      metrics: [
        { label: "国际金", value: hasNumber(international.price) ? Number(international.price).toFixed(0) : "—" },
        { label: "观察分", value: scored.score != null ? `${scored.score}` : "—" },
        { label: "半年位", value: hasNumber(international.percentile180) ? `${Number(international.percentile180)}%` : "—" },
      ],
      target: hasNumber(international.price) ? `国际金 ${Number(international.price).toFixed(0)}` : "黄金",
      grade: answer.action || "继续观察",
    };
  }

  const profiles = allItems(snapshot, "guru");
  const leader = profiles[0];
  return {
    metrics: [
      { label: "港股", value: "3" },
      { label: "美股", value: "5" },
      { label: "A股", value: "3" },
    ],
    target: leader ? shortCompanyName(leader.name, "机构", 6) : "待更新",
    grade: leader ? (leader.scoreText || leader.badge || "学习样本") : "—",
  };
}

Page({
  data: {
    market: "hk",
    meta: META.hk,
    groups: [],
    overview: { metrics: [], target: "", grade: "" },
    source: "正在读取同步数据",
    disclaimer: RESEARCH_DISCLAIMER,
  },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    this.setData({ market, meta: META[market] });
    wx.setNavigationBarTitle({ title: META[market].title });
    track("section_open", { market: String(market), from: "direct" });
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source) => {
      const groups = groupDefinitions(snapshot, this.data.market)
        .filter((item) => item.count > 0)
        .map((item, index) => ({
          ...item,
          indexLabel: String(index + 1).padStart(2, "0"),
        }));
      this.setData({ groups, overview: buildOverview(snapshot, this.data.market), source });
    }, done, { force });
  },
  openGroup(event) {
    const group = event.currentTarget.dataset.group;
    const target = this.data.groups.find((item) => item.id === group);
    if (!target || !target.count) {
      wx.showToast({ title: "这一组当前没有项目", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/list/index?market=${this.data.market}&group=${group}` });
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "section", market: this.data.market });
    return {
      title: `${this.data.meta.title}｜望潮研究观察`,
      path: `/pages/section/index?market=${this.data.market}`,
    };
  },
});
