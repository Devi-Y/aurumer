const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");
const { buildHkHistoryStats } = require("../../utils/hk-history-stats");

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
    if ((item.group === "hot" || item.group === "hot10") && hasNumber(item.raw?.heatScore)) {
      return { value: Number(item.raw.heatScore), label: `热度 ${Number(item.raw.heatScore)}` };
    }
    if (item.group === "value" && hasNumber(item.score)) {
      return { value: Number(item.score), label: `性价比 ${Number(item.score)}` };
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
      if (sell > 0) return { value: sell, label: `观察上沿 ${sell}` };
      if (buy > 0) return { value: buy, label: `观察低位 ${buy}` };
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
    statsBanner: null,
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
          showOne: (this.data.market === "guru" || this.data.market === "us") && Boolean(item.one),
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
      let groupHelp = group ? group.one : "";
      let statsBanner = null;
      if (this.data.market === "hk" && activeGroup === "ended") {
        const stats = buildHkHistoryStats(snapshot);
        const industries = buildHkIndustryStats(snapshot).slice(0, 2);
        const sponsors = buildHkSponsorStats(snapshot).slice(0, 1);
        const extra = [
          industries.length ? `行业样本 ${industries.map((item) => `${item.name} ${item.sampleCount}只`).join(" · ")}` : "",
          sponsors.length ? `保荐人 ${sponsors[0].name} 样本 ${sponsors[0].sampleCount}只` : "",
        ].filter(Boolean).join(" · ");
        groupHelp = extra ? `${stats.summary} · ${extra}` : stats.summary;
        statsBanner = {
          title: "历史样本对照",
          body: `暗盘上涨 ${stats.greyWinRate} · 首日上涨 ${stats.firstDayWinRate} · 暗盘→首日同向 ${stats.greyToFirstDirection}`,
          note: stats.disclaimer,
        };
      } else if (activeGroup === "hot10") {
        statsBanner = {
          title: "热度观察榜算法",
          body: "按公开热度分从高到低排序；热度只反映关注度，不代表未来涨幅。",
          note: "研究观察，不构成买卖建议。",
        };
      } else if (activeGroup === "value") {
        statsBanner = {
          title: "性价比观察指数",
          body: "盈利质量 50% · 估值 30% · 热度 15% · 近周变动 5%；分数用于横向比较。",
          note: "研究排序，不是收益承诺或买入信号。",
        };
      } else if (activeGroup === "overlap") {
        statsBanner = {
          title: "交叉重叠研究工具",
          body: "统计 11 个可核验机构组合中共同出现的标的；重叠只表示公开披露一致，不是买入推荐。",
          note: "报告期存在滞后，不构成实时交易信号。",
        };
      }
      this.setData({
        group: activeGroup,
        groups: definitions,
        title: group ? group.title : "建议明细",
        groupHelp,
        statsBanner,
        items,
        source,
        freshness: freshnessBanner(source, meta.kind),
      });
      wx.setNavigationBarTitle({ title: group ? group.title : "建议明细" });
    }, done, { force });
  },
  openItem(event) {
    const id = event.currentTarget.dataset.id;
    if (String(id || "").startsWith("overlap-")) {
      const item = (this.data.items || []).find((row) => row.id === id);
      const overlap = item?.raw?.overlap;
      if (overlap) {
        wx.showModal({
          title: `${overlap.name} · ${overlap.symbol}`,
          content: overlap.holders.map((holder) => `${holder.name}（${holder.market}）${holder.weight}`).join("\n"),
          showCancel: false,
          confirmText: "知道了",
        });
        return;
      }
    }
    wx.navigateTo({ url: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(id)}` });
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  onShareAppMessage() {
    track("share_tap", { page: "list" });
    return { title: `${this.data.title}｜望潮 Aurum`, path: `/pages/list/index?market=${this.data.market}&group=${this.data.group}` };
  },
});
