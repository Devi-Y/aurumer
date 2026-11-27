const { loadSnapshot, snapshotVersionKey } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName, shortOrgList, money, aShareDividendStability, tickerZhLabel, usPoolItems, usQualityEligibility } = require("../../utils/answers");
const { getDividendStability } = require("../../utils/dividend-stability");
const PRODUCT = require("../../config/product");
const {
  countTiles, usOrderState, usOrderLine, compareUsOrder, US_TRIGGERS,
  aOrderState, aOrderLine, compareAOrder, A_TRIGGERS, goldLevelNotes,
} = require("../../utils/order-plan");
// 结论行要按「低估 / 风险」这两个透镜选人，和今日答案用同一个判断。
const { parseOfferPrice, yieldImpliedPlan, goldZoneForPrice, goldPlanView, MAGNIFICENT_SEVEN } = require("../../utils/market-lenses");
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

// 「2,665.8百万港元」→「HK$26.7亿」；认不出单位就不显示，不猜。
// 有占比写「基石占比 35.2%」，只有金额写「基石金额 HK$1.2亿」——同一列不能一行是百分比、
// 一行是钱数还共用一个「基石」，读者分不清哪个是哪个。
function hkCornerstoneStat(raw) {
  const percent = finiteOrNull(raw.cornerstonePercent);
  if (percent != null) return { label: "基石占比", value: `${percent.toFixed(1)}%` };
  const match = String(raw.cornerstoneAmount || "").replace(/,/g, "").match(/([\d.]+)\s*(百万|亿)/);
  const value = match ? Number(match[1]) * (match[2] === "亿" ? 1e8 : 1e6) : NaN;
  if (!Number.isFinite(value) || value <= 0) return { label: "基石投资", value: "未公布" };
  return {
    label: "基石金额",
    value: value >= 1e8 ? `HK$${(value / 1e8).toFixed(1)}亿` : `HK$${Math.round(value / 1e4)}万`,
  };
}

function hkTone(group) {
  if (group === "worth") return "worth";
  if (group === "caution") return "caution";
  if (group === "settled") return "settled";
  return "avoid";
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
    const sponsorClean = rawFirstSponsor
      .replace(/（香港）|有限公司|股份有限公司|金融控股|证券|国际|融资|资本/gu, "")
      .trim()
      .slice(0, 5);
    const indTag = raw.industry ? String(raw.industry).split(/[\/、·,，]/)[0].trim().slice(0, 6) : "";
    const tagPills = [indTag, sponsorClean ? `保荐 ${sponsorClean}` : ""].filter(Boolean);
    const stageStep = item.group === "settled" ? 2 : (closed ? 1 : 0);
    const stageSteps = ["招股", "截止", "配发", "上市"].map((label, idx) => ({
      label,
      state: idx < stageStep ? "done" : (idx === stageStep ? "now" : "todo"),
    }));
    const rawCode = String(item.code || item.id || "").replace(/\.HK$/i, "");
    return {
      id: item.id,
      name: shortCompanyName(item.name, item.code || "新股", 10),
      code: rawCode ? `${rawCode}.HK` : "",
      tagPills,
      stageSteps,
      badgeText: closed ? "已截止" : (deadlineOffset == null ? "日期待核" : "日期参考"),
      tone: closed ? "settled" : "caution",
      reason: "招股资料仅供参考，请核对最新公告",
      deadlineLabel: deadlineOffset == null ? "截止日期待核" : `截止 ${String(deadline).slice(0, 10)}`,
      deadlineOffset,
      closed,
      stats: [
        { label: "招股价", value: offer != null ? `HK$${offer}` : "待更新" },
        { label: "一手本金", value: entryFee != null ? `HK$${Math.round(entryFee).toLocaleString("en-US")}` : "待更新" },
        hkCornerstoneStat(raw),
      ],
    };
  });
  // 招股中的排前面；已过截止日、还没出配发结果的排后面，每行底下的截止日写明哪只已截止。
  applyList.sort((left, right) => Number(left.closed) - Number(right.closed));

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
      oversubText: oversub != null ? `超购 ${Math.round(oversub).toLocaleString("en-US")} 倍` : "",
      plan,
    };
  });

  return {
    applyList,
    // 未核实当前招股状态，历史资料不计算“可申购”数量。
    applyTiles: [],
    firstDayChart: hkFirstDayChart(snapshot),
    exitList,
    exitChart: hkExitTierChart(buildHkExitBands(snapshot)),
  };
}

