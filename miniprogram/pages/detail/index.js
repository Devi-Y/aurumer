const { openPage, goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER, RISK_LABEL } = require("../../utils/disclaimer");
const { loadSnapshot } = require("../../data/store");
const { findItem, money, INVESTOR_NAMES, formatRange, shortCompanyName, shortOrgList } = require("../../utils/answers");

const DETAIL_META = {
  hk: { label: "港股打新", icon: "/assets/home/hk.svg", tone: "hk" },
  us: { label: "美股投资", icon: "/assets/home/us.svg", tone: "us" },
  a: { label: "A股收息", icon: "/assets/home/a.svg", tone: "a" },
  gold: { label: "黄金追踪", icon: "/assets/home/gold.svg", tone: "gold" },
  guru: { label: "机构持仓", icon: "/assets/home/guru.svg", tone: "guru" },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatPercent(value) {
  return hasNumber(value)
    ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`
    : "暂缺";
}

function formatLarge(value) {
  if (!hasNumber(value)) return "暂缺";
  const amount = Number(value);
  if (Math.abs(amount) >= 1e12) return `${(amount / 1e12).toFixed(2)} 万亿`;
  if (Math.abs(amount) >= 1e8) return `${(amount / 1e8).toFixed(1)} 亿`;
  if (Math.abs(amount) >= 1e4) return `${(amount / 1e4).toFixed(1)} 万`;
  return amount.toFixed(0);
}

function formatNumber(value, suffix = "") {
  return hasNumber(value) ? `${Number(value).toFixed(2)}${suffix}` : "暂缺";
}

function setCharts(base, ...charts) {
  base.charts = charts.filter(Boolean);
  base.visual = base.charts[0] || null;
}

function joinNames(values, fallback = "暂缺") {
  return shortOrgList(values, fallback, 2);
}

function withChartMeta(chart, hint) {
  if (!chart) return null;
  return hint ? { ...chart, hint } : chart;
}

function priceVisual(history, title, formatter = (value) => Number(value).toFixed(2), hint) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2) return null;
  const sampleCount = Math.min(36, values.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (values.length - 1));
    return values[sourceIndex];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const span = Math.max(high - low, 1);
  const change = values[0] ? ((latest - values[0]) / Math.abs(values[0])) * 100 : 0;
  return withChartMeta({
    kind: "columns",
    title,
    items: samples.map((value, index) => {
      const isLatest = index === samples.length - 1;
      const isHigh = value === high;
      const isLow = value === low;
      return {
        id: `${index}-${value}`,
        height: Math.round(16 + ((value - low) / span) * 84),
        tone: isLatest ? "latest" : (isHigh ? "peak" : (isLow ? "floor" : "")),
      };
    }),
    lowLabel: `最低 ${formatter(low)}`,
    latestLabel: `最新 ${formatter(latest)}`,
    highLabel: `最高 ${formatter(high)}`,
    stats: [
      { label: "样本", value: `${values.length}` },
      { label: "中位", value: formatter(median) },
      { label: "均价", value: formatter(mean) },
      { label: "高低差", value: formatter(high - low) },
      { label: "区间涨跌", value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` },
    ],
  }, hint || "柱越高价格越高；只看历史，不预测明天。");
}

function barVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  const showStats = options.stats !== false && usable.length >= 2;
  return withChartMeta({
    kind: "bars",
    title,
    stats: showStats
      ? [
          { label: "对比项", value: `${usable.length}` },
          { label: "最高项", value: usable.slice().sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))[0].label },
        ]
      : [],
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      width: Math.max(14, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
      colorIndex: index % 4,
    })),
  }, options.hint);
}

/** 扁平竖柱对比：仅用于同一量纲的指标。 */
function solidVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  const unique = new Set(usable.map((item) => Number(item.value).toFixed(4)));
  const showStats = options.stats !== false && usable.length >= 2 && unique.size > 1;
  return withChartMeta({
    kind: "solid",
    title,
    stats: showStats
      ? [
          { label: "对比项", value: `${usable.length}` },
          { label: "最高", value: usable.slice().sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))[0].valueText },
          { label: "最低", value: usable.slice().sort((a, b) => Math.abs(Number(a.value)) - Math.abs(Number(b.value)))[0].valueText },
        ]
      : (usable.length === 1 || unique.size === 1
        ? [{ label: "说明", value: unique.size === 1 ? "数值相同" : "单值" }]
        : []),
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      height: Math.max(22, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
      colorIndex: index % 4,
    })),
  }, options.hint);
}

