const { loadSnapshot } = require("../../data/store");
const { findItem, money, publicRoute } = require("../../utils/answers");

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%` : "暂缺";
}

function formatLarge(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "暂缺";
  if (Math.abs(amount) >= 1e8) return `${(amount / 1e8).toFixed(1)} 亿元`;
  if (Math.abs(amount) >= 1e4) return `${(amount / 1e4).toFixed(1)} 万元`;
  return amount.toFixed(0);
}

function detailView(item) {
  const raw = item.raw || {};
  const base = {
    title: item.name, code: item.code, badge: item.badge, score: item.score > 0 ? `${item.score} 分` : "待核验",
    rank: item.rank ? `第 ${item.rank} 名` : "当前分类", answer: item.one, metrics: [], facts: [], holdings: [], risk: "数据不足时宁可不给硬答案。",
  };
  if (item.market === "hk") {
    const review = raw.historicalReview || {};
    const ended = item.group === "ended";
    base.metrics = ended
      ? [["暗盘表现", formatPercent(review.greyMarketChange)], ["首日表现", formatPercent(review.firstDayChange)], ["五日最高", formatPercent(review.fiveDayHighChange)]]
      : [["暗盘卖出", "暂不发布可靠价格"], ["五日卖出", "暂不发布可靠价格"], ["招股价", raw.offerPrice || (raw.priceLow && raw.priceHigh ? `${raw.priceLow}-${raw.priceHigh} 港元` : "待公布")]];
    base.facts = [["上市日期", raw.listingDate || "待公布"], ["一手入场费", raw.entryFee ? `${Number(raw.entryFee).toFixed(2)} 港元` : "待解析"], ["保荐人", raw.sponsor || "待解析"], ["基石投资者", (raw.cornerstoneInvestors || []).join("、") || "待解析"]];
    base.risk = ended ? "历史表现只用于复盘，不能倒推当时必然值得申购。" : "新股结论、暗盘和卖出价格仅供研究参考。";
  } else if (item.market === "us") {
    const plan = raw.technicalPlan || {};
    const target = Array.isArray(plan.tp) ? plan.tp : [];
    base.metrics = [["当前价格", money(raw.price)], ["买入参考", money(plan.buy)], ["止盈参考", target.length ? `${money(target[0])}–${money(target[target.length - 1])}` : "暂缺"], ["止损参考", money(plan.stop)]];
    base.facts = [["今日涨跌", formatPercent(raw.changePercent)], ["七日涨跌", formatPercent(raw.weeklyChange)], ["热度", Number.isFinite(Number(raw.heatScore)) ? `${Number(raw.heatScore)} 分` : "暂缺"], ["营收增长", formatPercent(raw.fund && raw.fund.revenueGrowth)], ["利润率", formatPercent(raw.fund && raw.fund.profitMargin)], ["现金及等价物", raw.fund ? formatLarge(raw.fund.liquidAssets * 1000) : "暂缺"]];
    base.risk = "价格区间是研究参考；高热度不等于适合追高。";
  } else if (item.market === "a") {
    const financials = raw.financials || {};
    base.metrics = [["当前价格", money(raw.currentPrice, "¥")], ["当前股息率", Number.isFinite(Number(raw.currentDividendYield)) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : "暂缺"], ["合理买入", raw.buyPrice || "待核验"], ["高安全边际", raw.safeMarginPrice || "待核验"]];
    base.facts = [["评级", raw.rating || "待核验"], ["经营现金流", formatLarge(financials.operatingCashFlow)], ["自由现金流", formatLarge(financials.freeCashFlow)], ["现金利润比", Number.isFinite(Number(financials.cashConversion)) ? `${Number(financials.cashConversion).toFixed(2)} 倍` : "暂缺"], ["营收增长", formatPercent(financials.revenueGrowth)], ["净利润增长", formatPercent(financials.netProfitGrowth)]];
    base.risk = "过往分红不代表未来承诺，现金流转弱时需要重新判断。";
  } else {
    base.metrics = [["跟踪价值", Number.isFinite(Number(raw.trackingScore)) ? `${Number(raw.trackingScore)} 分` : "暂缺"], ["披露季度", raw.reportDate || "待核验"], ["披露日期", raw.filingDate || "待核验"], ["组合规模", formatLarge(raw.portfolioValue)]];
    base.holdings = (raw.holdings || []).slice(0, 6).map((holding) => ({ name: holding.ticker, value: `${Number.isFinite(Number(holding.weight)) ? `${Number(holding.weight).toFixed(1)}%` : "占比待核验"} · ${holding.changeLabel || "变化待核验"}` }));
    base.facts = [["最近清仓", (raw.sold || []).slice(0, 4).map((holding) => holding.ticker).join("、") || "暂无"], ["资料来源", raw.source || "SEC 13F"]];
    base.risk = "13F 通常滞后数周，只能参考方向，不能照抄。";
  }
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
      this.item = item;
      this.setData({ ready: true, view: detailView(item), source });
    }, done);
  },
  openDeep() {
    if (!this.item) return;
    const route = publicRoute(this.item);
    wx.navigateTo({ url: `/pages/webview/index?target=${route.target}&id=${encodeURIComponent(route.id)}` });
  },
  goBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) }); },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  onShareAppMessage() {
    return { title: `${this.data.view.title || "投资答案"}｜望潮 Aurum`, path: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(this.data.id)}` };
  },
});
