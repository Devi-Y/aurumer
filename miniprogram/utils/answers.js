const MAGNIFICENT_SEVEN = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"];

const US_NAMES = {
  NVDA: "英伟达", MSFT: "微软", AAPL: "苹果", GOOGL: "谷歌-A", AMZN: "亚马逊",
  META: "Meta", TSLA: "特斯拉", AMD: "超威半导体", AVGO: "博通", PLTR: "Palantir",
  SMCI: "超微电脑", ARM: "Arm", TSM: "台积电", ASML: "阿斯麦", COIN: "Coinbase",
  MSTR: "Strategy", CRWD: "CrowdStrike", NOW: "ServiceNow", V: "Visa", MA: "万事达",
  NFLX: "奈飞", ORCL: "甲骨文", CRM: "Salesforce", SNOW: "Snowflake", SHOP: "Shopify",
  UBER: "优步", JPM: "摩根大通", "BRK.B": "伯克希尔", LLY: "礼来", COST: "好市多",
};

const INVESTOR_NAMES = {
  buffett: "巴菲特 / 伯克希尔", munger: "查理·芒格（历史参考）", lilu: "李录 / 喜马拉雅",
  ackman: "比尔·阿克曼", wood: "凯茜·伍德", burry: "迈克尔·伯里",
  druckenmiller: "德鲁肯米勒", dalio: "瑞·达利欧", leopold: "Leopold Aschenbrenner",
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value, currency = "$") {
  return Number.isFinite(Number(value)) ? `${currency}${number(value).toFixed(2)}` : "暂缺";
}

function scoreRank(items, key) {
  const ordered = [...items].sort((left, right) => number(right[key]) - number(left[key]));
  return new Map(ordered.map((item, index) => [item.id || item.symbol || item.code, index + 1]));
}

function hkReviewScore(item) {
  const review = item.historicalReview || {};
  const outcomes = [review.greyMarketChange, review.firstDayChange, review.fiveDayChange]
    .map(Number)
    .filter(Number.isFinite);
  if (!outcomes.length) return null;
  const average = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
  return Math.max(0, Math.min(100, Math.round(50 + average / 2)));
}

function hkItems(snapshot) {
  const current = (snapshot.hk && snapshot.hk.listings ? snapshot.hk.listings : []).map((item) => {
    const verdict = item.publicAnswer && item.publicAnswer.verdict ? item.publicAnswer.verdict : "待核验";
    const group = verdict === "值得打" ? "worth" : verdict === "谨慎打" ? "caution" : "avoid";
    const publicScore = item.publicAnswer && item.publicAnswer.score;
    return {
      id: String(item.rawCode || item.code || item.id).replace(/\.HK$/i, ""),
      market: "hk",
      group,
      name: item.name || "港股新股",
      code: item.code || item.rawCode,
      badge: verdict === "待核验" ? "不建议" : verdict,
      score: verdict === "待核验"
        ? null
        : publicScore !== null && publicScore !== undefined && publicScore !== "" && Number.isFinite(Number(publicScore))
          ? Number(publicScore)
          : null,
      one: item.publicAnswer && item.publicAnswer.action ? item.publicAnswer.action : "资料不足，暂不参与。",
      raw: item,
    };
  });
  const ended = (snapshot.hk && snapshot.hk.history ? snapshot.hk.history : []).map((item) => ({
    id: String(item.stockCode || item.code || item.id).replace(/\.HK$/i, ""),
    market: "hk",
    group: "ended",
    name: item.name || "历史新股",
    code: item.code || item.stockCode,
    badge: "已结束",
    score: hkReviewScore(item),
    one: item.reviewNote || "申购已结束，查看暗盘与上市后表现。",
    raw: item,
  }));
  const items = [...current, ...ended];
  for (const group of ["worth", "caution", "avoid", "ended"]) {
    const ranked = items
      .filter((item) => item.group === group && Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score);
    ranked.forEach((item, index) => { item.rank = index + 1; });
  }
  return items;
}

function stockAction(stock) {
  const price = number(stock.price);
  const plan = stock.technicalPlan || {};
  const buy = number(plan.buy, NaN);
  const firstTarget = Array.isArray(plan.tp) ? number(plan.tp[0], NaN) : NaN;
  if (!Number.isFinite(buy) || !Number.isFinite(firstTarget)) return "价格资料不足，继续观察。";
  if (price <= buy * 1.03) return "接近买入区间，可小仓观察。";
  if (price >= firstTarget) return "已到目标区间，注意分批止盈。";
  if (number(stock.weeklyChange) > 8) return "短期涨得快，先别追。";
  return "未到理想买点，继续等待。";
}

