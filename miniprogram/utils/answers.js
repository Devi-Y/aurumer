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

// 历史新股只展示真实涨跌幅。此前这里把三个涨跌幅折算成 0-100 的"分数"，
// 结果首日亏 37% 的标的显示成"34 分"，正负 2% 以内的六只全部挤在 49-51 分，
// 既看不出差别也读不出亏损，因此直接改为原始百分比。
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

// 字段为空有两种完全不同的原因：招股书确实还没披露，或者我们的抽取环节失败了。
// 混为一谈会让"系统坏了"长期伪装成"市场还没公布"，所以这里必须分开说。
function hkExtractionNote(item) {
  const failures = [item.announcementExtraction, item.prospectusExtraction]
    .filter((entry) => entry && entry.ok === false);
  if (!failures.length) return null;
  return failures.some((entry) => entry.engine === "missing-pdftotext")
    ? "招股文件解析组件缺失，字段暂时取不到；这是望潮的问题，不是公司未披露。"
    : "招股文件解析失败，字段暂时取不到；已记录待修复，不是公司未披露。";
}

function hkItems(snapshot) {
  const current = (snapshot.hk && snapshot.hk.listings ? snapshot.hk.listings : []).map((item) => {
    const research = item.researchView || {};
    const group = research.state === "withdrawn"
      ? "cancelled"
      : research.state === "complete"
        ? "worth"
        : research.state === "review" ? "caution" : "avoid";
    const extractionNote = hkExtractionNote(item);
    const offerBits = [
      item.offerPrice ? `招股价 ${item.offerPrice}` : null,
      item.entryFee ? `一手约 ${item.entryFee}` : null,
      item.offerDeadline ? `认购至 ${item.offerDeadline}` : (item.offerEnd ? `认购至 ${item.offerEnd}` : null),
      item.listingDate ? `上市 ${item.listingDate}` : null,
    ].filter(Boolean);
    return {
      id: String(item.rawCode || item.code || item.id).replace(/\.HK$/i, ""),
      market: "hk",
      // group id 仍用 worth/caution/avoid 以兼容既有路由；展示标题已是「资料较完整」等，
      // 不再暗示申购动作结论。
      group,
      name: item.name || "港股新股",
      code: item.code || item.rawCode,
      badge: research.label || "资料不足",
      score: research.score !== null && research.score !== undefined && research.score !== "" && Number.isFinite(Number(research.score))
        ? Number(research.score)
        : null,
      scoreText: research.state === "withdrawn"
        ? "已取消"
        : (extractionNote ? "解析失败" : "招股资料"),
      extractionNote,
      one: extractionNote
        || (offerBits.length ? `${offerBits.join(" · ")}。${research.note || "只核验已披露事实，不给申购建议。"}` : null)
        || research.note
        || "关键招股资料尚不完整，当前只展示已核验事实。",
      raw: item,
    };
  });
  const ended = (snapshot.hk && snapshot.hk.history ? snapshot.hk.history : []).map((item) => {
    const outcome = hkOutcome(item);
    return {
      id: String(item.stockCode || item.code || item.id).replace(/\.HK$/i, ""),
      market: "hk",
      group: "ended",
      name: item.name || "历史新股",
      code: item.code || item.stockCode,
      badge: "已结束",
      score: null,
      outcomeValue: outcome.headline ? outcome.headline.value : null,
      scoreText: outcome.headline ? outcome.headline.label : "上市表现待核验",
      rankText: outcome.summary || "上市表现待核验",
      one: outcome.summary
        ? `${outcome.summary}。${item.reviewNote || "只复盘实际结果，不倒推当时结论。"}`
        : (item.reviewNote || "发行已结束，可查看暗盘与上市后实际表现。"),
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
  if (!values.length || !Number.isFinite(price)) return "历史价格样本不足，当前只展示已核验行情。";
  const atOrBelow = values.filter((value) => value <= price).length;
  const percentile = Math.round((atOrBelow / values.length) * 100);
  return `当前价格约位于近 ${values.length} 个交易日样本的 ${percentile}% 分位。`;
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
    scoreText: group === "hot" ? `热度 ${number(stock.heatScore)} 分` : "公开资料",
    rankText: badge,
    one: stockObservation(stock),
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
          interpretation: "13F 只确认报告期持仓；具体买卖原因需另行核验。",
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
  const action = gold.answer?.researchLabel || "资料观察";
  const international = gold.quotes?.international;
  const domestic = gold.quotes?.domestic;
  const quoteLine = international && domestic
    ? `${international.price} 美元/盎司 · ${domestic.price} 元/克`
    : "国际金与上海金资料待核验";
  const rows = [
    ["answer", "answer", "资料结论", action, gold.answer?.researchConclusion || "先看价格位置和宏观驱动。"],
    ["price", "price", "价格位置", "国际金 / 上海金", quoteLine],
    ["drivers", "drivers", "驱动与风险", "宏观指标", "实际利率、美元、金融条件、持仓拥挤与上海金溢价。"],
    ["analysis", "analysis", "深度分析", "HOW", "把价格、机会成本、拥挤度和风险放在同一页。"],
  ];
  return rows.map(([id, group, name, badge, one]) => ({
    id, market: "gold", group, name, code: id === "price" ? quoteLine : "黄金", badge,
    score: id === "answer" ? number(gold.answer?.score) : null, rank: 1, one, raw: { ...gold, view: id },
  }));
}

function aShareItems(snapshot) {
  const fundamentals = new Map((snapshot.aShare && snapshot.aShare.fundamentals ? snapshot.aShare.fundamentals : []).map((item) => [item.code, item]));
  const quotes = (snapshot.aShare && snapshot.aShare.quotes ? snapshot.aShare.quotes : []);
  return quotes.map((item) => {
    const research = item.researchView || {};
    const group = ["complete", "review", "limited"].includes(research.state) ? research.state : "limited";
    return {
      id: String(item.code).replace(/\.(SH|SZ)$/i, ""),
      market: "a",
      group,
      name: item.name,
      code: item.code,
      badge: research.label || "资料待核验",
      score: null,
      rank: null,
      scoreText: "公开资料",
      rankText: "不作投资排名",
      one: research.note || "先核对分红是否有现金流支撑。",
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
        ["worth", "资料较完整", "发行、认购与风险资料相对完整。"],
        ["caution", "重点核验", "部分关键字段或风险仍需核对。"],
        ["avoid", "资料不足", "当前只展示已核验事实，不给申购动作。"],
        ["cancelled", "发行已取消", "发行人已公告不进行本次发售，无法申购。"],
        ["ended", "已结束", "只复盘实际暗盘和上市表现。"],
      ];
  } else if (market === "us") {
    definitions = [
          ["seven", "七姐妹", "只看最核心的全球科技龙头。"],
          ["hot", "热度前三", "排除七姐妹后，市场最关注的三只。"],
        ];
  } else if (market === "a") {
    definitions = [
          ["complete", "资料较完整", "价格、分红与现金流字段较完整。"],
          ["review", "现金流待核验", "价格和分红已更新，财务字段仍需核对。"],
          ["limited", "资料待补充", "当前只展示已经核验的公开字段。"],
        ];
  } else if (market === "gold") {
    definitions = [
      ["answer", "资料结论", "先看黄金价格位置与宏观驱动。"],
      ["price", "价格位置", "同时看国际金与上海金。"],
      ["drivers", "驱动与风险", "把利率、美元、持仓和溢价放在一起。"],
      ["analysis", "深度分析", "把价格、机会成本与风险放在同一页核对。"],
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
};