// 「近期申购」顶上一张零轴柱：最近上市的新股首日涨跌，从早到晚一根一根排，
// 看打新行情冷热。和首页「港股首日」卡同一份 hkFirstDaySeries。
function hkFirstDayChart(snapshot) {
  const series = hkFirstDaySeries(snapshot);
  const changes = series.map((item) => item.change);
  if (changes.length < 3) return null;
  // 不写「5/12 收涨 +0.0% 中位」：斜杠像日期，「中位」是统计词。直接数只数。
  const up = changes.filter((value) => value > 0).length;
  const maxVal = Math.max(...changes);
  const minVal = Math.min(...changes);
  return {
    count: changes.length,
    lastDate: series[series.length - 1].date,
    upText: `${up}只涨`,
    flatDownText: `${changes.length - up}只没涨`,
    rangeText: `最高 ${signedPct(maxVal, 1)} · 最低 ${signedPct(minVal, 1)}`,
    ...zeroAxisBars(changes),
  };
}

// 「申购结束」视图的同类新股涨跌中位数，按超购热度分两批画横条，零轴居中。
// 数字和详情页 hkExitTierBarsVisual() 同一份 buildHkExitBands 统计。
function hkExitTierChart(bands) {
  if (!bands || !bands.sampleCount) return null;
  const stages = [
    { key: "grey", label: "暗盘" },
    { key: "firstDay", label: "首日" },
    { key: "fiveDay", label: "首周" },
  ];
  const tiers = [
    { key: "hot", label: `超购≥${HK_HOT_OVERSUBSCRIPTION}倍` },
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
    sampleText: `${bands.sampleCount} 只历史样本 · 中位数 · 收正/样本`,
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
function usOrderFields() {
  // 历史视图不提供到价动作，读屏文本也不能残留即时下单价。
  return { order: null, hasOrder: false, orderTone: "", orderLabel: "", orderValue: "", orderNote: "" };
}

function usFactChips(item, spark) {
  const fund = (item.raw && item.raw.fund) || {};
  const chips = [];
  const pe = finiteOrNull(fund.pe);
  const revG = finiteOrNull(fund.revenueGrowth);
  if (pe != null && pe > 0) chips.push({ label: `PE ${pe.toFixed(1)}x`, tone: "plain" });
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
      subText: row.sortStability != null ? `稳度${row.sortStability}分` : row.priceText,
      tileTone: yieldTileTone(y),
    };
  });
}

function usStockRow(item, sparkCache = null) {
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
  const shortTag = shortTagFor("us", item.id, item.code);
  const hasRangeBar = lo60 != null && hi60 != null && sortPos60 != null;
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    shortTag,
    hasRangeBar,
    lo60Text: lo60 != null ? `$${lo60.toFixed(0)}` : "",
    hi60Text: hi60 != null ? `$${hi60.toFixed(0)}` : "",
    pos60Pct: sortPos60 != null ? sortPos60 : 50,
    posChip: sortPos60 != null ? `${sortPos60}%位` : "",
    peChip: pe != null && pe > 0 ? `PE ${pe.toFixed(1)}x` : "",
    badgeText: plainLabel(signal.label),
    tone: usTone(signal.tone),
    reason: signal.action,
    asOfText: referenceDateText([raw.asOf]),
    factChips: usFactChips(item, spark),
    isSeven: MAGNIFICENT_SEVEN.includes(String(item.code || "").toUpperCase()),
    sortPe: finiteOrNull(fund.pe),
    sortMargin: finiteOrNull(fund.grossMargin),
    sortGrowth: finiteOrNull(fund.revenueGrowth),
    sortPerf60: perf60,
    sortPos60,
    ...usMetrics(item),
    ...spark,
    ...usOrderFields(item, signal),
  };
}

