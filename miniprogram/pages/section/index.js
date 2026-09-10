const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName, money, aShareDividendStability } = require("../../utils/answers");
// 结论行要按「低估 / 风险」这两个透镜选人，和今日答案用同一个判断。
const { matchesGroup, parseOfferPrice, yieldImpliedPlan, goldZoneForPrice, goldTurningPoint } = require("../../utils/market-lenses");
// 港股打新「中签后」每只股票自己的观察分位——已经是详情页在用的同一份
// 真实数据计算，这里原样复用，不重新写一遍价格逻辑。
const { buildHkExitPlan } = require("../../utils/hk-exit-plan");
// 美股「七姐妹」每行的判断句复用详情页同一套 usSignal——不是另起一套话术。
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { MASTER_PLAYBOOKS } = require("../../utils/master-playbooks");
const { buildHkHistoryStats } = require("../../utils/hk-history-stats");
const { buildDailyAnswers, goldMonthDay } = require("../../utils/daily-answers");
const { listHoldings } = require("../../utils/local-holdings");
const { marketSources } = require("../../utils/sources");
// 「机构持仓」的共识加减仓聚合，和今日答案卡片（未来持仓趋势）同一份计算，
// 不重新写一遍 13F 方向统计。
const { buildGuruTrend } = require("../../utils/guru-trend");
// 页头那句「数据截至 …」和新闻资讯页共用同一个写法。
const { asOfText } = require("../../utils/dates");

const META = {
  hk: {
    title: "港股打新",
    // 副标题跟着今日答案那五问走：上新、值得打、避雷、暗盘、首日。
    one: "上新 / 值得打 / 避雷 / 暗盘 / 首日",
    tone: "hk",
    icon: "/assets/home/hk.svg",
    kicker: "新股申购",
  },
  us: {
    title: "美股投资",
    // 长期观察与行业观察并入七姐妹、底仓两张卡后，副标题只留还在首屏的四件事。
    one: "七姐妹近况 / 低估 / 高估 / 最热三只",
    tone: "us",
    icon: "/assets/home/us.svg",
    kicker: "全球公司",
  },
  a: {
    title: "A股收息",
    // 「周期短持」那张卡撤了以后副标题还写着周期。跟着今日答案那四张走：
    // 两个维度的前五，外加参考买卖两侧。
    one: "稳定性前五 / 收益性前五 / 参考买卖",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    // 这行是栏目页的副标题，要跟今日答案那四问对上：什么价、能不能买、要不要卖、拐点。
    one: "价格 / 能不能买 / 要不要卖 / 拐点",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "价格观察",
  },
  guru: {
    title: "机构持仓",
    // 思路与借鉴收进了「未来持仓趋势」的展开层，副标题跟着答案卡走。
    one: "持仓 · 本季加减 · 方向与边界",
    tone: "guru",
    icon: "/assets/home/guru.svg",
    kicker: "学习与对照",
  },
};

// 分段 tab 各配一个图标，视觉上像微信「服务」页那样一眼分清四块内容。
const TAB_ICONS = {
  answers: "/assets/section/answers.svg",
  groups: "/assets/section/groups.svg",
  playbooks: "/assets/section/playbooks.svg",
  sources: "/assets/section/sources.svg",
};

// 分组网格里的图标按结论基调走：值得打/暂缓观察/暂不建议三种已有配色的
// 分组配对应图标，其余分组（以及历史样本对照等跳转入口）用统一的中性图标。
const TILE_TONE_ICONS = {
  worth: "/assets/section/tone-worth.svg",
  caution: "/assets/section/tone-caution.svg",
  avoid: "/assets/section/tone-avoid.svg",
};
const TILE_DEFAULT_ICON = "/assets/section/tile-default.svg";
function tileIcon(id) {
  return TILE_TONE_ICONS[id] || TILE_DEFAULT_ICON;
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// 港股打新页按原型忠实复刻：只有「近期申购」「中签后」两个视图，不做长桥
// 那种整月日历网格或状态筛选列表——样本量撑不起，原型也没有这两块。
// 截止日只有 YYYY-MM-DD，没有时间，不编一个「10:00」出来。
function hkDeadlineLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "截止时间待更新";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const offset = Math.round((target.getTime() - start.getTime()) / 86400000);
  const dateText = `${month}月${day}日`;
  if (offset < 0) return `${dateText} 已截止`;
  if (offset === 0) return `今日 ${dateText} 截止`;
  if (offset === 1) return `明日 ${dateText} 截止`;
  return `${dateText} 截止 · ${offset}天后`;
}

const HK_APPLY_GUIDANCE_READY = "打中后可参考下方分位观察成交强弱，再决定是否分批卖出。";
const HK_APPLY_GUIDANCE_EMPTY = "证据不足，暂不形成价格判断。";

function hkTone(group) {
  if (group === "worth") return "worth";
  if (group === "caution") return "caution";
  return "avoid";
}

// 「近期申购」「中签后」两个视图共用同一批在售新股，只是各取各的字段——
// 和原型 hkStocks 一份数据喂两个视图是同一个思路，这里换成真实数据源。
function buildHkModule(snapshot) {
  const items = allItems(snapshot, "hk").filter((item) => (item.lenses || []).includes("live"));
  const priority = { worth: 0, caution: 1, avoid: 2 };
  const sorted = [...items].sort((left, right) => (priority[left.group] ?? 3) - (priority[right.group] ?? 3));

  const applyList = sorted.map((item) => ({
    id: item.id,
    name: shortCompanyName(item.name, item.code || "新股", 10),
    code: String(item.code || "").replace(/\.HK$/i, ""),
    badgeText: item.badge || "待定",
    tone: hkTone(item.group),
    reason: item.one || "",
    deadlineLabel: hkDeadlineLabel(item.raw && (item.raw.offerDeadline || item.raw.offerEnd)),
  }));
  const worthCount = applyList.filter((item) => item.tone === "worth").length;
  const applyHint = applyList.length
    ? `${applyList.length} 只新股申购中${worthCount ? ` · ${worthCount} 只值得优先关注` : ""}`
    : "暂无在售新股";

  const exitList = sorted.map((item) => {
    const plan = buildHkExitPlan(item, { evidence: strategyEvidence, snapshot });
    const offerNum = parseOfferPrice(item.raw && item.raw.offerPrice);
    const offerLabel = offerNum != null ? `发行价 HK$ ${offerNum}` : "发行价待更新";
    const name = shortCompanyName(item.name, item.code || "新股", 10);
    return {
      id: item.id,
      name,
      badgeText: item.badge || "待定",
      tone: hkTone(item.group),
      offerLabel,
      text: `${name} · ${offerLabel}`,
      plan,
    };
  });

  return { applyList, applyHint, exitList };
}

