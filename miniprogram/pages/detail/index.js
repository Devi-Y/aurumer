const { openPage, goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { loadSnapshot } = require("../../data/store");
const { findItem, money, INVESTOR_NAMES, formatRange } = require("../../utils/answers");

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
  if (Math.abs(amount) >= 1e8) return `${(amount / 1e8).toFixed(1)} 亿元`;
  if (Math.abs(amount) >= 1e4) return `${(amount / 1e4).toFixed(1)} 万元`;
  return amount.toFixed(0);
}

function formatNumber(value, suffix = "") {
  return hasNumber(value) ? `${Number(value).toFixed(2)}${suffix}` : "暂缺";
}

function joinNames(values, fallback = "暂缺") {
  return Array.isArray(values) && values.length ? values.join("、") : fallback;
}

function priceVisual(history, title, note, formatter = (value) => Number(value).toFixed(2)) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2) return null;
  const sampleCount = Math.min(14, values.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (values.length - 1));
    return values[sourceIndex];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1);
  return {
    kind: "columns",
    title,
    note,
    items: samples.map((value, index) => ({
      id: `${index}-${value}`,
      height: Math.round(24 + ((value - low) / span) * 76),
    })),
    lowLabel: `最低 ${formatter(low)}`,
    latestLabel: `最新 ${formatter(values[values.length - 1])}`,
    highLabel: `最高 ${formatter(high)}`,
  };
}

function barVisual(rows, title, note) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  return {
    kind: "bars",
    title,
    note,
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      width: Math.max(10, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
    })),
  };
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
    facts: [],
    holdings: [],
    analysis: [],
    actions: [],
    risk: "数据不足时宁可不给硬答案。",
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
  const sponsors = raw.sponsor || joinNames(raw.sponsorNames, "待解析");
  const underwriters = joinNames(raw.underwriterNames, "暂未披露");
  const cornerstones = joinNames(raw.cornerstoneInvestors, "暂未披露");

  base.badge = item.badge || answer.verdict || base.badge;
  base.answer = item.one;
  base.metrics = ended
    ? [
        ["暗盘表现", formatPercent(review.greyMarketChange)],
        ["首日表现", formatPercent(review.firstDayChange)],
        ["五日表现", formatPercent(review.fiveDayChange)],
        ["五日最高", formatPercent(review.fiveDayHighChange)],
      ]
    : [
        ["能不能打", item.badge || "先看结论"],
        ["招股价", offerPrice],
        ["一手入场", raw.entryFee ? `${Number(raw.entryFee).toFixed(2)} 港元` : "待解析"],
        ["认购截止", raw.offerDeadline || raw.offerEnd || "待公布"],
      ];
  if (ended) {
    base.visual = barVisual([
      { label: "暗盘", value: review.greyMarketChange, valueText: formatPercent(review.greyMarketChange) },
      { label: "首日", value: review.firstDayChange, valueText: formatPercent(review.firstDayChange) },
      { label: "五日", value: review.fiveDayChange, valueText: formatPercent(review.fiveDayChange) },
      { label: "五日最高", value: review.fiveDayHighChange, valueText: formatPercent(review.fiveDayHighChange) },
    ], "上市表现对比", "柱长表示涨跌幅绝对值，正负方向以数字为准。");
  }
  base.facts = [
    ["所属行业", raw.industry || "待解析"],
    ["招股期", raw.offerStart && raw.offerDeadline ? `${raw.offerStart} 至 ${raw.offerDeadline}` : "待公布"],
    ["上市日期", raw.listingDate || "待公布"],
    ["一手股数", raw.boardLot || (raw.boardLotShares ? `${raw.boardLotShares} 股` : "待解析")],
    ["保荐人", sponsors],
    ["承销商", underwriters],
    ["基石投资者", cornerstones],
    ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)} 倍` : "待公布"],
    ["一手中签率", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(2)}%` : "待公布"],
    ["A+H", raw.isAH === true ? "是" : raw.isAH === false ? "否" : "待核验"],
  ];
  base.analysis = ended
    ? [
        { title: "结果复盘", body: `暗盘 ${formatPercent(review.greyMarketChange)}，首日 ${formatPercent(review.firstDayChange)}，五日 ${formatPercent(review.fiveDayChange)}。只比较实际结果，不倒推当时结论。` },
        { title: "发行与认购", body: `发行价 ${offerPrice}；公开认购 ${hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)} 倍` : "待核验"}；一手中签率 ${hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(2)}%` : "待核验"}。` },
        { title: "现在怎么用", body: "该标的申购已经结束，只用于复盘同类新股表现，不作为当前申购依据。" },
      ]
    : [
        { title: "能不能打", body: `${item.badge || "先看结论"}：${answer.action || item.one || "公开资料不足，暂不判断。"}` },
        { title: "关键事实", body: `招股价 ${offerPrice}；一手约 ${raw.entryFee ? `${Number(raw.entryFee).toFixed(2)} 港元` : "待解析"}；认购期 ${raw.offerStart && raw.offerDeadline ? `${raw.offerStart} 至 ${raw.offerDeadline}` : "待公布"}。` },
        { title: "为什么", body: answer.action || "结合保荐人、基石、认购热度与历史相似样本综合判断；缺失字段会标明，不用假数字凑结论。" },
      ];
  base.actions = ended
    ? [{ label: "下一步", value: "返回已结束列表，比较同类新股实际表现" }]
    : [
        { label: "结论", value: item.badge || "先看结论" },
        { label: "建议动作", value: answer.action || "先核对手金额与风险再决定" },
        { label: "下一步", value: "若决定申购，按券商规则下单；若暂缓，盯认购热度与补齐资料" },
      ];
  base.risk = ended
    ? "历史表现只用于复盘，不能倒推当时必然值得申购。"
    : "这是公开资料研究结论，供你参考；新股可能破发或中签率极低，盈亏自负。";
  if (ended && item.rank) base.rank = `首日涨幅第 ${item.rank} 名`;
  base.sourceNote = raw.source || "港交所公开文件与历史结果整理";
}

