const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");

const MARKET_META = {
  hk: { label: "港股打新", icon: "/assets/home/hk.svg", tone: "hk" },
  us: { label: "美股投资", icon: "/assets/home/us.svg", tone: "us" },
  a: { label: "A股收息", icon: "/assets/home/a.svg", tone: "a" },
  gold: { label: "黄金追踪", icon: "/assets/home/gold.svg", tone: "gold" },
  guru: { label: "机构持仓", icon: "/assets/home/guru.svg", tone: "guru" },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function performanceNumber(value) {
  return Number(String(value || "").match(/\d+(?:\.\d+)?/)?.[0] || 0);
}

function comparisonMetric(item, market) {
  if (market === "us") {
    if (item.group === "hot" && hasNumber(item.raw?.heatScore)) {
      return { value: Number(item.raw.heatScore), label: `热度 ${Number(item.raw.heatScore)}` };
    }
    if (hasNumber(item.raw?.changePercent)) {
      const value = Number(item.raw.changePercent);
      return {
        value: Math.abs(value),
        label: `今日 ${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
        tone: value < 0 ? "down" : "up",
      };
    }
  }
  if (market === "a" && hasNumber(item.raw?.currentDividendYield)) {
    const value = Number(item.raw.currentDividendYield);
    return { value, label: `股息 ${value.toFixed(2)}%` };
  }
  if (market === "gold") {
    const gold = item.raw || {};
    const answer = gold.answer || {};
    const international = gold.quotes?.international || {};
    if (item.id === "track") {
      if (hasNumber(answer.score)) {
        return { value: Number(answer.score), label: `观察分 ${Number(answer.score)}` };
      }
      if (hasNumber(international.percentile180)) {
        return { value: Number(international.percentile180), label: `半年位置 ${Number(international.percentile180)}%` };
      }
    }
    if (item.id === "plan") {
      const plan = answer.pricePlan || {};
      const buy = Number(plan.internationalWatch?.low || plan.internationalWatch?.high || 0);
      const sell = Number(plan.internationalUpper?.low || plan.internationalUpper?.high || 0);
      if (sell > 0) return { value: sell, label: `卖出观察 ${sell}` };
      if (buy > 0) return { value: buy, label: `买入观察 ${buy}` };
      if (hasNumber(international.price)) {
        return { value: Number(international.price), label: `国际金 ${Number(international.price).toFixed(0)}` };
      }
    }
  }
  if (market === "guru") {
    const value = performanceNumber(item.raw?.profile?.performanceValue);
    if (value > 0) {
      const holdings = Array.isArray(item.raw?.holdings) ? item.raw.holdings.length : 0;
      return {
        value,
        label: holdings > 0
          ? `表观年化 ${item.raw.profile.performanceValue} · ${holdings}只`
          : `表观年化 ${item.raw.profile.performanceValue}`,
      };
    }
    const weight = Number(item.raw?.holdings?.[0]?.weight);
    if (Number.isFinite(weight) && weight > 0) {
      return { value: weight, label: `头号仓 ${weight.toFixed(1)}%` };
    }
    return null;
  }
  if (market === "hk" && hasNumber(item.outcomeValue)) {
    const value = Number(item.outcomeValue);
    return { value: Math.abs(value), label: item.scoreText, tone: value < 0 ? "down" : "up" };
  }
  if (hasNumber(item.score) && Number(item.score) > 0) {
    return { value: Number(item.score), label: `${Number(item.score)} 分` };
  }
  return null;
}

function barScaleMax(comparable) {
  const values = comparable
    .map((item) => Number(item?.value || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!values.length) return 0;
  const percentile = values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
  return Math.max(percentile, values[values.length - 1] / 3, 1);
}

Page({
  data: {
    market: "hk",
    group: "worth",
    meta: MARKET_META.hk,
    title: "资料列表",
    groups: [],
    items: [],
    source: "正在读取同步数据",
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    disclaimer: RESEARCH_DISCLAIMER,
    groupHelp: "",
  },
  onLoad(options) {
    const market = MARKET_META[options.market] ? options.market : "hk";
    const defaultGroup = market === "a" ? "payout" : market === "gold" ? "track" : market === "us" ? "seven" : "worth";
    this.setData({ market, group: options.group || defaultGroup, meta: MARKET_META[market] });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
  retryFreshness() { this.refresh(null, true); },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const definitions = groupDefinitions(snapshot, this.data.market).filter((item) => item.count > 0);
      const group = definitions.find((item) => item.id === this.data.group) || definitions[0];
      const activeGroup = group ? group.id : this.data.group;
      const rawItems = allItems(snapshot, this.data.market).filter((item) => item.group === activeGroup);
      const comparable = rawItems.map((item) => comparisonMetric(item, this.data.market));
      const maxValue = barScaleMax(comparable);
      const items = rawItems.map((item, index) => {
        const visual = comparable[index];
        const scored = scoreForItem(item);
        const strategy = buildStrategySignal(item, { evidence: strategyEvidence });
        return {
          id: item.id,
          name: item.name,
          shortName: item.raw?.shortName || shortCompanyName(item.name, item.code || "标的", 8),
          code: item.code,
          badge: item.badge,
          badgeTone: this.data.market,
          position: index + 1,
          positionLabel: String(index + 1).padStart(2, "0"),
          scoreText: item.scoreText || (item.score > 0 ? `${item.score} 分` : "资料待核验"),
          researchScore: scored.score,
          researchScoreLabel: scored.score != null ? `${scored.label} ${scored.score}` : "",
          rankText: item.rankText || (item.rank ? `第 ${item.rank} 名` : "暂不排名"),
          one: item.one,
          showOne: this.data.market === "guru" && Boolean(item.one),
          showBar: Boolean(visual && maxValue > 0),
          barLabel: visual?.label || "",
          barTone: visual?.tone || "",
          barWidth: visual && maxValue > 0
            ? Math.min(100, Math.max(12, Math.round((visual.value / maxValue) * 100)))
            : 0,
          strategyLabel: strategy.label,
          strategyTone: strategy.tone,
          strategyLine: strategy.action,
        };
      });
      this.setData({
        group: activeGroup,
        groups: definitions,
        title: group ? group.title : "建议明细",
        groupHelp: group ? group.one : "",
        items,
        source,
        freshness: freshnessBanner(source, meta.kind),
      });
      wx.setNavigationBarTitle({ title: group ? group.title : "建议明细" });
    }, done, { force });
  },
  openItem(event) {
    wx.navigateTo({ url: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  onShareAppMessage() {
    track("share_tap", { page: "list" });
    return { title: `${this.data.title}｜望潮 Aurum`, path: `/pages/list/index?market=${this.data.market}&group=${this.data.group}` };
  },
});
