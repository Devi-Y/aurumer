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
  if (Number.isFinite(low) && Number.isFinite(high) && low !== high) {
    return `${low.toFixed(digits)}–${high.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  }
  if (Number.isFinite(low)) return `${low.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  if (Number.isFinite(high)) return `${high.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  return null;
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
  if (item.withdrawn || item.researchView?.state === "withdrawn") {
    return { group: "cancelled", badge: "发行已取消", tone: "ended", action: "这次发行取消了，不用再申购。", score: null };
  }
  const answer = item.publicAnswer || {};
  const mapped = HK_VERDICT_MAP[answer.verdict];
  if (mapped) {
    return {
      ...mapped,
      action: answer.action || mapped.badge,
      score: Number.isFinite(Number(answer.score)) ? Number(answer.score) : null,
    };
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
      item.offerPrice ? `招股价 ${item.offerPrice}` : null,
      item.entryFee ? `一手约 ${item.entryFee} 港元` : null,
      item.offerDeadline ? `认购到 ${item.offerDeadline}` : (item.offerEnd ? `认购到 ${item.offerEnd}` : null),
      item.listingDate ? `计划上市 ${item.listingDate}` : null,
    ].filter(Boolean);
    // 栏目只保留「值得关注 / 已结束」；内部 badge 仍保留建议申购等人话结论。
    const rawGroup = action.group === "ended" || item.allotmentUrl
      ? "ended"
      : action.group === "cancelled"
        ? "ended"
        : "watch";
    const group = rawGroup;
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
        || `${action.badge}：${action.action}${offerBits.length ? `｜${offerBits.join(" · ")}` : ""}`,
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
      one: outcome.summary
        ? `${outcome.summary}。当时结论：${verdict || "仅复盘结果"}。`
        : "发行已结束，可看暗盘和上市后实际表现。",
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

function stockObservation(stock) {
  const values = (stock.history || []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  const price = Number(stock.price);
  if (!values.length || !Number.isFinite(price)) return "历史价格样本不足，先看已核验的最新价。";
  const atOrBelow = values.filter((value) => value <= price).length;
  const percentile = Math.round((atOrBelow / values.length) * 100);
  const place = percentile <= 35 ? "偏低（相对近两个月更便宜一点）"
    : percentile >= 70 ? "偏高（相对近两个月更贵一点）"
      : "居中";
  return `现价约 ${money(price)}，在近 ${values.length} 个交易日里属于${place}。`;
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
    one: `${stockObservation(stock)} 今日 ${signedPercent(stock.changePercent) || "涨跌待更新"}。`,
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
      one: `WHY：${profile.why} HOW：${profile.how}`,
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
  const why = (answer.reasons || []).slice(0, 2).join("；") || "先看价格位置与宏观驱动。";
  const risk = (answer.risks || []).slice(0, 2).join("；") || "利率、美元与流动性变化会带来回撤。";
  const action = answer.action || answer.researchLabel || "继续观察";
  const rows = [
    [
      "track",
      "track",
      "现在怎么做",
      action,
      `${action}。${why} 风险：${risk}`,
    ],
    [
      "plan",
      "plan",
      "买点与卖点",
      "价格观察",
      [
        buyIntl ? `国际金买入观察 ${buyIntl}` : null,
        sellIntl ? `卖出/止盈观察 ${sellIntl}` : null,
        riskIntl ? `风险下沿 ${riskIntl}` : null,
        buyCny ? `上海金买入观察 ${buyCny}` : null,
        sellCny ? `上海金卖出观察 ${sellCny}` : null,
      ].filter(Boolean).join("｜") || quoteLine,
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

function aShareGroup(advice, research = {}) {
  const text = `${advice || ""} ${research.label || ""}`;
  if (/回避|卖出|不建议|暂不/.test(text)) return "avoid";
  if (/买入|值得关注|可关注|建议关注/.test(text)) return "watch";
  if (/等待|观望|暂缓/.test(text)) return "wait";
  if (research.state === "limited") return "avoid";
  if (research.state === "review") return "wait";
  return "wait";
}

function aShareItems(snapshot) {
  const fundamentals = new Map((snapshot.aShare && snapshot.aShare.fundamentals ? snapshot.aShare.fundamentals : []).map((item) => [item.code, item]));
  const quotes = [...(snapshot.aShare && snapshot.aShare.quotes ? snapshot.aShare.quotes : [])]
    .sort((left, right) => number(right.currentDividendYield) - number(left.currentDividendYield));
  return quotes.map((item) => {
    const research = item.researchView || {};
    const yieldText = Number.isFinite(Number(item.currentDividendYield))
      ? `股息率 ${Number(item.currentDividendYield).toFixed(2)}%`
      : "股息率待更新";
    const advice = item.currentAdvice || research.label || "先看分红";
    const summary = item.summary || research.note || "先核对流是否撑得住分红。";
    const buy = item.buyPrice || item.recommendPrice || null;
    const group = aShareGroup(advice, research);
    return {
      id: String(item.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group,
      name: item.name,
      code: item.code,
      badge: yieldText,
      score: null,
      rank: null,
      scoreText: advice,
      rankText: buy ? `参考 ${buy}` : "公开收息样本",
      one: `${advice}：${summary}${buy ? `｜参考价 ${buy}` : ""}`,
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
      ["watch", "值得关注", "当前在售或资料可看的新股；点进去看申购结论与一手金额。"],
      ["ended", "已结束", "只复盘实际暗盘和上市表现，用来学习。"],
      // 旧分组字面保留给审计兼容，count 为 0。
      ["worth", "建议申购", "已并入值得关注；badge 仍保留建议申购结论。"],
      ["caution", "暂缓观察", "已并入值得关注。"],
      ["avoid", "暂不建议", "已并入值得关注。"],
      ["cancelled", "发行已取消", "已并入已结束。"],
      ["legacy-complete", "资料较完整", "已改名为建议申购等动作结论。"],
      ["legacy-review", "重点核验", "已改名为暂缓观察。"],
      ["legacy-limited", "资料不足", "已改名为暂不建议 / 资料不够。"],
    ];
  } else if (market === "us") {
    definitions = [
      ["seven", "七姐妹", "长期盯住的七家科技巨头。"],
      ["hot", "热度前三", "这两天大家聊得最多的三只（不含七姐妹）。"],
    ];
  } else if (market === "a") {
    definitions = [
      ["watch", "值得关注", "公开资料更偏可跟踪的收息标的；仍要自己核对流与价格。"],
      ["wait", "建议等待", "股息不差，但价格或周期位置还不舒服，先等。"],
      ["avoid", "应该回避", "资料不足、风险偏高，或暂不适合作为收息仓。"],
      // 保留旧组名字符串供审计/兼容路由，count 恒为 0。
      ["payout", "收息清单", "已拆成值得关注 / 建议等待 / 应该回避。"],
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
      ["hk", "港股 · 3 个", "可核验候选池内，按表观长期年化从高到低排列。"],
      ["us", "美股 · 5 个", "可核验候选池内，按表观长期年化从高到低排列。"],
      ["a", "A股 · 3 个", "可核验候选池内，按表观长期年化从高到低排列。"],
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
  HK_VERDICT_MAP,
};
