const { SMART_MONEY_PROFILES } = require("./smart-money");

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
  const make = (stock, group, badge) => ({
    id: stock.symbol,
    market: "us",
    group,
    name: US_NAMES[stock.symbol] || stock.symbol,
    code: stock.symbol,
    badge,
    score: null,
    rank: null,
    scoreText: group === "hot" ? `热度 ${number(stock.heatScore)} 分` : "七姐妹",
    rankText: badge,
    one: [
      signedPercent(stock.changePercent) || "涨跌待更新",
      group === "hot" && Number.isFinite(number(stock.heatScore)) ? `热度 ${number(stock.heatScore)}` : null,
      Number.isFinite(Number(stock.price)) ? money(stock.price) : null,
    ].filter(Boolean).join(" · "),
    raw: stock,
  });
  const bySymbol = new Map(stocks.map((item) => [item.symbol, item]));
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
      code: profile.performanceValue,
      badge: profile.marketLabel,
      score: null,
      rank: profile.order,
      scoreText: profile.performanceValue,
      rankText: `第 ${profile.order}/${counts[profile.group]} 名`,
      one: `原因：${profile.why} 学法：${profile.how}`,
      raw: {
        ...live,
        profile,
        holdings,
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
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international;
  const domestic = gold.quotes?.domestic;
  const quoteLine = international && domestic
    ? `国际金 ${international.price} 美元/盎司 · 上海金 ${domestic.price} 元/克`
    : "国际金与上海金资料待核验";
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
        riskIntl ? `风险 ${riskIntl}` : null,
        buyCny ? `沪金买 ${buyCny}` : null,
        sellCny ? `沪金卖 ${sellCny}` : null,
      ].filter(Boolean).join(" · ") || quoteLine,
    ],
  ];
  return rows.map(([id, group, name, badge, one]) => ({
    id,
    market: "gold",
    group,
    name,
    code: id === "plan" ? quoteLine : "黄金",
    badge,
    score: id === "track" ? number(answer.score) : null,
    rank: 1,
    one,
    raw: { ...gold, view: id },
  }));
}

function aShareItems(snapshot) {
  const fundamentals = new Map((snapshot.aShare && snapshot.aShare.fundamentals ? snapshot.aShare.fundamentals : []).map((item) => [item.code, item]));
  const quotes = [...(snapshot.aShare && snapshot.aShare.quotes ? snapshot.aShare.quotes : [])]
    .sort((left, right) => number(right.currentDividendYield) - number(left.currentDividendYield));
  return quotes.map((item) => {
    const research = item.researchView || {};
    // 前端只开一个「收息清单」；完整度留给后端排序权重，不展示给用户。
    const yieldText = Number.isFinite(Number(item.currentDividendYield))
      ? `股息率 ${Number(item.currentDividendYield).toFixed(2)}%`
      : "股息率待更新";
    const advice = item.currentAdvice || research.label || "先看分红";
    const buy = item.buyPrice || item.recommendPrice || null;
    return {
      id: String(item.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group: "payout",
      name: item.name,
      code: item.code,
      badge: yieldText,
      score: null,
      rank: null,
      scoreText: advice,
      rankText: buy ? `参考 ${buy}` : "公开收息样本",
      one: [
        yieldText,
        advice,
        buy ? `参考 ${buy}` : null,
      ].filter(Boolean).join(" · "),
      raw: { ...item, financials: fundamentals.get(item.code) || {} },
    };
  });
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
      ["worth", "建议申购", "公开资料更偏可关注认购；仍要自己核对一手金额与风险。"],
      ["caution", "暂缓观察", "先看认购热度和补齐资料，不急着重仓。"],
      ["avoid", "暂不建议", "风险信号更多，或资料不够，暂不建议申购。"],
      ["cancelled", "发行已取消", "发行人已公告不进行本次发售，无法申购。"],
      ["ended", "已结束", "只复盘实际暗盘和上市表现，用来学习。"],
      // 旧完整度字面保留给审计兼容，count 为 0。
      ["legacy-complete", "资料较完整", "已改名为建议申购等动作结论。"],
      ["legacy-review", "重点核验", "已改名为暂缓观察。"],
      ["legacy-limited", "资料不足", "已改名为暂不建议 / 资料不够。"],
    ];
  } else if (market === "us") {
    definitions = [
      ["seven", "七姐妹", "长期盯住的七家大型科技公司。"],
      ["hot", "热度前三", "这两天大家聊得最多的三只（不含七姐妹）。"],
    ];
  } else if (market === "a") {
    definitions = [
      ["payout", "收息清单", "按公开股息率从高到低排列；点进去看详细介绍。"],
      // 保留旧组名字符串供审计/兼容路由，count 恒为 0，前端会显示暂无。
      ["complete", "资料较完整", "后端完整度分组，已并入收息清单。"],
      ["review", "现金流待核验", "后端完整度分组，已并入收息清单。"],
      ["limited", "资料待补充", "后端完整度分组，已并入收息清单。"],
    ];
  } else if (market === "gold") {
    definitions = [
      ["track", "现在怎么做", "一句话告诉你现在偏买、观望还是回避，以及为什么。"],
      ["plan", "买点与卖点", "国际金 / 上海金的买入观察区、卖出观察区和风险下沿。"],
      // 旧四入口字面保留给审计兼容，count 为 0。
      ["answer", "资料结论", "已并入「现在怎么做」。"],
      ["price", "价格位置", "已并入「买点与卖点」。"],
      ["drivers", "驱动与风险", "已并入「现在怎么做」的原因与风险。"],
    ];
  } else {
    definitions = [
      ["hk", "港股 · 3 个", "可核验候选池内，按公开长期年化从高到低排列。"],
      ["us", "美股 · 5 个", "可核验候选池内，按公开长期年化从高到低排列。"],
      ["a", "A股 · 3 个", "可核验候选池内，按公开长期年化从高到低排列。"],
    ];
  }
  return definitions.map(([id, title, one]) => ({ id, title, one, count: items.filter((item) => item.group === id).length }));
}

function findItem(snapshot, market, id) {
  return allItems(snapshot, market).find((item) => String(item.id).toUpperCase() === String(id).toUpperCase());
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