function usItems(snapshot) {
  const fundamentals = new Map((snapshot.us && snapshot.us.fundamentals ? snapshot.us.fundamentals : []).map((item) => [item.symbol, item]));
  const stocks = (snapshot.us && snapshot.us.stocks ? snapshot.us.stocks : []).map((stock) => {
    const fund = fundamentals.get(stock.symbol) || {};
    return { ...stock, fund, finalScore: number(fund.finalScore), id: stock.symbol };
  });
  const globalRanks = scoreRank(stocks, "finalScore");
  const make = (stock, group, badge) => ({
    id: stock.symbol,
    market: "us",
    group,
    name: US_NAMES[stock.symbol] || stock.symbol,
    code: stock.symbol,
    badge,
    score: stock.finalScore,
    rank: globalRanks.get(stock.symbol),
    one: stockAction(stock),
    raw: stock,
  });
  const bySymbol = new Map(stocks.map((item) => [item.symbol, item]));
  const seven = MAGNIFICENT_SEVEN.map((symbol) => bySymbol.get(symbol)).filter(Boolean).map((item) => make(item, "seven", "七姐妹"));
  const nonSeven = stocks
    .filter((item) => !MAGNIFICENT_SEVEN.includes(item.symbol))
    .sort((left, right) => number(right.heatScore) - number(left.heatScore));
  const qualityHot = nonSeven.filter((item) => item.fund && item.fund.qualityEligible);
  const hot = (qualityHot.length >= 3 ? qualityHot : nonSeven)
    .slice(0, 3)
    .map((item) => make(item, "hot", "热度前三"));
  const gurus = (snapshot.investors || []).map((investor) => ({
    id: investor.id,
    market: "guru",
    group: "gurus",
    name: INVESTOR_NAMES[investor.id] || investor.name,
    code: investor.name,
    badge: "聪明人持仓",
    score: number(investor.trackingScore),
    one: investor.trackingSummary || "只看公开持仓方向变化，不照抄。",
    raw: investor,
  }));
  const guruRanks = scoreRank(gurus.map((item) => ({ ...item, trackingScore: item.score })), "trackingScore");
  gurus.forEach((item) => { item.rank = guruRanks.get(item.id); });
  return [...seven, ...hot, ...gurus];
}

function aShareItems(snapshot) {
  const fundamentals = new Map((snapshot.aShare && snapshot.aShare.fundamentals ? snapshot.aShare.fundamentals : []).map((item) => [item.code, item]));
  const quotes = (snapshot.aShare && snapshot.aShare.quotes ? snapshot.aShare.quotes : []);
  const ranks = scoreRank(quotes.map((item) => ({ ...item, id: item.code })), "score");
  return quotes.map((item) => {
    const advice = item.currentAdvice || "等待";
    const group = advice === "买入" ? "buy" : ["持有", "等待", "观察"].includes(advice) ? "wait" : "avoid";
    return {
      id: String(item.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group,
      name: item.name,
      code: item.code,
      badge: group === "buy" ? "买入" : group === "wait" ? "等待" : "回避",
      score: number(item.score),
      rank: ranks.get(item.code),
      one: item.summary || "先看分红是否有现金流支撑。",
      raw: { ...item, financials: fundamentals.get(item.code) || {} },
    };
  });
}

function allItems(snapshot, market) {
  if (market === "hk") return hkItems(snapshot);
  if (market === "us") return usItems(snapshot);
  if (market === "a") return aShareItems(snapshot);
  return [];
}

function groupDefinitions(snapshot, market) {
  const items = allItems(snapshot, market);
  const definitions = market === "hk"
    ? [
        ["worth", "值得打", "当前资料支持参与。"],
        ["caution", "谨慎打", "有机会，但风险不能忽略。"],
        ["avoid", "不建议", "资料不足或风险偏高，先不参与。"],
        ["ended", "已结束", "只复盘实际暗盘和上市表现。"],
      ]
    : market === "us"
      ? [
          ["seven", "七姐妹", "只看最核心的全球科技龙头。"],
          ["hot", "热度前三", "排除七姐妹后，市场最关注的三只。"],
          ["gurus", "聪明人持仓", "看方向变化，不盲目抄作业。"],
        ]
      : [
          ["buy", "买入", "价格与现金流都达到观察条件。"],
          ["wait", "等待", "公司可以看，但价格还不够好。"],
          ["avoid", "回避", "分红或现金流暂不匹配。"],
        ];
  return definitions.map(([id, title, one]) => ({ id, title, one, count: items.filter((item) => item.group === id).length }));
}

function findItem(snapshot, market, id) {
  return allItems(snapshot, market).find((item) => String(item.id).toUpperCase() === String(id).toUpperCase());
}

function publicRoute(item) {
  if (item.market === "hk") return { target: "ipo", id: item.id };
  if (item.market === "us") return { target: "stock", id: item.id };
  if (item.market === "a") return { target: "ashare", id: item.id };
  return { target: "guru", id: item.id };
}

module.exports = {
  US_NAMES,
  allItems,
  findItem,
  groupDefinitions,
  money,
  publicRoute,
};