// 保留用户已经选中的中签新股；它不再存在（比如刷新后下架了）就退回第一只。
function resolveHkExitSelection(exitList, preferredId) {
  if (!exitList.length) return { index: 0, id: "", view: null };
  const idx = exitList.findIndex((item) => item.id === preferredId);
  const index = idx >= 0 ? idx : 0;
  const picked = exitList[index];
  return {
    index,
    id: picked.id,
    view: {
      id: picked.id,
      name: picked.name,
      text: picked.text,
      badgeText: picked.badgeText,
      tone: picked.tone,
      guidance: picked.plan.ready ? HK_APPLY_GUIDANCE_READY : HK_APPLY_GUIDANCE_EMPTY,
      plan: picked.plan,
    },
  };
}

function usTone(signalTone) {
  if (signalTone === "good") return "worth";
  if (signalTone === "bad") return "avoid";
  return "caution";
}

function usMonogram(item) {
  const code = String(item.code || item.id || "").trim();
  return code ? code.charAt(0).toUpperCase() : "?";
}

// 美股页按原型忠实复刻：只有「七姐妹」「热门三只」两个视图。原型 demo 数据
// 给每只股票编了一句「event」叙事（比如「云业务增长改善」），快照里没有
// 新闻源、没有公告字段，编事件就是凭空造。换成 usSignal 已经用 PE、质量门、
// 60日价格位置算出的结论句——详情页在用同一份判断，不是另起一套话术。
function buildUsModule(snapshot) {
  const items = allItems(snapshot, "us");
  const sevenItems = items.filter((item) => item.group === "seven");
  const hotItems = items.filter((item) => item.group === "hot");

  const sevenList = sevenItems.map((item) => {
    const signal = buildStrategySignal(item);
    return {
      id: item.id,
      name: item.name,
      code: item.code,
      monogram: usMonogram(item),
      badgeText: signal.label,
      tone: usTone(signal.tone),
      reason: signal.action,
      priceLabel: item.one || "涨跌、价格待更新",
    };
  });
  const labelCounts = new Map();
  sevenList.forEach((item) => {
    labelCounts.set(item.badgeText, (labelCounts.get(item.badgeText) || 0) + 1);
  });
  const sevenHint = [...labelCounts.entries()]
    .map(([label, count]) => `${count} 家${label}`)
    .join(" · ") || "七姐妹判断待更新";

  const hotList = hotItems.map((item) => {
    const fund = (item.raw && item.raw.fund) || {};
    let takeText = "质量数据不足，先观察";
    let takeTone = "caution";
    if (fund.qualityEligible === true) { takeText = "质量达标，可继续关注"; takeTone = "worth"; }
    else if (fund.qualityEligible === false) { takeText = "未过质量门，热度不代表低估"; takeTone = "avoid"; }
    return {
      id: item.id,
      name: item.name,
      why: item.heatDriver || "近期成交与涨跌幅度暂不足以说明为什么热",
      note: item.attentionNote || "",
      takeText,
      takeTone,
      evidenceOpen: false,
    };
  });
  const hotHint = hotList.length
    ? `热度前 ${hotList.length} 只 · 不含七姐妹`
    : "近期没有明显热度突出的美股";

  return { sevenList, sevenHint, hotList, hotHint };
}

function aTone(group) {
  if (group === "prime") return "worth";
  if (group === "watch") return "avoid";
  return "caution";
}

function aRankedList(items, lens) {
  return items
    .filter((item) => item.lensRank && item.lensRank[lens])
    .sort((left, right) => left.lensRank[lens] - right.lensRank[lens])
    .map((item) => {
      const plan = yieldImpliedPlan(item.raw);
      const yieldNow = Number(item.raw.currentDividendYield);
      const stability = aShareDividendStability(item.raw);
      const metricText = lens === "stable5"
        ? (stability != null ? `${stability} 分` : "待更新")
        : (Number.isFinite(yieldNow) ? `${yieldNow.toFixed(1)}%` : "待更新");
      return {
        id: item.id,
        rank: item.lensRank[lens],
        name: item.name,
        code: item.code,
        badgeText: item.badge,
        tone: aTone(item.group),
        metricText,
        buyText: plan ? money(plan.addPrice, "¥") : "待更新",
        sellText: plan ? money(plan.trimPrice, "¥") : "待更新",
      };
    });
}

// A股收息按原型忠实复刻：「分红稳定性/分红收益性」前五，每行带参考买卖价。
// 原型demo数据编了「连续分红N年」，真实数据里没有连续分红年数这个字段——
// 只有 aShareDividendStability 算出的0-100稳定性分（覆盖率/现金流/ROE加权），
// 用这个真实分数替代，不编年数。
function buildAModule(snapshot) {
  const items = allItems(snapshot, "a");
  const stableList = aRankedList(items, "stable5");
  const yieldList = aRankedList(items, "yield5");
  const stableHint = stableList.length
    ? `${stableList.length} 只入围 · 分红稳定性从高到低`
    : "分红稳定性榜单暂不足以显示";
  const yieldHint = yieldList.length
    ? `${yieldList.length} 只入围 · 当前股息率从高到低`
    : "分红收益性榜单暂不足以显示";
  const fundItem = items.find((item) => item.raw && item.raw.assetType === "fund");
  const fund = fundItem ? { name: fundItem.name, code: fundItem.code, note: fundItem.one } : null;
  return { stableList, stableHint, yieldList, yieldHint, fund };
}

// 黄金追踪原型默认币种是人民币金，这里改成国际金——国际金有180天真实收盘价
// 能画出有意义的走势图，人民币金只有2天真实数据，画不出图，让用户先看数据
// 撑得起的口径。原型的「1年」周期也改叫「全部」：国际金历史目前不到一年，
// 编一个「1年」标签但只有180天数据，是拿数据长度撒谎。
const GOLD_PERIODS = [
  { id: "month", label: "1月", days: 30 },
  { id: "quarter", label: "3月", days: 90 },
  { id: "all", label: "全部", days: 9999 },
];

function goldTone(zoneTone) {
  if (zoneTone === "good") return "worth";
  if (zoneTone === "bad") return "avoid";
  return "caution";
}

