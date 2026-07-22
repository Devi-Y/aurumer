const { loadSnapshot } = require("../../data/store");
const { findItem, money, INVESTOR_NAMES } = require("../../utils/answers");

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
  return {
    title: item.name,
    code: item.code,
    badge: item.badge,
    score: item.score > 0 ? `${item.score} 分` : "待核验",
    rank: item.rank ? `第 ${item.rank} 名` : "当前分类",
    answer: item.one,
    metrics: [],
    facts: [],
    holdings: [],
    analysis: [],
    actions: [],
    risk: "数据不足时宁可不给硬答案。",
    sourceNote: "公开资料整理",
    disclaimer: "本平台数据仅供学习参考，不构成投资建议。",
  };
}

function buildHKView(base, item) {
  const raw = item.raw || {};
  const review = raw.historicalReview || {};
  const ended = item.group === "ended";
  const offerPrice = raw.offerPrice || (raw.priceLow && raw.priceHigh ? `${raw.priceLow}-${raw.priceHigh} 港元` : "待公布");
  const sponsors = raw.sponsor || joinNames(raw.sponsorNames, "待解析");
  const underwriters = joinNames(raw.underwriterNames, "暂未披露");
  const cornerstones = joinNames(raw.cornerstoneInvestors, "暂未披露");

  base.metrics = ended
    ? [
        ["暗盘表现", formatPercent(review.greyMarketChange)],
        ["首日表现", formatPercent(review.firstDayChange)],
        ["五日表现", formatPercent(review.fiveDayChange)],
        ["五日最高", formatPercent(review.fiveDayHighChange)],
      ]
    : [
        ["招股价", offerPrice],
        ["一手入场", raw.entryFee ? `${Number(raw.entryFee).toFixed(2)} 港元` : "待解析"],
        ["暗盘卖出", "暂不发布可靠价格"],
        ["五日卖出", "暂不发布可靠价格"],
      ];
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
        { title: "申购答案", body: item.one || "公开资料不足，暂不参与。" },
        { title: "卖出答案", body: "发行价、配售结果或可验证样本不足时，不发布暗盘和上市五日的硬价格。" },
        { title: "资料完整度", body: `目前已整理保荐人、承销商、基石及招股信息；仍缺失的字段均明确标为待解析或待公布。` },
      ];
  base.actions = ended
    ? [{ label: "下一步", value: "返回已结束列表，比较同类新股实际表现" }]
    : [
        { label: "当前动作", value: item.badge === "值得打" ? "查看券商申购截止时间，再决定参与" : "先等待资料完整，不勉强参与" },
        { label: "价格纪律", value: "没有可靠卖出价时，不使用占位数字" },
      ];
  base.risk = ended
    ? "历史表现只用于复盘，不能倒推当时必然值得申购。"
    : "新股结论、暗盘和卖出价格仅供研究参考，实际表现可能明显偏离。";
  base.sourceNote = raw.source || "港交所公开文件与历史结果整理";
}

function buildUSView(base, item, snapshot) {
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const plan = raw.technicalPlan || {};
  const targets = Array.isArray(plan.tp) ? plan.tp.filter(hasNumber) : [];
  const targetRange = targets.length ? `${money(targets[0])}–${money(targets[targets.length - 1])}` : "暂缺";
  const holders = investorHoldings(snapshot, raw.symbol);

  base.metrics = [
    ["当前价格", money(raw.price)],
    ["买入参考", money(plan.buy)],
    ["止盈参考", targetRange],
    ["止损参考", money(plan.stop)],
  ];
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
    ["分析师目标价", money(fund.targetPrice)],
  ];
  base.holdings = holders;
  base.analysis = [
    { title: "现在怎么看", body: item.one || "价格资料不足，继续观察。" },
    { title: "基本面好不好", body: `营收增长 ${formatPercent(fund.revenueGrowth)}，利润率 ${formatPercent(fund.profitMargin)}，ROE ${formatPercent(fund.roe)}。数据缺失时不做强结论。` },
    { title: "价格在什么位置", body: stockRange(raw.history, raw.price) },
    { title: "聪明人持仓", body: holders.length ? `${holders.map((holder) => holder.name).join("、")} 的公开申报中包含该标的。` : "当前跟踪的公开申报中未发现该标的，或披露资料尚未更新。" },
  ];
  base.actions = [
    { label: "关注价", value: money(plan.buy) },
    { label: "分批止盈", value: targetRange },
    { label: "风险退出", value: money(plan.stop) },
  ];
  base.risk = "价格区间是研究参考；高热度不等于适合追高，财报和事件可能造成跳空。";
  base.sourceNote = `公开行情与财务资料 · ${raw.asOf || fund.period || "日期待核验"}`;
}

