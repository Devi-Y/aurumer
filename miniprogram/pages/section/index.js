const { loadSnapshot } = require("../../data/store");
const { allItems, groupDefinitions, formatRange } = require("../../utils/answers");

const META = {
  hk: {
    title: "港股打新",
    one: "这一页告诉你：有哪些新股、一手多少钱、建议申购还是暂缓。",
    tone: "hk",
    icon: "/assets/home/hk.svg",
    kicker: "新股申购",
  },
  us: {
    title: "美股投资",
    one: "这一页只盯两块：七姐妹，和今天热度最高的三只。",
    tone: "us",
    icon: "/assets/home/us.svg",
    kicker: "全球公司",
  },
  a: {
    title: "A股收息",
    one: "这一页告诉你：谁分红高、股息率多少、钱是不是赚得稳。",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    one: "这一页用大白话说：现在怎么做、多少钱买、多少钱卖、为什么。",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "买卖观察",
  },
  guru: {
    title: "机构持仓",
    one: "这一页用来学习机构思路和公开持仓，也可对照自己是否和他们抢同一只。",
    tone: "guru",
    icon: "/assets/home/guru.svg",
    kicker: "学习与对照",
  },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function percent(value, digits = 2) {
  if (!hasNumber(value)) return "待更新";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function shortName(value, fallback = "公开资料") {
  const name = String(value || fallback);
  return name.length > 12 ? `${name.slice(0, 12)}…` : name;
}

function buildOverview(snapshot, market) {
  if (market === "hk") {
    const items = allItems(snapshot, "hk").filter((item) => item.group !== "ended");
    const suggest = items.filter((item) => item.group === "worth");
    const lead = suggest[0] || items[0];
    return {
      metrics: [
        { label: "在售新股", value: `${items.filter((item) => item.group !== "cancelled").length} 只` },
        { label: "建议申购", value: `${suggest.length} 只` },
        { label: "历史复盘", value: `${(snapshot.hk?.history || []).length} 只` },
      ],
      conclusion: lead
        ? `${lead.name}：${lead.badge}。${lead.one}`
        : "当前没有在售新股可看。",
      analysis: "先看「建议申购 / 暂缓观察 / 暂不建议」，再点进详情核对一手金额、认购截止日和风险。",
    };
  }

  if (market === "us") {
    const stocks = snapshot.us?.stocks || [];
    const hot = [...stocks].sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0))[0];
    return {
      metrics: [
        { label: "七姐妹", value: "7 家" },
        { label: "热度前三", value: "3 只" },
        { label: "今日最热", value: hot ? hot.symbol : "待更新" },
      ],
      conclusion: hot
        ? `今天市场最热闹的是 ${hot.symbol}（热度 ${hot.heatScore}）。热度高只说明大家关注多，不等于一定要买。`
        : "美股行情资料正在更新。",
      analysis: "点「七姐妹」看长期核心公司；点「热度前三」看这两天焦点。详情里再看近 60 日贵不贵、增长和利润。",
    };
  }

  if (market === "a") {
    const items = allItems(snapshot, "a");
    const top = items[0];
    return {
      metrics: [
        { label: "收息样本", value: `${items.length} 只` },
        { label: "最高股息", value: top?.badge || "待更新" },
        { label: "先看谁", value: top ? shortName(top.name) : "待更新" },
      ],
      conclusion: top
        ? `${shortName(top.name)} 当前公开股息率靠前。${top.one}`
        : "A股收息资料正在更新。",
      analysis: "股息率高不等于稳。点进详情看现金流能不能撑住分红，以及参考价位。",
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const answer = gold.answer || {};
    const plan = answer.pricePlan || {};
    const international = gold.quotes?.international || {};
    const domestic = gold.quotes?.domestic || {};
    const buy = formatRange(plan.internationalWatch) || formatRange(plan.domesticWatch, 1) || "待更新";
    const sell = formatRange(plan.internationalUpper) || formatRange(plan.domesticUpper, 1) || "待更新";
    return {
      metrics: [
        { label: "国际金", value: hasNumber(international.price) ? Number(international.price).toFixed(1) : "待更新" },
        { label: "上海金", value: hasNumber(domestic.price) ? Number(domestic.price).toFixed(2) : "待更新" },
        { label: "现在动作", value: answer.action || "观察中" },
      ],
      conclusion: `${answer.action || "继续观察"}。买入观察约 ${buy}；卖出观察约 ${sell}。`,
      analysis: `${(answer.reasons || []).slice(0, 2).join("；") || "先看价格位置"}。风险：${(answer.risks || []).slice(0, 1).join("；") || "波动可能加大"}。`,
    };
  }

  const profiles = allItems(snapshot, "guru");
  const leader = profiles[0];
  return {
    metrics: [
      { label: "港股方向", value: "3 个" },
      { label: "美股方向", value: "5 个" },
      { label: "A股方向", value: "3 个" },
    ],
    conclusion: leader
      ? `先学 ${leader.name}：${leader.raw?.profile?.why || leader.one}`
      : "公开持仓资料正在更新。",
    analysis: "重点看 WHY（为什么这样选）和 HOW（你可以怎么学），再对照公开持仓；披露有滞后，别当实时跟单，也可用来判断是否和机构抢同一只。",
  };
}

Page({
  data: {
    market: "hk",
    meta: META.hk,
    groups: [],
    overview: { metrics: [], conclusion: "", analysis: "" },
    source: "正在读取同步数据",
  },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    this.setData({ market, meta: META[market] });
    wx.setNavigationBarTitle({ title: META[market].title });
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
    wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) });
  },
  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
