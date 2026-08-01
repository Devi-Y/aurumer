const { loadSnapshot } = require("../../data/store");
const { allItems, groupDefinitions } = require("../../utils/answers");

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
  if (market === "us" && hasNumber(item.raw?.heatScore)) {
    return { value: Number(item.raw.heatScore), label: `热度 ${Number(item.raw.heatScore)} 分` };
  }
  if (market === "a" && hasNumber(item.raw?.currentDividendYield)) {
    const value = Number(item.raw.currentDividendYield);
    return { value, label: `股息率 ${value.toFixed(2)}%` };
  }
  if (market === "guru") {
    const value = performanceNumber(item.raw?.profile?.performanceValue);
    return value > 0 ? { value, label: `表观长期年化 ${item.raw.profile.performanceValue}` } : null;
  }
  // 港股历史新股按真实涨跌幅比较，条长取绝对值、颜色区分涨跌，负数不会被画成"分数低"。
  if (market === "hk" && hasNumber(item.outcomeValue)) {
    const value = Number(item.outcomeValue);
    return { value: Math.abs(value), label: item.scoreText, tone: value < 0 ? "down" : "up" };
  }
  if (hasNumber(item.score) && Number(item.score) > 0) {
    return { value: Number(item.score), label: `${Number(item.score)} 分` };
  }
  return null;
}

// 直接用最大值做标尺时，单个极端值会把其余所有条压到最小宽度：港股历史组里
// 一只 +162% 的新股就让另外 11 只全部贴底，对比条失去意义。这里改用 75 分位
// 作为标尺，超出的条画满即可。
function barScaleMax(comparable) {
  const values = comparable
    .map((item) => Number(item?.value || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!values.length) return 0;
  const percentile = values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
  return Math.max(percentile, values[values.length - 1] / 3, 1);
}

function buildInsight(market, group, items) {
  if (!items.length) {
    return { label: "本组结论", conclusion: "这一组暂时没有标的。", analysis: "望潮不会用假数据凑数。", metric: "0 项" };
  }
  const first = items[0];
  if (market === "hk") {
    return {
      label: "本组结论",
      conclusion: `先看 ${first.name}：${first.badge}。${first.one}`,
      analysis: group?.one || "点进详情核对手金额、认购截止和风险。",
      metric: `${items.length} 只`,
    };
  }
  if (market === "a") {
    return {
      label: "本组结论",
      conclusion: `股息最高先看 ${first.name}。${first.one}`,
      analysis: "股息率 = 一年分红 ÷ 股价；还要看公司有没有余钱继续发。",
      metric: `${items.length} 只`,
    };
  }
  if (market === "gold") {
    return {
      label: "本组结论",
      conclusion: first.one,
      analysis: group?.one || "这是公开资料研究结论，供你参考，不是强制下单。",
      metric: `${items.length} 项`,
    };
  }
  if (market === "guru") {
    return {
      label: "本组结论",
      conclusion: `先学 ${first.name}。${first.one}`,
      analysis: "先学思路，再对照持仓；披露有滞后，不要当实时买卖单。",
      metric: `${items.length} 位`,
    };
  }
  return {
    label: "本组结论",
    conclusion: `先看 ${first.name}。${first.one}`,
    analysis: group?.one || "点进详情看价格位置、涨跌和财务。",
    metric: `${items.length} 项`,
  };
}

Page({
  data: {
    market: "hk",
    group: "worth",
    meta: MARKET_META.hk,
    title: "资料列表",
    one: "一句话看懂，再进详情。",
    insight: { label: "本组结论", conclusion: "正在整理", analysis: "", metric: "" },
    items: [],
    source: "正在读取同步数据",
  },
  onLoad(options) {
    const market = MARKET_META[options.market] ? options.market : "hk";
    const defaultGroup = market === "a" ? "payout" : market === "gold" ? "track" : market === "us" ? "seven" : "worth";
    this.setData({ market, group: options.group || defaultGroup, meta: MARKET_META[market] });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source) => {
      const group = groupDefinitions(snapshot, this.data.market).find((item) => item.id === this.data.group);
      const rawItems = allItems(snapshot, this.data.market).filter((item) => item.group === this.data.group);
      const comparable = rawItems.map((item) => comparisonMetric(item, this.data.market));
      const maxValue = barScaleMax(comparable);
      const items = rawItems.map((item, index) => {
        const visual = comparable[index];
        return {
          id: item.id,
          name: item.name,
          code: item.code,
          badge: item.badge,
          position: index + 1,
          positionLabel: String(index + 1).padStart(2, "0"),
          scoreText: item.scoreText || (item.score > 0 ? `${item.score} 分` : "资料待核验"),
          rankText: item.rankText || (item.rank ? `第 ${item.rank} 名` : "暂不排名"),
          one: item.one,
          showBar: Boolean(visual && maxValue > 0),
          barLabel: visual?.label || "",
          barTone: visual?.tone || "",
          barWidth: visual && maxValue > 0
            ? Math.min(100, Math.max(12, Math.round((visual.value / maxValue) * 100)))
            : 0,
        };
      });
      this.snapshot = snapshot;
      const title = group ? group.title : "资料列表";
      const one = group ? group.one : "一句话看懂，再进详情。";
      this.setData({ title, one, items, insight: buildInsight(this.data.market, group, rawItems), source });
      wx.setNavigationBarTitle({ title });
    }, done, { force });
  },
  openItem(event) {
    wx.navigateTo({ url: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.title}｜望潮 Aurum`, path: `/pages/list/index?market=${this.data.market}&group=${this.data.group}` };
  },
});
