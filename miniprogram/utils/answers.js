const { SMART_MONEY_PROFILES } = require("./smart-money");

const MAGNIFICENT_SEVEN = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"];

// 前台只保留 10 个收息研究样本：用户指定的 5 只股票 + 1 只 ETF，另 4 只由当前快照自动筛选。
const A_SHARE_FIXED_ORDER = [
  "600900.SH", // 长江电力
  "600036.SH", // 招商银行
  "600941.SH", // 中国移动
  "515180.SH", // 易方达中证红利 ETF
  "601088.SH", // 中国神华
  "000333.SZ", // 美的集团
];
const A_SHARE_SAMPLE_COUNT = 10;

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

const HK_VERDICT_MAP = {
  值得打: { group: "worth", badge: "建议申购", tone: "suggest" },
  谨慎打: { group: "caution", badge: "暂缓观察", tone: "wait" },
  不建议: { group: "avoid", badge: "暂不建议", tone: "skip" },
  申购已结束: { group: "ended", badge: "申购已结束", tone: "ended" },
  待核验: { group: "avoid", badge: "资料不够", tone: "skip" },
};

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value, currency = "$") {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? `${currency}${number(value).toFixed(2)}`
    : "暂缺";
}

function signedPercent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function formatRange(range, digits = 1) {
  if (!range) return null;
  const low = Number(range.low);
  const high = Number(range.high);
  const unit = range.currency || "";
  if (!Number.isFinite(low) && !Number.isFinite(high)) return null;
  if (Number.isFinite(low) && Number.isFinite(high) && low !== high) {
    return `${low.toFixed(digits)}–${high.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  }
  const value = Number.isFinite(low) ? low : high;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

/** 长公司名压成简称，方便老人/小白一眼看懂。 */
function shortCompanyName(value, fallback = "—", max = 8) {
  let name = String(value || "")
    .replace(/股份有限公司$/u, "")
    .replace(/有限责任公司$/u, "")
    .replace(/有限公司$/u, "")
    .replace(/集团公司$/u, "")
    .replace(/集团$/u, "")
    .replace(/控股$/u, "")
    .replace(/科技$/u, "")
    .replace(/智能$/u, "")
    .replace(/（[^）]*）/gu, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!name) name = String(value || fallback || "—").replace(/\s+/g, "").trim() || fallback;
  // 首页四格等窄位：直接截短，不用省略号（避免「拿森智能…」难读）
  return name.length > max ? name.slice(0, max) : name;
}

/** 保荐人/承销商等机构名缩短。 */
function shortOrgName(value, max = 8) {
  let name = String(value || "")
    .replace(/股份有限公司$/u, "")
    .replace(/有限责任公司$/u, "")
    .replace(/有限公司$/u, "")
    .replace(/资本$/u, "")
    .replace(/证券$/u, "")
    .replace(/（[^）]*）/gu, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (!name) return String(value || "暂缺");
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

function shortOrgList(values, fallback = "暂缺", maxItems = 2) {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values.slice(0, maxItems).map((item) => shortOrgName(item)).join("、")
    + (values.length > maxItems ? ` 等${values.length}家` : "");
}

function hkOutcome(item) {
  const review = item.historicalReview || {};
  const firstDay = Number(review.firstDayChange);
  const grey = Number(review.greyMarketChange);
  const fiveDay = Number(review.fiveDayChange);
  const headline = Number.isFinite(firstDay)
    ? { value: firstDay, label: `首日 ${signedPercent(firstDay)}` }
    : Number.isFinite(grey)
      ? { value: grey, label: `暗盘 ${signedPercent(grey)}` }
      : null;
  const parts = [
    Number.isFinite(grey) ? `暗盘 ${signedPercent(grey)}` : null,
    Number.isFinite(firstDay) ? `首日 ${signedPercent(firstDay)}` : null,
    Number.isFinite(fiveDay) ? `五日 ${signedPercent(fiveDay)}` : null,
  ].filter(Boolean);
  return { headline, summary: parts.join(" · ") };
}

function hkExtractionNote(item) {
  const failures = [item.announcementExtraction, item.prospectusExtraction]
    .filter((entry) => entry && entry.ok === false);
  if (!failures.length) return null;
  return failures.some((entry) => entry.engine === "missing-pdftotext")
    ? "招股文件解析组件缺失，字段暂时取不到；这是望潮的问题，不是公司未披露。"
    : "招股文件解析失败，字段暂时取不到；已记录待修复，不是公司未披露。";
}

function hkActionFromItem(item) {
  const answer = item.publicAnswer || {};
  const mapped = HK_VERDICT_MAP[answer.verdict];
  if (mapped) {
    return {
      ...mapped,
      action: answer.action || mapped.badge,
      score: Number.isFinite(Number(answer.score)) ? Number(answer.score) : null,
    };
  }
  if (item.withdrawn || item.researchView?.state === "withdrawn") {
    return { group: "cancelled", badge: "发行已取消", tone: "ended", action: "这次发行取消了，不用再申购。", score: null };
  }
  const state = item.researchView?.state;
  if (state === "complete") {
    return { group: "caution", badge: "暂缓观察", tone: "wait", action: "资料齐了，但研究结论尚未给出，先观察。", score: null };
  }
  if (state === "review") {
    return { group: "caution", badge: "暂缓观察", tone: "wait", action: "关键信息还缺一块，先别急着申购。", score: null };
  }
  return { group: "avoid", badge: "资料不够", tone: "skip", action: "公开资料不够，暂时没法判断能不能打。", score: null };
}

function hkItems(snapshot) {
  const current = (snapshot.hk && snapshot.hk.listings ? snapshot.hk.listings : []).map((item) => {
    const extractionNote = hkExtractionNote(item);
    const action = hkActionFromItem(item);
    const offerBits = [
      item.offerPrice ? `招股 ${item.offerPrice}` : null,
      item.entryFee ? `一手 ${Math.round(Number(item.entryFee))}` : null,
      item.offerDeadline || item.offerEnd || null,
    ].filter(Boolean);
    // 已出配发结果的仍可能留在 listings；按「已结束」展示，不混进暂不建议。
    const group = action.group === "ended" || item.allotmentUrl
      ? "ended"
      : action.group;
    return {
      id: String(item.rawCode || item.code || item.id).replace(/\.HK$/i, ""),
      market: "hk",
      group,
      name: item.name || "港股新股",
      code: item.code || item.rawCode,
      badge: group === "ended" ? (action.badge || "申购已结束") : action.badge,
      score: action.score,
      scoreText: action.badge,
      extractionNote,
      one: extractionNote
        || [action.badge, ...offerBits].filter(Boolean).join(" · "),
      raw: item,
    };
  });
  const ended = (snapshot.hk && snapshot.hk.history ? snapshot.hk.history : []).map((item) => {
    const outcome = hkOutcome(item);
    const verdict = item.historicalReview?.verdict || item.publicAnswer?.verdict;
    return {
      id: String(item.stockCode || item.code || item.id).replace(/\.HK$/i, ""),
      market: "hk",
      group: "ended",
      name: item.name || "历史新股",
      code: item.code || item.stockCode,
      badge: verdict || "已结束",
      score: null,
      outcomeValue: outcome.headline ? outcome.headline.value : null,
      scoreText: outcome.headline ? outcome.headline.label : "上市表现待核验",
      rankText: outcome.summary || "上市表现待核验",
      one: [
        outcome.headline ? outcome.headline.label : null,
        verdict || null,
      ].filter(Boolean).join(" · ") || "发行已结束",
      raw: item,
    };
  });
  const items = [...current, ...ended];
  const ranked = items
    .filter((item) => item.group === "ended" && Number.isFinite(item.outcomeValue))
    .sort((left, right) => right.outcomeValue - left.outcomeValue);
  ranked.forEach((item, index) => { item.rank = index + 1; });
  return items;
}

function usItems(snapshot) {
  const fundamentals = new Map((snapshot.us && snapshot.us.fundamentals ? snapshot.us.fundamentals : []).map((item) => [item.symbol, item]));
  const stocks = (snapshot.us && snapshot.us.stocks ? snapshot.us.stocks : []).map((stock) => {
    const fund = fundamentals.get(stock.symbol) || {};
    return { ...stock, fund, id: stock.symbol };
  });
  const make = (stock, group, badge) => {
    const heat = Number(stock.heatScore);
    const hasHeat = Number.isFinite(heat);
    return {
      id: stock.symbol,
      market: "us",
      group,
      name: US_NAMES[stock.symbol] || stock.symbol,
      code: stock.symbol,
      badge,
      score: null,
      rank: null,
      scoreText: group === "hot" && hasHeat ? `热度 ${Math.round(heat)}` : "七姐妹",
      rankText: badge,
      one: [
        signedPercent(stock.changePercent) || "涨跌待更新",
        group === "hot" && hasHeat ? `热度 ${Math.round(heat)}` : null,
        Number.isFinite(Number(stock.price)) ? money(stock.price) : null,
      ].filter(Boolean).join(" · "),
      raw: stock,
    };
  };  const bySymbol = new Map(stocks.map((item) => [item.symbol, item]));
  const seven = MAGNIFICENT_SEVEN.map((symbol) => bySymbol.get(symbol)).filter(Boolean).map((item) => make(item, "seven", "七姐妹"));
  const nonSeven = stocks
    .filter((item) => !MAGNIFICENT_SEVEN.includes(item.symbol))
    .sort((left, right) => number(right.heatScore) - number(left.heatScore));
  const hot = nonSeven.slice(0, 3)
    .map((item) => make(item, "hot", "热度前三"));
  return [...seven, ...hot];
}

function smartMoneyItems(snapshot) {
  const liveById = new Map((snapshot.investors || []).map((item) => [item.id, item]));
  const counts = { hk: 3, us: 5, a: 3 };
  return SMART_MONEY_PROFILES.map((profile) => {
    const live = liveById.get(profile.id);
    const holdings = live && Array.isArray(live.holdings)
      ? live.holdings.slice(0, 10).map((holding) => ({
          ticker: holding.ticker,
          name: holding.issuer || holding.ticker,
          weight: holding.weight,
          changeLabel: holding.changeLabel || "变化待核验",
          interpretation: "报告有滞后，只能当学习样本，不能当明天的买卖单。",
        }))
      : (profile.holdings || []).map(([ticker, name, weight, changeLabel, interpretation]) => ({ ticker, name, weight, changeLabel, interpretation }));
    return {
      id: profile.id,
      market: "guru",
      group: profile.group,
      name: profile.name,
      code: "",
      badge: profile.performanceValue || profile.marketLabel,
      score: null,
      rank: profile.order,
      scoreText: `${holdings.length}只持仓`,
      rankText: `第 ${profile.order}/${counts[profile.group]}`,
      one: `原因：${String(profile.why || "").slice(0, 10)} · 学法：${String(profile.how || "").slice(0, 8)}`,
      raw: {
        ...live,
        profile,
        holdings,
        sold: Array.isArray(live?.sold) ? live.sold : [],
        reportDate: live?.reportDate || profile.report || "以最新公开报告为准",
        filingDate: live?.filingDate || profile.report || "以原始文件为准",
        source: live?.source || profile.sourceName,
      },
    };
  });
}

function goldItems(snapshot) {
  const gold = snapshot.gold || {};
  const answer = gold.answer || {};
  const scores = answer.scores || {};
  const internationalScore = Number(scores.international?.score ?? answer.internationalScore);
  const domesticScore = Number(scores.domestic?.score ?? answer.domesticScore);
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international;
  const domestic = gold.quotes?.domestic;
  const intlPrice = Number(international?.price);
  const domPrice = Number(domestic?.price);
  const quoteLine = Number.isFinite(intlPrice) && Number.isFinite(domPrice)
    ? `国际金 ${intlPrice.toFixed(0)} 美元/盎司 · 人民币金 ${domPrice.toFixed(0)} 元/克`
    : "国际金与人民币金资料待核验";
  const buyIntl = formatRange(plan.internationalWatch);
  const sellIntl = formatRange(plan.internationalUpper);
  const riskIntl = formatRange(plan.internationalRisk);
  const buyCny = formatRange(plan.domesticWatch, 1);
  const sellCny = formatRange(plan.domesticUpper, 1);
  const action = answer.action || answer.researchLabel || "继续观察";
  const rows = [
    [
      "track",
      "track",
      "现在怎么做",
      action,
      [
        action,
        Number.isFinite(Number(international?.percentile180)) ? `半年位 ${Number(international.percentile180)}%` : null,
        Number.isFinite(Number(international?.price)) ? `国际金 ${Number(international.price).toFixed(0)}` : null,
        Number.isFinite(domPrice) ? `人民币金 ${domPrice.toFixed(0)}` : null,
        Number.isFinite(internationalScore) ? `国际金观察分 ${internationalScore}` : null,
        Number.isFinite(domesticScore) ? `人民币金观察分 ${domesticScore}` : null,
      ].filter(Boolean).join(" · "),
    ],
    [
      "plan",
      "plan",
      "买点与卖点",
      "价格观察",
      [
        buyIntl ? `买 ${buyIntl}` : null,
        sellIntl ? `卖 ${sellIntl}` : null,
      ].filter(Boolean).join(" · ") || quoteLine,
    ],
  ];
  return rows.map(([id, group, name, badge, one]) => ({
    id,
    market: "gold",
    group,
    name,
    code: id === "plan" ? "观察区" : "黄金",
    badge,
    score: id === "track" ? (Number.isFinite(Number(answer.score)) ? Number(answer.score) : null) : null,
    rank: 1,
    one,
    raw: { ...gold, view: id },
  }));
}

function aShareDetailFallback(snapshot, id) {
  const normalize = (value) => String(value || "")
    .toUpperCase()
    .replace(/\.(SH|SZ)$/i, "")
    .replace(/^A-/, "");
  const wanted = normalize(id);
  const quote = (snapshot.aShare?.quotes || []).find((item) => normalize(item.code) === wanted);
  if (!quote) return null;
  const financials = (snapshot.aShare?.fundamentals || []).find((item) => item.code === quote.code) || {};
  const raw = { ...quote, financials };
  const score = aShareObserveScore(raw);
  const yieldNow = Number(raw.currentDividendYield);
  const yieldSustain = Number(raw.sustainableDividendYield);
  const fcf = Number(financials.freeCashFlow);
  const cashOk = Number.isFinite(fcf) ? fcf > 0 : true;
  const coverOk = Number.isFinite(yieldNow) && Number.isFinite(yieldSustain)
    ? yieldSustain >= yieldNow * 0.75
    : Number.isFinite(yieldSustain);
  const badge = score != null && score >= 72 && cashOk && coverOk
    ? "优等收息"
    : Number.isFinite(yieldNow) && yieldNow >= 5 && (!coverOk || !cashOk || (score != null && score < 55))
      ? "高息待核"
      : "稳健收息";
  return {
    id: String(quote.code).replace(/\.(SH|SZ)$/i, ""),
    market: "a",
    group: "detail-only",
    name: quote.name,
    code: quote.code,
    badge,
    score,
    rank: null,
    scoreText: score != null ? `观察分 ${score}` : badge,
    rankText: Number.isFinite(yieldNow) ? `${yieldNow.toFixed(1)}%` : "股息待更",
    one: [
      Number.isFinite(yieldNow) ? `${yieldNow.toFixed(1)}%` : "股息待更",
      Number.isFinite(yieldSustain) ? `可持续 ${yieldSustain.toFixed(1)}%` : null,
      score != null ? `观察分 ${score}` : null,
    ].filter(Boolean).join(" · "),
    raw,
  };
}

function aShareObserveScore(raw = {}) {
  const financials = raw.financials || {};
  const yieldNow = Number(raw.currentDividendYield);
  const yieldSustain = Number(raw.sustainableDividendYield);
  const fcf = Number(financials.freeCashFlow);
  const ocf = Number(financials.operatingCashFlow);
  const conversion = Number(financials.cashConversion);
  const roe = Number(financials.roe);
  let total = 0;
  let weight = 0;
  if (Number.isFinite(yieldSustain)) {
    total += Math.min(100, yieldSustain * 11) * 0.22;
    weight += 0.22;
  }
  if (Number.isFinite(yieldNow)) {
    total += Math.min(100, yieldNow * 10) * 0.16;
    weight += 0.16;
  }
  if (Number.isFinite(yieldNow) && Number.isFinite(yieldSustain) && yieldNow > 0) {
    const cover = Math.min(1.2, Math.max(0, yieldSustain / yieldNow));
    total += cover * 85 * 0.14;
    weight += 0.14;
  }
  if (Number.isFinite(fcf)) {
    total += (fcf > 0 ? 82 : 18) * 0.18;
    weight += 0.18;
  } else if (Number.isFinite(ocf)) {
    total += (ocf > 0 ? 70 : 25) * 0.12;
    weight += 0.12;
  }
  if (Number.isFinite(conversion)) {
    total += Math.min(100, Math.max(15, conversion * 38)) * 0.14;
    weight += 0.14;
  }
  if (Number.isFinite(roe)) {
    total += Math.min(100, Math.max(20, roe * 4)) * 0.1;
    weight += 0.1;
  }
  if (!weight) return null;
  return Math.max(0, Math.min(100, Math.round(total / weight)));
}

function aShareItems(snapshot) {
  const fundamentals = new Map((snapshot.aShare && snapshot.aShare.fundamentals ? snapshot.aShare.fundamentals : []).map((item) => [item.code, item]));
  const quotes = [...(snapshot.aShare && snapshot.aShare.quotes ? snapshot.aShare.quotes : [])];

  const makeStockItem = (item) => {
    const financials = fundamentals.get(item.code) || {};
    const raw = { ...item, financials };
    const score = aShareObserveScore(raw);
    const yieldNow = Number(item.currentDividendYield);
    const yieldSustain = Number(item.sustainableDividendYield);
    const fcf = Number(financials.freeCashFlow);
    const hasYield = Number.isFinite(yieldNow);
    const hasSustain = Number.isFinite(yieldSustain);
    const cashOk = Number.isFinite(fcf) ? fcf > 0 : true;
    const coverOk = hasYield && hasSustain ? yieldSustain >= yieldNow * 0.75 : hasSustain;

    let group = "steady";
    let badge = "稳健收息";
    if (score != null && score >= 72 && cashOk && coverOk) {
      group = "prime";
      badge = "优等收息";
    } else if (hasYield && yieldNow >= 5 && (!coverOk || !cashOk || (score != null && score < 55))) {
      group = "watch";
      badge = "高息待核";
    } else if (score != null && score < 45) {
      group = "watch";
      badge = "高息待核";
    }

    const yieldText = hasYield ? `${yieldNow.toFixed(1)}%` : "股息待更";
    const sustainText = hasSustain ? `可持续 ${yieldSustain.toFixed(1)}%` : null;
    const scoreText = score != null ? `观察分 ${score}` : null;

    return {
      id: String(item.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group,
      name: item.name,
      code: item.code,
      badge,
      score,
      rank: null,
      scoreText: scoreText || badge,
      rankText: yieldText,
      one: [yieldText, sustainText, scoreText].filter(Boolean).join(" · "),
      raw,
    };
  };

  const makeFundItem = (source = {}) => {
    const raw = {
      ...source,
      code: source.code || "515180.SH",
      name: source.name || "易方达中证红利ETF",
      shortName: source.shortName || "红利ETF",
      assetType: "fund",
      fundType: source.fundType || "ETF",
      trackingIndex: source.trackingIndex || "中证红利指数",
      fundManager: source.fundManager || "易方达基金",
      researchView: source.researchView || {
        state: "review",
        label: "ETF待核",
        note: "价格已接入，基金公告与分红记录仍需补齐。",
      },
      financials: source.financials || {},
    };
    const priceText = Number.isFinite(Number(raw.currentPrice))
      ? `现价 ${Number(raw.currentPrice).toFixed(3)}`
      : "价格待更";
    return {
      id: String(raw.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group: "steady",
      name: raw.name,
      code: raw.code,
      badge: "红利ETF",
      score: null,
      rank: null,
      scoreText: "红利ETF",
      rankText: "指数化收息",
      one: `${priceText} · 指数化收息 · 分红看公告`,
      raw,
    };
  };

  const stockItems = quotes.map(makeStockItem);
  const stockByCode = new Map(stockItems.map((item) => [item.code, item]));
  const fundSource = (snapshot.aShare && snapshot.aShare.funds || [])
    .find((item) => String(item.code || "").replace(/\.(SH|SZ)$/i, "") === "515180")
    || { code: "515180.SH" };
  const fixedItems = A_SHARE_FIXED_ORDER.map((code) => (
    code === "515180.SH" ? makeFundItem(fundSource) : stockByCode.get(code)
  )).filter(Boolean);
  const selectedCodes = new Set(A_SHARE_FIXED_ORDER);
  const autoItems = stockItems
    .filter((item) => !selectedCodes.has(item.code))
    .sort((left, right) => {
      const leftFinancials = left.raw.financials || {};
      const rightFinancials = right.raw.financials || {};
      const leftCash = Number(leftFinancials.freeCashFlow) > 0 ? 1 : 0;
      const rightCash = Number(rightFinancials.freeCashFlow) > 0 ? 1 : 0;
      if (rightCash !== leftCash) return rightCash - leftCash;
      return number(right.score) - number(left.score);
    });
  return [
    ...fixedItems,
    ...autoItems.slice(0, Math.max(0, A_SHARE_SAMPLE_COUNT - fixedItems.length)),
  ].slice(0, A_SHARE_SAMPLE_COUNT);
}

function allItems(snapshot, market) {
  if (market === "hk") return hkItems(snapshot);
  if (market === "us") return usItems(snapshot);
  if (market === "a") return aShareItems(snapshot);
  if (market === "gold") return goldItems(snapshot);
  if (market === "guru") return smartMoneyItems(snapshot);
  return [];
}

function groupDefinitions(snapshot, market) {
  const items = allItems(snapshot, market);
  let definitions;
  if (market === "hk") {
    definitions = [
      ["worth", "建议申购", "先核一手与风险"],
      ["caution", "暂缓观察", "先看热度"],
      ["avoid", "暂不建议", "风险偏多"],
      ["cancelled", "发行已取消", "无法申购"],
      ["ended", "已结束", "上市复盘"],
      // 旧完整度字面保留给审计兼容，count 为 0。
      ["legacy-complete", "资料较完整", "已改名为建议申购等动作结论。"],
      ["legacy-review", "重点核验", "已改名为暂缓观察。"],
      ["legacy-limited", "资料不足", "已改名为暂不建议 / 资料不够。"],
    ];
  } else if (market === "us") {
    definitions = [
      ["seven", "七姐妹", "长期关注七巨头"],
      ["hot", "热度前三", "近期热度最高"],
    ];
  } else if (market === "a") {
    definitions = [
      ["prime", "优等收息", "股息可持续+现金支撑"],
      ["steady", "稳健收息", "综合观察分中等"],
      ["watch", "高息待核", "高息但现金/可持续偏弱"],
      // 保留旧组名字符串供审计/兼容路由，count 恒为 0，前端会显示暂无。
      ["payout", "收息清单", "已拆为优等/稳健/待核"],
      ["complete", "资料较完整", "后端完整度分组，已并入收息清单。"],
      ["review", "现金流待核验", "后端完整度分组，已并入收息清单。"],
      ["limited", "资料待补充", "后端完整度分组，已并入收息清单。"],
    ];
  } else if (market === "gold") {
    definitions = [
      ["track", "现在怎么做", "偏买 / 观望 / 回避"],
      ["plan", "买点与卖点", "买入卖出观察区"],
      // 旧四入口字面保留给审计兼容，count 为 0。
      ["answer", "资料结论", "已并入「现在怎么做」。"],
      ["price", "价格位置", "已并入「买点与卖点」。"],
      ["drivers", "驱动与风险", "已并入「现在怎么做」的原因与风险。"],
    ];
  } else {
    definitions = [
      ["hk", "港股 · 3 个", "公开长期年化排序"],
      ["us", "美股 · 5 个", "公开长期年化排序"],
      ["a", "A股 · 3 个", "公开长期年化排序"],
    ];
  }
  return definitions.map(([id, title, one]) => ({ id, title, one, count: items.filter((item) => item.group === id).length }));
}

function findItem(snapshot, market, id) {
  const needle = String(id || "").trim().toUpperCase();
  if (!needle) return null;
  const items = allItems(snapshot, market);
  const normalize = (value) => String(value || "")
    .toUpperCase()
    .replace(/\.(HK|SH|SZ|US)$/i, "")
    .replace(/^(HK|US|A)-/, "");
  const want = normalize(needle);
  const exact = items.find((item) => String(item.id).toUpperCase() === needle || normalize(item.id) === want);
  if (exact) return exact;
  const found = items.find((item) => {
    const candidates = [
      item.id,
      item.code,
      item.raw?.rawCode,
      item.raw?.code,
      item.raw?.symbol,
      item.raw?.stockCode,
      item.raw?.id,
    ].filter(Boolean).map(normalize);
    return candidates.includes(want);
  });
  if (found) return found;
  // A 股列表刻意只展示 10 个深度收息样本，但 20 个实时标的都必须能打开详情。
  if (market === "a") return aShareDetailFallback(snapshot, id);
  return null;
}

module.exports = {
  INVESTOR_NAMES,
  allItems,
  findItem,
  groupDefinitions,
  money,
  formatRange,
  shortCompanyName,
  shortOrgName,
  shortOrgList,
  HK_VERDICT_MAP,
};
