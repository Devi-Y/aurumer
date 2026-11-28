const { loadSnapshot, snapshotVersionKey } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, findItem, groupDefinitions, shortCompanyName, shortOrgList, money, aShareDividendStability, tickerZhLabel, tickerShortZh, usPoolItems, usQualityEligibility } = require("../../utils/answers");
const { getDividendStability } = require("../../utils/dividend-stability");
const PRODUCT = require("../../config/product");
const {
  countTiles, usOrderState, usOrderLine, compareUsOrder, US_TRIGGERS,
  aOrderState, aOrderLine, compareAOrder, A_TRIGGERS, goldLevelNotes,
} = require("../../utils/order-plan");
// 结论行要按「低估 / 风险」这两个透镜选人，和今日答案用同一个判断。
const { parseOfferPrice, yieldImpliedPlan, goldZoneForPrice, goldPlanView, MAGNIFICENT_SEVEN, cleanUsGrossMargin } = require("../../utils/market-lenses");
// 港股打新「中签后」每只股票自己的观察分位——已经是详情页在用的同一份
// 真实数据计算，这里原样复用，不重新写一遍价格逻辑。
const { buildHkExitPlan, buildHkExitBands, HK_HOT_OVERSUBSCRIPTION } = require("../../utils/hk-exit-plan");
// 美股「七姐妹」每行的判断句复用详情页同一套 usSignal——不是另起一套话术。
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");
const { goHome, openPage } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { eventBrief, eventFactFor } = require("../../utils/us-event-facts");
const { plainLabel, plainOverview } = require("../../utils/plain-reading");
const { getHistoricalDividendYield } = require("../../utils/historical-dividend-yield");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { MASTER_PLAYBOOKS } = require("../../utils/master-playbooks");
const { buildHkHistoryStats, hkFirstDaySeries } = require("../../utils/hk-history-stats");
const { buildDailyAnswers } = require("../../utils/daily-answers");
const { listHoldings } = require("../../utils/local-holdings");
const { marketSources } = require("../../utils/sources");
// 「机构持仓」的共识加减仓聚合，和今日答案卡片（未来持仓趋势）同一份计算，
// 不重新写一遍 13F 方向统计。
const { buildGuruTrend } = require("../../utils/guru-trend");
const { holdingLabel, instrumentSuffix } = require("../../utils/guru-changes");
// 页头那句「数据截至 …」和新闻资讯页共用同一个写法。
const { asOfText } = require("../../utils/dates");
const { marketReferenceAsOf, referenceDateText } = require("../../utils/historical-reference");
const { historicalGoldSeries, domesticGoldClose } = require("../../utils/gold-series");
const { goldParity } = require("../../utils/gold-parity");
const { PALETTE, donutSvg, monthDensitySvg } = require("../../utils/svg-charts");

const SHORT_TAG_MAP = {
  NVDA: "AI芯片",
  MSFT: "云计算",
  AAPL: "手机生态",
  GOOGL: "搜索AI",
  GOOG: "搜索AI",
  AMZN: "电商云",
  META: "社交广告",
  TSLA: "智能电车",
  AMD: "服务器芯片",
  AVGO: "通信芯片",
  TSM: "晶圆代工",
  ORCL: "企业云",
  PLTR: "AI软件",
  MSTR: "数字资产",
  CRWD: "网络安全",
  ARM: "芯片架构",
  NFLX: "流媒体",
  COST: "仓储超市",
  LLY: "创新药",
  ASML: "光刻机",
  V: "支付清算",
  MA: "支付清算",
  JPM: "综合银行",
  WMT: "连锁零售",
  UNH: "医疗保险",
  "600900": "水电龙头",
  "600036": "零售银行",
  "600941": "通信龙头",
  "601088": "煤电一体",
  "000333": "白电龙头",
  "000651": "空调家电",
  "601398": "国有大行",
  "601939": "国有大行",
  "601288": "国有大行",
  "601988": "国有大行",
  "601328": "国有大行",
  "600000": "股份银行",
  "600938": "海上油气",
  "600377": "高速公路",
  "600585": "水泥龙头",
  "600011": "火电绿电",
  "601166": "股份银行",
  "600019": "钢铁龙头",
  "601006": "重载铁路",
  "601225": "优质煤炭",
  "600028": "石油化工",
  "601857": "油气龙头",
  "515180": "红利ETF",
};

function shortTagFor(market, id, code, industry) {
  const cleanId = String(id || "").replace(/\.(SH|SZ|HK)$/i, "").toUpperCase();
  const cleanCode = String(code || "").replace(/\.(SH|SZ|HK)$/i, "").toUpperCase();
  if (SHORT_TAG_MAP[cleanId]) return SHORT_TAG_MAP[cleanId];
  if (SHORT_TAG_MAP[cleanCode]) return SHORT_TAG_MAP[cleanCode];
  if (industry) {
    const first = String(industry).split(/[\/、·,，]/)[0].trim();
    return first.length > 5 ? first.slice(0, 5) : first;
  }
  return market === "us" ? "美股" : (market === "a" ? "红利" : "新股");
}