function goldRangeText(range, digits) {
  const low = Number(range?.low);
  const high = Number(range?.high);
  if (!Number.isFinite(low) && !Number.isFinite(high)) return "";
  if (Number.isFinite(low) && Number.isFinite(high) && low !== high) {
    return `${low.toFixed(digits)}–${high.toFixed(digits)}`;
  }
  const value = Number.isFinite(low) ? low : high;
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

// 和今日答案卡片（utils/daily-answers.js 的 goldNextLine）同一套判断措辞，
// 只是把「持有观察区」「进入观察上沿」「触及风险下沿」三种状态合并成一行。
function goldStatusLine(priceText, zone, holdRange, sellRange, digits) {
  if (zone.label === "触及风险下沿") return `现价 ${priceText}，已触及风险下沿，建议先停手复核`;
  if (zone.hold) return `现价 ${priceText}，仍在观察低位（${goldRangeText(holdRange, digits)}）`;
  if (zone.sell) return `现价 ${priceText}，进入观察上沿（${goldRangeText(sellRange, digits)}）`;
  return `现价 ${priceText} · ${zone.label || "继续观察"}`;
}

// WXML 没有原生 <svg>，柱状走势图沿用详情页 priceVisual() 同一套抽样/柱高算法
// （pages/detail/index.js），这里只取收盘价数组，重新实现一遍，不跨页面导出。
function goldChartColumns(history, digits) {
  const values = (history || [])
    .map((entry) => Number(entry.close))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const sampleCount = Math.min(30, values.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (values.length - 1));
    return values[sourceIndex];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const span = Math.max(high - low, 1);
  return {
    columns: samples.map((value, index) => {
      const isLatest = index === samples.length - 1;
      const isHigh = value === high;
      const isLow = value === low;
      return {
        id: `${index}-${value}`,
        height: Math.round(16 + ((value - low) / span) * 84),
        tone: isLatest ? "latest" : (isHigh ? "peak" : (isLow ? "floor" : "")),
      };
    }),
    lowLabel: `最低 ${low.toFixed(digits)}`,
    latestLabel: `最新 ${latest.toFixed(digits)}`,
    highLabel: `最高 ${high.toFixed(digits)}`,
  };
}

function buildGoldModule(snapshot) {
  const gold = snapshot.gold || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const scoreBundle = answer.scores || {};
  const internationalScore = Number(scoreBundle.international?.score);
  const domesticScore = Number(scoreBundle.domestic?.score);

  const intlZone = goldZoneForPrice(international.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk);
  const cnyZone = goldZoneForPrice(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk);

  const intlHistory = gold.history?.international || [];
  const cnyHistory = gold.history?.domestic || [];
  const chartsByPeriod = {};
  GOLD_PERIODS.forEach((period) => {
    chartsByPeriod[period.id] = goldChartColumns(intlHistory.slice(-period.days), 0);
  });

  const quotes = [
    {
      id: "usd",
      label: "国际金",
      priceText: hasNumber(international.price) ? Number(international.price).toFixed(0) : "待更新",
      unit: "美元 / 盎司",
    },
    {
      id: "cny",
      label: "人民币金",
      priceText: hasNumber(domestic.price) ? Number(domestic.price).toFixed(1) : "待更新",
      unit: "元 / 克",
    },
  ];

  const perCurrency = {
    usd: {
      currencyLabel: "国际金 · 美元 / 盎司",
      zoneLabel: intlZone.label,
      zoneTone: goldTone(intlZone.tone),
      buyText: goldRangeText(plan.internationalWatch, 0) || "待更新",
      sellText: goldRangeText(plan.internationalUpper, 0) || "待更新",
      riskLine: hasNumber(international.price)
        ? goldStatusLine(Number(international.price).toFixed(0), intlZone, plan.internationalWatch, plan.internationalUpper, 0)
        : "证据不足，暂不形成价格判断。",
      periods: GOLD_PERIODS.map((period) => ({ id: period.id, label: period.label })),
      chartsByPeriod,
      chartNote: "",
    },
    cny: {
      currencyLabel: "人民币金 · 元 / 克",
      zoneLabel: cnyZone.label,
      zoneTone: goldTone(cnyZone.tone),
      buyText: goldRangeText(plan.domesticWatch, 1) || "待更新",
      sellText: goldRangeText(plan.domesticUpper, 1) || "待更新",
      riskLine: hasNumber(domestic.price)
        ? goldStatusLine(Number(domestic.price).toFixed(1), cnyZone, plan.domesticWatch, plan.domesticUpper, 1)
        : "证据不足，暂不形成价格判断。",
      // 人民币金历史目前只有2个真实交易日，画不出有意义的走势图，如实说明，
      // 不拿两个点硬凑一条线。
      periods: [],
      chartsByPeriod: {},
      chartNote: `人民币金仅 ${cnyHistory.length} 个交易日真实收盘价，样本不足以画走势图。`,
    },
  };

  // 拐点判断和今日答案卡片（gold-turn）同一套真实20/60日均线计算，措辞照抄
  // buildGoldAnswers 里 turnAnswer/crossText 的公式，不重新编一套话术。
  const turn = goldTurningPoint(gold.history?.international, international.price);
  const trendTone = turn ? (turn.above ? "worth" : "avoid") : "caution";
  const trendBadge = turn ? (turn.above ? "均线上行" : "均线下行") : "样本不足";
  const trendTitle = turn ? (turn.above ? "均线转上行" : "均线转下行") : "拐点暂不下判断";
  const trendDetail = turn
    ? (turn.crossDate
      ? `${goldMonthDay(turn.crossDate)} 20日线${turn.above ? "上穿" : "下穿"}60日线，已 ${turn.crossDays} 个交易日未反向`
      : `近半年 20日线一直在 60日线${turn.above ? "上方" : "下方"}`)
    : "半年收盘价样本不足 60 天，拐点暂不下判断";

  const scoreText = [
    Number.isFinite(internationalScore) ? `国际观察分 ${internationalScore}` : null,
    Number.isFinite(domesticScore) ? `人民币观察分 ${domesticScore}` : null,
  ].filter(Boolean).join(" · ") || "观察分暂缺";

  return { quotes, perCurrency, scoreText, trendTone, trendBadge, trendTitle, trendDetail };
}

// 币种/周期切换只在这两个预计算好的结构里挑数据，不重新访问快照或重算——
// 和 resolveHkExitSelection 同一个思路。
function resolveGoldView(goldModule, currency, periodId) {
  if (!goldModule) {
    return {
      badgeText: "", zoneTone: "caution", currencyLabel: "", periods: [], period: periodId,
      chart: null, chartNote: "", buyText: "待更新", sellText: "待更新", riskLine: "",
    };
  }
  const cur = goldModule.perCurrency[currency] || goldModule.perCurrency.usd;
  const periodOk = cur.periods.some((item) => item.id === periodId);
  const activePeriod = periodOk ? periodId : (cur.periods[0] ? cur.periods[0].id : periodId);
  const chart = cur.chartsByPeriod[activePeriod] || null;
  return {
    badgeText: cur.zoneLabel,
    zoneTone: cur.zoneTone,
    currencyLabel: cur.currencyLabel,
    periods: cur.periods,
    period: activePeriod,
    chart,
    chartNote: chart ? "" : cur.chartNote,
    buyText: cur.buyText,
    sellText: cur.sellText,
    riskLine: cur.riskLine,
  };
}

// 「机构持仓」跟随原型的「共同方向/机构持仓」两个视图，数据全部来自
// smartMoneyItems（今日答案同一份 profiles）和 buildGuruTrend（未来持仓
// 趋势同一份季度加减仓聚合），不新起一套计算。
function guruTrendRow(row, investorCount) {
  const adderCount = (row.adders || []).length;
  const cutterCount = (row.cutters || []).length;
  let tone = "caution";
  let badge = `${adderCount}加${cutterCount}减`;
  if (adderCount && !cutterCount) {
    tone = "worth";
    badge = `${adderCount}家增持`;
  } else if (cutterCount && !adderCount) {
    tone = "avoid";
    badge = `${cutterCount}家减持`;
  }
  const totalTouch = adderCount + cutterCount;
  // 条形长度只示意同向程度，不是仓位规模；8% 是给最小样本留的可见下限，
  // 不是编出来的数据。
  const widthPct = investorCount > 0
    ? Math.max(8, Math.min(100, Math.round((totalTouch / investorCount) * 100)))
    : 8;
  return { key: row.symbol || row.name, label: row.name || row.symbol || "待更新", tone, badge, widthPct };
}

function guruTrendRowsFrom(trend) {
  if (!trend) return [];
  const picked = [
    ...(trend.consensusAdds || []).slice(0, 2),
    ...(trend.split || []).slice(0, 1),
    ...(trend.consensusCuts || []).slice(0, 2),
  ];
  // 没有 2 家以上同向的，就诚实展示单家的加/减各一条，不硬凑「共识」。
  const rows = picked.length ? picked : [...(trend.adds || []).slice(0, 1), ...(trend.cuts || []).slice(0, 1)];
  return rows.map((row) => guruTrendRow(row, trend.investorCount || 0));
}

function buildGuruModule(snapshot) {
  const profiles = allItems(snapshot, "guru").filter((item) => item.group !== "overlap");
  const trend = buildGuruTrend(snapshot);
  const trendRows = guruTrendRowsFrom(trend);
  const institutionList = profiles.map((item) => ({
    id: String(item.id || ""),
    name: item.name || "待更新",
    org: item.raw?.profile?.org || "待更新",
  }));
  const holdingsByInstitution = {};
  profiles.forEach((item) => {
    const holdings = Array.isArray(item.raw?.holdings) ? item.raw.holdings : [];
    const rows = holdings.slice(0, 5).map((holding) => ({
      name: holding.name || holding.ticker || "待更新",
      weightText: Number.isFinite(Number(holding.weight)) ? `${Number(holding.weight).toFixed(1)}%` : "待更新",
      moveText: holding.changeLabel || "待更新",
    }));
    holdingsByInstitution[item.id] = {
      rows,
      hint: rows.length ? `重仓前 ${rows.length} · 按披露顺序排列` : "暂无持仓披露",
      reportDate: item.raw?.reportDate || "以最新公开报告为准",
      filingDate: item.raw?.filingDate || "以原始文件为准",
    };
  });
  const defaultId = String(
    ["us", "hk", "a"].map((group) => profiles.find((item) => item.group === group)).find(Boolean)?.id
      || (profiles[0] && profiles[0].id)
      || "",
  );
  return { profiles, trend, trendRows, institutionList, holdingsByInstitution, defaultId };
}

const GURU_EMPTY_HOLDINGS = { rows: [], hint: "持仓证据不足，暂不展示", reportDate: "", filingDate: "" };

// 机构切换（「跟着谁看」点行 / 「重仓前五」下拉选）共用同一份「预先算好
// 全部、只挑一个」的模式，和 resolveHkExitSelection、resolveGoldView 一路。
function resolveGuruInstitution(guruModule, institutionId) {
  const list = guruModule ? guruModule.institutionList : [];
  if (!list.length) return { index: 0, id: "", name: "", org: "", holdings: GURU_EMPTY_HOLDINGS };
  const requestedIdx = list.findIndex((item) => item.id === institutionId);
  const defaultIdx = list.findIndex((item) => item.id === guruModule.defaultId);
  const index = requestedIdx >= 0 ? requestedIdx : Math.max(0, defaultIdx);
  const picked = list[index];
  return {
    index,
    id: picked.id,
    name: picked.name,
    org: picked.org,
    holdings: guruModule.holdingsByInstitution[picked.id] || GURU_EMPTY_HOLDINGS,
  };
}

function buildOverview(snapshot, market) {
  if (market === "hk") {
    const items = allItems(snapshot, "hk").filter((item) => item.group !== "ended");
    const live = items.filter((item) => item.group !== "cancelled");
    const suggest = items.filter((item) => item.group === "worth");
    const lead = suggest[0] || live[0];
    const scored = scoreForItem(lead);
    const leadId = lead ? String(lead.id || "") : "";
    // 「在售」「值得打」这两格原来在结论行下面单独占一整排，可是今日答案里
    // 的「近期上新」「哪些值得打」两张卡说的是同一件事，同一个数字印两遍。
    // 数字留给答案卡，这里的结论行只补一个答案卡没有的：研究分。
    return {
      metrics: [],
      target: lead ? shortCompanyName(lead.name, "新股", 6) : "暂无在售",
      targetId: leadId,
      grade: lead
        ? `${lead.badge || "待定"}${scored.score != null ? ` · 研究分${scored.score}` : ""}`
        : "—",
      gradeGroup: lead?.group || "worth",
      canOpenTarget: Boolean(leadId),
      canOpenGrade: Boolean(lead?.group),
    };
  }

  if (market === "us") {
    const items = allItems(snapshot, "us");
    const hot = items.filter((item) => item.group === "hot");
    const seven = items.filter((item) => item.group === "seven");
    // 结论行原来取「全样本综合分最高的那一只」，选出来的是行业观察里的
    // 万事达——底下四张答案卡讲的全是七姐妹和热度三只，页头却挂着一只
    // 一次都没出现过的票，徽章还写着「七姐妹」。这一栏的结论只能从这四张卡
    // 覆盖得到的范围里选：先低估（可买入的那侧），再风险（要减的那侧），
    // 都没有才退回七姐妹本身。
    const best = (list) => [...list]
      .map((item) => ({ item, score: scoreForItem(item).score }))
      .filter((entry) => entry.score != null)
      .sort((left, right) => right.score - left.score)[0]?.item || list[0] || null;
    const cheap = seven.filter((item) => matchesGroup(item, "cheap7"));
    const risk = seven.filter((item) => matchesGroup(item, "risk7"));
    const lead = best(cheap) || best(risk) || best(seven) || hot[0] || null;
    const leadLens = lead && matchesGroup(lead, "cheap7")
      ? "cheap7"
      : (lead && matchesGroup(lead, "risk7") ? "risk7" : "seven");
    const scored = scoreForItem(lead);
    const leadId = lead ? String(lead.id || lead.code || "") : "";
    return {
      metrics: [
        {
          label: "七姐妹",
          value: `${seven.length}`,
          action: "group",
          group: "seven",
          enabled: seven.length > 0,
        },
        {
          label: "热度前三",
          value: `${hot.length}`,
          action: "group",
          group: "hot",
          enabled: hot.length > 0,
        },
        {
          label: "综合分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: leadId,
          enabled: Boolean(leadId),
        },
      ],
      // 页头写代码（MA、GOOGL）就得读的人自己翻译一遍，其它四栏的结论行
      // 写的都是中文名，这里跟上。
      target: lead ? shortCompanyName(lead.name, lead.code || "美股", 6) : "待更新",
      targetId: leadId,
      grade: lead
        ? (leadLens === "cheap7" ? "低估可买入" : (leadLens === "risk7" ? "风险要减" : "七姐妹"))
        : "—",
      gradeGroup: leadLens,
      canOpenTarget: Boolean(leadId),
      canOpenGrade: Boolean(lead),
    };
  }

  if (market === "a") {
    const items = allItems(snapshot, "a");
    const ranked = [...items]
      .map((item) => ({ item, score: scoreForItem(item).score }))
      .filter((entry) => entry.score != null)
      .sort((left, right) => right.score - left.score);
    const top = ranked[0]?.item || items[0];
    const scored = scoreForItem(top);
    const topId = top ? String(top.id || "") : "";
    const primeCount = items.filter((item) => item.group === "prime").length;
    return {
      metrics: [
        {
          // 同上：这一格数的是全部 10 只样本，落地页却和右边那格一样固定在
          // 「优等收息」的 1 只。
          label: "收息样本",
          value: `${items.length}`,
          action: "group",
          group: "sample",
          enabled: items.length > 0,
        },
        {
          label: "优等收息",
          value: `${primeCount}`,
          action: "group",
          group: "prime",
          enabled: primeCount > 0,
        },
        {
          label: "收息分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: topId,
          enabled: Boolean(topId),
        },
      ],
      target: top ? shortCompanyName(top.name, top.code || "—", 6) : "—",
      grade: top ? (top.badge || "—") : "—",
      targetId: topId,
      gradeGroup: top?.group || "prime",
      canOpenTarget: Boolean(topId),
      canOpenGrade: Boolean(top?.group),
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const answer = gold.answer || {};
    const international = gold.quotes?.international || {};
    const domestic = gold.quotes?.domestic || {};
    const scored = scoreForItem({ market: "gold", raw: gold });
    return {
      metrics: [
        {
          // 「国际金 4519」「人民币金 957.5」都是裸数字，一个是美元每盎司、
          // 一个是人民币每克，同一行摆着看不出是两套口径。详情页那四格已经
          // 写成「国际金/盎司 $4473」，栏目页跟上同一种写法。
          label: "国际金/盎司",
          value: hasNumber(international.price) ? `$${Number(international.price).toFixed(0)}` : "—",
          action: "detail",
          id: "track",
          enabled: true,
        },
        {
          label: "观察分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: "track",
          enabled: true,
        },
        {
          label: "人民币金/克",
          value: hasNumber(domestic.price) ? `¥${Number(domestic.price).toFixed(1)}` : "—",
          action: "detail",
          id: "plan",
          enabled: true,
        },
      ],
      // 结论行原来写「人民币金 957.5」，可这个数字紧接着又在下面的关键数值行
      // 出现一次、在四口径卡里再出现一次，同一屏印三遍。结论行只说这条结论
      // 是关于谁的，数字交给下面两块。
      target: "黄金",
      targetId: "track",
      grade: answer.action || "继续观察",
      gradeGroup: "track",
      canOpenTarget: true,
      canOpenGrade: true,
    };
  }

  const profiles = allItems(snapshot, "guru");
  // leader 原本取 profiles[0]，也就是数组里排头的那条（港股组的价值伙伴经典
  // 13.2% 年化）；而正下方第一行「业绩靠前持仓」用的是 daily-answers 里
  // 美股→港股→A股 的取法（德鲁肯米勒 约 30% 年化）。同一屏两处各说一个「领头」，
  // 数还不一样。这里按 daily-answers 的同一条规则取，两处说的是同一个人。
  const leader = ["us", "hk", "a"]
    .map((group) => profiles.find((item) => item.group === group))
    .find(Boolean) || profiles[0];
  const leaderId = leader ? String(leader.id || "") : "";
  const hkCount = profiles.filter((item) => item.group === "hk").length;
  const usCount = profiles.filter((item) => item.group === "us").length;
  const aCount = profiles.filter((item) => item.group === "a").length;
  const topPerf = leader?.badge || leader?.raw?.profile?.performanceValue || "—";
  return {
    metrics: [
      { label: "港股", value: `${hkCount}`, action: "group", group: "hk", enabled: hkCount > 0 },
      { label: "美股", value: `${usCount}`, action: "group", group: "us", enabled: usCount > 0 },
      { label: "A股", value: `${aCount}`, action: "group", group: "a", enabled: aCount > 0 },
    ],
    // 6 个字会把「斯坦利·德鲁肯米勒」削成「斯坦利·德鲁」，看着像个完整名字，
    // 其实是另一个人。放宽到 10 字，真放不下时交给 CSS 的省略号，至少能看出被截了。
    target: leader ? shortCompanyName(leader.name, "机构", 10) : "待更新",
    targetId: leaderId,
    grade: topPerf,
    gradeGroup: leader?.group || "hk",
    canOpenTarget: Boolean(leaderId),
    canOpenGrade: Boolean(leader?.group),
  };
}

// 展开层正文按行拆开。空行是段落间隔，不是一行空文字；开头的全角空格是
// 「上一行的补充」（比如某只股票的同期公告），拆成一档更浅的样式，
// 而不是让它和主行一样重。
function sheetLines(text) {
  return String(text || "").split("\n").map((line, index) => {
    const trimmed = line.replace(/^\u3000+/, "");
    return {
      key: `line-${index}`,
      text: trimmed,
      blank: !trimmed,
      sub: trimmed !== line,
    };
  });
}

Page({
  data: {
    market: "hk",
    meta: META.hk,
    groups: [],
    overview: {
      metrics: [],
      target: "",
      targetId: "",
      grade: "",
      gradeGroup: "",
      canOpenTarget: false,
      canOpenGrade: false,
    },
    source: "正在读取同步数据",
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    disclaimer: RESEARCH_DISCLAIMER,
    playbooks: [],
    answers: [],
    deepLinks: [],
    sourceLinks: [],
    // 港股打新专属：原型的「近期申购/中签后」两个视图，只有 market==='hk' 时渲染。
    hkSubTab: "apply",
    hkApplyList: [],
    hkApplyHint: "",
    hkExitOptions: [],
    hkExitIndex: 0,
    hkExitSelectedId: "",
    hkExitView: null,
    hkEvidenceOpen: false,
    // 美股专属：原型的「七姐妹/热门三只」两个视图，只有 market==='us' 时渲染。
    usSubTab: "seven",
    usSevenList: [],
    usSevenHint: "",
    usHotList: [],
    usHotHint: "",
    // A股收息专属：原型的「分红稳定性/分红收益性」两个前五榜单，只有 market==='a' 时渲染。
    aSubTab: "stable",
    aStableList: [],
    aStableHint: "",
    aYieldList: [],
    aYieldHint: "",
    aEvidenceOpen: false,
    aFund: null,
    // 黄金追踪专属：原型的币种/周期切换，只有 market==='gold' 时渲染。默认
    // 国际金——它有180天真实收盘价能画走势图，人民币金只有2天数据画不出图。
    goldCurrency: "usd",
    goldPeriod: "month",
    goldQuotes: [],
    goldBadgeText: "",
    goldZoneTone: "caution",
    goldCurrencyLabel: "",
    goldPeriods: [],
    goldChart: null,
    goldChartNote: "",
    goldBuyText: "",
    goldSellText: "",
    goldRiskLine: "",
    goldTrendTone: "caution",
    goldTrendBadge: "",
    goldTrendTitle: "",
    goldTrendDetail: "",
    goldScoreText: "",
    goldEvidenceOpen: false,
    // 机构持仓专属：原型的「共同方向/机构持仓」两个视图，只有 market==='guru' 时渲染。
    guruSubTab: "trend",
    guruTrendRows: [],
    guruInstitutionList: [],
    guruInstitutionIndex: 0,
    guruInstitutionId: "",
    guruInstitutionName: "",
    guruInstitutionOrg: "",
    guruHoldingsRows: [],
    guruHoldingsHint: "",
    guruReportDate: "",
    guruFilingDate: "",
    guruEvidenceOpen: false,
    // 「今日答案/分组浏览/策略摘要/数据出处」四块内容原来从上到下摞在一起，
    // 现在收进横向 tab，同一屏只看其中一块，切换靠点顶部的分段控件。
    tabs: [],
    activeTab: "",
    dataAsOf: "",
    // 只有黄金栏目页会用到；其余四栏恒为 null，wx:if 直接整块不渲染。
    // 展开层。wx.showModal 会把 content 里的 \n 当成空格吞掉——七姐妹那张卡
    // 十几行事实会连成一堵墙，这是用户花钱买的正文，不能这么给。
    // 所以自己渲染：每行一个 text，空行留白，缩进行降一级。
    answerSheet: null,
  },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    const playbooks = market === "guru"
      ? MASTER_PLAYBOOKS.map((item) => ({
        id: item.id,
        name: item.name,
        tag: item.tag,
        principle: item.principle,
        sensitivity: item.sensitivity,
        valueLens: item.valueLens,
        doNot: item.doNot,
        sourceNote: item.sourceNote,
      }))
      : [];
    this.setData({ market, meta: META[market], playbooks });
    wx.setNavigationBarTitle({ title: META[market].title });
    track("section_open", { market: String(market), from: "direct" });
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  retryFreshness() { this.refresh(null, true); },
  // 和新闻资讯页同一套交互：小程序打不开任意外链，来源只能复制出去自己核对。
  copySourceLink(event) {
    const url = String(event.currentTarget.dataset.url || "");
    if (!url) return;
    track("news_source_copy", { market: String(this.data.market || "") });
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "已复制来源链接", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  buildDeepLinks(snapshot, market) {
    if (market === "hk") {
      const stats = buildHkHistoryStats(snapshot);
      // 「在售新股」分组一直存在（值得打/暂缓观察/暂不建议全在里面），但
      // catalog:false 让它进不了下面的分组网格，之前也没有别的入口指向它——
      // 用户点不进这个分组，只能靠改 URL。这里补一张卡片当入口，用真实计数
      // 拼说明文字，不编内容。
      const hkGroups = groupDefinitions(snapshot, "hk");
      const countOf = (id) => hkGroups.find((item) => item.id === id)?.count || 0;
      const liveCount = countOf("live");
      const liveBreakdown = [
        countOf("worth") ? `值得打 ${countOf("worth")}` : null,
        countOf("caution") ? `暂缓观察 ${countOf("caution")}` : null,
        countOf("avoid") ? `暂不建议 ${countOf("avoid")}` : null,
      ].filter(Boolean).join(" · ");
      return [
        {
          id: "history",
          group: "ended",
          title: "历史样本对照",
          help: stats.summary,
          enabled: stats.sampleCount > 0,
        },
        {
          id: "live",
          group: "live",
          title: "在售新股",
          help: liveCount > 0 ? `在售 ${liveCount} 只 · ${liveBreakdown}` : "当前没有在售新股",
          enabled: liveCount > 0,
        },
      ];
    }
    if (market === "us") {
      return [
        {
          id: "hot10",
          group: "hot10",
          title: "热度前十",
          help: "公开热度横向比较，热度≠买入信号",
          enabled: true,
        },
        {
          id: "value",
          group: "value",
          title: "性价比观察",
          help: "质量·估值·热度综合排序，非收益承诺",
          enabled: true,
        },
      ];
    }
    if (market === "guru") {
      return [{
        id: "overlap",
        group: "overlap",
        title: "交叉重叠",
        help: "多机构共同持有，仅供研究对照",
        enabled: true,
      }];
    }
    return [];
  },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const deepLinks = this.buildDeepLinks(snapshot, this.data.market)
        .map((item) => ({ ...item, icon: tileIcon(item.group) }));
      const answers = buildDailyAnswers(snapshot, this.data.market, { holdings: listHoldings() });
      // 「今日答案」「历史样本对照」经常和分组网格指向同一张列表页——比如港股
      // 「哪些值得打」答案卡和网格里的「值得打」格，点开是同一个 group=worth。
      // 谁已经把这个分组的入口做出来了（而且真能点），网格里就不再重复放一张；
      // 判断只看目的地是否相同，不关心具体是哪个市场，所以对5个模块都成立。
      const coveredGroups = new Set([
        ...deepLinks.filter((item) => item.enabled).map((item) => item.group),
        ...answers.filter((item) => item.enabled && item.action === "group" && item.group).map((item) => item.group),
      ]);
      const groups = groupDefinitions(snapshot, this.data.market)
        .filter((item) => item.count > 0 && item.catalog !== false && !coveredGroups.has(item.id))
        .map((item) => ({ ...item, icon: tileIcon(item.id) }));
      // 这一栏的数据是从哪儿来的。新闻资讯页每条都挂了官方出处，
      // 五个栏目页一直只有一句"公开资料整理"，核对无门。
      const sourceLinks = marketSources(snapshot, this.data.market);
      // 四块内容谁有数据谁才出现在 tab 上，空的不占一个位置。数字是各自
      // 真实的条目数——点开前先知道里面有几条，不是装饰。
      const tabs = [
        answers.length ? { id: "answers", label: "今日答案", count: answers.length, icon: TAB_ICONS.answers } : null,
        (deepLinks.length || groups.length)
          ? { id: "groups", label: "分组浏览", count: deepLinks.length + groups.length, icon: TAB_ICONS.groups }
          : null,
        this.data.playbooks.length
          ? { id: "playbooks", label: "策略摘要", count: this.data.playbooks.length, icon: TAB_ICONS.playbooks }
          : null,
        sourceLinks.length ? { id: "sources", label: "数据出处", count: sourceLinks.length, icon: TAB_ICONS.sources } : null,
      ].filter(Boolean);
      // 保留用户已经切到的 tab；只有它不再存在（比如刷新后这一块没数据了）
      // 才退回第一个可用的 tab。
      const activeTab = tabs.some((tab) => tab.id === this.data.activeTab)
        ? this.data.activeTab
        : (tabs[0]?.id || "");
      const hkModule = this.data.market === "hk" ? buildHkModule(snapshot) : null;
      const hkExitList = hkModule ? hkModule.exitList : [];
      this._hkExitList = hkExitList;
      const hkSelection = resolveHkExitSelection(hkExitList, this.data.hkExitSelectedId);
      const usModule = this.data.market === "us" ? buildUsModule(snapshot) : null;
      const aModule = this.data.market === "a" ? buildAModule(snapshot) : null;
      const goldModule = this.data.market === "gold" ? buildGoldModule(snapshot) : null;
      this._goldModule = goldModule;
      const goldView = resolveGoldView(goldModule, this.data.goldCurrency, this.data.goldPeriod);
      const guruModule = this.data.market === "guru" ? buildGuruModule(snapshot) : null;
      this._guruModule = guruModule;
      const guruSelection = resolveGuruInstitution(guruModule, this.data.guruInstitutionId || guruModule?.defaultId);
      this.setData({
        groups,
        overview: buildOverview(snapshot, this.data.market),
        answers,
        deepLinks,
        tabs,
        activeTab,
        source,
        freshness: freshnessBanner(source, meta.kind),
        sourceLinks,
        dataAsOf: asOfText(snapshot && snapshot.updatedAt, meta.kind),
        hkApplyList: hkModule ? hkModule.applyList : [],
        hkApplyHint: hkModule ? hkModule.applyHint : "",
        hkExitOptions: hkExitList.map((item) => ({ id: item.id, text: item.text })),
        hkExitIndex: hkSelection.index,
        hkExitSelectedId: hkSelection.id,
        hkExitView: hkSelection.view,
        usSevenList: usModule ? usModule.sevenList : [],
        usSevenHint: usModule ? usModule.sevenHint : "",
        usHotList: usModule ? usModule.hotList : [],
        usHotHint: usModule ? usModule.hotHint : "",
        aStableList: aModule ? aModule.stableList : [],
        aStableHint: aModule ? aModule.stableHint : "",
        aYieldList: aModule ? aModule.yieldList : [],
        aYieldHint: aModule ? aModule.yieldHint : "",
        aFund: aModule ? aModule.fund : null,
        goldQuotes: goldModule ? goldModule.quotes : [],
        goldScoreText: goldModule ? goldModule.scoreText : "",
        goldTrendTone: goldModule ? goldModule.trendTone : "caution",
        goldTrendBadge: goldModule ? goldModule.trendBadge : "",
        goldTrendTitle: goldModule ? goldModule.trendTitle : "",
        goldTrendDetail: goldModule ? goldModule.trendDetail : "",
        goldPeriod: goldView.period,
        goldBadgeText: goldView.badgeText,
        goldZoneTone: goldView.zoneTone,
        goldCurrencyLabel: goldView.currencyLabel,
        goldPeriods: goldView.periods,
        goldChart: goldView.chart,
        goldChartNote: goldView.chartNote,
        goldBuyText: goldView.buyText,
        goldSellText: goldView.sellText,
        goldRiskLine: goldView.riskLine,
        guruTrendRows: guruModule ? guruModule.trendRows : [],
        guruInstitutionList: guruModule ? guruModule.institutionList : [],
        guruInstitutionIndex: guruSelection.index,
        guruInstitutionId: guruSelection.id,
        guruInstitutionName: guruSelection.name,
        guruInstitutionOrg: guruSelection.org,
        guruHoldingsRows: guruSelection.holdings.rows,
        guruHoldingsHint: guruSelection.holdings.hint,
        guruReportDate: guruSelection.holdings.reportDate,
        guruFilingDate: guruSelection.holdings.filingDate,
      });
    }, done, { force });
  },
  switchTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeTab) return;
    this.setData({ activeTab: id });
    track("section_tab", { market: this.data.market, tab: String(id) });
  },
  switchHkSubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.hkSubTab) return;
    this.setData({ hkSubTab: id });
    track("section_tab", { market: "hk", tab: String(id) });
  },
  selectHkExit(event) {
    const list = this._hkExitList || [];
    const picked = list[Number(event.detail.value)];
    if (!picked) return;
    const selection = resolveHkExitSelection(list, picked.id);
    this.setData({
      hkExitIndex: selection.index,
      hkExitSelectedId: selection.id,
      hkExitView: selection.view,
    });
    track("section_hk_exit_select", { id: String(picked.id) });
  },
  toggleHkEvidence() {
    this.setData({ hkEvidenceOpen: !this.data.hkEvidenceOpen });
  },
  openHkDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_hk_apply");
  },
  switchUsSubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.usSubTab) return;
    this.setData({ usSubTab: id });
    track("section_tab", { market: "us", tab: String(id) });
  },
  openUsDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_us");
  },
  toggleUsHotEvidence(event) {
    const id = event.currentTarget.dataset.id;
    const list = this.data.usHotList || [];
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.setData({ [`usHotList[${index}].evidenceOpen`]: !list[index].evidenceOpen });
  },
  switchASubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.aSubTab) return;
    this.setData({ aSubTab: id });
    track("section_tab", { market: "a", tab: String(id) });
  },
  openADetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_a");
  },
  toggleAEvidence() {
    this.setData({ aEvidenceOpen: !this.data.aEvidenceOpen });
  },
  switchGoldCurrency(event) {
    const currency = event.currentTarget.dataset.currency;
    if (!currency || currency === this.data.goldCurrency) return;
    const view = resolveGoldView(this._goldModule, currency, this.data.goldPeriod);
    this.setData({
      goldCurrency: currency,
      goldPeriod: view.period,
      goldBadgeText: view.badgeText,
      goldZoneTone: view.zoneTone,
      goldCurrencyLabel: view.currencyLabel,
      goldPeriods: view.periods,
      goldChart: view.chart,
      goldChartNote: view.chartNote,
      goldBuyText: view.buyText,
      goldSellText: view.sellText,
      goldRiskLine: view.riskLine,
    });
    track("section_tab", { market: "gold", tab: `currency_${currency}` });
  },
  switchGoldPeriod(event) {
    const period = event.currentTarget.dataset.period;
    if (!period || period === this.data.goldPeriod) return;
    const view = resolveGoldView(this._goldModule, this.data.goldCurrency, period);
    this.setData({
      goldPeriod: view.period,
      goldChart: view.chart,
      goldChartNote: view.chartNote,
    });
  },
  toggleGoldEvidence() {
    this.setData({ goldEvidenceOpen: !this.data.goldEvidenceOpen });
  },
  switchGuruSubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.guruSubTab) return;
    this.setData({ guruSubTab: id });
    track("section_tab", { market: "guru", tab: String(id) });
  },
  applyGuruInstitution(id) {
    const selection = resolveGuruInstitution(this._guruModule, id);
    this.setData({
      guruInstitutionIndex: selection.index,
      guruInstitutionId: selection.id,
      guruInstitutionName: selection.name,
      guruInstitutionOrg: selection.org,
      guruHoldingsRows: selection.holdings.rows,
      guruHoldingsHint: selection.holdings.hint,
      guruReportDate: selection.holdings.reportDate,
      guruFilingDate: selection.holdings.filingDate,
    });
    track("section_guru_institution_select", { id: String(selection.id || "") });
  },
  // 「跟着谁看」点一行：和原型一样，直接切到「机构持仓」视图看这家的持仓，
  // 不是原地展开。
  switchGuruInstitution(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (id !== this.data.guruInstitutionId) this.applyGuruInstitution(id);
    this.setData({ guruSubTab: "holdings" });
    track("section_tab", { market: "guru", tab: "holdings" });
  },
  selectGuruInstitution(event) {
    const list = this.data.guruInstitutionList || [];
    const picked = list[Number(event.detail.value)];
    if (!picked) return;
    this.applyGuruInstitution(picked.id);
  },
  toggleGuruEvidence() {
    this.setData({ guruEvidenceOpen: !this.data.guruEvidenceOpen });
  },
  openMetric(event) {
    const { action, group, id, enabled } = event.currentTarget.dataset;
    if (String(enabled) === "false" || enabled === false) {
      wx.showToast({ title: "这一项暂时没有内容", icon: "none" });
      return;
    }
    if (action === "detail" && id) {
      this.openDetail(id, "section_metric");
      return;
    }
    if (action === "group" && group) {
      this.openGroupById(group, "section_metric");
    }
  },
  openInsightTarget() {
    const { targetId, canOpenTarget } = this.data.overview;
    if (!canOpenTarget || !targetId) {
      wx.showToast({ title: "暂无标的可打开", icon: "none" });
      return;
    }
    this.openDetail(targetId, "section_insight_target");
  },
  openInsightGrade() {
    const { gradeGroup, targetId, canOpenGrade, canOpenTarget } = this.data.overview;
    if (canOpenTarget && targetId && (this.data.market === "gold" || this.data.market === "a")) {
      this.openDetail(targetId, "section_insight_grade");
      return;
    }
    if (canOpenGrade && gradeGroup) {
      this.openGroupById(gradeGroup, "section_insight_grade");
      return;
    }
    wx.showToast({ title: "暂无分组可打开", icon: "none" });
  },
  openDetail(id, from = "section") {
    track("detail_open", { market: this.data.market, from });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(this.data.market)}&id=${encodeURIComponent(id)}`,
    });
  },
  openPlaybook(event) {
    const id = event.currentTarget.dataset.id;
    const book = (this.data.playbooks || []).find((item) => item.id === id);
    if (!book) return;
    track("detail_open", { market: "guru", from: "playbook" });
    this.setData({
      answerSheet: {
        title: `${book.name} · ${book.tag}`,
        lines: sheetLines([
          book.principle,
          `敏感度：${book.sensitivity}`,
          `价值透镜：${book.valueLens}`,
          `边界：${book.doNot}`,
          `来源：${book.sourceNote}`,
        ].join("\n")),
        confirmLabel: "",
      },
    });
  },
  // 遮罩点空白处关，正文里点字不关：catchtap 得有个真方法接住冒泡。
  noop() {},
  closeAnswerSheet() {
    this.setData({ answerSheet: null });
  },
  confirmAnswerSheet() {
    const sheet = this.data.answerSheet;
    this.setData({ answerSheet: null });
    if (!sheet) return;
    if (sheet.action === "detail" && sheet.targetId) this.openDetail(sheet.targetId, "section_answer");
    else if (sheet.action === "group" && sheet.group) this.openGroupById(sheet.group, "section_answer");
  },
  openGroupById(group, from = "section_group") {
    const live = this.data.groups.find((item) => item.id === group);
    if (live && !live.count) {
      wx.showToast({ title: "这一组当前没有项目", icon: "none" });
      return;
    }
    track("list_open", { market: this.data.market, group: String(group), from });
    wx.navigateTo({ url: `/pages/list/index?market=${this.data.market}&group=${group}` });
  },
  openGroup(event) {
    const group = event.currentTarget.dataset.group;
    this.openGroupById(group, "section_group");
  },
  openDeepLink(event) {
    const group = event.currentTarget.dataset.group;
    const enabled = event.currentTarget.dataset.enabled;
    if (String(enabled) === "false" || enabled === false) {
      wx.showToast({ title: "暂无历史样本", icon: "none" });
      return;
    }
    this.openGroupById(group, "section_deep");
  },
  openAnswer(event) {
    const id = event.currentTarget.dataset.id;
    const item = (this.data.answers || []).find((row) => row.id === id);
    if (!item) return;
    track("section_answer", { market: this.data.market, id: String(id) });
    if (item.modal) {
      const canOpen = (item.action === "detail" && item.targetId) || (item.action === "group" && item.group);
      this.setData({
        answerSheet: {
          title: item.question,
          lines: sheetLines(item.modal),
          // 打不开就不留这个按钮：原来无论有没有目标都印「查看」，点了只是关掉。
          confirmLabel: canOpen ? "查看" : "",
          action: item.action,
          targetId: item.targetId || "",
          group: item.group || "",
        },
      });
      return;
    }
    if (!item.enabled) {
      wx.showToast({ title: item.answer || "这一项暂时没有内容", icon: "none" });
      return;
    }
    if (item.action === "detail" && item.targetId) {
      this.openDetail(item.targetId, "section_answer");
      return;
    }
    if (item.action === "group" && item.group) {
      this.openGroupById(item.group, "section_answer");
    }
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "section", market: this.data.market });
    return {
      title: `${this.data.meta.title}｜望潮研究观察`,
      path: `/pages/section/index?market=${this.data.market}`,
    };
  },
});