function buildUsModule(snapshot) {
  const items = allItems(snapshot, "us");
  const sevenItems = items.filter((item) => item.group === "seven");
  const hotItems = items.filter((item) => item.group === "hot");
  const sparkCache = new Map();

  const triggerTiles = []; // 历史参考不生成即时到价提示。

  const sevenList = sevenItems.map((item) => usStockRow(item, sparkCache)).map(({ order, ...row }) => ({
    ...row,
    event: eventBrief(snapshot, row.code),
    eventDate: eventFactFor(snapshot, row.code).eventDate || "",
  }));
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
      .map((item) => usStockRow(item, sparkCache))
      .sort((left, right) => compareUsOrder(left.order, right.order))
      .map(({ order, ...row }) => row);
    return _allList;
  };

  const computeHotList = () => {
    if (_hotList) return _hotList;
    _hotList = hotItems.map((item) => {
      const raw = item.raw || {};
      const { order, ...orderFields } = usOrderFields(item, buildStrategySignal(item));
      const fund = raw.fund || {};
      let takeText = "质量待核";
      let takeTone = "caution";
      if (usQualityEligibility(fund) === true) { takeText = "质量达标"; takeTone = "worth"; }
      else if (usQualityEligibility(fund) === false) { takeText = "质量不达标"; takeTone = "avoid"; }
      const heat = finiteOrNull(raw.heatScore);
      const cacheKey = item.code || item.id;
      const spark = cacheKey && sparkCache.has(cacheKey)
        ? sparkCache.get(cacheKey)
        : historySpark(item, US_SPARK_SIZE);
      if (cacheKey) sparkCache.set(cacheKey, spark);
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        why: item.heatDriver || "",
        event: eventBrief(snapshot, item.code),
        eventDate: eventFactFor(snapshot, item.code).eventDate || "",
        takeText,
        takeTone,
        heatText: heat != null ? String(Math.round(heat)) : "—",
        asOfText: referenceDateText([raw.asOf]),
        factChips: usFactChips(item, spark),
        ...usMetrics(item),
        ...spark,
        ...orderFields,
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
    _filingsFeed = rawFilings
      .filter((entry) => entry && entry.symbol && entry.filingDate)
      .slice()
      .sort((a, b) => String(b.filingDate || "").localeCompare(String(a.filingDate || "")))
      .slice(0, 24)
      .map((entry, idx) => {
        const sym = String(entry.symbol || "").toUpperCase();
        const matched = poolByCode.get(sym);
        const labels = Array.isArray(entry.labels) ? entry.labels.filter(Boolean) : [];
        return {
          key: `sec-${sym}-${entry.filingDate}-${idx}`,
          id: matched ? matched.id : sym,
          name: matched ? matched.name : tickerZhLabel(sym, sym),
          code: sym,
          form: entry.form || "8-K",
          date: String(entry.filingDate || ""),
          summary: labels.join(" · ") || "公开备案",
          sourceUrl: entry.sourceUrl || "",
        };
      });
    return _filingsFeed;
  };

  return {
    triggerTiles,
    sevenList,
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

function aRankedList(items, lens) {
  return items
    .filter((item) => item.lensRank && item.lensRank[lens])
    .sort((left, right) => left.lensRank[lens] - right.lensRank[lens])
    .map((item) => {
      const plan = null; // 历史榜单不展示模型买卖价。
      const historicalYield = getHistoricalDividendYield(item.raw);
      const stabilityDetail = getDividendStability(item.raw);
      const stability = stabilityDetail.score != null ? stabilityDetail.score : aShareDividendStability(item.raw);
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
      if (stability != null) yieldParts.push(`稳度 ${stability}分`);
      // 现价落在「参考买—参考卖」之间的位置；越过两端就钉在端点，颜色标出越界方向。
      let pricePos = null;
      let priceZone = "";
      if (plan && plan.trimPrice > plan.addPrice) {
        const pos = ((plan.price - plan.addPrice) / (plan.trimPrice - plan.addPrice)) * 100;
        pricePos = Math.max(0, Math.min(100, Math.round(pos)));
        priceZone = plan.zone;
      }
      const raw = item.raw || {};
      const curPrice = finiteOrNull(raw.currentPrice);
      const dataChips = [];
      if (lens === "stable5" && historicalYield) dataChips.push(`股息 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (lens !== "stable5" && stability != null) dataChips.push(`稳度 ${stability}分`);
      if (curPrice != null) dataChips.push(`一手 ¥${Math.round(curPrice * 100).toLocaleString("en-US")}`);
      const spark = historySpark(item, US_SPARK_SIZE);
      return {
        id: item.id,
        rank: item.lensRank[lens],
        name: item.name,
        code: formatACode(item.code, item.id),
        shortTag: shortTagFor("a", item.id, item.code, raw.industry),
        dataChips,
        ...spark,
        badgeText: item.badge,
        tone: aTone(item.group),
        metricText,
        metricUnit: lens === "stable5" ? "分" : "%",
        metricLabel: lens === "stable5" ? "稳定性" : "历史股息率",
        stability,
        historicalYield: historicalYield ? historicalYield.yieldPercent : null,
        stableBasis: stableParts.join(" · "),
        yieldBasis: yieldParts.join(" · "),
        yearDots: buildDividendDots(item.raw),
        buyText: plan ? money(plan.addPrice, "¥") : "待更新",
        sellText: plan ? money(plan.trimPrice, "¥") : "待更新",
        priceText: plan ? money(plan.price, "¥") : "",
        hasPricePos: pricePos != null,
        pricePos,
        priceLabelPos: pricePos != null ? Math.max(14, Math.min(86, pricePos)) : 0,
        priceZone,
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

// 前五只展示名字和对应分红指标，其余页签按需懒计算，首屏仅算 5 条。
function buildAModule(snapshot) {
  const items = allItems(snapshot, "a");
  const stableList = withMetricBars(aRankedList(items, "stable5"), "stable5");
  let _yieldList = null;
  let _allPack = null;
  let _fund = undefined;
  const ensureAll = () => {
    if (!_allPack) _allPack = aAllModule(items, snapshot.actionsFresh !== false);
    return _allPack;
  };
  return {
    stableList,
    get yieldList() {
      if (!_yieldList) _yieldList = withMetricBars(aRankedList(items, "yield5"), "yield5");
      return _yieldList;
    },
    get allList() { return ensureAll().allList; },
    get triggerTiles() { return ensureAll().triggerTiles; },
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
      const order = null; // 历史资料不触发“已到买卖价”。
      const line = aOrderLine(order);
      const price = finiteOrNull(raw.currentPrice);
      const change = finiteOrNull(raw.changePercent);
      const historicalYield = getHistoricalDividendYield(raw);
      const stabilityDetail = getDividendStability(raw);
      const stability = stabilityDetail.score != null ? stabilityDetail.score : aShareDividendStability(raw);
      const factParts = [];
      if (historicalYield) factParts.push(`股息率 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (stability != null) factParts.push(`稳度 ${stability}分`);
      const dataChips = [];
      if (historicalYield) dataChips.push(`股息 ${historicalYield.yieldPercent.toFixed(2)}%`);
      if (stability != null) dataChips.push(`稳度 ${stability}分`);
      if (price != null) dataChips.push(`一手 ¥${Math.round(price * 100).toLocaleString("en-US")}`);
      if (historicalYield) dataChips.push(`万分红 ¥${Math.round(historicalYield.yieldPercent * 100)}`);
      const spark = historySpark(item, US_SPARK_SIZE);
      return {
        order,
        id: item.id,
        name: item.name,
        code: formatACode(item.code, item.id),
        shortTag: shortTagFor("a", item.id, item.code, raw.industry),
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
        priceText: price != null ? money(price, "¥") : "—",
        asOfText: referenceDateText([raw.priceAsOf || raw.asOf]),
        changeText: signedPct(change, 2),
        changeTone: change == null ? "flat" : (change >= 0 ? "up" : "down"),
        hasOrder: false,
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

function buildGoldModule(snapshot) {
  const gold = snapshot.gold || {};
  const answer = gold.answer || {};
  const plan = goldPlanView(answer.pricePlan);
  const international = gold.quotes?.international || {};
  const domestic = domesticGoldClose(snapshot) || {};

  const intlZone = goldZoneForPrice(international.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk);
  const cnyZone = goldZoneForPrice(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk);

  const intlChange = finiteOrNull(international.changePercent);
  const domChange = finiteOrNull(domestic.changePercent);
  const quotes = [
    {
      id: "usd",
      label: "国际金",
      code: "XAU",
      priceText: hasNumber(international.price) ? Number(international.price).toFixed(0) : "待更新",
      unit: "美元 / 盎司",
      asOfText: referenceDateText([international.asOf]),
      changeText: intlChange != null ? signedPct(intlChange, 2) : "",
      changeTone: intlChange == null ? "flat" : (intlChange >= 0 ? "up" : "down"),
    },
    {
      id: "cny",
      label: "人民币金",
      code: "Au99.99",
      priceText: hasNumber(domestic.price) ? Number(domestic.price).toFixed(2) : "待更新",
      unit: "元 / 克",
      asOfText: referenceDateText([domestic.asOf], "收盘"),
      changeText: domChange != null ? signedPct(domChange, 2) : "",
      changeTone: domChange == null ? "flat" : (domChange >= 0 ? "up" : "down"),
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

  const parityInfo = goldParity(gold);
  const parityLine = parityInfo ? parityInfo.headline : "";

  return { quotes, perCurrency, parityLine };
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

// 持仓表先找中文名：代码对得上就「TSM（台积电）」，基金月报只有英文全称的
// 就按全称对（「Tencent Holdings Ltd」→「腾讯控股」）。都对不上才原样显示。
const HAS_HAN = /[\u4e00-\u9fa5]/u;
function guruHoldingName(holding) {
  if (!holding) return holdingLabel(holding);
  const suffix = instrumentSuffix(holding.putCall);
  const byTicker = holding.ticker ? tickerZhLabel(holding.ticker) : "";
  if (HAS_HAN.test(byTicker)) return `${byTicker}${suffix}`;
  const byName = tickerZhLabel(holding.issuer || holding.name || "");
  if (HAS_HAN.test(byName)) return `${byName}${suffix}`;
  // 没有中文名的美股小盘：「NTRA（Natera）」，和有中文名的「TSM（台积电）」同一个写法。
  if (/^[A-Z]{1,5}(\.[A-Z])?$/u.test(String(holding.ticker || ""))) {
    return `${tickerZhLabel(holding.ticker, holding.issuer || holding.name)}${suffix}`;
  }
  return holdingLabel(holding);
}

// 「机构持仓」跟随原型的「共同方向/机构持仓」两个视图，数据全部来自
// smartMoneyItems（今日答案同一份 profiles）和 buildGuruTrend（未来持仓
// 趋势同一份季度加减仓聚合），不新起一套计算。
function guruTrendRow(row) {
  const counts = { up: 0, new: 0, down: 0, exit: 0 };
  for (const entry of [...row.adders, ...row.cutters]) counts[entry.type] += 1;
  const badge = [["up", "增持"], ["new", "新进"], ["down", "减持"], ["exit", "清仓"]]
    .filter(([type]) => counts[type] > 0)
    .map(([type, label]) => `${counts[type]}家${label}`)
    .join(" · ");
  const tone = row.adders.length && row.cutters.length ? "caution" : (row.adders.length ? "worth" : "avoid");
  const label = tickerZhLabel(row.name || row.symbol, row.issuer) || "待更新";
  const rawSym = String(row.symbol || "").trim().toUpperCase();
  const code = /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(rawSym) && !label.includes(rawSym) ? rawSym : "";
  return { key: row.symbol || row.name, label, code, tone, badge };
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
  return rows.map(guruTrendRow);
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
  // 增减需要前后两期可比。单期申报里的持仓不能当成新进。
  const investors = Array.isArray(snapshot.investors) ? snapshot.investors.filter(hasAdjacentGuruReports) : [];
  const trend = buildGuruTrend({ investors });
  const trendRows = guruTrendRowsFrom(trend);
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
      const code = /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(rawTicker) && !displayName.includes(rawTicker) ? rawTicker : "";
      return {
        name: displayName,
        code,
        weightText: Number.isFinite(weight) ? `${weight.toFixed(1)}%` : "—",
        weightBar: Number.isFinite(weight) ? Math.max(3, Math.round((weight / topWeight) * 100)) : 0,
        moveText: move || "—",
        moveTone: /新进|新建|增持/.test(move) ? "worth" : (/减持|清仓|退出/.test(move) ? "avoid" : ""),
      };
    });
    const currency = item.group === "a" ? "¥" : "$";
    const history = Array.isArray(item.raw?.history) ? item.raw.history : [];
    const isLive = Boolean(item.raw?.isLive);
    const trackingScore = Number.isFinite(Number(item.raw?.trackingScore)) ? Number(item.raw.trackingScore) : null;
    const shortDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).slice(2) : "—");
    const built = {
      rows,
      hint: rows.length ? `重仓前 ${rows.length}` : "暂无持仓披露",
      stats: [
        { label: "报告期", value: shortDate(item.raw?.reportDate) },
        { label: "披露日", value: shortDate(item.raw?.filingDate) },
        { label: "来源", value: isLive ? "美国证监会" : "基金定期报告" },
        { label: "可靠度", value: trackingScore != null ? String(trackingScore) : "—" },
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
  const defaultId = String((profiles[0] && profiles[0].id) || "");
  return { profiles, trend, trendRows, trendTitle, trendHint, trendEmptyText, institutionList, holdingsByInstitution, defaultId };
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
  hk: { id: "hk-open", ask: "还没有港股账户？", go: "查看港股开户", url: "/pages/guide/index?topic=hk-open&from=section" },
  us: { id: "us-start", ask: "第一次买美股？", go: "查看美股开户", url: "/pages/guide/index?topic=us-start&from=section" },
  a: { id: "a-open", ask: "还没有A股账户？", go: "查看A股开户", url: "/pages/guide/index?topic=a-open&from=section" },
  gold: { id: "info", ask: "获取更多全球信息？", go: "查看全球信息入口", url: "/pages/guide/index?topic=info&from=section" },
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
    // 美股专属：原型的「七姐妹/热门三只/SEC公告」视图，只有 market==='us' 时渲染。
    usSubTab: "seven",
    usHeatMode: "day",
    usHeatmap: [],
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
    // 机构持仓专属：模仿富途「明星机构持仓」，一进来直接看各家机构重仓，点铭牌秒切。
    guruSubTab: "holdings",
    guruTrendRows: [],
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
        const hkExitList = hkModule.exitList;
        this._hkExitList = hkExitList;
        const hkSelection = resolveHkExitSelection(hkExitList, this.data.hkExitSelectedId);
        Object.assign(patch, {
          hkApplyList: hkModule.applyList,
          hkApplyTiles: hkModule.applyTiles,
          hkFirstDayChart: hkModule.firstDayChart,
          hkExitOptions: hkExitList.map((item) => ({ id: item.id, text: item.text })),
          hkExitIndex: hkSelection.index,
          hkExitSelectedId: hkSelection.id,
          hkExitView: hkSelection.view,
          hkExitChart: hkModule.exitChart,
        });
      } else if (market === "us" && cached.usModule) {
        const usModule = cached.usModule;
        Object.assign(patch, {
          usTriggerTiles: usModule.triggerTiles,
          usSevenList: usModule.sevenList,
          usSevenHint: usModule.sevenHint,
          usSevenMix: usModule.sevenMix,
          usHotHint: usModule.hotHint,
        });
        // 按激活子 tab 懒下发列表（含 SVG Base64），首屏只算并只传七家大公司 7 条。
        if (this.data.usSubTab === "hot") patch.usHotList = usModule.hotList;
        if (this.data.usSubTab === "filings") patch.usFilingsList = usModule.filingsFeed || [];
        if (this.data.usSubTab === "heatmap") patch.usHeatmap = buildUsHeatmap(usModule.allList, this.data.usHeatMode);
        if (this.data.usSubTab === "all") patch.usAllList = this.applyUsView(usModule.allList, this.data.usAllFilter, this.data.usAllSort);
        this._usModule = usModule;
      } else if (market === "a" && cached.aModule) {
        const aModule = cached.aModule;
        this._aModule = aModule;
        Object.assign(patch, {
          aStableList: aModule.stableList,
        });
        if (this.data.aSubTab === "yield") patch.aYieldList = aModule.yieldList;
        if (this.data.aSubTab === "heatmap") patch.aHeatmap = buildAHeatmap(aModule.allList, this.data.aHeatMode);
        if (this.data.aSubTab === "all") {
          patch.aAllList = this.applyAView(aModule.allList, this.data.aAllFilter, this.data.aAllSort);
          patch.aFund = aModule.fund;
        }
      } else if (market === "gold" && cached.goldModule) {
        const goldModule = cached.goldModule;
        this._goldModule = goldModule;
        const goldView = resolveGoldView(goldModule, this.data.goldCurrency, this.data.goldPeriod);
        Object.assign(patch, {
          goldQuotes: goldModule.quotes,
          goldParityLine: goldModule.parityLine || "",
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
          sourceLinks: cached.sourceLinks,
          guruTrendRows: guruModule.trendRows,
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
  switchUsSubTab(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.usSubTab) return;
    const patch = { usSubTab: id };
    const mod = this._usModule;
    if (id === "hot" && !this.data.usHotList.length && mod) {
      patch.usHotList = mod.hotList;
    }
    if (id === "filings" && !this.data.usFilingsList.length && mod) {
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
    if (id === "yield" && !this.data.aYieldList.length && mod) {
      patch.aYieldList = mod.yieldList;
    }
    if (id === "heatmap" && mod) {
      patch.aHeatmap = buildAHeatmap(mod.allList, this.data.aHeatMode);
    }
    if (id === "all" && mod) {
      patch.aAllList = this.applyAView(mod.allList, this.data.aAllFilter, this.data.aAllSort);
      patch.aFund = mod.fund || null;
    }
    this.setData(patch);
    track("section_tab", { market: "a", tab: String(id) });
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
    this.setData({
      aAllSort: sortId,
      aAllList: this.applyAView(all, this.data.aAllFilter, sortId),
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