function scoreMeter(score, title, badge, hint) {
  if (!hasNumber(score)) return null;
  const value = Math.max(0, Math.min(100, Math.round(Number(score))));
  return withChartMeta({
    kind: "meter",
    title,
    percent: value,
    lowLabel: "0",
    midLabel: `${value} 分`,
    highLabel: "100",
    stats: [
      { label: "研究分", value: `${value}` },
      ...(badge ? [{ label: "建议", value: String(badge) }] : []),
    ],
  }, hint || "分越高，公开资料越偏「可关注」；不是保证赚钱。");
}

function meterVisual(history, currentPrice, title, formatter = money, hint) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2 || !hasNumber(currentPrice)) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const price = Number(currentPrice);
  const percent = high === low ? 50 : Math.round(((price - low) / (high - low)) * 100);
  const clamped = Math.max(0, Math.min(100, percent));
  const distanceLow = price - low;
  const distanceHigh = high - price;
  return withChartMeta({
    kind: "meter",
    title,
    percent: clamped,
    lowLabel: formatter(low),
    midLabel: `${clamped}%`,
    highLabel: formatter(high),
    stats: [
      { label: "最低", value: formatter(low) },
      { label: "当前", value: formatter(price) },
      { label: "最高", value: formatter(high) },
      { label: "距低", value: formatter(distanceLow) },
      { label: "距高", value: formatter(distanceHigh) },
    ],
  }, hint || "越靠近右边，越接近这段时间的高价。");
}

function metricTilesVisual(metrics, title = "关键数据", hint) {
  const rows = (metrics || [])
    .filter((row) => Array.isArray(row) && row[1] && row[1] !== "暂缺" && row[1] !== "待公布" && row[1] !== "待解析")
    .slice(0, 8);
  if (rows.length < 2) return null;
  return withChartMeta({
    kind: "tiles",
    title,
    stats: [],
    items: rows.map((row, index) => ({
      id: `${index}-${row[0]}`,
      label: row[0],
      valueText: String(row[1]),
    })),
  }, hint);
}

/** 招股区间：固定价不画三柱（易误解）；有高低差才画对比。 */
function offerBandVisual(raw, offerPriceText) {
  const low = hasNumber(raw.priceLow) ? Number(raw.priceLow) : null;
  const high = hasNumber(raw.priceHigh) ? Number(raw.priceHigh) : null;
  const offerMatch = String(raw.offerPrice || "").match(/[\d.]+/);
  const offer = offerMatch ? Number(offerMatch[0]) : null;
  if (low == null && high == null && offer == null) return null;
  if (low != null && high != null && low === high) {
    return metricTilesVisual([
      ["招股价", offerPriceText || `${low} 港元`],
      ["定价方式", "固定招股价（无高低价区间）"],
    ], "招股价说明", "这次没有高低价区间，就是这一个价。");
  }
  if (low != null && high != null && low !== high) {
    return solidVisual([
      { label: "招股低", value: low, valueText: `${low}` },
      ...(offer != null ? [{ label: "招股价", value: offer, valueText: offerPriceText || `${offer}` }] : []),
      { label: "招股高", value: high, valueText: `${high}` },
    ], "招股价格带", { hint: "单位：港元。柱越高，价格越高。" });
  }
  return null;
}

function stockRange(history, currentPrice) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (!values.length) return "近 60 日位置暂缺";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || high === low) return `${money(low)}–${money(high)}`;
  const position = Math.round(((price - low) / (high - low)) * 100);
  return `${money(low)}–${money(high)} · 当前约在 ${Math.max(0, Math.min(100, position))}% 位置`;
}

function historyStats(history) {
  const values = (history || []).filter(hasNumber).map(Number).sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { low: values[0], median, high: values[values.length - 1], count: values.length };
}

function investorHoldings(snapshot, symbol) {
  return (snapshot.investors || [])
    .map((investor) => {
      const holding = (investor.holdings || []).find((entry) => entry.ticker === symbol);
      if (!holding) return null;
      return {
        name: INVESTOR_NAMES[investor.id] || investor.name,
        value: `${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核验"}`,
      };
    })
    .filter(Boolean);
}

function baseView(item) {
  const meta = DETAIL_META[item.market] || DETAIL_META.hk;
  return {
    title: item.name,
    code: item.code,
    badge: item.badge,
    marketLabel: meta.label,
    icon: meta.icon,
    tone: meta.tone,
    score: item.scoreText || (item.score > 0 ? `${item.score} 分` : "待核验"),
    rank: item.rank ? `第 ${item.rank} 名` : "当前分类",
    answer: item.one,
    metrics: [],
    visual: null,
    charts: [],
    facts: [],
    holdings: [],
    analysis: [],
    actions: [],
    risk: "数据不足时宁可不给硬答案。",
    riskLabel: RISK_LABEL,
    pageHelp: "",
    sourceNote: "公开资料整理",
    disclaimer: RESEARCH_DISCLAIMER,
  };
}

