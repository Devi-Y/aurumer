const { loadSnapshot } = require("../../data/store");
const { allItems, groupDefinitions } = require("../../utils/answers");

const META = {
  hk: { title: "港股新股", one: "发行资料、认购信息与上市后复盘。", tone: "hk", icon: "/assets/home/hk.svg", kicker: "新股资料" },
  us: { title: "美股机会", one: "价格位置、市场热度与公开财务。", tone: "us", icon: "/assets/home/us.svg", kicker: "全球公司" },
  a: { title: "A股收息", one: "分红水平、现金流质量与公开价格。", tone: "a", icon: "/assets/home/a.svg", kicker: "现金流研究" },
  gold: { title: "黄金机会", one: "价格位置、机会成本与宏观驱动。", tone: "gold", icon: "/assets/home/gold.svg", kicker: "第 4 个模块" },
  guru: { title: "机构持仓", one: "代表机构与投资人的公开业绩、持仓披露与 WHY/HOW。", tone: "guru", icon: "/assets/home/guru.svg", kicker: "最后一个模块" },
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
    const listings = snapshot.hk?.listings || [];
    const history = snapshot.hk?.history || [];
    const complete = listings.filter((item) => item.researchView?.state === "complete");
    const lead = complete[0] || listings[0];
    return {
      metrics: [
        { label: "当前新股", value: `${listings.length} 只` },
        { label: "资料较完整", value: `${complete.length} 只` },
        { label: "历史复盘", value: `${history.length} 只` },
      ],
      conclusion: lead ? `${lead.name}目前为${lead.researchView?.label || "公开资料"}，可继续核对发行与风险信息。` : "当前没有可核验的新股资料。",
      analysis: "先区分资料是否完整，再查看发行、认购、配售与上市结果；缺失字段会直接标明，不用占位数字凑结论。",
    };
  }

  if (market === "us") {
    const stocks = snapshot.us?.stocks || [];
    const hot = [...stocks].sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0))[0];
    return {
      metrics: [
        { label: "公开行情", value: `${stocks.length} 只` },
        { label: "最高热度", value: hot ? `${hot.heatScore} 分` : "待更新" },
        { label: "当日涨跌", value: hot ? percent(hot.changePercent) : "待更新" },
      ],
      conclusion: hot ? `${hot.symbol}当前热度最高；热度只说明关注度，价格位置和财务质量仍需分开看。` : "美股行情资料正在更新。",
      analysis: "七姐妹用于看核心科技龙头，热度前三用于发现市场焦点；详情页再核对近 60 日位置、增长、利润率与持仓披露。",
    };
  }

  if (market === "a") {
    const quotes = snapshot.aShare?.quotes || [];
    const complete = quotes.filter((item) => item.researchView?.state === "complete");
    const topYield = [...quotes].sort((left, right) => Number(right.currentDividendYield || 0) - Number(left.currentDividendYield || 0))[0];
    return {
      metrics: [
        { label: "收息样本", value: `${quotes.length} 只` },
        { label: "资料较完整", value: `${complete.length} 只` },
        { label: "最高股息率", value: topYield && hasNumber(topYield.currentDividendYield) ? `${Number(topYield.currentDividendYield).toFixed(2)}%` : "待更新" },
      ],
      conclusion: topYield ? `${shortName(topYield.name)}当前公开股息率居样本前列，但还要核对自由现金流和分红持续性。` : "A股收息资料正在更新。",
      analysis: "高股息不是单一答案。详情页把股息率、经营现金流、自由现金流、现金利润比和财报日期放在一起核验。",
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const international = gold.quotes?.international || {};
    const domestic = gold.quotes?.domestic || {};
    return {
      metrics: [
        { label: "国际金", value: hasNumber(international.price) ? Number(international.price).toFixed(1) : "待更新" },
        { label: "上海金", value: hasNumber(domestic.price) ? Number(domestic.price).toFixed(2) : "待更新" },
        { label: "半年位置", value: hasNumber(international.percentile180) ? `${Number(international.percentile180)}%` : "待更新" },
      ],
      conclusion: gold.answer?.researchConclusion || "先查看价格位置，再核对实际利率、美元和持仓拥挤。",
      analysis: `国际金当日 ${percent(international.changePercent)}，上海金当日 ${percent(domestic.changePercent)}。两者还受汇率、境内供需与交易时段影响。`,
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
    conclusion: leader ? `${leader.name}在当前可核验候选池中表观长期年化居前；不同币种、区间与风险不能直接横比。` : "公开持仓资料正在更新。",
    analysis: "每位名人或机构都给出业绩口径、公开持仓、WHY 与 HOW。重点是学习框架，不按滞后披露直接照抄。",
  };
}

Page({
  data: { market: "hk", meta: META.hk, groups: [], overview: { metrics: [], conclusion: "", analysis: "" }, source: "正在读取同步数据" },
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
      const groups = groupDefinitions(snapshot, this.data.market).map((item, index) => ({
        ...item,
        indexLabel: String(index + 1).padStart(2, "0"),
      }));
      this.setData({ groups, overview: buildOverview(snapshot, this.data.market), source });
    }, done, { force });
  },
  openGroup(event) {
    const group = event.currentTarget.dataset.group;
    wx.navigateTo({ url: `/pages/list/index?market=${this.data.market}&group=${group}` });
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.meta.title}｜望潮 Aurum`, path: `/pages/section/index?market=${this.data.market}` };
  },
  onShareTimeline() {
    return { title: `${this.data.meta.title}｜望潮 Aurum`, query: `market=${this.data.market}` };
  },
});