function formatACode(code, id) {
  const raw = String(code || id || "").trim();
  if (!raw) return "";
  if (/\.(SH|SZ)$/i.test(raw)) return raw.toUpperCase();
  return /^6|^5/.test(raw) ? `${raw}.SH` : `${raw}.SZ`;
}
const { toneOf, sampleSeries, sparklineSvg, zeroAxisBars } = require("../../utils/sparkline");

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
    one: "分红稳定性 / 历史股息率",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    // 这行是栏目页的副标题，要跟今日答案那四问对上：什么价、能不能买、要不要卖、拐点。
    one: "历史价格 / 区间涨跌 / 均线变化",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "价格观察",
  },
  guru: {
    title: "聪明钱跟踪",
    one: "持仓 · 历史披露变化",
    tone: "guru",
    icon: "/assets/home/guru.svg",
    kicker: "学习与对照",
  },
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
function hkDeadlineOffset(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

const HK_CORNERSTONE_NOISE_RE = /禁售期|财务报告准则|会计准则|补充协议|配发结果|历史财务|公允价值|招股章程|全球发售|香港发售|国际发售|发售股份|联交所|证券及期货|概无|不适用|董事|监事/u;

function cleanCornerstoneNames(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || "").trim();
    if (!s || s.length < 2 || s.length > 22) continue;
    if (HK_CORNERSTONE_NOISE_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeHkSponsorShort(rawName) {
  const s = String(rawName || "").trim();
  if (!s || /见历史|招股文件|待定|暂无/u.test(s)) return "";
  if (/中国国际金融|中金/u.test(s)) return "中金公司";
  if (/中信建投/u.test(s)) return "中信建投";
  if (/中信里昂|中信证券|中信/u.test(s)) return "中信证券";
  if (/华泰/u.test(s)) return "华泰国际";
  if (/中银/u.test(s)) return "中银国际";
  if (/高盛/u.test(s)) return "高盛亚洲";
  if (/摩根士丹利/u.test(s)) return "摩根士丹利";
  if (/摩根大通/u.test(s)) return "摩根大通";
  if (/国泰君安/u.test(s)) return "国泰君安";
  if (/海通/u.test(s)) return "海通国际";
  if (/招银/u.test(s)) return "招银国际";
  if (/招商/u.test(s)) return "招商证券";
  if (/广发/u.test(s)) return "广发香港";
  if (/建银/u.test(s)) return "建银国际";
  if (/农银/u.test(s)) return "农银国际";
  if (/工银/u.test(s)) return "工银国际";
  if (/瑞银|UBS/iu.test(s)) return "瑞银集团";
  if (/美林|BofA/iu.test(s)) return "美银证券";
  return s
    .replace(/（香港）|\(香港\)|（国际）|\(国际\)|（亚洲）|\(亚洲\)|有限责任公司|股份有限公司|有限公司|金融控股|企业融资|融资|证券|国际|资本/gu, "")
    .trim()
    .slice(0, 6);
}

// 「2,665.8百万港元」→「HK$26.7亿」；认不出单位就不显示，不猜。
// 有占比写「基石占比 35.2%」，只有金额写「基石金额 HK$1.2亿」——同一列不能一行是百分比、
// 一行是钱数还共用一个「基石」，读者分不清哪个是哪个。
function hkCornerstoneStat(raw) {
  const percent = finiteOrNull(raw.cornerstonePercent);
  if (percent != null) return { label: "大机构锁仓", value: `${percent.toFixed(1)}%` };
  const match = String(raw.cornerstoneAmount || "").replace(/,/g, "").match(/([\d.]+)\s*(百万|亿)/);
  const value = match ? Number(match[1]) * (match[2] === "亿" ? 1e8 : 1e6) : NaN;
  if (!Number.isFinite(value) || value <= 0) return { label: "大机构锁仓", value: "暂无披露" };
  return {
    label: "大机构锁仓",
    value: value >= 1e8 ? `HK$${(value / 1e8).toFixed(1)}亿` : `HK$${Math.round(value / 1e4)}万`,
  };
}

function hkTone(group) {
  if (group === "worth") return "worth";
  if (group === "caution") return "caution";
  if (group === "settled") return "settled";
  return "avoid";
}

function sortHkHistoryRows(rows, sortId = "latest") {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (sortId === "firstDay") {
    return list.sort((a, b) => (b.firstDayNum ?? -1e9) - (a.firstDayNum ?? -1e9));
  }
  if (sortId === "pnl") {
    return list.sort((a, b) => (b.pnlNum ?? -1e9) - (a.pnlNum ?? -1e9));
  }
  if (sortId === "drop") {
    return list.sort((a, b) => (a.firstDayNum ?? 1e9) - (b.firstDayNum ?? 1e9));
  }
  return list;
}

// 「近期申购」取还在接受申购的三档（值得打/暂缓观察/暂不建议）；「中签后」
// 取已出配发结果、还没被上游归档进历史的一档（group:"settled"）。两个视图
// 曾经共用同一份「live」过滤池，导致一只股票配发结果一出就同时从两边消失——
// 现在按各自的真实生命周期阶段分开取数，一只股票任一时刻只属于其中一边。
function buildHkModule(snapshot) {
  const items = allItems(snapshot, "hk");
  const applyItems = items.filter((item) => (item.lenses || []).some((lens) => lens === "live" || lens === "date-pending"));
  const exitItems = items.filter((item) => item.group === "settled");

  const applyList = applyItems.map((item) => {
    const raw = item.raw || {};
    const offer = parseOfferPrice(raw.offerPrice || raw.priceHigh || raw.priceLow);
    const entryFee = finiteOrNull(raw.entryFee);
    const deadline = raw.offerDeadline || raw.offerEnd;
    const deadlineOffset = hkDeadlineOffset(deadline);
    const closed = deadlineOffset != null && deadlineOffset < 0;
    const rawFirstSponsor = Array.isArray(raw.sponsorNames) && raw.sponsorNames.length
      ? String(raw.sponsorNames[0] || "")
      : (raw.sponsor ? String(raw.sponsor).split(/[、,，/]/)[0] : "");
    const sponsorClean = normalizeHkSponsorShort(rawFirstSponsor);
    const indTag = raw.industry ? String(raw.industry).split(/[\/、·,，]/)[0].trim().slice(0, 6) : "";
    const lotRaw = String(raw.boardLot || raw.boardLotShares || "").replace(/,/g, "").trim();
    const lotTag = /^\d+$/.test(lotRaw) ? `一手${lotRaw}股` : "";
    const tagPills = [indTag, sponsorClean ? `保荐 ${sponsorClean}` : "", lotTag].filter(Boolean);
    const stageStep = item.group === "settled" ? 2 : (closed ? 1 : 0);
    const stageSteps = ["招股", "截止", "配发", "上市"].map((label, idx) => ({
      label,
      state: idx < stageStep ? "done" : (idx === stageStep ? "now" : "todo"),
    }));
    const rawCode = String(item.code || item.id || "").replace(/\.HK$/i, "");
    const freshHk = snapshot.actionsFresh !== false;
    let verdictBadge = "日期待核";
    let verdictTone = "caution";
    if (closed) {
      verdictBadge = "已截止";
      verdictTone = "settled";
    } else if (deadlineOffset == null) {
      verdictBadge = "日期待核";
      verdictTone = "caution";
    } else if (!freshHk) {
      verdictBadge = "数据待更新";
      verdictTone = "settled";
    } else if (item.group === "worth") {
      verdictBadge = "值得申购";
      verdictTone = "worth";
    } else if (item.group === "caution") {
      verdictBadge = "谨慎参与";
      verdictTone = "caution";
    } else {
      verdictBadge = "不建议申购";
      verdictTone = "avoid";
    }
    const csNames = cleanCornerstoneNames(raw.cornerstoneInvestors);
    const cornerstoneLine = csNames.length
      ? `基石机构：${csNames.slice(0, 3).join("、")}${csNames.length > 3 ? ` 等${csNames.length}家` : ""}`
      : "";
    const scheduleParts = [];
    if (raw.offerStart && deadline && deadlineOffset != null) {
      scheduleParts.push(`招股 ${String(raw.offerStart).slice(5, 10)} 至 ${String(deadline).slice(5, 10)}`);
    }
    const listingOffset = hkDeadlineOffset(raw.listingDate);
    if (raw.listingDate && deadlineOffset != null) {
      if (listingOffset != null && listingOffset < 0) {
        scheduleParts.push(`原定上市 ${String(raw.listingDate).slice(5, 10)}（待核结果）`);
      } else {
        scheduleParts.push(`预计上市 ${String(raw.listingDate).slice(5, 10)}`);
      }
    }
    const countdownPill = !closed && deadlineOffset != null
      ? (deadlineOffset === 0 ? "今日截止" : `剩 ${deadlineOffset} 天`)
      : "";
    return {
      id: item.id,
      name: shortCompanyName(item.name, item.code || "新股", 10),
      code: rawCode ? `${rawCode}.HK` : "",
      tagPills,
      stageSteps,
      badgeText: verdictBadge,
      statusLabel: verdictBadge,
      tone: verdictTone,
      reason: item.one || "招股资料仅供参考，请核对最新公告",
      deadlineLabel: deadlineOffset == null ? "截止日期待核" : `截止 ${String(deadline).slice(0, 10)}`,
      scheduleLine: scheduleParts.join(" · "),
      countdownPill,
      cornerstoneLine,
      deadlineOffset,
      closed,
      stats: [
        { label: "招股价", value: offer != null ? `HK$${offer}` : "待更新" },
        { label: "一手本金", value: entryFee != null ? `HK$${Math.round(entryFee).toLocaleString("en-US")}` : "待更新" },
        hkCornerstoneStat(raw),
      ],
    };
  });
  // 真正招股中的排最前，日期待核次之，已过截止日的排最后。
  const applyOrder = (row) => {
    if (row.closed) return 2;
    if (row.deadlineOffset == null) return 1;
    return 0;
  };
  applyList.sort((left, right) => applyOrder(left) - applyOrder(right));

  const exitList = exitItems.map((item) => {
    const plan = buildHkExitPlan(item, { evidence: strategyEvidence, snapshot });
    const offerNum = parseOfferPrice(item.raw && item.raw.offerPrice);
    const offerLabel = offerNum != null ? `发行价 HK$ ${offerNum}` : "发行价待更新";
    const name = shortCompanyName(item.name, item.code || "新股", 10);
    const oversub = finiteOrNull(item.raw && item.raw.publicOversubscription);
    return {
      id: item.id,
      name,
      badgeText: item.badge || "待定",
      tone: hkTone(item.group),
      offerLabel,
      text: `${name} · ${offerLabel}`,
      tier: oversub == null ? "" : (oversub >= HK_HOT_OVERSUBSCRIPTION ? "hot" : "cool"),
      oversubText: oversub != null ? `抢购 ${Math.round(oversub).toLocaleString("en-US")} 倍` : "",
      plan,
    };
  });

  const endedItems = items.filter((item) => item.group === "ended");
  const oneLotValues = [];
  const sponsorAgg = new Map();
  const industryAgg = new Map();
  const bucketDefs = [
    { key: "cool", label: "冷门 (<15倍)", min: 0, max: 15, items: [] },
    { key: "warm", label: "温和 (15–100倍)", min: 15, max: 100, items: [] },
    { key: "hot", label: "火热 (≥100倍)", min: 100, max: Infinity, items: [] },
  ];

  const historyRowsAll = endedItems.map((item) => {
    const raw = item.raw || {};
    const rev = raw.historicalReview || {};
    const grey = finiteOrNull(rev.greyMarketChange);
    const firstDay = finiteOrNull(rev.firstDayChange);
    const fee = finiteOrNull(raw.entryFee);
    const oversub = finiteOrNull(raw.publicOversubscription);
    const oneLot = finiteOrNull(raw.oneLotRate);
    if (oneLot != null && oneLot > 0) oneLotValues.push(oneLot);
    const pnl = finiteOrNull(raw.oneLotPnl) != null
      ? Math.round(Number(raw.oneLotPnl))
      : ((fee != null && fee > 0 && firstDay != null) ? Math.round((fee * firstDay) / 100) : null);
    if (oversub != null && firstDay != null) {
      const targetBucket = bucketDefs.find((b) => oversub >= b.min && oversub < b.max);
      if (targetBucket) targetBucket.items.push({ firstDay, oneLot, pnl });
    }
    const indName = String(raw.industry || "").split(/[\/、·,，]/)[0].trim();
    if (indName && indName !== "待整理" && firstDay != null) {
      const indCur = industryAgg.get(indName) || { name: indName, count: 0, up: 0, sumFd: 0, sumPnl: 0, pnlCount: 0 };
      indCur.count += 1;
      if (firstDay > 0) indCur.up += 1;
      indCur.sumFd += firstDay;
      if (pnl != null) {
        indCur.sumPnl += pnl;
        indCur.pnlCount += 1;
      }
      industryAgg.set(indName, indCur);
    }
    const rawSponsors = (Array.isArray(raw.sponsorNames) && raw.sponsorNames.length)
      ? raw.sponsorNames
      : (raw.sponsor ? String(raw.sponsor).split(/[、,，/]/) : []);
    const seenSp = new Set();
    for (const spRaw of rawSponsors) {
      const spName = normalizeHkSponsorShort(spRaw);
      if (!spName || seenSp.has(spName) || firstDay == null) continue;
      seenSp.add(spName);
      const cur = sponsorAgg.get(spName) || { name: spName, count: 0, up: 0, sumFd: 0, bestName: "", bestFd: -1e9 };
      cur.count += 1;
      if (firstDay > 0) cur.up += 1;
      cur.sumFd += firstDay;
      if (firstDay > cur.bestFd) {
        cur.bestFd = firstDay;
        cur.bestName = shortCompanyName(item.name, item.code || "新股", 5);
      }
      sponsorAgg.set(spName, cur);
    }

    const rawCode = String(item.code || raw.stockCode || "").replace(/\.HK$/i, "");
    const crowdBits = [];
    if (oversub != null) {
      crowdBits.push(`抢购${oversub >= 100 ? Math.round(oversub).toLocaleString("en-US") : oversub.toFixed(1)}倍`);
    }
    if (oneLot != null) {
      crowdBits.push(`一手中签${oneLot >= 10 ? oneLot.toFixed(0) : oneLot.toFixed(1)}%`);
    }
    return {
      id: item.id,
      name: shortCompanyName(item.name, item.code || "新股", 7),
      code: rawCode || "",
      date: raw.listingDate ? String(raw.listingDate).slice(5) : "",
      crowdText: crowdBits.join(" · "),
      greyNum: grey,
      firstDayNum: firstDay,
      pnlNum: pnl,
      greyText: grey != null ? signedPct(grey, 1) : "—",
      greyTone: grey == null ? "flat" : (grey > 0 ? "up" : (grey < 0 ? "down" : "flat")),
      firstDayText: firstDay != null ? signedPct(firstDay, 1) : "—",
      firstDayTone: firstDay == null ? "flat" : (firstDay > 0 ? "up" : (firstDay < 0 ? "down" : "flat")),
      pnlText: pnl != null ? `${pnl >= 0 ? "+" : "-"}HK$${Math.abs(pnl).toLocaleString("en-US")}` : "—",
      pnlTone: pnl == null ? "flat" : (pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat")),
    };
  });
  const historyRows = historyRowsAll.slice(0, 12);
  const statsSummary = buildHkHistoryStats(snapshot);
  const avgOneLot = oneLotValues.length
    ? `${(oneLotValues.reduce((s, v) => s + v, 0) / oneLotValues.length).toFixed(1)}%`
    : "—";
  const historySummary = statsSummary.sampleCount > 0 ? [
    { label: "首日上涨率", value: statsSummary.firstDayWinRate || "—" },
    { label: "平均一手中签", value: avgOneLot },
    { label: "前夜首日同向", value: statsSummary.greyToFirstDirection || "—" },
    { label: "最高首日涨幅", value: statsSummary.maxFirstDay ? statsSummary.maxFirstDay.label : `${statsSummary.sampleCount}只` },
  ] : [];

  const sponsorRows = [...sponsorAgg.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => (b.count - a.count) || ((b.up / b.count) - (a.up / a.count)))
    .slice(0, 10)
    .map((entry) => {
      const winPct = Math.round((entry.up / entry.count) * 100);
      const avgFd = entry.sumFd / entry.count;
      return {
        name: entry.name,
        countText: `保荐 ${entry.count} 只`,
        recordText: `${entry.up}涨 ${entry.count - entry.up}不涨`,
        winPct,
        winText: `${winPct}%`,
        winTone: winPct >= 60 ? "up" : (winPct <= 35 ? "down" : "flat"),
        avgFdText: signedPct(avgFd, 1),
        avgTone: avgFd > 0 ? "up" : (avgFd < 0 ? "down" : "flat"),
        bestNote: entry.bestName ? `代表：${entry.bestName} (${signedPct(entry.bestFd, 1)})` : "",
      };
    });

  const crowdBuckets = bucketDefs
    .filter((b) => b.items.length > 0)
    .map((b) => {
      const up = b.items.filter((x) => x.firstDay > 0).length;
      const winPct = Math.round((up / b.items.length) * 100);
      const avgFd = b.items.reduce((s, x) => s + x.firstDay, 0) / b.items.length;
      const lots = b.items.map((x) => x.oneLot).filter((v) => v != null);
      const avgLot = lots.length ? `${(lots.reduce((s, v) => s + v, 0) / lots.length).toFixed(1)}%` : "—";
      return {
        key: b.key,
        label: b.label,
        countText: `${b.items.length}只`,
        winPct,
        winText: `${winPct}%`,
        winTone: winPct >= 60 ? "up" : (winPct <= 35 ? "down" : "flat"),
        avgLotText: avgLot,
        avgFdText: signedPct(avgFd, 1),
        fdTone: avgFd > 0 ? "up" : (avgFd < 0 ? "down" : "flat"),
      };
    });

  const industryRows = [...industryAgg.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => (b.count - a.count) || ((b.up / b.count) - (a.up / a.count)))
    .slice(0, 8)
    .map((entry) => {
      const winPct = Math.round((entry.up / entry.count) * 100);
      const avgFd = entry.sumFd / entry.count;
      const avgPnl = entry.pnlCount > 0 ? Math.round(entry.sumPnl / entry.pnlCount) : null;
      return {
        name: entry.name.length > 6 ? entry.name.slice(0, 6) : entry.name,
        countText: `${entry.count}只`,
        winPct,
        winText: `${winPct}%`,
        winTone: winPct >= 60 ? "up" : (winPct <= 35 ? "down" : "flat"),
        avgFdText: signedPct(avgFd, 1),
        fdTone: avgFd > 0 ? "up" : (avgFd < 0 ? "down" : "flat"),
        avgPnlText: avgPnl != null ? `${avgPnl >= 0 ? "+" : "-"}HK$${Math.abs(avgPnl).toLocaleString("en-US")}` : "—",
        pnlTone: avgPnl == null ? "flat" : (avgPnl > 0 ? "up" : (avgPnl < 0 ? "down" : "flat")),
      };
    });

  const openApply = applyList.filter((r) => !r.closed && r.deadlineOffset != null && r.deadlineOffset >= 0);
  const worthApply = openApply.filter((r) => r.tone === "worth");
  const answerBar = snapshot.actionsFresh === false
    ? "数据待更新 · 招股状态请核对港交所公告"
    : (openApply.length
      ? (worthApply.length
        ? `招股中 ${openApply.length} 只 · 值得申购：${worthApply.slice(0, 3).map((r) => r.name).join("、")}`
        : `招股中 ${openApply.length} 只 · 暂无高性价比标的`)
      : `暂无在招新股 · 近 ${statsSummary.sampleCount || historyRowsAll.length} 只首日胜率 ${statsSummary.firstDayWinRate || "—"}`);

  return {
    answerBar,
    applyList,
    applyTiles: [],
    firstDayChart: hkFirstDayChart(snapshot),
    exitList,
    exitChart: hkExitTierChart(buildHkExitBands(snapshot)),
    historySummary,
    historyRows,
    historyRowsAll,
    historyTotal: historyRowsAll.length,
    sponsorRows,
    crowdBuckets,
    industryRows,
  };
}

// 「近期申购」顶上一张零轴柱：最近上市的新股首日涨跌，从早到晚一根一根排，
// 看打新行情冷热。和首页「港股首日」卡同一份 hkFirstDaySeries。
function hkFirstDayChart(snapshot) {
  const series = hkFirstDaySeries(snapshot);
  const changes = series.map((item) => item.change);
  if (changes.length < 3) return null;
  const up = changes.filter((value) => value > 0).length;
  const flat = changes.filter((value) => value === 0).length;
  const down = changes.filter((value) => value < 0).length;
  const winPct = Math.round((up / changes.length) * 100);
  const maxVal = Math.max(...changes);
  const minVal = Math.min(...changes);
  const donutSrc = donutSvg([
    { value: up, color: "#dc4c3e" },
    ...(flat > 0 ? [{ value: flat, color: "#94a3b8" }] : []),
    { value: down, color: "#159960" },
  ], { size: 140, strokeWidth: 18 });
  return {
    count: changes.length,
    lastDate: series[series.length - 1].date,
    winPctText: `${winPct}%`,
    donutSrc,
    upText: `${up}只涨`,
    flatDownText: `${changes.length - up}只平/跌`,
    rangeText: `最高 ${signedPct(maxVal, 1)} · 最低 ${signedPct(minVal, 1)}`,
    ...zeroAxisBars(changes),
  };
}

// 「申购结束」视图的同类新股涨跌中位数，按超购热度分两批画横条，零轴居中。
// 数字和详情页 hkExitTierBarsVisual() 同一份 buildHkExitBands 统计。
function hkExitTierChart(bands) {
  if (!bands || !bands.sampleCount) return null;
  const stages = [
    { key: "grey", label: "前夜" },
    { key: "firstDay", label: "首日" },
    { key: "fiveDay", label: "首周" },
  ];
  const tiers = [
    { key: "hot", label: `抢购≥${HK_HOT_OVERSUBSCRIPTION}倍` },
    { key: "cool", label: "一般" },
  ];
  const groups = stages.map((stage) => ({
    label: stage.label,
    bars: tiers
      .map((tier) => {
        const band = bands[tier.key] && bands[tier.key][stage.key];
        if (!band || !band.n || band.p50 == null) return null;
        return { tier: tier.key, label: tier.label, value: band.p50, ratioText: `${band.positive}/${band.n}` };
      })
      .filter(Boolean),
  })).filter((group) => group.bars.length);
  if (!groups.length) return null;
  const values = groups.flatMap((group) => group.bars.map((bar) => bar.value));
  const maxPos = Math.max(0, ...values);
  const maxNeg = Math.max(0, ...values.map((value) => -value));
  const span = Math.max(maxPos + maxNeg, 1e-6);
  const zero = (maxNeg / span) * 100;
  groups.forEach((group) => {
    group.bars.forEach((bar) => {
      const width = Math.max(1.5, (Math.abs(bar.value) / span) * 100);
      bar.left = bar.value >= 0 ? zero : Math.max(0, zero - width);
      bar.width = width;
      bar.dir = bar.value >= 0 ? "up" : "down";
      bar.valueText = signedPct(bar.value);
    });
  });
  return {
    zero,
    groups,
    legend: tiers,
    sampleText: `${bands.sampleCount} 只历史样本 · 平均涨跌 · 上涨/总数`,
  };
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
      tier: picked.tier,
      oversubText: picked.oversubText,
      showTierChart: !picked.plan.rows.length,
      plan: picked.plan,
    },
  };
}

function usTone(signalTone) {
  if (signalTone === "good") return "worth";
  if (signalTone === "bad") return "avoid";
  return "caution";
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedPct(value, digits = 1) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

// 一条收盘走势（美股每行 60 日、红利 ETF 90 日），出成 SVG 图片；首尾涨跌写成旁边的数字。
// history 两种形状都认：纯数字数组，或 {date, close}。size 要和 WXML 里图片的 CSS 宽高同比例。
const US_SPARK_SIZE = { width: 260, height: 64 };
const A_FUND_SPARK_SIZE = { width: 640, height: 120 };

function historySpark(item, size) {
  const closes = ((item.raw && item.raw.history) || [])
    .map((entry) => finiteOrNull(entry && entry.close != null ? entry.close : entry))
    .filter((value) => value != null);
  if (closes.length < 10) return { hasSpark: false, sparkSrc: "", sparkTone: "flat", sparkDays: 0, sparkChangeText: "" };
  const first = closes[0];
  const last = closes[closes.length - 1];
  return {
    hasSpark: true,
    sparkSrc: sparklineSvg(sampleSeries(closes), size),
    sparkTone: toneOf(last - first),
    sparkDays: closes.length,
    sparkChangeText: first ? signedPct(((last - first) / first) * 100) : "",
  };
}

// 七姐妹每行右侧只留现价和今日涨跌；PE、营收、60 日位置交给走势图和详情页。
function usMetrics(item) {
  const raw = item.raw || {};
  const price = finiteOrNull(raw.price);
  const change = finiteOrNull(raw.changePercent);
  return {
    priceText: price != null ? `$${price.toFixed(2)}` : "—",
    changeText: signedPct(change, 2),
    changeTone: change == null ? "flat" : (change >= 0 ? "up" : "down"),
  };
}

// 美股页按原型忠实复刻：只有「七姐妹」「热门三只」两个视图。原型 demo 数据
// 给每只股票编了一句「event」叙事（比如「云业务增长改善」），快照里没有
// 新闻源、没有公告字段，编事件就是凭空造。换成 usSignal 已经用 PE、质量门、
// 60日价格位置算出的结论句——详情页在用同一份判断，不是另起一套话术。
// 每行下面那条参考价：跟详情页「下单参考」卡同一个价、同一个「风险升高就暂不买」。
function usOrderFields(item, signal) {
  const raw = (item && item.raw) || {};
  const noBuy = Boolean(signal && signal.label === "风险升高");
  const order = usOrderState(raw, noBuy);
  if (!order) {
    const stale = signal && signal.label === "数据待更新";
    return {
      order: null,
      hasOrder: false,
      orderTone: "",
      orderLabel: "",
      orderValue: "",
      orderNote: "",
      verdictBadge: stale ? "数据待更新" : plainLabel((signal && signal.label) || "观察中"),
      verdictTone: stale ? "settled" : usTone(signal && signal.tone),
      refRangeText: "",
    };
  }
  const line = usOrderLine(order);
  let verdictBadge = "价格适中 · 等低位";
  let verdictTone = "caution";
  if (order.state === "buy") {
    verdictBadge = "偏便宜 · 可关注";
    verdictTone = "worth";
  } else if (order.state === "stop") {
    verdictBadge = "跌破警戒 · 先观望";
    verdictTone = "avoid";
  } else if (order.state === "sell") {
    verdictBadge = "偏贵 · 分批止盈区";
    verdictTone = "caution";
  } else if (order.noBuy || (signal && signal.tone === "bad")) {
    verdictBadge = "风险偏高 · 暂不追";
    verdictTone = "avoid";
  } else if (signal && signal.tone === "good") {
    verdictBadge = "偏便宜 · 可分批看";
    verdictTone = "worth";
  }
  const refRangeText = order.noBuy
    ? `暂不设低接位 · 警戒位 $${order.stop.toFixed(1)}`
    : `参考区间 $${order.buy.toFixed(1)} – $${order.sell.toFixed(1)}${order.state === "buy" ? "（已在低位区）" : (order.buyGapPct > 0 ? `（距低位 ${order.buyGapPct.toFixed(1)}%）` : "")}`;
  return {
    order,
    hasOrder: true,
    orderTone: line ? line.tone : "",
    orderLabel: line ? line.label : "",
    orderValue: line ? line.value : "",
    orderNote: line ? line.note : "",
    verdictBadge,
    verdictTone,
    refRangeText,
  };
}

function usFactChips(item, spark) {
  const fund = (item.raw && item.raw.fund) || {};
  const chips = [];
  const pe = finiteOrNull(fund.pe);
  const revG = finiteOrNull(fund.revenueGrowth);
  if (pe != null && pe > 0) chips.push({ label: `市盈 ${pe.toFixed(0)}倍`, tone: "plain" });
  if (revG != null) chips.push({ label: `营收 ${signedPct(revG, 1)}`, tone: revG >= 0 ? "up" : "down" });
  if (spark && spark.hasSpark && spark.sparkChangeText) {
    chips.push({ label: `${spark.sparkDays}日 ${spark.sparkChangeText}`, tone: spark.sparkTone || "plain" });
  }
  return chips;
}

function heatTileTone(delta, strongThreshold = 3) {
  if (delta == null || !Number.isFinite(delta)) return "flat";
  if (delta >= strongThreshold) return "up-strong";
  if (delta > 0.05) return "up-soft";
  if (delta <= -strongThreshold) return "down-strong";
  if (delta < -0.05) return "down-soft";
  return "flat";
}

function yieldTileTone(yieldPct) {
  if (yieldPct == null || !Number.isFinite(yieldPct)) return "flat";
  if (yieldPct >= 5) return "yield-high";
  if (yieldPct >= 3.5) return "yield-mid";
  return "yield-low";
}

function buildUsHeatmap(allList, mode = "day") {
  return (Array.isArray(allList) ? allList : []).map((row) => {
    const rawDelta = mode === "perf60" ? row.sortPerf60 : parseFloat(String(row.changeText || "").replace("%", ""));
    const val = Number.isFinite(rawDelta) ? rawDelta : null;
    const threshold = mode === "perf60" ? 12 : 2.5;
    return {
      id: row.id,
      shortName: String(row.name || "").slice(0, 6),
      code: row.code,
      valText: val != null ? signedPct(val, 1) : "—",
      subText: row.priceText || "",
      tileTone: heatTileTone(val, threshold),
    };
  });
}

function buildAHeatmap(allList, mode = "yield") {
  return (Array.isArray(allList) ? allList : []).map((row) => {
    if (mode === "change") {
      const val = row.sortChange;
      return {
        id: row.id,
        shortName: String(row.name || "").slice(0, 5),
        code: String(row.code || "").replace(/\.(SH|SZ)$/i, ""),
        valText: val != null ? signedPct(val, 2) : "—",
        subText: row.priceText || "",
        tileTone: heatTileTone(val, 2),
      };
    }
    const y = row.sortYield;
    return {
      id: row.id,
      shortName: String(row.name || "").slice(0, 5),
      code: String(row.code || "").replace(/\.(SH|SZ)$/i, ""),
      valText: y != null ? `${y.toFixed(2)}%` : "暂缺",
      subText: row.sortStability != null ? `稳定${row.sortStability}分` : row.priceText,
      tileTone: yieldTileTone(y),
    };
  });
}

function formatUsdLarge(value) {
  const n = finiteOrNull(value);
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${sign}$${Math.round(abs / 1e8).toLocaleString("en-US")}亿`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e4)}万`;
  return `${sign}$${Math.round(abs)}`;
}

function medianOf(nums) {
  const valid = (Array.isArray(nums) ? nums : []).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function shortGuruPersonName(rawName) {
  const s = String(rawName || "").trim();
  if (!s) return "";
  const tail = s.includes("·") ? s.split("·").pop().trim() : s.split("/")[0].trim();
  return tail.replace(/（.*?）|\(.*?\)/g, "").slice(0, 6);
}

function buildUsGuruHolderMap(snapshot) {
  const map = new Map();
  const investors = Array.isArray(snapshot && snapshot.investors) ? snapshot.investors : [];
  for (const inv of investors) {
    const holdings = Array.isArray(inv && inv.holdings) ? inv.holdings : [];
    const seen = new Set();
    for (const h of holdings) {
      if (!h || h.putCall) continue;
      const sym = String(h.ticker || h.code || "").trim().toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const cur = map.get(sym) || { count: 0, names: [] };
      cur.count += 1;
      const shortInv = shortGuruPersonName(inv.name);
      if (shortInv) cur.names.push(shortInv);
      map.set(sym, cur);
    }
  }
  return map;
}

function plainSecFormLabel(form) {
  const f = String(form || "").trim().toUpperCase();
  if (f === "10-Q") return "季度财报";
  if (f === "10-K") return "年度财报";
  if (f === "8-K") return "重大事项";
  if (f === "6-K") return "境外公告";
  if (f === "20-F") return "境外年报";
  if (f === "4") return "高管持股";
  return f || "官方备案";
}

function usStockRow(item, sparkCache = null, guruMap = null) {
  const signal = buildStrategySignal(item);
  const cacheKey = item.code || item.id;
  const spark = sparkCache && cacheKey && sparkCache.has(cacheKey)
    ? sparkCache.get(cacheKey)
    : historySpark(item, US_SPARK_SIZE);
  if (sparkCache && cacheKey) sparkCache.set(cacheKey, spark);
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const closes = (Array.isArray(raw.history) ? raw.history : [])
    .map((entry) => finiteOrNull(entry && entry.close != null ? entry.close : entry))
    .filter((value) => value != null);
  const perf60 = closes.length >= 2 && closes[0] > 0
    ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
    : null;
  const lo60 = closes.length >= 10 ? Math.min(...closes) : null;
  const hi60 = closes.length >= 10 ? Math.max(...closes) : null;
  const curPrice = finiteOrNull(raw.price);
  const sortPos60 = (lo60 != null && hi60 != null && hi60 > lo60 && curPrice != null)
    ? Math.max(0, Math.min(100, Math.round(((curPrice - lo60) / (hi60 - lo60)) * 100)))
    : null;
  const pe = finiteOrNull(fund.pe);
  const mcap = finiteOrNull(fund.marketCap);
  const capChip = mcap != null && mcap >= 1e8
    ? (mcap >= 1e12 ? `$${(mcap / 1e12).toFixed(2)}万亿` : `$${Math.round(mcap / 1e8)}亿`)
    : "";
  const symUpper = String(item.code || item.id || "").toUpperCase();
  const guruHit = guruMap ? guruMap.get(symUpper) : null;
  const guruCount = guruHit ? guruHit.count : 0;
  const guruChip = guruCount >= 2 ? `${guruCount}家大师重仓` : (guruCount === 1 ? "大师重仓" : "");
  const shortTag = shortTagFor("us", item.id, item.code);
  const hasRangeBar = lo60 != null && hi60 != null && sortPos60 != null;
  const gm = cleanUsGrossMargin(symUpper, fund.grossMargin);
  const pm = finiteOrNull(fund.profitMargin);
  const roe = finiteOrNull(fund.roe);
  const revG = finiteOrNull(fund.revenueGrowth);
  const ocf = finiteOrNull(fund.operatingCashFlow);
  const rawCapex = finiteOrNull(fund.capitalExpenditures);
  const absCapex = rawCapex != null ? Math.abs(rawCapex) : null;
  const fcf = finiteOrNull(fund.freeCashFlow) != null
    ? finiteOrNull(fund.freeCashFlow)
    : (ocf != null && absCapex != null ? ocf - absCapex : null);
  const cash = finiteOrNull(fund.liquidAssets != null ? fund.liquidAssets : fund.cashAndEquivalents);
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    shortTag,
    guruChip,
    guruCount,
    hasRangeBar,
    lo60Text: lo60 != null ? `$${lo60.toFixed(0)}` : "",
    hi60Text: hi60 != null ? `$${hi60.toFixed(0)}` : "",
    pos60Pct: sortPos60 != null ? sortPos60 : 50,
    posChip: sortPos60 != null ? (sortPos60 <= 25 ? "近3月偏便宜" : (sortPos60 >= 75 ? "近3月偏贵" : "近3月适中")) : "",
    posTone: sortPos60 != null ? (sortPos60 <= 25 ? "cool" : (sortPos60 >= 75 ? "warn" : "plain")) : "plain",
    peChip: pe != null && pe > 0 ? `市盈 ${pe.toFixed(0)}倍` : "",
    capChip,
    gmText: gm != null ? `${gm.toFixed(1)}%` : "—",
    gmBar: gm != null ? Math.max(8, Math.min(100, Math.round(gm))) : 0,
    pmText: pm != null ? `${pm.toFixed(1)}%` : "—",
    roeText: roe != null ? `${roe.toFixed(1)}%` : "—",
    revGText: revG != null ? signedPct(revG, 1) : "—",
    revGTone: revG == null ? "flat" : (revG >= 15 ? "up" : (revG < 0 ? "down" : "flat")),
    ocfText: formatUsdLarge(ocf),
    capexText: absCapex != null ? formatUsdLarge(absCapex) : "—",
    fcfNum: fcf,
    fcfText: fcf != null ? formatUsdLarge(fcf) : "—",
    fcfTone: fcf == null ? "flat" : (fcf > 0 ? "worth" : "down"),
    cashText: formatUsdLarge(cash),
    mcapText: formatUsdLarge(mcap),
    peNumText: pe != null && pe > 0 ? `${pe.toFixed(1)}倍` : "—",
    badgeText: plainLabel(signal.label),
    tone: usTone(signal.tone),
    reason: signal.action,
    asOfText: referenceDateText([raw.asOf]),
    factChips: usFactChips(item, spark),
    isSeven: MAGNIFICENT_SEVEN.includes(symUpper),
    sortPe: pe,
    sortMargin: gm,
    sortGrowth: revG,
    sortPerf60: perf60,
    sortPos60,
    sortMcap: mcap,
    ...usMetrics(item),
    ...spark,
    ...usOrderFields(item, signal),
  };
}

function buildUsSevenCompare(sevenRaw) {
  if (!Array.isArray(sevenRaw) || !sevenRaw.length) return null;
  const pes = sevenRaw.map((r) => (r.sortPe > 0 && r.sortPe < 250 ? r.sortPe : null)).filter((v) => v != null);
  const medPe = medianOf(pes);
  const medGm = medianOf(sevenRaw.map((r) => r.sortMargin));
  const medGrowth = medianOf(sevenRaw.map((r) => r.sortGrowth));
  const totalMcap = sevenRaw.reduce((sum, r) => sum + (r.sortMcap > 0 ? r.sortMcap : 0), 0);
  const benchPills = [
    totalMcap > 0 ? { label: "七巨头总市值", value: formatUsdLarge(totalMcap) } : null,
    medPe != null ? { label: "中位市盈率", value: `${medPe.toFixed(1)}倍` } : null,
    medGm != null ? { label: "中位毛利率", value: `${medGm.toFixed(1)}%` } : null,
    medGrowth != null ? { label: "中位营收增速", value: signedPct(medGrowth, 1) } : null,
  ].filter(Boolean);

  const maxFcf = Math.max(1, ...sevenRaw.map((r) => (r.fcfNum != null ? Math.abs(r.fcfNum) : 0)));
  const rows = sevenRaw.map((r) => {
    const order = r.order;
    let buyGapText = "待更新";
    let buyGapTone = "flat";
    if (order) {
      if (order.noBuy) {
        buyGapText = "暂不低接";
        buyGapTone = "down";
      } else if (order.state === "buy") {
        buyGapText = "已在低位区";
        buyGapTone = "worth";
      } else if (order.buyGapPct > 0) {
        buyGapText = `距低位 ${order.buyGapPct.toFixed(1)}%`;
        buyGapTone = order.buyGapPct <= 6 ? "worth" : "flat";
      }
    }
    const peBetter = medPe != null && r.sortPe > 0 && r.sortPe <= medPe;
    return {
      id: r.id,
      name: shortCompanyName(r.name, r.code, 4),
      code: r.code,
      shortTag: r.shortTag,
      priceText: r.priceText,
      changeText: r.changeText,
      changeTone: r.changeTone,
      peText: r.peNumText,
      peTone: peBetter ? "worth" : (r.sortPe != null && r.sortPe >= 80 ? "down" : "flat"),
      posText: r.sortPos60 != null ? `${r.sortPos60}%分位` : "—",
      posBar: r.sortPos60 != null ? Math.max(6, Math.min(100, Math.round(r.sortPos60))) : 0,
      buyGapText,
      buyGapTone,
      verdictBadge: r.verdictBadge,
      verdictTone: r.verdictTone,
      revGText: r.revGText,
      revGTone: r.revGTone,
      gmText: r.gmText,
      gmBar: r.gmBar,
      pmRoeText: `${r.pmText} / ${r.roeText}`,
      ocfText: r.ocfText,
      capexText: r.capexText,
      fcfText: r.fcfText,
      fcfTone: r.fcfTone,
      fcfBar: r.fcfNum != null ? Math.max(8, Math.min(100, Math.round((Math.abs(r.fcfNum) / maxFcf) * 100))) : 0,
      cashText: r.cashText,
      mcapText: r.mcapText,
      guruText: r.guruCount > 0 ? `${r.guruCount}家大师` : "—",
    };
  });

  return { benchPills, rows };
}

function buildUsModule(snapshot) {
  const items = allItems(snapshot, "us");
  const sevenItems = items.filter((item) => item.group === "seven");
  const hotItems = items.filter((item) => item.group === "hot");
  const sparkCache = new Map();
  const guruMap = buildUsGuruHolderMap(snapshot);

  const sevenRaw = sevenItems.map((item) => usStockRow(item, sparkCache, guruMap));
  const sevenCompare = buildUsSevenCompare(sevenRaw);
  const triggerOrders = sevenRaw.map((r) => r.order).filter(Boolean);
  const triggerTiles = triggerOrders.length ? countTiles(triggerOrders, US_TRIGGERS) : [];
  const sevenList = sevenRaw.map(({ order, ...row }) => ({
    ...row,
    event: eventBrief(snapshot, row.code),
    eventDate: eventFactFor(snapshot, row.code).eventDate || "",
  }));
  const sevenWorth = sevenList.filter((r) => r.verdictTone === "worth");
  const allSevenStale = sevenList.length > 0 && sevenList.every((r) => r.verdictBadge === "数据待更新");
  const answerBar = snapshot.actionsFresh === false || allSevenStale
    ? "美股休市或报价待更新 · 下一交易日收盘后展示参考区间"
    : (sevenWorth.length
      ? `七大巨头 ${sevenWorth.length} 只偏便宜可关注：${sevenWorth.map((r) => r.name).join("、")}`
      : "七大巨头当前均未进低接区，建议等回调至参考区间");
  const sevenHeatmap = buildUsHeatmap(sevenList, "day");
  const labelCounts = new Map();
  sevenList.forEach((item) => {
    const entry = labelCounts.get(item.badgeText) || { label: item.badgeText, tone: item.tone, count: 0 };
    entry.count += 1;
    labelCounts.set(item.badgeText, entry);
  });
  const toneOrder = { worth: 0, caution: 1, avoid: 2 };
  const sevenMix = [...labelCounts.values()].sort((left, right) => (toneOrder[left.tone] ?? 3) - (toneOrder[right.tone] ?? 3));
  const sevenHint = sevenMix.map((entry) => `${entry.count} 家${entry.label}`).join(" · ") || "七姐妹判断待更新";

  const hotHint = hotItems.length
    ? `样本内热度前 ${hotItems.length} 只`
    : "近期没有明显热度突出的美股";

  let _allList = null;
  let _hotList = null;
  let _filingsFeed = null;

  const computeAllList = () => {
    if (_allList) return _allList;
    _allList = usPoolItems(snapshot)
      .map((item) => usStockRow(item, sparkCache, guruMap))
      .sort((left, right) => compareUsOrder(left.order, right.order))
      .map(({ order, ...row }) => row);
    return _allList;
  };

  const computeHotList = () => {
    if (_hotList) return _hotList;
    _hotList = hotItems.map((item) => {
      const baseRow = usStockRow(item, sparkCache, guruMap);
      const raw = item.raw || {};
      const fund = raw.fund || {};
      let takeText = "质量待核";
      let takeTone = "caution";
      if (usQualityEligibility(fund) === true) { takeText = "质量达标"; takeTone = "worth"; }
      else if (usQualityEligibility(fund) === false) { takeText = "质量不达标"; takeTone = "avoid"; }
      const heat = finiteOrNull(raw.heatScore);
      const volRatio = finiteOrNull(raw.volumeRatio);
      return {
        ...baseRow,
        why: item.heatDriver || "",
        event: eventBrief(snapshot, item.code),
        eventDate: eventFactFor(snapshot, item.code).eventDate || "",
        takeText,
        takeTone,
        heatText: heat != null ? String(Math.round(heat)) : "—",
        heatBar: heat != null ? Math.max(12, Math.min(100, Math.round(heat))) : 0,
        volChip: volRatio != null ? `热度 ${volRatio.toFixed(1)}倍` : "",
      };
    });
    return _hotList;
  };

  const computeFilingsFeed = () => {
    if (_filingsFeed) return _filingsFeed;
    const allList = computeAllList();
    const poolByCode = new Map(allList.map((row) => [String(row.code || "").toUpperCase(), row]));
    const rawFilings = Array.isArray(snapshot && snapshot.us && snapshot.us.filings)
      ? snapshot.us.filings
      : [];
    const seenFilingKeys = new Set();
    _filingsFeed = rawFilings
      .filter((entry) => entry && entry.symbol && entry.filingDate)
      .slice()
      .sort((a, b) => String(b.filingDate || "").localeCompare(String(a.filingDate || "")))
      .filter((entry) => {
        const sig = `${String(entry.symbol).toUpperCase()}|${entry.filingDate}|${entry.form || ""}|${(entry.labels || []).join(",")}`;
        if (seenFilingKeys.has(sig)) return false;
        seenFilingKeys.add(sig);
        return true;
      })
      .slice(0, 24)
      .map((entry, idx) => {
        const sym = String(entry.symbol || "").toUpperCase();
        const matched = poolByCode.get(sym);
        const labels = Array.isArray(entry.labels) ? entry.labels.filter(Boolean) : [];
        return {
          key: `sec-${sym}-${entry.filingDate}-${idx}`,
          id: matched ? matched.id : sym,
          name: matched ? shortCompanyName(matched.name, sym, 6) : tickerShortZh(sym, sym),
          code: sym,
          form: entry.form || "8-K",
          formZh: plainSecFormLabel(entry.form),
          date: String(entry.filingDate || ""),
          summary: labels.join(" · ") || "公开备案",
          sourceUrl: entry.sourceUrl || "",
        };
      });
    return _filingsFeed;
  };

  return {
    answerBar,
    triggerTiles,
    sevenList,
    sevenCompare,
    sevenHeatmap,
    sevenHint,
    sevenMix,
    hotHint,
    get allList() { return computeAllList(); },
    get hotList() { return computeHotList(); },
    get filingsFeed() { return computeFilingsFeed(); },
  };
}

// 借鉴 Stock Events：用 5 个颜色圆点展示近 5 个所属年度是否连续稳定派息（绿=稳/增，琥珀=减息，灰=缺记录）。
function buildDividendDots(raw) {
  const detail = getDividendStability(raw);
  const win = Array.isArray(detail.window) ? detail.window : [];
  if (!win.length) return [];
  const changeByYear = new Map((detail.changes || []).map((c) => [c.toYear, c]));
  return win.map((entry) => {
    const yy = String(entry.year || "").slice(-2);
    if (!entry.complete || !(entry.perTenSharesRmb > 0)) {
      return { year: yy, state: "miss" };
    }
    const ch = changeByYear.get(entry.year);
    return { year: yy, state: ch && ch.decreased ? "cut" : "ok" };
  });
}

function aTone(group) {
  if (group === "prime") return "worth";
  if (group === "watch") return "avoid";
  return "caution";
}

function aVerdictFields(raw, stability, fresh) {
  if (!fresh) {
    return {
      verdictBadge: "数据待更新",
      verdictTone: "settled",
      refRangeText: "",
      plan: null,
      order: null,
    };
  }
  const plan = yieldImpliedPlan(raw);
  const order = aOrderState(raw);
  if (!plan || !(plan.price > 0)) {
    return {
      verdictBadge: stability != null && stability >= 75 ? "分红稳 · 区间待核" : "分红待核",
      verdictTone: "caution",
      refRangeText: "",
      plan: null,
      order: null,
    };
  }
  let verdictBadge = stability != null && stability >= 75 ? "分红稳 · 价适中" : "股息适中 · 观察";
  let verdictTone = "caution";
  if (plan.zone === "add") {
    verdictBadge = stability != null && stability >= 75 ? "分红稳 · 偏便宜" : "高股息 · 偏便宜";
    verdictTone = "worth";
  } else if (plan.zone === "trim") {
    verdictBadge = "股价偏高 · 等回调";
    verdictTone = "avoid";
  }
  const gapNote = order && order.state === "buy"
    ? "（已在高息区）"
    : (order && order.buyGapPct > 0 ? `（距低接 ${order.buyGapPct.toFixed(1)}%）` : "");
  return {
    verdictBadge,
    verdictTone,
    refRangeText: `参考区间 ¥${plan.addPrice.toFixed(2)} – ¥${plan.trimPrice.toFixed(2)}${gapNote}`,
    plan,
    order,
  };
}

function aRankedList(items, lens, fresh = true) {
  return items
    .filter((item) => item.lensRank && item.lensRank[lens])
    .sort((left, right) => left.lensRank[lens] - right.lensRank[lens])
    .map((item) => {
      const raw = item.raw || {};
      const historicalYield = getHistoricalDividendYield(raw);
      const stabilityDetail = getDividendStability(raw);
      const stability = stabilityDetail.score != null ? stabilityDetail.score : aShareDividendStability(raw);
      const { verdictBadge, verdictTone, refRangeText, plan } = aVerdictFields(raw, stability, fresh);
      const recordedYears = Array.isArray(stabilityDetail.years) ? stabilityDetail.years.length : 0;
      const metricText = lens === "stable5"
        ? (stability != null ? String(stability) : "—")
        : (historicalYield ? historicalYield.yieldPercent.toFixed(2) : "—");
      const stableParts = [];
      if (recordedYears > 0) stableParts.push(`收录${recordedYears}年分红`);
      if (stabilityDetail.decreaseCount != null) stableParts.push(`近5年${stabilityDetail.decreaseCount}次减息`);
      if (historicalYield) stableParts.push(`股息率 ${historicalYield.yieldPercent.toFixed(2)}%`);
      const yieldParts = [];
      if (historicalYield) yieldParts.push(`${historicalYield.year}年分红 · ${historicalYield.priceAsOf.slice(0, 10)}股价`);
      if (stability != null) yieldParts.push(`稳定度 ${stability}分`);
      // 现价落在「参考买—参考卖」之间的位置；越过两端就钉在端点，颜色标出越界方向。
      let pricePos = null;
      let priceZone = "";
      if (plan && plan.trimPrice > plan.addPrice) {
        const pos = ((plan.price - plan.addPrice) / (plan.trimPrice - plan.addPrice)) * 100;
        pricePos = Math.max(0, Math.min(100, Math.round(pos)));
        priceZone = plan.zone;
      }
      const curPrice = finiteOrNull(raw.currentPrice);
      const annualPer10kText = historicalYield ? `投1万年息 ¥${Math.round(historicalYield.yieldPercent * 100)}` : "";
      const dataChips = [];
      if (lens === "stable5" && historicalYield) dataChips.push(`股息 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (lens !== "stable5" && stability != null) dataChips.push(`稳定度 ${stability}分`);
      if (curPrice != null) dataChips.push(`一手 ¥${Math.round(curPrice * 100).toLocaleString("en-US")}`);
      const spark = historySpark(item, US_SPARK_SIZE);
      return {
        id: item.id,
        rank: item.lensRank[lens],
        name: item.name,
        code: formatACode(item.code, item.id),
        shortTag: shortTagFor("a", item.id, item.code, raw.industry),
        annualPer10kText,
        dataChips,
        ...spark,
        badgeText: item.badge,
        tone: aTone(item.group),
        verdictBadge,
        verdictTone,
        refRangeText,
        metricText,
        metricUnit: lens === "stable5" ? "分" : "%",
        metricLabel: lens === "stable5" ? "稳定性" : "历史股息率",
        stability,
        historicalYield: historicalYield ? historicalYield.yieldPercent : null,
        stableBasis: stableParts.join(" · "),
        yieldBasis: yieldParts.join(" · "),
        yearDots: buildDividendDots(raw),
        buyText: plan ? money(plan.addPrice, "¥") : "待更新",
        sellText: plan ? money(plan.trimPrice, "¥") : "待更新",
        priceText: curPrice != null ? money(curPrice, "¥") : "",
        hasPricePos: pricePos != null,
        pricePos,
        priceLabelPos: pricePos != null ? Math.max(14, Math.min(86, pricePos)) : 0,
        priceZone,
      };
    });
}

function lifeExpenseHint(annualRmb) {
  const amt = Number(annualRmb);
  if (!Number.isFinite(amt) || amt <= 0) return "";
  if (amt < 500) return "约抵大半年话费";
  if (amt < 1200) return "约抵全年手机话费";
  if (amt < 3000) return "约抵全年水电燃气费";
  if (amt < 6000) return "约抵全年小区物业费";
  if (amt < 15000) return "约抵全家一趟年度旅行";
  return `月均约领 ¥${Math.round(amt / 12).toLocaleString("en-US")} 买菜零花`;
}

function buildLifeSummaryLine(list, wan = 1) {
  const yields = (Array.isArray(list) ? list : [])
    .map((r) => (r.historicalYield != null ? r.historicalYield : r.sortYield))
    .filter((v) => v != null && Number.isFinite(v) && v > 0);
  if (!yields.length) return "";
  const avgY = yields.reduce((s, v) => s + v, 0) / yields.length;
  const annual = Math.round(avgY * 100 * wan);
  const life = lifeExpenseHint(annual);
  return `投${wan}万均领 ¥${annual.toLocaleString("en-US")}/年${life ? ` · ${life}` : ""}`;
}

function formatPrincipalIncome(yieldPct, wan = 1) {
  if (!Number.isFinite(yieldPct) || yieldPct <= 0) return "";
  const annual = Math.round(yieldPct * 100 * wan);
  if (wan <= 1) return `投1万年息 ¥${annual.toLocaleString("en-US")}`;
  const monthly = Math.round(annual / 12);
  return `投${wan}万年领 ¥${annual.toLocaleString("en-US")} · 月均 ¥${monthly.toLocaleString("en-US")}`;
}

function withPrincipalWan(list, wan = 1) {
  return (Array.isArray(list) ? list : []).map((row) => {
    const y = row.historicalYield != null ? row.historicalYield : row.sortYield;
    return {
      ...row,
      annualPer10kText: y != null ? formatPrincipalIncome(y, wan) : row.annualPer10kText,
    };
  });
}

function extractRecentAnnualDistributions(raw) {
  const hist = Array.isArray(raw && raw.financials && raw.financials.dividendHistory)
    ? raw.financials.dividendHistory
    : [];
  const all = [];
  for (const yr of hist) {
    const dists = Array.isArray(yr && yr.distributions) ? yr.distributions : [];
    for (const d of dists) {
      const exDate = String((d && d.exDividendDate) || "").trim();
      const perTen = finiteOrNull(d && d.perTenSharesRmb);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate) || !(perTen > 0)) continue;
      const stamp = Date.parse(`${exDate}T00:00:00Z`);
      if (!Number.isFinite(stamp)) continue;
      const basis = String((d && d.reportBasis) || "");
      const periodKind = /-12-31$/.test(basis)
        ? "final"
        : (/-06-30$/.test(basis)
          ? "interim"
          : (/-09-30$/.test(basis) ? "q3" : (/-03-31$/.test(basis) ? "q1" : `m${Number(exDate.slice(5, 7))}`)));
      all.push({
        exDate,
        stamp,
        month: Number(exDate.slice(5, 7)),
        periodKind,
        perTen,
        plan: String((d && d.plan) || `10派${perTen.toFixed(2)}元`).replace(/\(.*?\)|（.*?）/g, "").trim(),
      });
    }
  }
  if (!all.length) return [];
  all.sort((a, b) => b.stamp - a.stamp);
  const maxStamp = all[0].stamp;
  const cutoff = maxStamp - 365 * 86400000;
  const byMonth = new Map();
  const seenKind = new Set();
  for (const entry of all) {
    if (entry.stamp < cutoff) break;
    if (seenKind.has(entry.periodKind) || byMonth.has(entry.month)) continue;
    seenKind.add(entry.periodKind);
    byMonth.set(entry.month, entry);
  }
  return [...byMonth.values()].sort((a, b) => a.month - b.month);
}

function buildADividendCalendar(items) {
  const byMonth = new Map();
  for (let m = 1; m <= 12; m += 1) byMonth.set(m, []);
  let multiCount = 0;
  for (const item of items) {
    const raw = item.raw || {};
    if (raw.assetType === "fund") continue;
    const dists = extractRecentAnnualDistributions(raw);
    if (!dists.length) continue;
    if (dists.length >= 2) multiCount += 1;
    const freqLabel = dists.length >= 3 ? `一年${dists.length}派` : (dists.length === 2 ? "一年2派" : "一年1派");
    const price = finiteOrNull(raw.currentPrice);
    for (const d of dists) {
      const dps = d.perTen / 10;
      const singleYieldPct = price != null && price > 0 ? (dps / price) * 100 : null;
      byMonth.get(d.month).push({
        key: `${item.id}-${d.exDate}`,
        id: item.id,
        name: shortCompanyName(item.name, item.code, 6),
        code: formatACode(item.code, item.id),
        freqLabel,
        isMulti: dists.length >= 2,
        exDate: d.exDate,
        planShort: d.plan || `10派${d.perTen.toFixed(2)}元`,
        dps,
        price,
        singleYieldPct,
      });
    }
  }
  const months = [];
  let coveredMonths = 0;
  for (let m = 1; m <= 12; m += 1) {
    const rows = byMonth.get(m);
    rows.sort((a, b) => (b.singleYieldPct ?? 0) - (a.singleYieldPct ?? 0));
    if (rows.length > 0) coveredMonths += 1;
    months.push({
      month: m,
      label: `${m}月`,
      count: rows.length,
      countText: rows.length ? `${rows.length}只` : "无",
      tone: rows.length >= 4 ? "rich" : (rows.length > 0 ? "has" : "empty"),
    });
  }
  const curMonth = new Date().getMonth() + 1;
  let defaultMonth = curMonth;
  if (!(byMonth.get(defaultMonth) || []).length) {
    const upcoming = months.find((x) => x.month > curMonth && x.count > 0) || months.find((x) => x.count > 0);
    if (upcoming) defaultMonth = upcoming.month;
  }
  const counts12 = months.map((x) => x.count);
  const summaryText = `全年 ${coveredMonths} 个派息月 · ${multiCount} 只一年多派`;
  return {
    months,
    byMonth,
    defaultMonth,
    summaryText,
    chartSrcFor(activeM) {
      return monthDensitySvg(counts12, { activeMonth: activeM });
    },
  };
}

function formatCalendarRows(rows, wan = 1) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    let cashNote = "";
    if (r.price != null && r.price > 0 && r.dps > 0) {
      const cash = Math.round(((wan * 10000) / r.price) * r.dps);
      cashNote = `投${wan}万单次约领 ¥${cash.toLocaleString("en-US")}`;
    }
    return {
      ...r,
      cashNote,
    };
  });
}

// 指标条按榜内最大值归一：稳定性满分 100，股息率按榜首那只画满。
function withMetricBars(list, lens) {
  const values = list.map((item) => (lens === "stable5" ? item.stability : item.historicalYield)).filter((value) => value != null);
  const max = lens === "stable5" ? 100 : Math.max(...values, 1e-6);
  return list.map((item) => {
    const value = lens === "stable5" ? item.stability : item.historicalYield;
    return { ...item, metricBar: value != null ? Math.max(4, Math.round((value / max) * 100)) : 0 };
  });
}

// 组合全量 20 只 A 股收息股池（不改动 allItems(snapshot,'a') 的精选样本边界，让「全部20只」「派息月历」「热力图」真正覆盖全部 20 只股票）。
function aFullStockPool(snapshot) {
  const curated = allItems(snapshot, "a");
  const byId = new Map();
  for (const item of curated) {
    if (item && item.id && !(item.raw && item.raw.assetType === "fund")) {
      byId.set(String(item.id), item);
    }
  }
  for (const quote of (snapshot && snapshot.aShare && snapshot.aShare.quotes) || []) {
    const cleanId = String((quote && quote.code) || "").replace(/\.(SH|SZ)$/i, "");
    if (!cleanId || byId.has(cleanId)) continue;
    const resolved = findItem(snapshot, "a", quote.code);
    if (resolved) {
      if (resolved.raw && !resolved.raw.historicalDividendYield) {
        resolved.raw.historicalDividendYield = getHistoricalDividendYield(resolved.raw);
      }
      byId.set(cleanId, resolved);
    }
  }
  return [...byId.values()];
}

// 前五只展示名字和对应分红指标，其余页签按需懒计算，首屏仅算 5 条。
function buildAModule(snapshot) {
  const items = allItems(snapshot, "a");
  const fullStocks = aFullStockPool(snapshot);
  const fresh = snapshot.actionsFresh !== false;
  const stableList = withMetricBars(aRankedList(items, "stable5", fresh), "stable5");
  let _yieldList = null;
  let _allPack = null;
  let _fund = undefined;
  let _calendar = null;
  const ensureAll = () => {
    if (!_allPack) _allPack = aAllModule(fullStocks, fresh);
    return _allPack;
  };
  const ensureCalendar = () => {
    if (!_calendar) _calendar = buildADividendCalendar(fullStocks);
    return _calendar;
  };
  const sectorBuckets = [
    { key: "bank", label: "银行金融", re: /银行|金融/u, color: "#1d5fd1", count: 0 },
    { key: "util", label: "公用交通", re: /水电|电力|火电|通信|高速|铁路|公用/u, color: "#0f9f6e", count: 0 },
    { key: "res", label: "能源材料", re: /煤炭|油气|石油|石化|钢铁|建材|水泥|能源/u, color: "#d97706", count: 0 },
    { key: "mfg", label: "家电制造", re: /家电|制造|白电/u, color: "#6366f1", count: 0 },
  ];
  for (const st of fullStocks) {
    const ind = String(st?.raw?.industry || st?.raw?.financials?.industry || "");
    const hit = sectorBuckets.find((b) => b.re.test(ind)) || sectorBuckets[1];
    hit.count += 1;
  }
  const activeSectors = sectorBuckets.filter((b) => b.count > 0);
  const sectorDonut = activeSectors.length >= 2 ? {
    src: donutSvg(activeSectors.map((b) => ({ value: b.count, color: b.color })), { size: 120, strokeWidth: 22 }),
    centerMain: `${fullStocks.length}只`,
    legend: activeSectors.map((b) => ({ key: b.key, label: b.label, countText: `${b.count}只`, color: b.color })),
  } : null;

  const cheapNames = fresh
    ? fullStocks
      .filter((it) => {
        const p = yieldImpliedPlan(it.raw);
        return p && p.zone === "add";
      })
      .map((it) => it.name)
    : [];
  const answerBar = !fresh
    ? "数据待更新 · 暂不展示参考区间"
    : (cheapNames.length
      ? `20 只收息股 · 高息偏便宜 ${cheapNames.length} 只：${cheapNames.slice(0, 3).join("、")}`
      : `${fullStocks.length} 只收息股 · 优选 5 年连续稳分红`);
  return {
    answerBar,
    sectorDonut,
    stableList,
    get yieldList() {
      if (!_yieldList) _yieldList = withMetricBars(aRankedList(items, "yield5", fresh), "yield5");
      return _yieldList;
    },
    get allList() { return ensureAll().allList; },
    get triggerTiles() { return ensureAll().triggerTiles; },
    get calendar() { return ensureCalendar(); },
    get fund() {
      if (_fund === undefined) {
        const fundItem = items.find((item) => item.raw && item.raw.assetType === "fund");
        _fund = fundItem ? aFundView(fundItem) : null;
      }
      return _fund;
    },
  };
}

// 「全部」：每只股票（红利 ETF 在下面单独一张卡）现价离参考买入/卖出价多远，
// 到价的排最上面。参考价跟详情页、榜单每行同一个 yieldImpliedPlan。
// 数据过期时现价是旧的，不说「已到」，整条参考价和顶上两格都不显示。
function aAllModule(items, fresh) {
  const rows = items
    .filter((item) => !(item.raw && item.raw.assetType === "fund"))
    .map((item) => {
      const raw = item.raw || {};
      const historicalYield = getHistoricalDividendYield(raw);
      const stabilityDetail = getDividendStability(raw);
      const stability = stabilityDetail.score != null ? stabilityDetail.score : aShareDividendStability(raw);
      const { verdictBadge, verdictTone, refRangeText, order } = aVerdictFields(raw, stability, fresh);
      const line = aOrderLine(order);
      const price = finiteOrNull(raw.currentPrice);
      const change = finiteOrNull(raw.changePercent);
      const factParts = [];
      if (historicalYield) factParts.push(`股息率 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (stability != null) factParts.push(`稳定度 ${stability}分`);
      const annualPer10kText = historicalYield ? `投1万年息 ¥${Math.round(historicalYield.yieldPercent * 100)}` : "";
      const dataChips = [];
      if (historicalYield) dataChips.push(`股息 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (price != null) dataChips.push(`一手 ¥${Math.round(price * 100).toLocaleString("en-US")}`);
      const spark = historySpark(item, US_SPARK_SIZE);
      return {
        order,
        id: item.id,
        name: item.name,
        code: formatACode(item.code, item.id),
        shortTag: shortTagFor("a", item.id, item.code, raw.industry),
        annualPer10kText,
        dataChips,
        factSummary: factParts.join(" · "),
        yearDots: buildDividendDots(raw),
        ...spark,
        sortYield: historicalYield ? historicalYield.yieldPercent : null,
        sortStability: stability != null ? Number(stability) : null,
        sortCuts: stabilityDetail.decreaseCount,
        sortChange: change,
        badgeText: item.badge,
        tone: aTone(item.group),
        verdictBadge,
        verdictTone,
        refRangeText,
        priceText: price != null ? money(price, "¥") : "—",
        asOfText: referenceDateText([raw.priceAsOf || raw.asOf]),
        changeText: signedPct(change, 2),
        changeTone: change == null ? "flat" : (change >= 0 ? "up" : "down"),
        hasOrder: Boolean(order),
        orderTone: line ? line.tone : "",
        orderLabel: line ? line.label : "",
        orderValue: line ? line.value : "",
        orderNote: line ? line.note : "",
      };
    })
    .sort((left, right) => compareAOrder(left.order, right.order));
  const orders = rows.map((row) => row.order);
  return {
    allList: rows.map(({ order, ...row }) => row),
    triggerTiles: orders.some(Boolean) ? countTiles(orders, A_TRIGGERS) : [],
  };
}

// 红利 ETF：大字现价 + 今日涨跌 + 90 日走势线；跟踪指数和年费率（管理费+托管费相加）
// 缩成底下一行小字。
function aFundView(item) {
  const raw = item.raw || {};
  const price = finiteOrNull(raw.currentPrice);
  const change = finiteOrNull(raw.changePercent);
  const fees = String(raw.expenseRatio || "").match(/\d+(?:\.\d+)?(?=%)/g) || [];
  const feeTotal = fees.reduce((sum, value) => sum + Number(value), 0);
  const stats = [
    { label: "跟踪", value: String(raw.trackingIndex || "—").replace(/指数$/, "") },
    { label: "年费率", value: fees.length ? `${feeTotal.toFixed(2)}%` : "—" },
  ];
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    badgeText: item.badge || "红利ETF",
    // 大字旁边两个百分比，一个是今天、一个是近 N 日，不写明就分不清哪个是哪个。
    priceText: price != null ? `¥${price.toFixed(3)}` : "—",
    asOfText: referenceDateText([raw.priceAsOf || raw.asOf]),
    changeText: change != null ? `报价日 ${signedPct(change, 2)}` : "",
    changeTone: toneOf(change || 0),
    stats,
    ...historySpark(item, A_FUND_SPARK_SIZE),
  };
}

// 黄金追踪原型默认币种是人民币金，这里改成国际金——国际金有180天真实收盘价
// 能画出有意义的走势图，人民币金只有2天真实数据，画不出图，让用户先看数据
// 撑得起的口径。原型的「1年」周期也改叫「全部」：国际金历史目前不到一年，
// 编一个「1年」标签但只有180天数据，是拿数据长度撒谎。
// 「1月」「3月」会被看成一月份、三月份，写成「1个月」「3个月」。
const GOLD_PERIODS = [
  { id: "month", label: "1个月", months: 1 },
  { id: "quarter", label: "3个月", months: 3 },
  { id: "all", label: "全部" },
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

// 观察区间条：风险下沿、观察低位、观察上沿三个研究价位和现价画在同一根轴上，
// 现价落在哪一段一眼可见——取代原来两张价位卡 + 一句「现价 X，仍在观察低位」。
function goldLadder(price, watch, upper, risk, digits) {
  const current = finiteOrNull(price);
  const watchLow = finiteOrNull(watch?.low ?? watch?.high);
  const watchHigh = finiteOrNull(watch?.high ?? watch?.low);
  const upperLow = finiteOrNull(upper?.low ?? upper?.high);
  const upperHigh = finiteOrNull(upper?.high ?? upper?.low);
  const riskLow = finiteOrNull(risk?.low ?? risk?.high);
  if (current == null || watchLow == null || upperLow == null) return null;
  const points = [current, watchLow, watchHigh, upperLow, upperHigh, riskLow].filter((value) => value != null);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const pad = (max - min) * 0.06 || 1;
  const lo = min - pad;
  const span = max + pad - lo;
  const at = (value) => Math.round(((value - lo) / span) * 1000) / 10;
  const priceLeft = at(current);
  // 每格底下一句现价离这条线多远（再跌/再涨几%、现价在内、已到），口径以现价为底。
  const notes = goldLevelNotes(current, watchLow, watchHigh, upperLow, riskLow);
  const note = (key) => ({ note: notes[key] ? notes[key].text : "", noteTone: notes[key] ? notes[key].tone : "" });
  return {
    watchLeft: at(watchLow),
    watchWidth: Math.max(1.5, at(watchHigh) - at(watchLow)),
    upperLeft: at(upperLow),
    upperWidth: Math.max(1.5, at(upperHigh) - at(upperLow)),
    hasRisk: riskLow != null,
    riskLeft: riskLow != null ? at(riskLow) : 0,
    priceLeft,
    priceLabelLeft: Math.max(12, Math.min(88, priceLeft)),
    priceText: current.toFixed(digits),
    tiles: [
      { key: "risk", label: "风险下沿", value: riskLow != null ? riskLow.toFixed(digits) : "—", ...note("risk") },
      { key: "watch", label: "观察低位", value: goldRangeText(watch, digits) || "—", ...note("watch") },
      { key: "upper", label: "观察上沿", value: goldRangeText(upper, digits) || "—", ...note("upper") },
    ],
  };
}

// 这张大图带切周期/币种，仍用 Canvas 2D 自己画（paintGoldLineChart）；
// 详情页和首页的折线已改成 utils/sparkline.js 的 SVG 图片。
// canvasId 固定不变（这块画布切周期/币种时不会被 wx:if 销毁重建，只是重新画），
// 每次数据变化后由 drawGoldChart() 重新 paint。
function goldLineChart(history, digits, source) {
  const values = history.map((entry) => entry.close);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const change = ((latest - values[0]) / values[0]) * 100;
  const rangePos = high > low ? Math.max(0, Math.min(100, Math.round(((latest - low) / (high - low)) * 100))) : 50;
  const rangeMood = rangePos <= 25 ? "靠近区间低位" : (rangePos >= 75 ? "靠近区间高位" : "处于区间中段");
  const rangeTone = rangePos <= 25 ? "cool" : (rangePos >= 75 ? "warn" : "flat");
  const posLabel = rangePos <= 25 ? "区间偏低" : (rangePos >= 75 ? "区间偏高" : "区间居中");
  return {
    canvasId: "gold-price-line",
    values,
    changeText: `区间 ${signedPct(change, 1)}`,
    changeTone: change > 0 ? "up" : change < 0 ? "down" : "flat",
    dateText: `${history[0].date} 至 ${history[history.length - 1].date}`,
    source,
    lowLabel: `最低 ${low.toFixed(digits)}`,
    latestLabel: `期末 ${latest.toFixed(digits)}`,
    highLabel: `最高 ${high.toFixed(digits)}`,
    rangePos,
    posLabel,
    rangeMood,
    rangeTone,
  };
}

function goldPeriodCharts(series, digits) {
  const chartsByPeriod = {};
  const last = series.rows[series.rows.length - 1];
  if (!last) return { chartsByPeriod, periods: [] };
  const periods = GOLD_PERIODS.filter((period) => {
    let rows = series.rows;
    if (period.months) {
      const cutoff = new Date(`${last.date}T00:00:00Z`);
      const endDay = cutoff.getUTCDate();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - period.months, 1);
      const monthDays = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
      cutoff.setUTCDate(Math.min(endDay, monthDays));
      const firstDay = cutoff.toISOString().slice(0, 10);
      rows = rows.filter((row) => row.date >= firstDay);
    }
    const chart = goldLineChart(rows, digits, series.source);
    if (!chart) return false;
    chartsByPeriod[period.id] = chart;
    return true;
  }).map(({ id, label }) => ({ id, label }));
  return { chartsByPeriod, periods };
}

// 画法：先描浅色网格线，再用二次贝塞尔
// 让折线带一点自然的圆滑弧度，填充渐变色，最后描高/低点和最新点。
function paintGoldLineChart(ctx, width, height, values) {
  ctx.clearRect(0, 0, width, height);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1e-6);
  const padTop = 10, padBottom = 4, padX = 2;
  const plotH = height - padTop - padBottom;
  const plotW = width - padX * 2;
  const stepX = plotW / (values.length - 1);
  const xAt = (i) => padX + i * stepX;
  const yAt = (v) => padTop + (1 - (v - low) / span) * plotH;

  ctx.strokeStyle = "#e3e6ec";
  ctx.lineWidth = 1;
  [0.33, 0.66].forEach((f) => {
    const y = padTop + plotH * f;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
  });

  const pts = values.map((v, i) => [xAt(i), yAt(v)]);
  function tracePath() {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }

  ctx.beginPath();
  tracePath();
  const gradient = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
  gradient.addColorStop(0, "rgba(217, 119, 6, 0.22)");
  gradient.addColorStop(1, "rgba(217, 119, 6, 0)");
  ctx.lineTo(pts[pts.length - 1][0], height - padBottom);
  ctx.lineTo(pts[0][0], height - padBottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  tracePath();
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  function dot(i, color, radius) {
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  dot(values.indexOf(high), "#b45309", 2.6);
  dot(values.indexOf(low), "#94a3b8", 2.6);

  const lastIdx = pts.length - 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = "rgba(217, 119, 6, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[lastIdx][0], pts[lastIdx][1]);
  ctx.lineTo(pts[lastIdx][0], height - padBottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(pts[lastIdx][0], pts[lastIdx][1], 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(217, 119, 6, 0.2)";
  ctx.fill();
  dot(lastIdx, "#d97706", 3);
}

function plainGoldZone(zoneLabel, fresh) {
  if (!fresh) return "数据待更新";
  const z = String(zoneLabel || "");
  if (z.includes("低位")) return "偏低关注区";
  if (z.includes("上沿")) return "偏高分批区";
  if (z.includes("风险下沿")) return "跌破警戒位";
  return "中间观察区";
}

function buildGoldModule(snapshot) {
  const gold = snapshot.gold || {};
  const answer = gold.answer || {};
  const freshGold = snapshot.actionsFresh !== false && gold.actionsFresh !== false;
  const plan = goldPlanView(answer.pricePlan);
  const international = gold.quotes?.international || {};
  const domestic = domesticGoldClose(snapshot) || {};

  const intlZone = goldZoneForPrice(international.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk);
  const cnyZone = goldZoneForPrice(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk);
  const intlWatchText = freshGold && plan.internationalWatch ? `关注区间 $${goldRangeText(plan.internationalWatch, 0)}` : "";
  const domWatchText = freshGold && plan.domesticWatch ? `关注区间 ¥${goldRangeText(plan.domesticWatch, 0)}/克` : "";

  const intlChange = finiteOrNull(international.changePercent);
  const domChange = finiteOrNull(domestic.changePercent);
  const quotes = [
    {
      id: "usd",
      label: "国际金价",
      code: "纽约期金",
      priceText: hasNumber(international.price) ? Number(international.price).toFixed(0) : "待更新",
      unit: "美元 / 盎司",
      asOfText: referenceDateText([international.asOf]),
      changeText: intlChange != null ? signedPct(intlChange, 2) : "",
      changeTone: intlChange == null ? "flat" : (intlChange >= 0 ? "up" : "down"),
      verdictBadge: plainGoldZone(intlZone.label, freshGold && Boolean(plan.internationalWatch)),
      verdictTone: freshGold && plan.internationalWatch ? goldTone(intlZone.tone) : "settled",
      watchRangeText: intlWatchText,
    },
    {
      id: "cny",
      label: "国内上海金",
      code: "上金所",
      priceText: hasNumber(domestic.price) ? Number(domestic.price).toFixed(2) : "待更新",
      unit: "元 / 克",
      asOfText: referenceDateText([domestic.asOf], "收盘"),
      changeText: domChange != null ? signedPct(domChange, 2) : "",
      changeTone: domChange == null ? "flat" : (domChange >= 0 ? "up" : "down"),
      verdictBadge: plainGoldZone(cnyZone.label, freshGold && Boolean(plan.domesticWatch)),
      verdictTone: freshGold && plan.domesticWatch ? goldTone(cnyZone.tone) : "settled",
      watchRangeText: domWatchText,
    },
  ];

  const perCurrency = {
    usd: {
      currencyLabel: "国际金 · 美元 / 盎司",
      zoneLabel: intlZone.label,
      zoneTone: goldTone(intlZone.tone),
      ladder: goldLadder(international.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk, 0),
      ...goldPeriodCharts(historicalGoldSeries(snapshot, "international"), 0),
      chartNote: "国际金收盘资料不足",
    },
    cny: {
      currencyLabel: "人民币金 · 元 / 克",
      zoneLabel: cnyZone.label,
      zoneTone: goldTone(cnyZone.tone),
      ladder: goldLadder(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk, 1),
      ...goldPeriodCharts(historicalGoldSeries(snapshot, "domestic"), 2),
      chartNote: "人民币金收盘资料待核验",
    },
  };

  const fxPrice = finiteOrNull(gold.quotes?.usdCny?.price);
  const etf = gold.quotes?.etf || {};
  const etfPrice = finiteOrNull(etf.price);
  const etfChange = finiteOrNull(etf.changePercent);
  const convertedGram = (hasNumber(international.price) && fxPrice != null && fxPrice > 0)
    ? (Number(international.price) * fxPrice) / 31.1034768
    : null;
  const compareTiles = [
    convertedGram != null ? {
      key: "conv",
      label: "国际金折算",
      value: `¥${convertedGram.toFixed(1)}/克`,
      sub: `汇率 ${fxPrice.toFixed(2)}`,
    } : null,
    hasNumber(domestic.price) ? {
      key: "sge",
      label: "上海金收盘",
      value: `¥${Number(domestic.price).toFixed(2)}/克`,
      sub: domestic.asOf ? `${String(domestic.asOf).slice(5)} 收盘` : "上金所",
    } : null,
    etfPrice != null ? {
      key: "gld",
      label: "美股黄金基金",
      value: `$${etfPrice.toFixed(1)}`,
      sub: etfChange != null ? `单日 ${signedPct(etfChange, 1)}` : "黄金ETF",
    } : null,
  ].filter(Boolean);

  const domPriceNum = finiteOrNull(domestic.price);
  let spreadBadge = "";
  if (convertedGram != null && domPriceNum != null && convertedGram > 0) {
    const diff = domPriceNum - convertedGram;
    const diffPct = (diff / convertedGram) * 100;
    spreadBadge = `上海金较国际折算 ${diff >= 0 ? "+" : "-"}¥${Math.abs(diff).toFixed(1)}/克（${signedPct(diffPct, 1)}）`;
  }
  const intlRows = historicalGoldSeries(snapshot, "international").rows || [];
  const intlCloses = intlRows.map((r) => finiteOrNull(r.close)).filter((v) => v != null && v > 0);
  const returnPills = [];
  if (intlCloses.length >= 6) {
    const lastC = intlCloses[intlCloses.length - 1];
    for (const [days, label] of [[5, "近5日"], [20, "近20日"], [60, "近60日"]]) {
      if (intlCloses.length >= days) {
        const baseC = intlCloses[intlCloses.length - days];
        if (baseC > 0) {
          const pct = ((lastC - baseC) / baseC) * 100;
          returnPills.push({ label, valueText: signedPct(pct, 1), tone: pct > 0.05 ? "up" : (pct < -0.05 ? "down" : "flat") });
        }
      }
    }
  }

  const answerBar = !freshGold
    ? "数据待更新 · 暂不展示黄金参考区间"
    : `国际金当前处于${plainGoldZone(intlZone.label, true)}${intlWatchText ? ` · ${intlWatchText}` : ""}`;

  return { answerBar, quotes, perCurrency, parityLine: "", compareTiles, spreadBadge, returnPills };
}

// 币种/周期切换只在这两个预计算好的结构里挑数据，不重新访问快照或重算——
// 和 resolveHkExitSelection 同一个思路。
function resolveGoldView(goldModule, currency, periodId) {
  if (!goldModule) {
    return {
      badgeText: "", zoneTone: "caution", currencyLabel: "", periods: [], period: periodId,
      chart: null, chartNote: "", ladder: null,
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
    ladder: cur.ladder,
  };
}

// 持仓表中文名优先：能识别中文简称直接写「苹果」「美国运通」「腾讯控股」，代码单独放右侧蓝色胶囊。
const HAS_HAN = /[\u4e00-\u9fa5]/u;
function guruHoldingName(holding) {
  if (!holding) return holdingLabel(holding);
  const suffix = instrumentSuffix(holding.putCall);
  const shortZh = tickerShortZh(holding.ticker, holding.issuer || holding.name);
  if (shortZh && (HAS_HAN.test(shortZh) || shortZh.toUpperCase() !== String(holding.ticker || "").trim().toUpperCase())) {
    return `${shortZh}${suffix}`;
  }
  const byName = tickerShortZh(holding.issuer || holding.name || "");
  if (byName && HAS_HAN.test(byName)) return `${byName}${suffix}`;
  return holdingLabel(holding);
}

// 「机构持仓」跟随原型的「共同方向/机构持仓」两个视图，数据全部来自
// smartMoneyItems（今日答案同一份 profiles）和 buildGuruTrend（未来持仓
// 趋势同一份季度加减仓聚合），不新起一套计算。
function buildStockLinkResolver(snapshot) {
  const usSet = new Set(((snapshot && snapshot.us && snapshot.us.stocks) || []).map((s) => String(s.symbol || "").toUpperCase()));
  const aCodeSet = new Set();
  const aNameMap = new Map();
  for (const q of (snapshot && snapshot.aShare && snapshot.aShare.quotes) || []) {
    const clean = String((q && q.code) || "").replace(/\.(SH|SZ)$/i, "").toUpperCase();
    if (!clean) continue;
    aCodeSet.add(clean);
    if (q.name) aNameMap.set(String(q.name).trim(), clean);
  }
  return (rawTicker, displayName) => {
    const sym = String(rawTicker || "").trim().toUpperCase().replace(/\.(SH|SZ|US)$/i, "");
    if (sym && usSet.has(sym)) return { linkMarket: "us", linkId: sym };
    if (sym === "GOOG" && usSet.has("GOOGL")) return { linkMarket: "us", linkId: "GOOGL" };
    if (sym && aCodeSet.has(sym)) return { linkMarket: "a", linkId: sym };
    const cleanDisp = String(displayName || "").replace(/（.*?）|\(.*?\)|看跌|看涨/g, "").trim();
    if (cleanDisp && aNameMap.has(cleanDisp)) return { linkMarket: "a", linkId: aNameMap.get(cleanDisp) };
    return { linkMarket: "", linkId: "" };
  };
}

function guruTrendRow(row, resolveLink) {
  const counts = { up: 0, new: 0, down: 0, exit: 0 };
  for (const entry of [...row.adders, ...row.cutters]) counts[entry.type] += 1;
  const badge = [["up", "增持"], ["new", "新进"], ["down", "减持"], ["exit", "清仓"]]
    .filter(([type]) => counts[type] > 0)
    .map(([type, label]) => `${counts[type]}家${label}`)
    .join(" · ");
  const tone = row.adders.length && row.cutters.length ? "caution" : (row.adders.length ? "worth" : "avoid");
  const label = tickerShortZh(row.symbol || row.name, row.issuer) || tickerZhLabel(row.name || row.symbol, row.issuer) || "待更新";
  const rawSym = String(row.symbol || "").trim().toUpperCase();
  const code = /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(rawSym) && label.toUpperCase() !== rawSym && !label.includes(rawSym) ? rawSym : "";
  const link = typeof resolveLink === "function" ? resolveLink(rawSym, label) : { linkMarket: "", linkId: "" };
  const addTotal = row.adders.length;
  const cutTotal = row.cutters.length;
  const moveSum = Math.max(1, addTotal + cutTotal);
  const addWidth = Math.round((addTotal / moveSum) * 100);
  const cutWidth = 100 - addWidth;
  return { key: row.symbol || row.name, label, code, tone, badge, addWidth, cutWidth, ...link };
}

function guruTrendRowsFrom(trend, resolveLink) {
  if (!trend) return [];
  const picked = [
    ...(trend.consensusAdds || []).slice(0, 2),
    ...(trend.split || []).slice(0, 1),
    ...(trend.consensusCuts || []).slice(0, 2),
  ];
  // 没有 2 家以上同向的，就诚实展示单家的加/减各一条，不硬凑「共识」。
  const rows = picked.length ? picked : [...(trend.adds || []).slice(0, 1), ...(trend.cuts || []).slice(0, 1)];
  return rows.map((r) => guruTrendRow(r, resolveLink));
}

function hasAdjacentGuruReports(investor) {
  const match = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(investor?.reportDate || "");
  if (!match) return false;
  const [, year, quarterEnd] = match;
  if (quarterEnd === "03-31") return investor.previousReportDate === `${Number(year) - 1}-12-31`;
  const previousQuarterEnd = { "06-30": "03-31", "09-30": "06-30", "12-31": "09-30" }[quarterEnd];
  return investor.previousReportDate === `${year}-${previousQuarterEnd}`;
}

// 报告期"2026-06-30" → "26年2季"，8 期历史挤在一条横向图表里，完整日期放不下；
// 「26Q2」是行内缩写，读者不认。
function guruQuarterLabel(reportDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(reportDate || ""));
  if (!match) return reportDate || "待更新";
  const quarter = Math.ceil(Number(match[2]) / 3);
  return `${match[1].slice(2)}年${quarter}季`;
}

// 机构持仓规模用"亿/万亿"这类中文财经媒体惯用单位，不是原始美元/人民币数字。
function guruFundSizeText(value, currency) {
  if (!Number.isFinite(Number(value))) return "暂缺";
  const amount = Number(value);
  const trim = (text) => String(text).replace(/\.0$/, "");
  if (Math.abs(amount) >= 1e12) return `${currency}${trim((amount / 1e12).toFixed(2))}万亿`;
  if (Math.abs(amount) >= 1e8) return `${currency}${trim((amount / 1e8).toFixed(1))}亿`;
  if (Math.abs(amount) >= 1e4) return `${currency}${trim((amount / 1e4).toFixed(1))}万`;
  return `${currency}${amount.toFixed(0)}`;
}

// history 按 reportDate 逆序存放（最新在前），图表按时间从左到右读，先转成正序。
function guruHistoryChart(history, currency) {
  const rows = (history || []).filter((row) => row && Number.isFinite(Number(row.portfolioValue)));
  if (rows.length < 2) return null;
  const chronological = [...rows].reverse();
  const values = chronological.map((row) => Number(row.portfolioValue));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const span = Math.max(high - low, 1);
  return {
    columns: chronological.map((row, index) => {
      const value = values[index];
      const isLatest = index === values.length - 1;
      const isHigh = value === high;
      const isLow = value === low;
      return {
        id: `${index}-${row.reportDate}`,
        label: guruQuarterLabel(row.reportDate),
        height: Math.round(16 + ((value - low) / span) * 84),
        tone: isLatest ? "latest" : (isHigh ? "peak" : (isLow ? "floor" : "")),
      };
    }),
    lowLabel: `最低 ${guruFundSizeText(low, currency)}`,
    latestLabel: `最新 ${guruFundSizeText(latest, currency)}`,
    highLabel: `最高 ${guruFundSizeText(high, currency)}`,
  };
}

// 图表只画持仓规模的形状，具体每期的持仓数/新增清仓数还是要靠表格给准确数字。
function guruHistoryRows(history, currency) {
  return (history || []).map((row) => {
    const hasNew = Number.isFinite(Number(row.newCount));
    const hasSold = Number.isFinite(Number(row.soldCount));
    return {
      key: row.reportDate || `${Math.random()}`,
      period: guruQuarterLabel(row.reportDate),
      reportDate: row.reportDate || "待更新",
      valueText: guruFundSizeText(row.portfolioValue, currency),
      positionCountText: Number.isFinite(Number(row.positionCount)) ? `${row.positionCount}只` : "暂缺",
      moveText: hasNew || hasSold ? `新增${hasNew ? Number(row.newCount) : 0} · 清仓${hasSold ? Number(row.soldCount) : 0}` : "无更早数据可比",
    };
  });
}

function buildGuruModule(snapshot) {
  const groupRank = { us: 0, hk: 1, a: 2 };
  const profiles = allItems(snapshot, "guru")
    .filter((item) => item.group !== "overlap")
    .sort((a, b) => {
      const ga = groupRank[a.group] ?? 3;
      const gb = groupRank[b.group] ?? 3;
      if (ga !== gb) return ga - gb;
      const aPri = /berkshire|巴菲特/i.test(`${a.id} ${a.name}`) ? -1 : 0;
      const bPri = /berkshire|巴菲特/i.test(`${b.id} ${b.name}`) ? -1 : 0;
      return aPri - bPri;
    });
  const resolveStockLink = buildStockLinkResolver(snapshot);
  // 增减需要前后两期可比。单期申报里的持仓不能当成新进。
  const investors = Array.isArray(snapshot.investors) ? snapshot.investors.filter(hasAdjacentGuruReports) : [];
  const trend = buildGuruTrend({ investors });
  const trendRows = guruTrendRowsFrom(trend, resolveStockLink);
  const trendTitle = trend.reportPeriod ? `报告期截至 ${trend.reportPeriod}` : "持仓变化";
  const trendHint = trend.reportPeriod ? `${trend.investorCount}家机构的部分持仓 · 与上季度比较，披露有滞后` : "";
  const trendEmptyText = trend.reportPeriod ? "这些样本暂无可展示的持仓变化" : "暂无同一报告期可比较的持仓资料";
  const marketTag = { us: "美", hk: "港", a: "A" };
  const institutionList = profiles.map((item) => {
    const perfRaw = String(item.raw?.profile?.performanceValue || "");
    const perf = perfRaw.match(/-?\d+(?:\.\d+)?/);
    return {
      id: String(item.id || ""),
      name: item.name || "待更新",
      org: item.raw?.profile?.org || "待更新",
      tag: marketTag[item.group] || "",
      hasPerf: Boolean(perf),
      perfText: perf
        ? `${perfRaw.includes("约") ? "≈" : ""}${/\.\d{2,}/.test(perf[0]) ? Number(perf[0]).toFixed(1) : perf[0]}%`
        : "",
    };
  });
  const profileById = new Map(profiles.map((item) => [String(item.id || ""), item]));
  const computedHoldings = new Map();
  const buildOneHolding = (id) => {
    if (computedHoldings.has(id)) return computedHoldings.get(id);
    const item = profileById.get(String(id || ""));
    if (!item) return null;
    const holdings = Array.isArray(item.raw?.holdings) ? item.raw.holdings : [];
    const topWeight = Math.max(...holdings.slice(0, 10).map((holding) => Number(holding.weight)).filter(Number.isFinite), 1e-6);
    const rows = holdings.slice(0, 10).map((holding) => {
      const weight = Number(holding.weight);
      const move = String(holding.changeLabel || "");
      const displayName = guruHoldingName(holding);
      const rawTicker = String(holding.ticker || holding.code || "").trim().toUpperCase();
      const code = /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(rawTicker) && displayName.toUpperCase() !== rawTicker && !displayName.includes(rawTicker) ? rawTicker : "";
      const link = holding && holding.putCall ? { linkMarket: "", linkId: "" } : resolveStockLink(rawTicker, displayName);
      return {
        name: displayName,
        code,
        ...link,
        weightNum: Number.isFinite(weight) ? weight : 0,
        weightText: Number.isFinite(weight) ? `${weight.toFixed(1)}%` : "—",
        weightBar: Number.isFinite(weight) ? Math.max(3, Math.round((weight / topWeight) * 100)) : 0,
        moveText: move || "—",
        moveTone: /新进|新建|增持/.test(move) ? "worth" : (/减持|清仓|退出/.test(move) ? "avoid" : ""),
      };
    });
    const top5Rows = rows.slice(0, 5).filter((r) => r.weightNum > 0);
    const top5Sum = top5Rows.reduce((s, r) => s + r.weightNum, 0);
    let concentration = null;
    if (top5Rows.length >= 2 && top5Sum > 0) {
      const denom = Math.max(100, top5Sum);
      const toneColors = ["#1d5fd1", "#0f9f6e", "#d97706", "#6366f1", "#ec4899"];
      const segs = top5Rows.map((r, idx) => ({
        key: `seg-${idx}`,
        tone: `c${idx + 1}`,
        color: toneColors[idx % toneColors.length],
        name: String(r.name || "").slice(0, 5),
        value: r.weightNum,
        pctText: `${r.weightNum.toFixed(1)}%`,
        width: Math.max(3, Math.round((r.weightNum / denom) * 1000) / 10),
      }));
      if (denom - top5Sum >= 2) {
        segs.push({
          key: "seg-rest",
          tone: "rest",
          color: "#cbd5e1",
          name: "其余仓位",
          value: denom - top5Sum,
          pctText: `${(denom - top5Sum).toFixed(1)}%`,
          width: Math.max(2, Math.round(((denom - top5Sum) / denom) * 1000) / 10),
        });
      }
      concentration = {
        topSumText: `前${top5Rows.length}重仓 ${top5Sum.toFixed(1)}%`,
        centerMain: `${top5Sum.toFixed(0)}%`,
        donutSrc: donutSvg(segs, { size: 148, strokeWidth: 20 }),
        segments: segs,
        legend: segs,
      };
    }
    const currency = item.group === "a" ? "¥" : "$";
    const history = Array.isArray(item.raw?.history) ? item.raw.history : [];
    const isLive = Boolean(item.raw?.isLive);
    const rawSrcText = `${item.raw?.source || ""} ${item.raw?.profile?.report || ""} ${item.raw?.profile?.sourceName || ""}`;
    const sourceShort = isLive
      ? "美国证监会"
      : (/月度|月报|Factsheet/i.test(rawSrcText)
        ? "基金月报"
        : (/半年报/i.test(rawSrcText) ? "基金半年报" : "基金季报"));
    const trackingScore = Number.isFinite(Number(item.raw?.trackingScore)) ? Number(item.raw.trackingScore) : null;
    const shortDate = (value) => {
      const m = String(value || "").match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1].slice(2) : "—";
    };
    const refTime = Date.parse(snapshot.updatedAt || "") || Date.now();
    const repMatch = String(item.raw?.reportDate || "").match(/(\d{4}-\d{2}-\d{2})/);
    const repAgeDays = repMatch ? Math.round((refTime - Date.parse(`${repMatch[1]}T00:00:00Z`)) / 86400000) : 0;
    const reportValue = repAgeDays > 190 ? `${shortDate(item.raw?.reportDate)}·旧期` : shortDate(item.raw?.reportDate);
    const built = {
      rows,
      concentration,
      hint: rows.length ? `重仓前 ${rows.length}` : "暂无持仓披露",
      stats: [
        { label: "报告期", value: reportValue },
        { label: "披露日", value: shortDate(item.raw?.filingDate) },
        { label: "来源", value: sourceShort },
        { label: "披露完整度", value: trackingScore != null ? `${trackingScore}分` : "—" },
      ],
      isLive,
      trackingScore,
      historyChart: guruHistoryChart(history, currency),
      historyRowsData: guruHistoryRows(history, currency),
      historyHint: history.length >= 2 ? `近 ${history.length} 期季度披露` : "",
      historyChartEmptyText: history.length >= 2
        ? "规模未披露 · 下表为各期新增/清仓"
        : "仅有最新一期披露",
    };
    computedHoldings.set(id, built);
    return built;
  };
  const holdingsByInstitution = new Proxy({}, {
    get(_, prop) {
      return typeof prop === "string" ? buildOneHolding(prop) : undefined;
    },
  });
  // 跨机构共同重仓统计：跨美/港/A三市场归一识别同一家公司（腾讯/阿里/台积电/拼多多/宁德时代/谷歌等）。
  const canonicalGuruEntity = (h) => {
    const rawSym = String((h && (h.ticker || h.code)) || "").trim().replace(/\.(HK|SH|SZ|US)$/i, "").toUpperCase();
    const disp = guruHoldingName(h);
    const probe = `${rawSym} ${disp} ${(h && (h.issuer || h.name)) || ""}`;
    if (/\b0?700\b|TENCENT|腾讯控股/i.test(probe)) return { key: "0700.HK", name: "腾讯控股", code: "0700.HK" };
    if (/\b9988\b|\bBABA\b|ALIBABA|阿里巴巴/i.test(probe)) return { key: "BABA", name: "阿里巴巴", code: "BABA" };
    if (/\bTSMC?\b|TAIWAN\s+SEMICONDUCTOR|台积电/i.test(probe)) return { key: "TSM", name: "台积电", code: "TSM" };
    if (/\bPDD\b|PINDUODUO|拼多多/i.test(probe)) return { key: "PDD", name: "拼多多", code: "PDD" };
    if (/\b9999\b|\bNTES\b|NETEASE|网易/i.test(probe)) return { key: "9999.HK", name: "网易", code: "9999.HK" };
    if (/\b2899\b|ZIJIN\s+MINING|紫金矿业/i.test(probe)) return { key: "2899.HK", name: "紫金矿业", code: "2899.HK" };
    if (/\b300750\b|\bCATL\b|CONTEMPORARY\s+AMPEREX|宁德时代/i.test(probe)) return { key: "300750", name: "宁德时代", code: "300750" };
    if (/\b2318\b|PING\s+AN|中国平安/i.test(probe)) return { key: "2318.HK", name: "中国平安", code: "2318.HK" };
    if (/\b600036\b|\b3968\b|CHINA\s+MERCHANTS\s+BANK|招商银行/i.test(probe)) return { key: "600036", name: "招商银行", code: "600036" };
    if (/\b300308\b|ZHONGJI\s+INNOLIGHT|中际旭创/i.test(probe)) return { key: "300308", name: "中际旭创", code: "300308" };
    if (/^(GOOG|GOOGL)$/.test(rawSym) || /ALPHABET/i.test(probe)) return { key: "GOOGL", name: "谷歌", code: "GOOGL" };
    if (!rawSym) return null;
    return {
      key: rawSym,
      name: disp,
      code: /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(rawSym) && disp.toUpperCase() !== rawSym ? rawSym : "",
    };
  };
  const overlapMap = new Map();
  for (const prof of profiles) {
    const holds = Array.isArray(prof.raw?.holdings) ? prof.raw.holdings : [];
    const seenInProf = new Set();
    for (const h of holds.slice(0, 10)) {
      if (h && h.putCall) continue;
      const ent = canonicalGuruEntity(h);
      if (!ent || !ent.key || seenInProf.has(ent.key)) continue;
      seenInProf.add(ent.key);
      const cur = overlapMap.get(ent.key) || {
        key: ent.key,
        name: ent.name,
        code: ent.code,
        ...resolveStockLink(ent.key, ent.name),
        count: 0,
        holders: [],
      };
      cur.count += 1;
      cur.holders.push(shortGuruPersonName(prof.name));
      overlapMap.set(ent.key, cur);
    }
  }
  const overlapSorted = [...overlapMap.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxOverlap = Math.max(...overlapSorted.map((r) => r.count), 1);
  const overlapRows = overlapSorted.map((entry) => ({
    ...entry,
    barWidth: Math.max(18, Math.round((entry.count / maxOverlap) * 100)),
    holdersText: entry.holders.slice(0, 3).join(" · "),
  }));

  const defaultId = String((profiles[0] && profiles[0].id) || "");
  const answerBar = overlapRows.length
    ? `${profiles.length} 家机构共同重仓前 ${ Math.min(3, overlapRows.length) }：${overlapRows.slice(0, 3).map((r) => `${r.name}(${r.count}家)`).join("、")}`
    : `已收录 ${profiles.length} 家顶级机构最新公开持仓（季度披露有滞后，仅学思路不照抄）`;
  return { answerBar, profiles, trend, trendRows, overlapRows, trendTitle, trendHint, trendEmptyText, institutionList, holdingsByInstitution, defaultId };
}

const GURU_EMPTY_HOLDINGS = {
  rows: [],
  hint: "持仓证据不足，暂不展示",
  stats: [],
  isLive: false,
  trackingScore: null,
  historyChart: null,
  historyRowsData: [],
  historyHint: "机构样本待更新",
  historyChartEmptyText: "机构样本待更新",
};

// 「跟着谁看」默认只露前 4 家，其余折进「展开」——11 家机构一次铺开，
// 这一屏最占地方的就是它。折叠只影响默认展示条数，「机构持仓」picker
// 里的 guruInstitutionList 仍然是全量，不受这个截断影响。
const GURU_INSTITUTION_PREVIEW_COUNT = 4;
function institutionListShown(list, expanded) {
  if (expanded) return list;
  return list.slice(0, GURU_INSTITUTION_PREVIEW_COUNT);
}

// 「重仓前十」默认只露前 5 条，跟机构列表同一套「展开」模式，不新发明交互。
const GURU_HOLDINGS_PREVIEW_COUNT = 5;
function holdingsRowsShown(rows, expanded) {
  if (expanded) return rows;
  return rows.slice(0, GURU_HOLDINGS_PREVIEW_COUNT);
}

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
    // 历史资料无法保证当前招股状态，不给单只新股生成页头结论。
    return {
      metrics: [],
      target: "",
      targetId: "",
      grade: "",
      gradeGroup: "",
      canOpenTarget: false,
      canOpenGrade: false,
    };
  }

  if (market === "us") {
    const items = allItems(snapshot, "us");
    const hot = items.filter((item) => item.group === "hot");
    const seven = items.filter((item) => item.group === "seven");
    // 结论行原来取「全样本综合分最高的那一只」，选出来的是行业观察里的
    // 万事达——底下四张答案卡讲的全是七姐妹和热度三只，页头却挂着一只
    // 一次都没出现过的票，徽章还写着「七姐妹」。这一栏的结论只从七姐妹里选，
    // 七姐妹缺数据时才退到热度三只。
    const best = (list) => [...list]
      .map((item) => ({ item, score: scoreForItem(item).score }))
      .filter((entry) => entry.score != null)
      .sort((left, right) => right.score - left.score)[0]?.item || list[0] || null;
    // 徽章原来按「属于低估七姐妹」写死成「低估可买入」，可下面列表给同一只 Meta
    // 标的是「等回撤」——同一屏两个相反的说法。现在徽章直接用列表里那个策略
    // 结论，挑人也按列表的结论排：可分批观察 > 等回撤 > 风险升高，同档看评分。
    const toneRank = { good: 0, warn: 1, bad: 2 };
    const signalled = seven.map((item) => ({ item, signal: buildStrategySignal(item), score: scoreForItem(item).score }));
    signalled.sort((left, right) => (
      ((toneRank[left.signal.tone] ?? 3) - (toneRank[right.signal.tone] ?? 3))
      || ((right.score ?? -1) - (left.score ?? -1))
    ));
    const leadEntry = signalled[0] || null;
    const lead = leadEntry ? leadEntry.item : (best(hot) || null);
    const leadLabel = leadEntry ? leadEntry.signal.label : (lead ? buildStrategySignal(lead).label : "");
    const leadId = lead ? String(lead.id || lead.code || "") : "";
    // 「七姐妹 7」「热度前三 3」这两格原来单独占一整排，可两个数都是固定的
    // ——七姐妹恒定 7 只、热度前三恒定取 3 只，点开又是下面「七姐妹近期怎么了」
    // 「最热的三只」两张答案卡、以及「分组浏览」里同一个分组，同一件事印三遍。
    // 数字和入口都留给答案卡和分组浏览，这里的结论行只补答案卡没有的：综合分。
    return {
      metrics: [],
      // 页头写代码（MA、GOOGL）就得读的人自己翻译一遍，其它四栏的结论行
      // 写的都是中文名，这里跟上。
      target: lead ? shortCompanyName(lead.name, lead.code || "美股", 6) : "待更新",
      targetId: leadId,
      grade: lead ? (leadLabel || "待定") : "—",
      gradeGroup: leadEntry ? "seven" : "hot",
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
    const topId = top ? String(top.id || "") : "";
    // 「收息样本 12」「优等收息 1」这两格原来单独占一整排，可两个数在分组浏览里
    // 一点就能看到、跟这里说的是同一件事，同一个数字印两遍。
    // 结论行原来还挂「收息分75」，下面列表同一只写的是「83分」（分红稳定性），
    // 两个分并排读者会问哪个对；结论行只留徽章。
    return {
      metrics: [],
      target: top ? shortCompanyName(top.name, top.code || "—", 10) : "—",
      grade: top ? (top.badge || "待定") : "—",
      targetId: topId,
      gradeGroup: top?.group || "prime",
      canOpenTarget: Boolean(topId),
      canOpenGrade: Boolean(top?.group),
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const answer = gold.answer || {};
    // 「国际金/盎司 $4416」「人民币金/克 ¥947.1」这两格是裸数字，往下一屏
    // 「现在怎么做」面板里同样两个价、外加一张真实走势图已经摆在那——数字印两遍，
    // 走势图反而要往下翻才看得到。去掉这两格数字，让走势图成为进页面后第一眼
    // 看到的黄金内容。「观察分」不是裸重复（下面拆成国际/人民币两个分），
    // 折进结论行说清是两者综合的一个分。
    return {
      metrics: [],
      target: "黄金",
      targetId: "track",
      // 国际/人民币两个观察分已经画在下方币种卡片里，徽章只留动作——
      // 「等待更好价格 · 观察分XX」一行装不下，分数总被截断。
      // 数据过期时 answer.action 是一整句「数据过期，暂不提供动作」，徽章装不下被截成省略号，
      // 而下面的红色提示条已经把「数据已陈旧」说清楚了，这里只留两个字。
      grade: snapshot.actionsFresh === false
        ? "待更新"
        : (gold.actionsFresh === false ? "资料待补齐" : "历史参考"),
      gradeGroup: "track",
      canOpenTarget: true,
      canOpenGrade: true,
    };
  }

  const profiles = allItems(snapshot, "guru");
  // leader 原本取 profiles[0]，也就是数组里排头的那条（港股组的惠理价值
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
      // 光写「3」不知道是 3 什么；跟下面「展开其余 11 家」同一个量词。
      { label: "港股", value: `${hkCount}家`, action: "group", group: "hk", enabled: hkCount > 0 },
      { label: "美股", value: `${usCount}家`, action: "group", group: "us", enabled: usCount > 0 },
      { label: "A股", value: `${aCount}家`, action: "group", group: "a", enabled: aCount > 0 },
    ],
    // 6 个字会把「斯坦利·德鲁肯米勒」削成「斯坦利·德鲁」，看着像个完整名字，
    // 其实是另一个人。放宽到 10 字，真放不下时交给 CSS 的省略号，至少能看出被截了。
    // 一个人名加年化不是「结论」，读者会问结论是什么；跟下面答案卡「业绩靠前持仓」同一个说法。
    label: "业绩靠前",
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

// 栏目页最底部一行轻量入口，不占正文：看完数据还没有账户 / 想要信息 / 想交流的人，顺手就能点进去。
// 每个栏目只放一条，进的都是 pages/guide 或 pages/community 的二级页。
const NEXT_LINKS = {
  hk: { id: "hk-open", ask: "需要港股渠道参考？", go: "查看港股指引", url: "/pages/guide/index?topic=hk-open&from=section" },
  us: { id: "us-start", ask: "需要美股渠道参考？", go: "查看美股指引", url: "/pages/guide/index?topic=us-start&from=section" },
  a: { id: "a-open", ask: "还没有A股账户？", go: "查看A股开户", url: "/pages/guide/index?topic=a-open&from=section" },
  gold: { id: "info", ask: "查阅海外一手数据？", go: "查看海外访问指引", url: "/pages/guide/index?topic=info&from=section" },
  guru: { id: "community", ask: "想继续交流？", go: "了解会员群", url: "/pages/community/index?from=section" },
};

// 跨页内存缓存：同一份快照版本内反复进出某栏目时直接命中，零重复计算。
const SECTION_CACHE = new Map();

function getCachedSectionData(snapshot, market, versionKey) {
  const cacheKey = `${versionKey}|${market}`;
  if (SECTION_CACHE.has(cacheKey)) return SECTION_CACHE.get(cacheKey);
  if (SECTION_CACHE.size > 10) SECTION_CACHE.clear();
  const entry = {
    overview: plainOverview(buildOverview(snapshot, market)),
    sourceLinks: market === "guru" ? marketSources(snapshot, market) : [],
    hkModule: market === "hk" ? buildHkModule(snapshot) : null,
    usModule: market === "us" ? buildUsModule(snapshot) : null,
    aModule: market === "a" ? buildAModule(snapshot) : null,
    goldModule: market === "gold" ? buildGoldModule(snapshot) : null,
    guruModule: market === "guru" ? buildGuruModule(snapshot) : null,
  };
  SECTION_CACHE.set(cacheKey, entry);
  return entry;
}

Page({
  data: {
    market: "hk",
    sectionAdUnitId: PRODUCT.sectionAdUnitId,
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
    hkApplyTiles: [],
    hkFirstDayChart: null,
    hkExitOptions: [],
    hkExitIndex: 0,
    hkExitSelectedId: "",
    hkExitView: null,
    hkExitChart: null,
    hkHistorySummary: [],
    hkHistoryRows: [],
    hkHistoryTotal: 0,
    hkHistorySort: "latest",
    hkShowAllHistory: false,
    hkSponsorRows: [],
    hkCrowdBuckets: [],
    hkIndustryRows: [],
    sectionAnswerBar: "",
    // 美股专属：原型的「七姐妹/热门三只/SEC公告」视图，只有 market==='us' 时渲染。
    usSubTab: "seven",
    usCompareDim: "val",
    usSevenCompare: null,
    usHeatMode: "day",
    usHeatmap: [],
    usSevenHeatmap: [],
    usAllFilter: "all",
    usAllSort: "default",
    usAllList: [],
    usTriggerTiles: [],
    usSevenList: [],
    usSevenHint: "",
    usSevenMix: [],
    usHotList: [],
    usHotHint: "",
    usFilingsList: [],
    usFilingsCount: 0,
    // A股收息专属：原型的「分红稳定性/分红收益性」两个前五榜单，只有 market==='a' 时渲染。
    aSubTab: "stable",
    aPrincipalWan: 1,
    aLifeSummary: "",
    aCalendarMonths: [],
    aCalendarMonth: 7,
    aCalendarRows: [],
    aCalendarSummary: "",
    aHeatMode: "yield",
    aHeatmap: [],
    aAllFilter: "all",
    aAllSort: "default",
    aAllList: [],
    aTriggerTiles: [],
    aStableList: [],
    aYieldList: [],
    aFund: null,
    // 黄金追踪专属：原型的币种/周期切换，只有 market==='gold' 时渲染。默认
    // 国际金——它有180天真实收盘价能画走势图，人民币金只有2天数据画不出图。
    goldCurrency: "usd",
    goldPeriod: "month",
    goldQuotes: [],
    goldZoneTone: "caution",
    goldCurrencyLabel: "",
    goldPeriods: [],
    goldChart: null,
    goldChartNote: "",
    goldLadder: null,
    goldParityLine: "",
    goldCompareTiles: [],
    goldSpreadBadge: "",
    goldReturnPills: [],
    // 机构持仓专属：模仿富途「明星机构持仓」，一进来直接看各家机构重仓，点铭牌秒切。
    guruSubTab: "holdings",
    guruTrendRows: [],
    guruOverlapRows: [],
    guruTrendTitle: "持仓变化",
    guruTrendHint: "",
    guruTrendEmptyText: "正在读取披露资料",
    guruInstitutionList: [],
    guruInstitutionListShown: [],
    guruInstitutionExpanded: false,
    guruInstitutionIndex: 0,
    guruInstitutionId: "",
    guruInstitutionName: "",
    guruInstitutionOrg: "",
    guruHoldingsRows: [],
    guruHoldingsRowsShown: [],
    guruHoldingsExpanded: false,
    guruConcentration: null,
    guruHoldingsHint: "",
    guruHoldingStats: [],
    guruIsLive: false,
    guruHistoryChart: null,
    guruHistoryRowsData: [],
    guruHistoryHint: "",
    guruHistoryChartEmptyText: "",
    // 策略摘要、数据出处不是机构持仓这一栏要立刻看到的内容，收进底部
    // 可展开区域，默认收起。
    guruMoreOpen: false,
    dataAsOf: "",
    // 只有黄金栏目页会用到；其余四栏恒为 null，wx:if 直接整块不渲染。
    // 展开层。wx.showModal 会把 content 里的 \n 当成空格吞掉——七姐妹那张卡
    // 十几行事实会连成一堵墙，这是用户花钱买的正文，不能这么给。
    // 所以自己渲染：每行一个 text，空行留白，缩进行降一级。
    answerSheet: null,
    nextLink: null,
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
    this.setData({ market, meta: META[market], playbooks,
      nextLink: market === "guru" && !PRODUCT.showPaidCommunity ? null : (NEXT_LINKS[market] || null) });
    wx.setNavigationBarTitle({ title: META[market].title });
    track("section_open", { market: String(market), from: "direct" });
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") {
      wx.nextTick(() => this.refresh());
    } else {
      this.refresh();
    }
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
      const settledCount = countOf("settled");
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
        {
          id: "settled",
          group: "settled",
          title: "申购结束观察",
          help: settledCount > 0 ? `已配发 ${settledCount} 只 · 暗盘/首日观察中` : "暂无已配发新股",
          enabled: settledCount > 0,
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
      const market = this.data.market;
      const versionKey = meta.versionKey || snapshotVersionKey(snapshot, meta.kind);
      if (!force && versionKey && versionKey === this._renderedKey) return;
      this._renderedKey = versionKey;

      const isDedicated = ["hk", "us", "a", "gold", "guru"].includes(market);
      const deepLinks = isDedicated ? [] : this.buildDeepLinks(snapshot, market)
        .map((item) => ({ ...item, icon: tileIcon(item.group) }));
      const answers = isDedicated ? [] : buildDailyAnswers(snapshot, market, { holdings: listHoldings() });
      const coveredGroups = new Set([
        ...deepLinks.filter((item) => item.enabled).map((item) => item.group),
        ...answers.filter((item) => item.enabled && item.action === "group" && item.group).map((item) => item.group),
      ]);
      const groups = isDedicated ? [] : groupDefinitions(snapshot, market)
        .filter((item) => item.count > 0 && item.catalog !== false && !coveredGroups.has(item.id))
        .map((item) => ({ ...item, icon: tileIcon(item.id) }));

      const cached = getCachedSectionData(snapshot, market, versionKey);
      const patch = {
        overview: cached.overview,
        // 聪明钱「本季他们在加/减什么」两张卡和下面「本季共同方向」那张条形图
        // 是同一批票、同一个家数，上下印两遍；2026-09-29 按产品要求只留下面那张。
        answers: this.data.market === "guru" ? [] : answers,
        source,
        freshness: freshnessBanner(source, meta.kind),
        dataAsOf: marketReferenceAsOf(snapshot, market, meta.kind),
      };
      if (!isDedicated) {
        patch.groups = groups;
        patch.deepLinks = deepLinks;
      }

      if (market === "hk" && cached.hkModule) {
        const hkModule = cached.hkModule;
        this._hkModule = hkModule;
        const hkExitList = hkModule.exitList;
        this._hkExitList = hkExitList;
        const hkSelection = resolveHkExitSelection(hkExitList, this.data.hkExitSelectedId);
        const showAll = Boolean(this.data.hkShowAllHistory);
        const sortedHist = sortHkHistoryRows(hkModule.historyRowsAll || hkModule.historyRows || [], this.data.hkHistorySort);
        Object.assign(patch, {
          sectionAnswerBar: hkModule.answerBar || "",
          hkApplyList: hkModule.applyList,
          hkApplyTiles: hkModule.applyTiles,
          hkFirstDayChart: hkModule.firstDayChart,
          hkExitOptions: hkExitList.map((item) => ({ id: item.id, text: item.text })),
          hkExitIndex: hkSelection.index,
          hkExitSelectedId: hkSelection.id,
          hkExitView: hkSelection.view,
          hkExitChart: hkModule.exitChart,
          hkHistorySummary: hkModule.historySummary || [],
          hkHistoryRows: showAll ? sortedHist : sortedHist.slice(0, 12),
          hkHistoryTotal: hkModule.historyTotal || sortedHist.length,
          hkSponsorRows: hkModule.sponsorRows || [],
          hkCrowdBuckets: hkModule.crowdBuckets || [],
          hkIndustryRows: hkModule.industryRows || [],
        });
      } else if (market === "us" && cached.usModule) {
        const usModule = cached.usModule;
        Object.assign(patch, {
          sectionAnswerBar: usModule.answerBar || "",
          usTriggerTiles: usModule.triggerTiles,
          usSevenList: usModule.sevenList,
          usSevenCompare: usModule.sevenCompare || null,
          usSevenHeatmap: usModule.sevenHeatmap || [],
          usSevenHint: usModule.sevenHint,
          usSevenMix: usModule.sevenMix,
          usHotHint: usModule.hotHint,
        });
        // 按激活子 tab 懒下发列表（含 SVG Base64），首屏只算并只传七家大公司 7 条。
        if (this.data.usSubTab === "hot") patch.usHotList = usModule.hotList;
        if (this.data.usSubTab === "filings" || (this.data.usSubTab === "compare" && this.data.usCompareDim === "filings")) {
          patch.usFilingsList = usModule.filingsFeed || [];
        }
        if (this.data.usSubTab === "heatmap") patch.usHeatmap = buildUsHeatmap(usModule.allList, this.data.usHeatMode);
        if (this.data.usSubTab === "all") patch.usAllList = this.applyUsView(usModule.allList, this.data.usAllFilter, this.data.usAllSort);
        this._usModule = usModule;
      } else if (market === "a" && cached.aModule) {
        const aModule = cached.aModule;
        this._aModule = aModule;
        const wan = this.data.aPrincipalWan || 1;
        Object.assign(patch, {
          sectionAnswerBar: aModule.answerBar || "",
          aSectorDonut: aModule.sectorDonut || null,
          aStableList: withPrincipalWan(aModule.stableList, wan),
          aLifeSummary: buildLifeSummaryLine(aModule.stableList, wan),
        });
        if (this.data.aSubTab === "yield") {
          patch.aYieldList = withPrincipalWan(aModule.yieldList, wan);
          patch.aLifeSummary = buildLifeSummaryLine(aModule.yieldList, wan);
        }
        if (this.data.aSubTab === "calendar") {
          const cal = aModule.calendar;
          const m = cal.byMonth.has(this.data.aCalendarMonth) && (cal.byMonth.get(this.data.aCalendarMonth) || []).length
            ? this.data.aCalendarMonth
            : cal.defaultMonth;
          patch.aCalendarMonths = cal.months;
          patch.aCalendarMonth = m;
          patch.aCalendarSummary = cal.summaryText;
          patch.aCalendarChartSrc = cal.chartSrcFor(m);
          patch.aCalendarRows = formatCalendarRows(cal.byMonth.get(m) || [], wan);
        }
        if (this.data.aSubTab === "heatmap") patch.aHeatmap = buildAHeatmap(aModule.allList, this.data.aHeatMode);
        if (this.data.aSubTab === "all") {
          patch.aAllList = withPrincipalWan(this.applyAView(aModule.allList, this.data.aAllFilter, this.data.aAllSort), wan);
          patch.aLifeSummary = buildLifeSummaryLine(aModule.allList, wan);
          patch.aFund = aModule.fund;
        }
      } else if (market === "gold" && cached.goldModule) {
        const goldModule = cached.goldModule;
        this._goldModule = goldModule;
        const goldView = resolveGoldView(goldModule, this.data.goldCurrency, this.data.goldPeriod);
        Object.assign(patch, {
          sectionAnswerBar: goldModule.answerBar || "",
          goldQuotes: goldModule.quotes,
          goldParityLine: goldModule.parityLine || "",
          goldCompareTiles: goldModule.compareTiles || [],
          goldSpreadBadge: goldModule.spreadBadge || "",
          goldReturnPills: goldModule.returnPills || [],
          goldPeriod: goldView.period,
          goldZoneTone: goldView.zoneTone,
          goldCurrencyLabel: goldView.currencyLabel,
          goldPeriods: goldView.periods,
          goldChart: goldView.chart,
          goldChartNote: goldView.chartNote,
          goldLadder: goldView.ladder,
        });
      } else if (market === "guru" && cached.guruModule) {
        const guruModule = cached.guruModule;
        this._guruModule = guruModule;
        const guruSelection = resolveGuruInstitution(guruModule, this.data.guruInstitutionId || guruModule.defaultId);
        Object.assign(patch, {
          sectionAnswerBar: guruModule.answerBar || "",
          sourceLinks: cached.sourceLinks,
          guruTrendRows: guruModule.trendRows,
          guruOverlapRows: guruModule.overlapRows || [],
          guruTrendTitle: guruModule.trendTitle,
          guruTrendHint: guruModule.trendHint,
          guruTrendEmptyText: guruModule.trendEmptyText,
          guruInstitutionList: guruModule.institutionList,
          guruInstitutionListShown: institutionListShown(guruModule.institutionList, this.data.guruInstitutionExpanded),
          guruInstitutionIndex: guruSelection.index,
          guruInstitutionId: guruSelection.id,
          guruInstitutionName: guruSelection.name,
          guruInstitutionOrg: guruSelection.org,
          guruHoldingsRows: guruSelection.holdings.rows,
          guruHoldingsRowsShown: holdingsRowsShown(guruSelection.holdings.rows, this.data.guruHoldingsExpanded),
          guruConcentration: guruSelection.holdings.concentration || null,
          guruHoldingsHint: guruSelection.holdings.hint,
          guruHoldingStats: guruSelection.holdings.stats,
          guruIsLive: guruSelection.holdings.isLive,
          guruHistoryChart: guruSelection.holdings.historyChart,
          guruHistoryRowsData: guruSelection.holdings.historyRowsData,
          guruHistoryHint: guruSelection.holdings.historyHint,
          guruHistoryChartEmptyText: guruSelection.holdings.historyChartEmptyText,
        });
      }

      this.setData(patch, () => {
        if (market === "gold") this.drawGoldChart();
      });
    }, done, { force });
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
  openHkDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_hk_apply");
  },
  toggleHkHistoryAll() {
    const next = !this.data.hkShowAllHistory;
    const rawHist = (this._hkModule && (this._hkModule.historyRowsAll || this._hkModule.historyRows)) || this.data.hkHistoryRows || [];
    const sortedHist = sortHkHistoryRows(rawHist, this.data.hkHistorySort);
    this.setData({
      hkShowAllHistory: next,
      hkHistoryRows: next ? sortedHist : sortedHist.slice(0, 12),
    });
  },
  sortHkHistory(event) {
    const sortId = String(event.currentTarget.dataset.sort || "latest");
    if (sortId === this.data.hkHistorySort) return;
    const rawHist = (this._hkModule && (this._hkModule.historyRowsAll || this._hkModule.historyRows)) || [];
    const sortedHist = sortHkHistoryRows(rawHist, sortId);
    this.setData({
      hkHistorySort: sortId,
      hkHistoryRows: this.data.hkShowAllHistory ? sortedHist : sortedHist.slice(0, 12),
    });
    track("section_tab", { market: "hk", tab: `hist_${sortId}` });
  },
  switchUsSubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.usSubTab) return;
    const patch = { usSubTab: id };
    const mod = this._usModule;
    if (id === "hot" && !this.data.usHotList.length && mod) {
      patch.usHotList = mod.hotList;
    }
    if ((id === "filings" || (id === "compare" && this.data.usCompareDim === "filings")) && !this.data.usFilingsList.length && mod) {
      patch.usFilingsList = mod.filingsFeed || [];
    }
    if (id === "heatmap" && mod) {
      patch.usHeatmap = buildUsHeatmap(mod.allList, this.data.usHeatMode);
    }
    if (id === "all" && mod) {
      patch.usAllList = this.applyUsView(mod.allList, this.data.usAllFilter, this.data.usAllSort);
    }
    this.setData(patch);
    track("section_tab", { market: "us", tab: String(id) });
  },
  switchUsCompareDim(event) {
    const dim = String(event.currentTarget.dataset.dim || "val");
    if (dim === this.data.usCompareDim) return;
    const patch = { usCompareDim: dim };
    if (dim === "filings" && !this.data.usFilingsList.length && this._usModule) {
      patch.usFilingsList = this._usModule.filingsFeed || [];
    }
    this.setData(patch);
    track("section_tab", { market: "us", tab: `cmp_${dim}` });
  },
  switchUsHeatMode(event) {
    const mode = String(event.currentTarget.dataset.mode || "day");
    if (mode === this.data.usHeatMode) return;
    this.setData({
      usHeatMode: mode,
      usHeatmap: buildUsHeatmap((this._usModule && this._usModule.allList) || [], mode),
    });
    track("section_tab", { market: "us", tab: `heat_${mode}` });
  },
  // 借鉴集思录高密度横向对比：多维筛选 + 一键排序美股全池。
  applyUsSort(list, sortId) {
    const rows = Array.isArray(list) ? list.slice() : [];
    if (sortId === "perf60") {
      return rows.sort((a, b) => (b.sortPerf60 ?? -1e9) - (a.sortPerf60 ?? -1e9));
    }
    if (sortId === "pe") {
      return rows.sort((a, b) => ((a.sortPe > 0 ? a.sortPe : 1e9) - (b.sortPe > 0 ? b.sortPe : 1e9)));
    }
    if (sortId === "growth") {
      return rows.sort((a, b) => (b.sortGrowth ?? -1e9) - (a.sortGrowth ?? -1e9));
    }
    return rows;
  },
  applyUsView(list, filterId, sortId) {
    const base = Array.isArray(list) ? list : [];
    let filtered = base;
    if (filterId === "seven") filtered = base.filter((row) => row.isSeven);
    else if (filterId === "margin50") filtered = base.filter((row) => row.sortMargin != null && row.sortMargin >= 50);
    else if (filterId === "low35") filtered = base.filter((row) => row.sortPos60 != null && row.sortPos60 <= 35);
    return this.applyUsSort(filtered, sortId);
  },
  filterUsAll(event) {
    const filterId = String(event.currentTarget.dataset.filter || "all");
    if (filterId === this.data.usAllFilter) return;
    const all = (this._usModule && this._usModule.allList) || this.data.usAllList;
    this.setData({
      usAllFilter: filterId,
      usAllList: this.applyUsView(all, filterId, this.data.usAllSort),
    });
    track("section_tab", { market: "us", tab: `filter_${filterId}` });
  },
  sortUsAll(event) {
    const sortId = String(event.currentTarget.dataset.sort || "default");
    if (sortId === this.data.usAllSort) return;
    const all = (this._usModule && this._usModule.allList) || this.data.usAllList;
    this.setData({
      usAllSort: sortId,
      usAllList: this.applyUsView(all, this.data.usAllFilter, sortId),
    });
    track("section_tab", { market: "us", tab: `sort_${sortId}` });
  },
  openUsDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_us");
  },
  switchASubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.aSubTab) return;
    const patch = { aSubTab: id };
    const mod = this._aModule;
    const wan = this.data.aPrincipalWan || 1;
    if (id === "stable" && mod) {
      patch.aLifeSummary = buildLifeSummaryLine(mod.stableList, wan);
    }
    if (id === "yield" && mod) {
      if (!this.data.aYieldList.length) patch.aYieldList = withPrincipalWan(mod.yieldList, wan);
      patch.aLifeSummary = buildLifeSummaryLine(mod.yieldList, wan);
    }
    if (id === "calendar" && mod) {
      const cal = mod.calendar;
      const curM = this.data.aCalendarMonth;
      const m = cal.byMonth.has(curM) && (cal.byMonth.get(curM) || []).length ? curM : cal.defaultMonth;
      patch.aCalendarMonths = cal.months;
      patch.aCalendarMonth = m;
      patch.aCalendarSummary = cal.summaryText;
      patch.aCalendarChartSrc = cal.chartSrcFor(m);
      patch.aCalendarRows = formatCalendarRows(cal.byMonth.get(m) || [], wan);
    }
    if (id === "heatmap" && mod) {
      patch.aHeatmap = buildAHeatmap(mod.allList, this.data.aHeatMode);
    }
    if (id === "all" && mod) {
      patch.aAllList = withPrincipalWan(this.applyAView(mod.allList, this.data.aAllFilter, this.data.aAllSort), wan);
      patch.aLifeSummary = buildLifeSummaryLine(mod.allList, wan);
      patch.aFund = mod.fund || null;
    }
    this.setData(patch);
    track("section_tab", { market: "a", tab: String(id) });
  },
  selectACalendarMonth(event) {
    const m = Number(event.currentTarget.dataset.month) || 0;
    if (!m || !this._aModule) return;
    const cal = this._aModule.calendar;
    const wan = this.data.aPrincipalWan || 1;
    this.setData({
      aCalendarMonth: m,
      aCalendarChartSrc: cal.chartSrcFor(m),
      aCalendarRows: formatCalendarRows(cal.byMonth.get(m) || [], wan),
    });
    track("section_tab", { market: "a", tab: `cal_${m}` });
  },
  selectAPrincipal(event) {
    const wan = Number(event.currentTarget.dataset.wan) || 1;
    if (wan === this.data.aPrincipalWan) return;
    const mod = this._aModule;
    const patch = { aPrincipalWan: wan };
    if (mod) {
      patch.aStableList = withPrincipalWan(mod.stableList, wan);
      const activePool = this.data.aSubTab === "yield"
        ? mod.yieldList
        : (this.data.aSubTab === "all" ? mod.allList : mod.stableList);
      patch.aLifeSummary = buildLifeSummaryLine(activePool, wan);
      if (this.data.aYieldList.length || this.data.aSubTab === "yield") {
        patch.aYieldList = withPrincipalWan(mod.yieldList, wan);
      }
      if (this.data.aAllList.length || this.data.aSubTab === "all") {
        patch.aAllList = withPrincipalWan(this.applyAView(mod.allList, this.data.aAllFilter, this.data.aAllSort), wan);
      }
      if (this.data.aCalendarMonths.length || this.data.aSubTab === "calendar") {
        const cal = mod.calendar;
        patch.aCalendarRows = formatCalendarRows(cal.byMonth.get(this.data.aCalendarMonth) || [], wan);
      }
    }
    this.setData(patch);
  },
  switchAHeatMode(event) {
    const mode = String(event.currentTarget.dataset.mode || "yield");
    if (mode === this.data.aHeatMode) return;
    this.setData({
      aHeatMode: mode,
      aHeatmap: buildAHeatmap((this._aModule && this._aModule.allList) || [], mode),
    });
    track("section_tab", { market: "a", tab: `heat_${mode}` });
  },
  // 借鉴集思录高密度横向对比：多维筛选 + 一键排序 A 股收息池。
  applyASort(list, sortId) {
    const rows = Array.isArray(list) ? list.slice() : [];
    if (sortId === "yield") {
      return rows.sort((a, b) => (b.sortYield ?? -1e9) - (a.sortYield ?? -1e9));
    }
    if (sortId === "stable") {
      return rows.sort((a, b) => (b.sortStability ?? -1e9) - (a.sortStability ?? -1e9) || (b.sortYield ?? -1e9) - (a.sortYield ?? -1e9));
    }
    if (sortId === "change") {
      return rows.sort((a, b) => (b.sortChange ?? -1e9) - (a.sortChange ?? -1e9));
    }
    return rows;
  },
  applyAView(list, filterId, sortId) {
    const base = Array.isArray(list) ? list : [];
    let filtered = base;
    if (filterId === "yield4") filtered = base.filter((row) => row.sortYield != null && row.sortYield >= 4);
    else if (filterId === "nocut") filtered = base.filter((row) => row.sortCuts === 0);
    else if (filterId === "stable75") filtered = base.filter((row) => row.sortStability != null && row.sortStability >= 75);
    return this.applyASort(filtered, sortId);
  },
  filterAAll(event) {
    const filterId = String(event.currentTarget.dataset.filter || "all");
    if (filterId === this.data.aAllFilter) return;
    const all = (this._aModule && this._aModule.allList) || this.data.aAllList;
    this.setData({
      aAllFilter: filterId,
      aAllList: this.applyAView(all, filterId, this.data.aAllSort),
    });
    track("section_tab", { market: "a", tab: `filter_${filterId}` });
  },
  sortAAll(event) {
    const sortId = String(event.currentTarget.dataset.sort || "default");
    if (sortId === this.data.aAllSort) return;
    const all = (this._aModule && this._aModule.allList) || this.data.aAllList;
    const wan = this.data.aPrincipalWan || 1;
    this.setData({
      aAllSort: sortId,
      aAllList: withPrincipalWan(this.applyAView(all, this.data.aAllFilter, sortId), wan),
    });
    track("section_tab", { market: "a", tab: `sort_${sortId}` });
  },
  openADetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_a");
  },
  switchGoldCurrency(event) {
    const currency = event.currentTarget.dataset.currency;
    if (!currency || currency === this.data.goldCurrency) return;
    const view = resolveGoldView(this._goldModule, currency, this.data.goldPeriod);
    if (!view.chart) this._goldCanvas = null;
    this.setData({
      goldCurrency: currency,
      goldPeriod: view.period,
      goldZoneTone: view.zoneTone,
      goldCurrencyLabel: view.currencyLabel,
      goldPeriods: view.periods,
      goldChart: view.chart,
      goldChartNote: view.chartNote,
      goldLadder: view.ladder,
    }, () => this.drawGoldChart());
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
    }, () => this.drawGoldChart());
  },
  // 缓存已解析的 Canvas 2D 上下文，切周期/币种时零延迟同步重绘。
  resolveGoldCanvasNode(attempt, onReady) {
    if (this._goldCanvas && this._goldCanvas.ctx && this._goldCanvas.width > 0) {
      onReady(this._goldCanvas.ctx, this._goldCanvas.width, this._goldCanvas.height);
      return;
    }
    wx.createSelectorQuery()
      .in(this)
      .select("#gold-price-line")
      .fields({ node: true, size: true })
      .exec((res) => {
        const hit = res && res[0];
        if (!hit || !hit.node || !hit.width) {
          if (attempt < 10) {
            setTimeout(() => this.resolveGoldCanvasNode(attempt + 1, onReady), 40);
          }
          return;
        }
        const canvas = hit.node;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 1;
        canvas.width = hit.width * dpr;
        canvas.height = hit.height * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        this._goldCanvas = { ctx, width: hit.width, height: hit.height };
        onReady(ctx, hit.width, hit.height);
      });
  },
  drawGoldChart() {
    const chart = this.data.goldChart;
    if (!chart || !Array.isArray(chart.values) || chart.values.length < 2) return;
    this.resolveGoldCanvasNode(0, (ctx, w, h) => paintGoldLineChart(ctx, w, h, chart.values));
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
      // 切换机构时收起「展开」，避免上一家展开到10条的状态带到下一家。
      guruHoldingsExpanded: false,
      guruHoldingsRowsShown: holdingsRowsShown(selection.holdings.rows, false),
      guruConcentration: selection.holdings.concentration || null,
      guruHoldingsHint: selection.holdings.hint,
      guruHoldingStats: selection.holdings.stats,
      guruIsLive: selection.holdings.isLive,
      guruHistoryChart: selection.holdings.historyChart,
      guruHistoryRowsData: selection.holdings.historyRowsData,
      guruHistoryHint: selection.holdings.historyHint,
      guruHistoryChartEmptyText: selection.holdings.historyChartEmptyText,
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
  tapGuruPill(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.guruInstitutionId) return;
    this.applyGuruInstitution(id);
  },
  openCurrentGuruDetail() {
    const id = this.data.guruInstitutionId;
    if (!id) return;
    this.openDetail(id, "section_guru");
  },
  openGuruStock(event) {
    const { market, id } = event.currentTarget.dataset;
    if (!market || !id) return;
    track("detail_open", { market: String(market), from: "section_guru_holding" });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(market)}&id=${encodeURIComponent(id)}`,
    });
  },
  toggleGuruMore() {
    this.setData({ guruMoreOpen: !this.data.guruMoreOpen });
  },
  toggleGuruInstitutionMore() {
    const expanded = !this.data.guruInstitutionExpanded;
    this.setData({
      guruInstitutionExpanded: expanded,
      guruInstitutionListShown: institutionListShown(this.data.guruInstitutionList, expanded),
    });
  },
  toggleGuruHoldingsMore() {
    const expanded = !this.data.guruHoldingsExpanded;
    this.setData({
      guruHoldingsExpanded: expanded,
      guruHoldingsRowsShown: holdingsRowsShown(this.data.guruHoldingsRows, expanded),
    });
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
  openNextLink() {
    const link = this.data.nextLink;
    if (!link) return;
    track("path_open", { path: link.id, from: `section_${this.data.market}` });
    openPage(link.url);
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