function buildHKView(base, item) {
  const raw = item.raw || {};
  const review = raw.historicalReview || {};
  const answer = raw.publicAnswer || {};
  const ended = item.group === "ended";
  const offerPrice = raw.offerPrice || (raw.priceLow && raw.priceHigh ? `${raw.priceLow}-${raw.priceHigh} 港元` : "待公布");
  const sponsors = joinNames(raw.sponsorNames, raw.sponsor || "待解析");
  const underwriters = joinNames(raw.underwriterNames, "暂未披露");
  const cornerstones = joinNames(raw.cornerstoneInvestors, "暂未披露");
  const lotSize = raw.boardLot || (raw.boardLotShares ? `${raw.boardLotShares}` : null);

  base.badge = item.badge || answer.verdict || base.badge;
  base.answer = item.badge || answer.action || item.one;
  base.metrics = ended
    ? [
        ["暗盘表现", formatPercent(review.greyMarketChange)],
        ["首日表现", formatPercent(review.firstDayChange)],
        ["五日表现", formatPercent(review.fiveDayChange)],
        ["五日最高", formatPercent(review.fiveDayHighChange)],
        ["招股价", offerPrice],
        ["一手股数", lotSize || "待解析"],
      ]
    : [
        ["建议等级", item.badge || "先看结论"],
        ["招股价", offerPrice],
        ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)} 港元` : "待解析"],
        ["一手股数", lotSize || "待解析"],
        ["认购截止", raw.offerDeadline || raw.offerEnd || "待公布"],
        ["上市日期", raw.listingDate || "待公布"],
        ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)} 倍` : "待公布"],
        ["一手中签", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(1)}%` : "待公布"],
      ];

  if (ended) {
    setCharts(
      base,
      solidVisual([
        { label: "暗盘", value: review.greyMarketChange, valueText: formatPercent(review.greyMarketChange) },
        { label: "首日", value: review.firstDayChange, valueText: formatPercent(review.firstDayChange) },
        { label: "五日", value: review.fiveDayChange, valueText: formatPercent(review.fiveDayChange) },
        { label: "五日最高", value: review.fiveDayHighChange, valueText: formatPercent(review.fiveDayHighChange) },
      ], "上市涨跌对比", { hint: "暗盘=上市前夜交易；都是涨跌百分比，只用于复盘。" }),
    );
    base.pageHelp = "已结束新股只看结果学习，不能倒推当时一定该打。";
  } else {
    const rateBars = [
      hasNumber(raw.oneLotRate)
        ? { label: "一手中签", value: Number(raw.oneLotRate), valueText: `${Number(raw.oneLotRate).toFixed(1)}%` }
        : null,
      hasNumber(raw.cornerstonePercent)
        ? { label: "基石占比", value: Number(raw.cornerstonePercent), valueText: `${Number(raw.cornerstonePercent).toFixed(1)}%` }
        : null,
    ].filter(Boolean);
    const structureTiles = metricTilesVisual([
      ["保荐人", sponsors],
      ["承销商", underwriters],
      ["基石投资者", cornerstones],
      ["A+H", raw.isAH === true ? "是" : raw.isAH === false ? "否" : "待核验"],
    ], "中介与结构", "保荐人负责带队上市；基石是提前认购的大额投资者。");

    setCharts(
      base,
      scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
      rateBars.length >= 2
        ? solidVisual(rateBars, "中签与基石", { hint: "都是百分比。一手中签越低越难抽中；基石占比越高，锁定筹码越多。" })
        : null,
      offerBandVisual(raw, offerPrice),
      structureTiles,
    );
    base.pageHelp = "先看结论与一手金额，再核认购截止日；建议≠保证赚钱。";
  }

  base.facts = [
    ["公司全称", item.name || "待核验"],
    ["股票代码", raw.code || item.code || "待核验"],
    ["所属行业", raw.industry || "待解析"],
    ["招股期", raw.offerStart && raw.offerDeadline ? `${raw.offerStart} 至 ${raw.offerDeadline}` : "待公布"],
    ["上市日期", raw.listingDate || "待公布"],
    ["一手股数", lotSize ? `${lotSize} 股` : "待解析"],
    ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(2)} 港元` : "待解析"],
    ["招股价", offerPrice],
    ["保荐人", sponsors],
    ["承销商", underwriters],
    ["稳定操作人", joinNames([raw.stabilizingManager].filter(Boolean), "暂未披露")],
    ["基石投资者", cornerstones],
    ["基石金额", hasNumber(raw.cornerstoneAmount) ? formatLarge(raw.cornerstoneAmount) : (raw.cornerstoneAmount || "暂未披露")],
    ["基石占比", hasNumber(raw.cornerstonePercent) ? `${Number(raw.cornerstonePercent).toFixed(2)}%` : "暂未披露"],
    ["公开发售股数", hasNumber(raw.publicOfferShares) ? formatLarge(raw.publicOfferShares) : (raw.publicOfferShares || "待公布")],
    ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)} 倍` : "待公布"],
    ["一手中签率", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(2)}%` : "待公布"],
    ["A+H", raw.isAH === true ? "是" : raw.isAH === false ? "否" : "待核验"],
    ["资料来源", raw.source || "港交所公开文件"],
  ];
  base.analysis = ended
    ? [
        { title: "结果", body: `暗盘 ${formatPercent(review.greyMarketChange)} · 首日 ${formatPercent(review.firstDayChange)} · 五日 ${formatPercent(review.fiveDayChange)}` },
        { title: "用途", body: "只用于复盘，不作为当前申购依据。" },
      ]
    : [
        { title: "结论", body: answer.action || item.badge || "公开资料不足，暂不判断。" },
        { title: "风险", body: "新股可能破发或中签率极低，盈亏自负。" },
      ];
  base.actions = [];
  base.risk = ended
    ? "历史表现只用于复盘，不能倒推当时必然值得申购。"
    : "公开资料研究观察，供参考；不是买卖指令。";
  if (ended && item.rank) base.score = `首日涨幅第 ${item.rank} 名`;
  base.sourceNote = raw.source || "港交所公开文件与历史结果整理";
}