function buildAShareView(base, item) {
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const annualDividend = hasNumber(raw.annualDividendPer100k) ? Number(raw.annualDividendPer100k) : null;

  base.metrics = [
    ["当前价格", money(raw.currentPrice, "¥")],
    ["当前股息率", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺"],
    ["合理买入", raw.buyPrice || "待核验"],
    ["高安全边际", raw.safeMarginPrice || "待核验"],
  ];
  base.facts = [
    ["所属行业", raw.industry || financials.industry || "待核验"],
    ["评级", raw.rating || "待核验"],
    ["可持续股息率", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : "暂缺"],
    ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ["自由现金流", formatLarge(financials.freeCashFlow)],
    ["自由现金流率", formatPercent(financials.freeCashFlowMargin)],
    ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"],
    ["营收增长", formatPercent(financials.revenueGrowth)],
    ["净利润增长", formatPercent(financials.netProfitGrowth)],
    ["ROE", formatPercent(financials.roe)],
  ];
  base.analysis = [
    { title: "收息答案", body: item.one || "先看分红是否有现金流支撑。" },
    { title: "10 万元现金流", body: hasNumber(annualDividend) ? `按当前公开分红口径估算，每年约 ${annualDividend.toFixed(0)} 元；实际分红以公司公告为准。` : "公开资料不足，暂不估算年现金分红。" },
    { title: "现金流质量", body: `经营现金流 ${formatLarge(financials.operatingCashFlow)}，自由现金流 ${formatLarge(financials.freeCashFlow)}，现金利润比 ${hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"}。` },
    { title: "价格答案", body: `当前 ${money(raw.currentPrice, "¥")}；合理买入 ${raw.buyPrice || "待核验"}；高安全边际 ${raw.safeMarginPrice || "待核验"}。` },
  ];
  base.actions = [
    { label: "当前动作", value: raw.currentAdvice || item.badge || "等待" },
    { label: "关注价格", value: raw.buyPrice || "待核验" },
    { label: "更高安全边际", value: raw.safeMarginPrice || "待核验" },
  ];
  base.risk = "过往分红不代表未来承诺，现金流转弱、资本开支上升或政策变化时需要重新判断。";
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
    ["组合规模", hasNumber(raw.portfolioValue) ? formatLarge(raw.portfolioValue) : "以原始文件为准"],
  ];
  base.holdings = holdings.slice(0, 10).map((holding) => ({
    name: holding.ticker,
    value: `${holding.name || ""} · ${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核验"}`,
  }));
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
    { label: "适合做", value: "学习选股框架与组合方向" },
    { label: "下一次核验", value: profile.group === "us" ? "下一期 13F / 基金报告" : "下一份月报、季报或半年报" },
    { label: "不适合做", value: "按报告期仓位直接照抄" },
  ];
  base.risk = "历史业绩不代表未来收益；公开持仓按月或按季披露，不能代表实时仓位或实时买卖理由。";
  base.sourceNote = `${raw.source || profile.sourceName || "公开报告"} · ${raw.filingDate || profile.report || "披露日期待核验"}`;
}