function buildUSView(base, item, snapshot) {
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const range = historyStats(raw.history);
  const holders = investorHoldings(snapshot, raw.symbol);

  base.metrics = [
    ["当前价格", money(raw.price)],
    ["近 60 日最低", range ? money(range.low) : "暂缺"],
    ["近 60 日中位数", range ? money(range.median) : "暂缺"],
    ["近 60 日最高", range ? money(range.high) : "暂缺"],
  ];
  base.visual = priceVisual(raw.history, "近 60 日价格轨迹", "使用公开收盘价样本，只描述已经发生的区间。", (value) => `$${Number(value).toFixed(2)}`);
  base.facts = [
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["七日涨跌", formatPercent(raw.weeklyChange)],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["营收增长", formatPercent(fund.revenueGrowth)],
    ["毛利率", formatPercent(fund.grossMargin)],
    ["利润率", formatPercent(fund.profitMargin)],
    ["ROE", formatPercent(fund.roe)],
    ["现金及等价物", hasNumber(fund.liquidAssets) ? formatLarge(Number(fund.liquidAssets) * 1000) : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
  ];
  base.holdings = holders;
  base.analysis = [
    { title: "一句话", body: item.one || "价格资料不足，暂不作方向判断。" },
    { title: "公司赚不赚钱", body: `营收增长 ${formatPercent(fund.revenueGrowth)}，利润率 ${formatPercent(fund.profitMargin)}，ROE ${formatPercent(fund.roe)}。数据缺失时不做强结论。` },
    { title: "现在贵不贵", body: `${stockRange(raw.history, raw.price)}（近 60 日最低 / 中位数 / 最高用来当尺子）。` },
    { title: "机构有没有拿", body: holders.length ? `${holders.map((holder) => holder.name).join("、")} 的公开申报里有它。` : "当前跟踪的公开申报里没看到，或报告还没更新。" },
  ];
  base.actions = [
    { label: "怎么用", value: item.group === "seven" ? "长期跟踪七姐妹之一" : "热度高只说明关注多，不等于马上买" },
    { label: "样本数量", value: range ? `${range.count} 个交易日` : "暂缺" },
    { label: "下一步", value: "对照自己的持仓或关注名单，再决定要不要深入研究" },
  ];
  base.risk = "历史样本只描述已经发生的价格位置，不预测未来；财报和事件可能造成跳空。";
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
    ["当前股息率", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺"],
    ["可持续股息率", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺"],
    ["研究看法", advice],
  ];
  base.visual = barVisual([
    { label: "当前股息率", value: raw.currentDividendYield, valueText: hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺" },
    { label: "可持续股息率", value: raw.sustainableDividendYield, valueText: hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺" },
  ], "股息口径对比", "股息率 = 一年分红 ÷ 股价；还要看公司有没有余钱继续发。");
  base.facts = [
    ["所属行业", raw.industry || financials.industry || "待核验"],
    ["价格日期", raw.priceAsOf || raw.asOf || "待核验"],
    ["财报期", financials.reportDate || financials.period || "待核验"],
    ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ["自由现金流", formatLarge(financials.freeCashFlow)],
    ["自由现金流率", formatPercent(financials.freeCashFlowMargin)],
    ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"],
    ["营收增长", formatPercent(financials.revenueGrowth)],
    ["净利润增长", formatPercent(financials.netProfitGrowth)],
    ["ROE", formatPercent(financials.roe)],
  ];
  base.analysis = [
    { title: "收息结论", body: `${advice}：${raw.summary || item.one || "先核对分红是否有现金流支撑。"}` },
    { title: "10 万元现金流", body: hasNumber(annualDividend) ? `按当前公开分红口径估算，每年约 ${annualDividend.toFixed(0)} 元；实际分红以公司公告为准。` : "公开资料不足，暂不估算年现金分红。" },
    { title: "钱是不是赚得稳", body: `经营现金流 ${formatLarge(financials.operatingCashFlow)}，自由现金流 ${formatLarge(financials.freeCashFlow)}，现金利润比 ${hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"}。` },
    { title: "参考价", body: buyHint ? `公开研究参考：${buyHint}${raw.safeMarginPrice ? `；更稳一点可看 ${raw.safeMarginPrice}` : ""}。` : `当前 ${money(raw.currentPrice, "¥")}；今日涨跌 ${formatPercent(raw.changePercent)}。` },
  ];
  base.actions = [
    { label: "结论", value: advice },
    { label: "参考价", value: buyHint || "暂无单独参考价" },
    { label: "下一步", value: "对照股息率与现金流，决定要不要纳入自己的收息名单" },
  ];
  base.risk = "过往分红不代表未来承诺；现金流转弱、资本开支上升或政策变化时，分红可能被砍。";
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
  base.rank = profile.order ? `${profile.marketLabel} 第 ${profile.order}/${groupCounts[profile.group]} 名` : "候选池";
  base.answer = `WHY：${profile.why || item.one} HOW：${profile.how || "学框架，不照抄。"}`;
  base.metrics = [
    ["长期公开业绩", profile.performanceValue || "待核验"],
    ["业绩区间", profile.performanceDetail || "待核验"],
    ["持仓报告", raw.reportDate || profile.report || "待核验"],
    ["披露日期", raw.filingDate || "待核验"],
    ["组合规模", "以原始文件口径为准"],
  ];
  base.holdings = holdings.slice(0, 10).map((holding) => ({
    name: holding.ticker,
    value: `${holding.name || ""} · ${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核验"}`,
  }));
  base.visual = barVisual(holdings.slice(0, 6).map((holding) => ({
    label: holding.ticker,
    value: holding.weight,
    valueText: formatNumber(holding.weight, "%"),
  })), "公开持仓权重", "只显示最新公开报告中的前六项；披露有延迟。 ");
  base.facts = [
    ["WHY", profile.why || "公开资料待核验"],
    ["HOW", profile.how || "学框架，不照抄"],
    ["业绩口径", profile.performanceBasis || "不同区间、币种与份额不可直接横比"],
    ["资料来源", raw.source || "SEC 13F"],
  ];
  base.analysis = [
    { title: "WHY · 为什么选它", body: profile.why || "公开业绩和持仓具备研究价值。" },
    { title: "HOW · 怎么学", body: profile.how || "先理解方法，再独立判断。" },
    { title: "持仓怎么读", body: holdings.length ? holdings.slice(0, 5).map((holding) => `${holding.ticker}：${holding.interpretation || holding.changeLabel}`).join("；") : "当前持仓资料待核验。" },
    { title: "比较边界", body: "这是可核验候选池内按表观长期年化排序，不是不同市场、币种和风险口径下的全球绝对榜。" },
  ];
  base.actions = [
    { label: "适合做", value: "学思路、对照自己有没有和机构抢同一只" },
    { label: "下一次核验", value: profile.group === "us" ? "下一期 13F / 基金报告" : "下一份月报、季报或半年报" },
    { label: "不适合做", value: "按旧报告仓位直接照抄下单" },
  ];
  base.risk = "历史业绩不代表未来；公开持仓有滞后，不能当实时买卖单，但可用来学习与争利对照。";
  base.sourceNote = `${raw.source || profile.sourceName || "公开报告"} · ${raw.filingDate || profile.report || "披露日期待核验"}`;
}

function buildGoldView(base, item) {
  const gold = item.raw || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
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
  const why = (answer.reasons || []).join("；") || "先看价格位置与宏观驱动。";
  const risks = (answer.risks || []).join("；") || "利率、美元与流动性变化会带来回撤。";

  base.title = gold.view === "plan" ? "买点与卖点" : "现在怎么做";
  base.badge = action;
  base.answer = item.one;
  base.metrics = [
    ["现在动作", action],
    ["国际金", hasNumber(international.price) ? `${Number(international.price).toFixed(1)} ${international.currency || "USD/oz"}` : "暂缺"],
    ["上海金", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)} ${domestic.currency || "CNY/g"}` : "暂缺"],
    ["半年位置", hasNumber(international.percentile180) ? `${Number(international.percentile180)}% 分位` : "暂缺"],
  ];
  base.visual = priceVisual(
    (gold.history?.international || []).map((entry) => entry.close),
    "国际金历史轨迹",
    "公开收盘样本，不代表未来价格。",
    (value) => Number(value).toFixed(1),
  );
  base.facts = [
    ["国际金买入观察", buyIntl || "暂缺"],
    ["国际金卖出观察", sellIntl || "暂缺"],
    ["国际金风险下沿", riskIntl || "暂缺"],
    ["上海金买入观察", buyCny || "暂缺"],
    ["上海金卖出观察", sellCny || "暂缺"],
    ["上海金风险下沿", riskCny || "暂缺"],
    ...(gold.indicators || []).slice(0, 4).map((entry) => [entry.label, `${entry.value}${entry.unit || ""}`]),
  ];
  if (gold.view === "plan") {
    base.analysis = [
      { title: "什么价可以买", body: `国际金买入观察 ${buyIntl || "暂缺"}；上海金买入观察 ${buyCny || "暂缺"}。落到观察区可开始分批关注。` },
      { title: "什么价可以卖", body: `国际金卖出/止盈观察 ${sellIntl || "暂缺"}；上海金卖出观察 ${sellCny || "暂缺"}。` },
      { title: "跌破哪里要小心", body: `国际金风险下沿 ${riskIntl || "暂缺"}；上海金风险下沿 ${riskCny || "暂缺"}。` },
      { title: "历史样本区间", body: `国际金近 ${internationalRange?.count || 0} 个样本 ${rangeText(internationalRange, international.currency || "USD/oz")}。` },
    ];
  } else {
    base.analysis = [
      { title: "现在怎么做", body: `${action}。${answer.conclusion || why}` },
      { title: "为什么", body: why },
      { title: "主要风险", body: risks },
      { title: "买卖观察区", body: `买 ${buyIntl || buyCny || "暂缺"}；卖 ${sellIntl || sellCny || "暂缺"}；风险 ${riskIntl || riskCny || "暂缺"}。` },
    ];
  }
  base.actions = [
    { label: "现在动作", value: action },
    { label: "买入观察", value: buyIntl || buyCny || "暂缺" },
    { label: "卖出观察", value: sellIntl || sellCny || "暂缺" },
  ];
  base.risk = "黄金波动可能很大；以上为公开资料研究观察区，不是强制下单指令，盈亏自负。";
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
  const firstAnalysis = base.analysis[0] && base.analysis[0].body;
  const quickAnswer = String(firstAnalysis || base.answer || "先看关键数据，再按需展开完整资料。")
    .replace(/\s+/g, " ")
    .trim();
  base.quickAnswer = quickAnswer.length > 76 ? `${quickAnswer.slice(0, 76)}…` : quickAnswer;
  base.metrics = base.metrics.slice(0, 4);
  return base;
}

Page({
  data: {
    market: "hk",
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
      this.setData({ ready: true, view, source });
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