function buildUSView(base, item, snapshot) {
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const range = historyStats(raw.history);
  const holders = investorHoldings(snapshot, raw.symbol);
  const cashValue = hasNumber(fund.liquidAssets)
    ? Number(fund.liquidAssets) * (Number(fund.liquidAssets) < 1e7 ? 1000 : 1)
    : null;

  base.metrics = [
    ["当前价格", money(raw.price)],
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["七日涨跌", formatPercent(raw.weeklyChange)],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["近 60 日最低", range ? money(range.low) : "暂缺"],
    ["近 60 日最高", range ? money(range.high) : "暂缺"],
  ];

  const fundBars = solidVisual([
    hasNumber(fund.revenueGrowth) ? { label: "营收增长", value: fund.revenueGrowth, valueText: formatPercent(fund.revenueGrowth) } : null,
    hasNumber(fund.grossMargin) ? { label: "毛利率", value: fund.grossMargin, valueText: formatPercent(fund.grossMargin) } : null,
    hasNumber(fund.profitMargin) ? { label: "利润率", value: fund.profitMargin, valueText: formatPercent(fund.profitMargin) } : null,
    hasNumber(fund.roe) ? { label: "股东回报", value: fund.roe, valueText: formatPercent(fund.roe) } : null,
  ].filter(Boolean), "盈利能力", { hint: "都是百分比，柱越高越好看（公开财报）。" });

  const cashBars = solidVisual([
    hasNumber(fund.operatingCashFlow) ? { label: "经营现金流", value: fund.operatingCashFlow, valueText: formatLarge(Number(fund.operatingCashFlow) * (Number(fund.operatingCashFlow) < 1e8 ? 1000 : 1)) } : null,
    cashValue != null ? { label: "现金等价物", value: cashValue, valueText: formatLarge(cashValue) } : null,
  ].filter(Boolean), "现金实力", { hint: "只比「手里有多少现金类资产」，单位统一。" });

  const sizeTiles = metricTilesVisual([
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)} 倍` : "暂缺"],
  ], "估值与热度", "市盈率：股价相对盈利贵不贵；热度高≠马上买。");

  const revenueHistory = Array.isArray(fund.revenueHistory) ? fund.revenueHistory.filter(hasNumber).map(Number) : [];
  const revenueVisual = revenueHistory.length >= 2
    ? priceVisual(revenueHistory.slice().reverse(), "营收趋势", (value) => formatLarge(value), "近几期公开营收，柱越高营收越大。")
    : null;
  const incomeHistory = Array.isArray(fund.netIncomeHistory) ? fund.netIncomeHistory.filter(hasNumber).map(Number) : [];
  const incomeVisual = incomeHistory.length >= 2
    ? solidVisual(incomeHistory.slice().reverse().map((value, index) => ({
      label: `期${index + 1}`,
      value,
      valueText: formatLarge(value),
    })), "净利润", { hint: "近几期公开净利润，单位统一。" })
    : null;

  setCharts(
    base,
    priceVisual(raw.history, "近 60 日价格", (value) => `$${Number(value).toFixed(2)}`),
    meterVisual(raw.history, raw.price, "价格位置", money),
    fundBars,
    cashBars,
    sizeTiles,
    revenueVisual || incomeVisual,
  );

  base.pageHelp = "先看价格位置，再看盈利与现金；热度只说明关注多。";
  base.facts = [
    ["代码", raw.symbol || item.code || "待核验"],
    ["交易所", raw.exchange || "待核验"],
    ["行情状态", raw.marketState || "待核验"],
    ["数据截至", raw.asOf || fund.period || "待核验"],
    ["近 60 日中位数", range ? money(range.median) : "暂缺"],
    ["样本交易日", range ? `${range.count} 个` : "暂缺"],
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)} 倍` : "暂缺"],
    ["营收增长", formatPercent(fund.revenueGrowth)],
    ["毛利率", formatPercent(fund.grossMargin)],
    ["利润率", formatPercent(fund.profitMargin)],
    ["股东回报", formatPercent(fund.roe)],
    ["经营现金流", hasNumber(fund.operatingCashFlow) ? formatLarge(Number(fund.operatingCashFlow) * (Number(fund.operatingCashFlow) < 1e8 ? 1000 : 1)) : "暂缺"],
    ["现金及等价物", cashValue != null ? formatLarge(cashValue) : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["财报期", fund.period || "待核验"],
  ];
  base.holdings = holders;
  base.analysis = [
    { title: "位置", body: stockRange(raw.history, raw.price) },
    { title: "怎么用", body: item.group === "seven" ? "七家长期跟踪样本，不急着追涨。" : "热度高只说明关注多，不等于马上买。" },
  ];
  base.actions = [];
  base.risk = "历史价格不预测未来；财报与事件可能造成跳空。";
  base.sourceNote = `公开行情与财务资料 · ${raw.asOf || fund.period || "日期待核验"}`;
}