function buildGoldView(base, item) {
  const gold = item.raw || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const band = (value) => value && hasNumber(value.low) && hasNumber(value.high) ? `${Number(value.low).toFixed(1)}–${Number(value.high).toFixed(1)} ${value.currency || ""}` : "待核验";
  const indicatorLine = (gold.indicators || []).map((entry) => `${entry.label} ${entry.value}${entry.unit || ""}`).join("；") || "宏观资料待核验";
  base.metrics = [
    ["国际金", hasNumber(international.price) ? `${Number(international.price).toFixed(1)} ${international.currency || "USD/oz"}` : "暂缺"],
    ["上海金", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)} ${domestic.currency || "CNY/g"}` : "暂缺"],
    ["当前结论", answer.action || "等待数据"],
    ["综合观察分", hasNumber(answer.score) ? `${Number(answer.score)} 分` : "暂缺"],
  ];
  base.facts = (gold.indicators || []).map((entry) => [entry.label, `${entry.value}${entry.unit || ""} · ${entry.note || ""}`]);
  if (gold.view === "price") {
    base.analysis = [
      { title: "国际金位置", body: `20 日 ${formatPercent(international.returns?.day20)}，60 日 ${formatPercent(international.returns?.day60)}，半年位置约 ${international.percentile180 ?? "暂缺"}% 分位。` },
      { title: "上海金位置", body: `现价 ${hasNumber(domestic.price) ? Number(domestic.price).toFixed(2) : "暂缺"} 元/克；与国际金还受汇率、境内供需和交易时段影响。` },
      { title: "研究区间", body: `国际金关注 ${band(plan.internationalWatch)}；上海金关注 ${band(plan.domesticWatch)}。` },
    ];
  } else if (gold.view === "drivers") {
    base.analysis = (gold.indicators || []).map((entry) => ({ title: entry.label, body: `${entry.value}${entry.unit || ""}。${entry.note || ""}` }));
  } else if (gold.view === "analysis") {
    base.analysis = [
      { title: "1 · 价格位置", body: "先看国际金与上海金是否进入观察区，不因单日涨跌追高。" },
      { title: "2 · 机会成本", body: "实际利率和美元走强通常压制黄金，但关系会随风险事件变化。" },
      { title: "3 · 拥挤与溢价", body: `结合持仓和上海金溢价判断是否拥挤。当前指标：${indicatorLine}` },
      { title: "4 · 风险执行", body: "只用能承受波动的仓位，并在价格或宏观逻辑失效时重新评估。" },
    ];
  } else {
    base.analysis = [
      { title: "现在怎么看", body: answer.conclusion || "先等待价格与宏观资料完整。" },
      { title: "WHY · 当前依据", body: (answer.reasons || []).join("；") || "当前没有足够的积极依据。" },
      { title: "主要风险", body: (answer.risks || []).join("；") || "利率、美元与流动性变化会带来回撤。" },
    ];
  }
  base.actions = [
    { label: "国际金关注区", value: band(plan.internationalWatch) },
    { label: "上海金关注区", value: band(plan.domesticWatch) },
    { label: "风险下沿", value: `${band(plan.internationalRisk)} / ${band(plan.domesticRisk)}` },
  ];
  base.risk = "黄金会受通胀、实际利率、美元、汇率与流动性共同影响；研究区间不是收益承诺。";
  base.sourceNote = (gold.sources || []).filter((source) => source.ok).map((source) => source.name).join(" · ") || "公开行情与宏观资料";
}

function detailView(item, snapshot) {
  const base = baseView(item);
  if (item.market === "hk") buildHKView(base, item);
  else if (item.market === "us") buildUSView(base, item, snapshot);
  else if (item.market === "a") buildAShareView(base, item);
  else if (item.market === "gold") buildGoldView(base, item);
  else buildGuruView(base, item);
  return base;
}

Page({
  data: { market: "hk", id: "", ready: false, view: {}, source: "正在读取同步数据" },
  onLoad(options) {
    this.setData({ market: options.market || "hk", id: decodeURIComponent(options.id || "") });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh()); },
  refresh(done) {
    loadSnapshot((snapshot, source) => {
      const item = findItem(snapshot, this.data.market, this.data.id);
      if (!item) return;
      this.setData({ ready: true, view: detailView(item, snapshot), source });
    }, done);
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.view.title || "投资答案"}｜望潮 Aurum`, path: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(this.data.id)}` };
  },
});