function buildAShareView(base, item) {
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const annualDividend = hasNumber(raw.annualDividendPer100k) ? Number(raw.annualDividendPer100k) : null;
  const advice = raw.currentAdvice || item.scoreText || "先看分红";
  const buyHint = raw.buyPrice || raw.recommendPrice || null;

  base.badge = hasNumber(raw.currentDividendYield) ? `股息 ${Number(raw.currentDividendYield).toFixed(2)}%` : base.badge;
  base.answer = item.one;
  base.metrics = [
    ["当前价格", money(raw.currentPrice, "¥")],
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["当前股息", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺"],
    ["可持续股息", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺"],
    ["10万估算年息", hasNumber(annualDividend) ? `${Math.round(annualDividend)} 元` : "暂缺"],
    ["研究看法", advice],
    ["昨收", money(raw.previousClose, "¥")],
    ["自由现金流", formatLarge(financials.freeCashFlow)],
  ];
  base.pageHelp = "股息率 = 一年分红 ÷ 股价；可持续股息看现金能不能撑住。";

  setCharts(
    base,
    solidVisual([
      { label: "当前股息", value: raw.currentDividendYield, valueText: hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺" },
      { label: "可持续股息", value: raw.sustainableDividendYield, valueText: hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺" },
    ].filter((row) => hasNumber(row.value)), "股息率对比", { hint: "两个都是百分比。可持续更看重现金能不能持续分红。" }),
    hasNumber(annualDividend)
      ? metricTilesVisual([
          ["10万估算年息", `${Math.round(annualDividend)} 元`],
          ["当前价格", money(raw.currentPrice, "¥")],
          ["研究看法", advice],
          ["昨收", money(raw.previousClose, "¥")],
        ], "收息估算", "按当前股息粗算，不等于保证能拿到。")
      : null,
    solidVisual([
      hasNumber(financials.operatingCashFlow) ? { label: "经营现金流", value: financials.operatingCashFlow, valueText: formatLarge(financials.operatingCashFlow) } : null,
      hasNumber(financials.freeCashFlow) ? { label: "自由现金流", value: financials.freeCashFlow, valueText: formatLarge(financials.freeCashFlow) } : null,
      hasNumber(financials.revenue) ? { label: "营收", value: financials.revenue, valueText: formatLarge(financials.revenue) } : null,
      hasNumber(financials.netProfit) ? { label: "净利润", value: financials.netProfit, valueText: formatLarge(financials.netProfit) } : null,
    ].filter(Boolean), "现金流与盈利", { hint: "金额对比，单位统一；现金比利润更能支撑分红。" }),
    solidVisual([
      hasNumber(financials.revenueGrowth) ? { label: "营收增长", value: financials.revenueGrowth, valueText: formatPercent(financials.revenueGrowth) } : null,
      hasNumber(financials.netProfitGrowth) ? { label: "净利增长", value: financials.netProfitGrowth, valueText: formatPercent(financials.netProfitGrowth) } : null,
      hasNumber(financials.roe) ? { label: "股东回报", value: financials.roe, valueText: formatPercent(financials.roe) } : null,
      hasNumber(financials.freeCashFlowMargin) ? { label: "自由现金流率", value: financials.freeCashFlowMargin, valueText: formatPercent(financials.freeCashFlowMargin) } : null,
    ].filter(Boolean), "成长质量", { hint: "都是百分比，柱越高通常越好。" }),
    hasNumber(financials.cashConversion)
      ? metricTilesVisual([
          ["现金利润比", `${Number(financials.cashConversion).toFixed(2)} 倍`],
          ["含义", "利润有多少变成现金"],
        ], "现金转化", "大于 1 通常说明利润兑现更好。")
      : null,
  );

  base.facts = [
    ["公司全称", item.name || "待核验"],
    ["股票代码", raw.code || item.code || "待核验"],
    ["所属行业", raw.industry || financials.industry || "待核验"],
    ["价格日期", raw.priceAsOf || raw.asOf || "待核验"],
    ["财报期", financials.reportDate || financials.period || "待核验"],
    ["当前价格", money(raw.currentPrice, "¥")],
    ["昨收", money(raw.previousClose, "¥")],
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["当前股息率", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺"],
    ["可持续股息率", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺"],
    ["10万估算年息", hasNumber(annualDividend) ? `${Math.round(annualDividend)} 元` : "暂缺"],
    ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ["自由现金流", formatLarge(financials.freeCashFlow)],
    ["自由现金流率", formatPercent(financials.freeCashFlowMargin)],
    ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"],
    ["营收", formatLarge(financials.revenue)],
    ["营收增长", formatPercent(financials.revenueGrowth)],
    ["净利润", formatLarge(financials.netProfit)],
    ["净利润增长", formatPercent(financials.netProfitGrowth)],
    ["股东回报", formatPercent(financials.roe)],
    ["参考价", buyHint || "暂无"],
    ["资料来源", raw.priceSource || raw.source || "公开行情"],
  ];
  base.analysis = [
    { title: "结论", body: advice },
    { title: "现金流", body: `经营 ${formatLarge(financials.operatingCashFlow)} · 自由 ${formatLarge(financials.freeCashFlow)}` },
  ];
  base.actions = [];
  base.risk = "过往分红不代表未来；现金流转弱时分红可能被砍。";
  base.sourceNote = `${raw.priceSource || raw.source || "公开行情"} · ${financials.source || "公开财务资料"}`;
}

function buildGuruView(base, item) {
  const raw = item.raw || {};
  const profile = raw.profile || {};
  const groupCounts = { hk: 3, us: 5, a: 3 };
  const holdings = raw.holdings || [];

  base.title = profile.name || base.title;
  base.code = profile.org || base.code;
  base.badge = profile.marketLabel || base.badge;
  base.score = profile.performanceValue || "业绩待核验";
  base.rank = profile.order ? `第 ${profile.order}/${groupCounts[profile.group]}` : "";
  base.answer = profile.why || item.one;
  base.metrics = [
    ["公开业绩", profile.performanceValue || "待核验"],
    ["业绩区间", profile.performanceDetail || "待核验"],
    ["持仓报告", raw.reportDate || profile.report || "待核验"],
    ["披露日期", raw.filingDate || "待核验"],
    ["持仓只数", `${holdings.length} 只`],
    ["市场", profile.marketLabel || "待核验"],
  ];
  base.holdings = holdings.slice(0, 10).map((holding) => ({
    name: holding.ticker,
    value: `${shortCompanyName(holding.name || holding.ticker, holding.ticker, 6)} · ${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核验"}`,
  }));
  setCharts(base,
    solidVisual(holdings.slice(0, 8).map((holding) => ({
      label: holding.ticker,
      value: holding.weight,
      valueText: formatNumber(holding.weight, "%"),
    })), "持仓权重", { hint: "公开报告里的仓位占比；披露往往有滞后。" }),
  );
  base.facts = [
    ["机构", profile.name || item.name || "待核验"],
    ["市场", profile.marketLabel || "待核验"],
    ["公开业绩", profile.performanceValue || "待核验"],
    ["业绩区间", profile.performanceDetail || "待核验"],
    ["持仓报告", raw.reportDate || profile.report || "待核验"],
    ["披露日期", raw.filingDate || "待核验"],
    ["持仓只数", `${holdings.length} 只`],
    ["业绩口径", profile.performanceBasis || "不同区间与币种不可直接横比"],
    ["资料来源", raw.source || "SEC 13F"],
  ];
  base.analysis = [
    { title: "为什么看它", body: profile.why || "公开业绩和持仓具备研究价值。" },
    { title: "怎么学", body: profile.how || "学框架，不照抄持仓。" },
  ];
  base.actions = [];
  base.risk = "历史业绩不代表未来；公开持仓有滞后，不是实时仓位。";
  base.pageHelp = "学思路，不照抄；持仓披露往往落后真实买卖。";
  base.sourceNote = `${raw.source || profile.sourceName || "公开报告"} · ${raw.filingDate || profile.report || "披露日期待核验"}`;
}

function buildGoldView(base, item) {
  const gold = item.raw || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const etf = gold.quotes?.etf || {};
  const usdCny = gold.quotes?.usdCny || {};
  const returns = international.returns || {};
  const internationalRange = historyStats((gold.history?.international || []).map((entry) => entry.close));
  const domesticRange = historyStats((gold.history?.domestic || []).map((entry) => entry.close));
  const rangeText = (range, currency) => range ? `${Number(range.low).toFixed(1)}–${Number(range.high).toFixed(1)} ${currency}` : "待核验";
  const buyIntl = formatRange(plan.internationalWatch);
  const sellIntl = formatRange(plan.internationalUpper);
  const riskIntl = formatRange(plan.internationalRisk);
  const buyCny = formatRange(plan.domesticWatch, 1);
  const sellCny = formatRange(plan.domesticUpper, 1);
  const riskCny = formatRange(plan.domesticRisk, 1);
  const action = answer.action || answer.researchLabel || "继续观察";

  base.title = gold.view === "plan" ? "买点与卖点" : "现在怎么做";
  base.badge = action;
  base.answer = item.one;
  base.metrics = [
    ["现在动作", action],
    ["国际金", hasNumber(international.price) ? `${Number(international.price).toFixed(0)}` : "暂缺"],
    ["上海金", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(1)}` : "暂缺"],
    ["半年位置", hasNumber(international.percentile180) ? `${Number(international.percentile180)}%` : "暂缺"],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(1)}` : "暂缺"],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(2)}` : "暂缺"],
    ["20日涨跌", formatPercent(returns.day20)],
    ["60日涨跌", formatPercent(returns.day60)],
  ];
  base.pageHelp = "观察区不是买卖指令；半年位置越低越靠近近半年低价。";

  const intlHistory = (gold.history?.international || []).map((entry) => entry.close);
  const domesticHistory = (gold.history?.domestic || []).map((entry) => entry.close);
  setCharts(
    base,
    priceVisual(intlHistory, "国际金轨迹", (value) => Number(value).toFixed(0), "美元金价历史；柱越高金价越高。"),
    meterVisual(intlHistory, international.price, "国际金位置", (value) => Number(value).toFixed(0), "相对这段历史高低：右=偏高，左=偏低。"),
    domesticHistory.length >= 2
      ? priceVisual(domesticHistory, "上海金轨迹", (value) => Number(value).toFixed(1), "人民币金价历史样本。")
      : null,
    solidVisual([
      hasNumber(returns.day20) ? { label: "20日", value: returns.day20, valueText: formatPercent(returns.day20) } : null,
      hasNumber(returns.day60) ? { label: "60日", value: returns.day60, valueText: formatPercent(returns.day60) } : null,
      hasNumber(returns.day180) ? { label: "180日", value: returns.day180, valueText: formatPercent(returns.day180) } : null,
    ].filter(Boolean), "区间涨跌", { hint: "都是涨跌百分比，方便比这段时间涨了还是跌了。" }),
    hasNumber(international.percentile180)
      ? metricTilesVisual([
          ["半年位置", `${Number(international.percentile180)}%`],
          ["白话", Number(international.percentile180) <= 35 ? "偏近半年低位" : (Number(international.percentile180) >= 65 ? "偏近半年高位" : "处在中间区间")],
        ], "半年高低位置", "0% 接近半年最低，100% 接近半年最高。")
      : null,
    metricTilesVisual([
      ["国际金买入观察", buyIntl || "暂缺"],
      ["国际金卖出观察", sellIntl || "暂缺"],
      ["上海金买入观察", buyCny || "暂缺"],
      ["上海金卖出观察", sellCny || "暂缺"],
    ], "买卖观察区", "观察区供参考，不是自动下单指令。"),
  );

  base.facts = [
    ["现在动作", action],
    ["国际金价", hasNumber(international.price) ? `${Number(international.price).toFixed(1)} ${international.currency || "USD/oz"}` : "暂缺"],
    ["国际金涨跌", formatPercent(international.changePercent)],
    ["国际金截至", international.asOf || "待核验"],
    ["上海金价", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)} ${domestic.currency || "CNY/g"}` : "暂缺"],
    ["上海金涨跌", formatPercent(domestic.changePercent)],
    ["上海金截至", domestic.asOf || "待核验"],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(2)} · ${formatPercent(etf.changePercent)}` : "暂缺"],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(4)} · ${formatPercent(usdCny.changePercent)}` : "暂缺"],
    ["国际金买入观察", buyIntl || "暂缺"],
    ["国际金卖出观察", sellIntl || "暂缺"],
    ["国际金风险下沿", riskIntl || "暂缺"],
    ["上海金买入观察", buyCny || "暂缺"],
    ["上海金卖出观察", sellCny || "暂缺"],
    ["上海金风险下沿", riskCny || "暂缺"],
    ["国际金样本", internationalRange ? `${internationalRange.count} 个 · ${rangeText(internationalRange, international.currency || "USD/oz")}` : "暂缺"],
    ["上海金样本", domesticRange ? `${domesticRange.count} 个 · ${rangeText(domesticRange, domestic.currency || "CNY/g")}` : "暂缺"],
    ["历史样本区间", internationalRange ? rangeText(internationalRange, international.currency || "USD/oz") : "暂缺"],
    ...(gold.indicators || []).slice(0, 6).map((entry) => [entry.label, `${entry.value}${entry.unit || ""}`]),
  ];
  base.analysis = [
    { title: "动作", body: action },
    { title: "买卖区", body: `买 ${buyIntl || buyCny || "暂缺"} · 卖 ${sellIntl || sellCny || "暂缺"}` },
  ];
  base.actions = [];
  base.risk = "黄金波动可能很大；以上为观察区，不是买卖指令。";
  base.sourceNote = (gold.sources || []).filter((source) => source.ok).map((source) => source.name).join(" · ") || "公开行情与宏观资料";
}

function detailView(item, snapshot) {
  const base = baseView(item);
  if (item.market === "hk") buildHKView(base, item);
  else if (item.market === "us") buildUSView(base, item, snapshot);
  else if (item.market === "a") buildAShareView(base, item);
  else if (item.market === "gold") buildGoldView(base, item);
  else buildGuruView(base, item);
  base.analysis = base.analysis.map((entry, index) => ({
    ...entry,
    indexLabel: String(index + 1).padStart(2, "0"),
  }));
  const metricHint = (base.metrics || [])
    .slice(0, 2)
    .map((row) => `${row[1]}`)
    .filter((value) => value && value !== "暂缺" && value !== "待公布" && value !== "待解析")
    .join(" · ");
  const quickAnswer = [base.badge || base.answer, metricHint].filter(Boolean).join(" · ");
  base.quickAnswer = quickAnswer.length > 48 ? `${quickAnswer.slice(0, 48)}…` : (quickAnswer || "先看关键数据");
  base.metrics = (base.metrics || []).slice(0, 8);
  if (!Array.isArray(base.charts)) base.charts = [];
  base.charts = base.charts.filter(Boolean);
  if (!base.charts.length) {
    const fallback = metricTilesVisual(base.metrics);
    if (fallback) base.charts = [fallback];
  }
  base.charts = base.charts.slice(0, 6);
  base.visual = base.charts[0] || null;
  base.group = item.group;
  base.market = item.market;
  // 四级用简称；全称放在公司资料里。
  base.title = shortCompanyName(item.name || base.title, base.title, 10);
  base.fullName = item.name || base.title;
  if (item.market !== "guru") base.rank = "";
  return base;
}

Page({
  data: {
    market: "hk",
    group: "",
    id: "",
    ready: false,
    detailsExpanded: false,
    view: {},
    source: "正在读取同步数据",
  },
  onLoad(options) {
    this.setData({ market: options.market || "hk", id: decodeURIComponent(options.id || "") });
    track("detail_open", { market: String(options.market || "hk") });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source) => {
      const item = findItem(snapshot, this.data.market, this.data.id);
      if (!item) return;
      const view = detailView(item, snapshot);
      this.setData({ ready: true, view, group: item.group || "", source });
      wx.setNavigationBarTitle({ title: view.title || "资料详情" });
    }, done, { force });
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  toggleDetails() {
    this.setData({ detailsExpanded: !this.data.detailsExpanded });
  },
  openWorkspace() {
    const market = ["hk", "us", "a", "gold"].includes(this.data.market) ? this.data.market : "other";
    const query = [
      `market=${encodeURIComponent(market)}`,
      `name=${encodeURIComponent(this.data.view.title || "")}`,
      `code=${encodeURIComponent(this.data.view.code || "")}`,
    ].join("&");
    track("workspace_open", { from: "detail" });
    openPage(`/pages/workspace/index?${query}`);
  },
  onShareAppMessage() {
    track("share_tap", { page: "detail" });
    return { title: `${this.data.view.title || "研究资料"}｜望潮 Aurum`, path: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(this.data.id)}` };
  },
});
