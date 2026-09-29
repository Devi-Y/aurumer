const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName, money, aShareDividendStability, tickerZhLabel } = require("../../utils/answers");
// 结论行要按「低估 / 风险」这两个透镜选人，和今日答案用同一个判断。
const { matchesGroup, parseOfferPrice, yieldImpliedPlan, goldZoneForPrice, goldTurningPoint } = require("../../utils/market-lenses");
// 港股打新「中签后」每只股票自己的观察分位——已经是详情页在用的同一份
// 真实数据计算，这里原样复用，不重新写一遍价格逻辑。
const { buildHkExitPlan, buildHkExitBands, HK_HOT_OVERSUBSCRIPTION } = require("../../utils/hk-exit-plan");
// 美股「七姐妹」每行的判断句复用详情页同一套 usSignal——不是另起一套话术。
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { MASTER_PLAYBOOKS } = require("../../utils/master-playbooks");
const { buildHkHistoryStats, hkFirstDaySeries } = require("../../utils/hk-history-stats");
const { buildDailyAnswers, goldMonthDay } = require("../../utils/daily-answers");
const { listHoldings } = require("../../utils/local-holdings");
const { marketSources } = require("../../utils/sources");
// 「机构持仓」的共识加减仓聚合，和今日答案卡片（未来持仓趋势）同一份计算，
// 不重新写一遍 13F 方向统计。
const { buildGuruTrend } = require("../../utils/guru-trend");
const { holdingLabel, instrumentSuffix } = require("../../utils/guru-changes");
// 页头那句「数据截至 …」和新闻资讯页共用同一个写法。
const { asOfText } = require("../../utils/dates");
// 美股每行、红利 ETF 卡的小走势图，和首页走势卡同一套画法。
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
    title: "聪明钱跟踪",
    // 思路与借鉴收进了「未来持仓趋势」的展开层，副标题跟着答案卡走。
    one: "持仓 · 本季加减 · 方向与边界",
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

// 没有截止日就留空，不在每行底下印一句「待更新」。
function hkDeadlineLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  const offset = hkDeadlineOffset(value);
  const dateText = `${month}月${day}日`;
  if (offset < 0) return `${dateText} 已截止`;
  if (offset === 0) return `今日 ${dateText} 截止`;
  if (offset === 1) return `明日 ${dateText} 截止`;
  return `${dateText} 截止 · ${offset}天后`;
}

// 「2,665.8百万港元」→「HK$26.7亿」；认不出单位就不显示，不猜。
function hkCornerstoneText(raw) {
  const percent = finiteOrNull(raw.cornerstonePercent);
  if (percent != null) return `${percent.toFixed(1)}%`;
  const match = String(raw.cornerstoneAmount || "").replace(/,/g, "").match(/([\d.]+)\s*(百万|亿)/);
  if (!match) return "—";
  const value = Number(match[1]) * (match[2] === "亿" ? 1e8 : 1e6);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 1e8 ? `HK$${(value / 1e8).toFixed(1)}亿` : `HK$${Math.round(value / 1e4)}万`;
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
  const priority = { worth: 0, caution: 1, avoid: 2 };
  const applyItems = items.filter((item) => (item.lenses || []).includes("live"));
  const sortedApply = [...applyItems].sort((left, right) => (priority[left.group] ?? 3) - (priority[right.group] ?? 3));
  const exitItems = items.filter((item) => item.group === "settled");

  const applyList = sortedApply.map((item) => {
    const raw = item.raw || {};
    const offer = parseOfferPrice(raw.offerPrice || raw.priceHigh || raw.priceLow);
    const entryFee = finiteOrNull(raw.entryFee);
    const score = finiteOrNull(raw.publicAnswer && raw.publicAnswer.score);
    return {
      id: item.id,
      name: shortCompanyName(item.name, item.code || "新股", 10),
      code: String(item.code || "").replace(/\.HK$/i, ""),
      badgeText: item.badge || "待定",
      tone: hkTone(item.group),
      reason: item.one || "",
      deadlineLabel: hkDeadlineLabel(raw.offerDeadline || raw.offerEnd),
      closed: (hkDeadlineOffset(raw.offerDeadline || raw.offerEnd) ?? 0) < 0,
      stats: [
        { label: "招股价", value: offer != null ? `HK$${offer}` : "待更新" },
        { label: "一手", value: entryFee != null ? `HK$${Math.round(entryFee).toLocaleString("en-US")}` : "待更新" },
        { label: "基石", value: hkCornerstoneText(raw) },
      ],
      score: score && score > 0 ? Math.round(score) : null,
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
    firstDayChart: hkFirstDayChart(snapshot),
    exitList,
    exitChart: hkExitTierChart(buildHkExitBands(snapshot)),
  };
}

// 「近期申购」顶上一张零轴柱：最近上市的新股首日涨跌，从早到晚一根一根排，
// 看打新行情冷热。和首页「港股首日」卡同一份 hkFirstDaySeries。
function hkFirstDayChart(snapshot) {
  const changes = hkFirstDaySeries(snapshot).map((item) => item.change);
  if (changes.length < 3) return null;
  const sorted = [...changes].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: changes.length,
    upText: `${changes.filter((value) => value > 0).length}/${changes.length}`,
    medianText: signedPct(median),
    medianTone: toneOf(median),
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
      badgeText: signal.label,
      tone: usTone(signal.tone),
      reason: signal.action,
      ...usMetrics(item),
      ...historySpark(item, US_SPARK_SIZE),
    };
  });
  const labelCounts = new Map();
  sevenList.forEach((item) => {
    const entry = labelCounts.get(item.badgeText) || { label: item.badgeText, tone: item.tone, count: 0 };
    entry.count += 1;
    labelCounts.set(item.badgeText, entry);
  });
  const toneOrder = { worth: 0, caution: 1, avoid: 2 };
  const sevenMix = [...labelCounts.values()].sort((left, right) => (toneOrder[left.tone] ?? 3) - (toneOrder[right.tone] ?? 3));
  const sevenHint = sevenMix.map((entry) => `${entry.count} 家${entry.label}`).join(" · ") || "七姐妹判断待更新";

  const hotList = hotItems.map((item) => {
    const raw = item.raw || {};
    const fund = raw.fund || {};
    let takeText = "质量待核";
    let takeTone = "caution";
    if (fund.qualityEligible === true) { takeText = "质量达标"; takeTone = "worth"; }
    else if (fund.qualityEligible === false) { takeText = "未过质量门"; takeTone = "avoid"; }
    const heat = finiteOrNull(raw.heatScore);
    return {
      id: item.id,
      name: item.name,
      code: item.code,
      why: item.heatDriver || "",
      takeText,
      takeTone,
      heatText: heat != null ? String(Math.round(heat)) : "—",
      ...historySpark(item, US_SPARK_SIZE),
    };
  });
  const hotHint = hotList.length
    ? `热度前 ${hotList.length} 只 · 不含七姐妹`
    : "近期没有明显热度突出的美股";

  return { sevenList, sevenHint, sevenMix, hotList, hotHint };
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
      // yield5 现在按可持续股息率排序（先过滤高息待核），这一列必须跟排序
      // 依据同一个数，不能继续显示当前股息率——那是另一个数，会和名次对不上。
      const sustainableYield = Number(item.raw.sustainableDividendYield);
      const stability = aShareDividendStability(item.raw);
      const metricText = lens === "stable5"
        ? (stability != null ? String(stability) : "—")
        : (Number.isFinite(sustainableYield) ? `${sustainableYield.toFixed(1)}%` : "—");
      // 现价落在「参考买—参考卖」之间的位置；越过两端就钉在端点，颜色标出越界方向。
      let pricePos = null;
      let priceZone = "";
      if (plan && plan.trimPrice > plan.addPrice) {
        const pos = ((plan.price - plan.addPrice) / (plan.trimPrice - plan.addPrice)) * 100;
        pricePos = Math.max(0, Math.min(100, Math.round(pos)));
        priceZone = plan.zone;
      }
      return {
        id: item.id,
        rank: item.lensRank[lens],
        name: item.name,
        code: item.code,
        badgeText: item.badge,
        tone: aTone(item.group),
        metricText,
        metricUnit: lens === "stable5" && stability != null ? "分" : "",
        metricLabel: lens === "stable5" ? "稳定性" : "可持续股息率",
        stability,
        sustainableYield: Number.isFinite(sustainableYield) ? sustainableYield : null,
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
  const values = list.map((item) => (lens === "stable5" ? item.stability : item.sustainableYield)).filter((value) => value != null);
  const max = lens === "stable5" ? 100 : Math.max(...values, 1e-6);
  return list.map((item) => {
    const value = lens === "stable5" ? item.stability : item.sustainableYield;
    return { ...item, metricBar: value != null ? Math.max(4, Math.round((value / max) * 100)) : 0 };
  });
}

// A股收息按原型忠实复刻：「分红稳定性/分红收益性」前五，每行带参考买卖价。
// 原型demo数据编了「连续分红N年」，真实数据里没有连续分红年数这个字段——
// 只有 aShareDividendStability 算出的0-100稳定性分（覆盖率/现金流/ROE加权），
// 用这个真实分数替代，不编年数。
function buildAModule(snapshot) {
  const items = allItems(snapshot, "a");
  const stableList = withMetricBars(aRankedList(items, "stable5"), "stable5");
  const yieldList = withMetricBars(aRankedList(items, "yield5"), "yield5");
  const fundItem = items.find((item) => item.raw && item.raw.assetType === "fund");
  return { stableList, yieldList, fund: fundItem ? aFundView(fundItem) : null };
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
    name: item.name,
    code: item.code,
    badgeText: item.badge || "红利ETF",
    priceText: price != null ? price.toFixed(3) : "—",
    changeText: signedPct(change, 2),
    changeTone: toneOf(change || 0),
    stats,
    ...historySpark(item, A_FUND_SPARK_SIZE),
  };
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
      { key: "risk", label: "风险下沿", value: riskLow != null ? riskLow.toFixed(digits) : "—" },
      { key: "watch", label: "观察低位", value: goldRangeText(watch, digits) || "—" },
      { key: "upper", label: "观察上沿", value: goldRangeText(upper, digits) || "—" },
    ],
  };
}

// 这张大图带切周期/币种，仍用 Canvas 2D 自己画（paintGoldLineChart）；
// 详情页和首页的折线已改成 utils/sparkline.js 的 SVG 图片。
// canvasId 固定不变（这块画布切周期/币种时不会被 wx:if 销毁重建，只是重新画），
// 每次数据变化后由 drawGoldChart() 重新 paint。
function goldLineChart(history, digits, periodLabel) {
  const values = (history || [])
    .map((entry) => Number(entry.close))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const sampleCount = Math.min(60, values.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (values.length - 1));
    return values[sourceIndex];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const change = values[0] ? ((latest - values[0]) / values[0]) * 100 : null;
  return {
    canvasId: "gold-price-line",
    values: samples,
    changeText: `${periodLabel === "全部" ? `${values.length}日` : periodLabel} ${signedPct(change, 1)}`,
    changeTone: change > 0 ? "up" : change < 0 ? "down" : "flat",
    lowLabel: `最低 ${low.toFixed(digits)}`,
    latestLabel: `最新 ${latest.toFixed(digits)}`,
    highLabel: `最高 ${high.toFixed(digits)}`,
  };
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
  gradient.addColorStop(0, "rgba(29, 95, 209,0.22)");
  gradient.addColorStop(1, "rgba(29, 95, 209,0)");
  ctx.lineTo(pts[pts.length - 1][0], height - padBottom);
  ctx.lineTo(pts[0][0], height - padBottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  tracePath();
  ctx.strokeStyle = "#1d5fd1";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.stroke();

  function dot(i, color, radius) {
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  dot(values.indexOf(high), "#d99a12", 2.5);
  dot(values.indexOf(low), "#8fb2ee", 2.5);

  const lastIdx = pts.length - 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = "#1d5fd1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[lastIdx][0], pts[lastIdx][1]);
  ctx.lineTo(pts[lastIdx][0], height - padBottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(pts[lastIdx][0], pts[lastIdx][1], 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(29, 95, 209,0.18)";
  ctx.fill();
  dot(lastIdx, "#1d5fd1", 2.8);
}

// 数字里免不了 118.2126、-0.4 这种长尾小数，两位小数四舍五入后再去掉多余的
// 尾零——2.60% 不用留成 2.60，直接读 2.6。
function trimTrailingZeros(text) {
  return String(text).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// 详情页 buildGoldView() 已经把这 6 个宏观指标算好，这里原样搬到栏目页
// 首屏，不重新计算、不筛选——用户明确要求 6 个全都摆出来。
function goldIndicatorTiles(gold) {
  const indicators = Array.isArray(gold.indicators) ? gold.indicators : [];
  return indicators.map((item) => {
    const value = Number(item.value);
    const valueText = Number.isFinite(value)
      ? `${trimTrailingZeros(value.toFixed(2))}${item.unit || ""}`
      : "待更新";
    return { id: item.id, label: item.label || item.id, valueText };
  });
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
    chartsByPeriod[period.id] = goldLineChart(intlHistory.slice(-period.days), 0, period.label);
  });

  const quotes = [
    {
      id: "usd",
      label: "国际金",
      priceText: hasNumber(international.price) ? Number(international.price).toFixed(0) : "待更新",
      unit: "美元 / 盎司",
      ...goldScoreMeter(internationalScore),
    },
    {
      id: "cny",
      label: "人民币金",
      priceText: hasNumber(domestic.price) ? Number(domestic.price).toFixed(1) : "待更新",
      unit: "元 / 克",
      ...goldScoreMeter(domesticScore),
    },
  ];

  const perCurrency = {
    usd: {
      currencyLabel: "国际金 · 美元 / 盎司",
      zoneLabel: intlZone.label,
      zoneTone: goldTone(intlZone.tone),
      ladder: goldLadder(international.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk, 0),
      periods: GOLD_PERIODS.map((period) => ({ id: period.id, label: period.label })),
      chartsByPeriod,
      chartNote: "",
    },
    cny: {
      currencyLabel: "人民币金 · 元 / 克",
      zoneLabel: cnyZone.label,
      zoneTone: goldTone(cnyZone.tone),
      ladder: goldLadder(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk, 1),
      // 人民币金历史目前只有2个真实交易日，画不出有意义的走势图，如实说明，
      // 不拿两个点硬凑一条线。
      periods: [],
      chartsByPeriod: {},
      chartNote: `走势样本仅 ${cnyHistory.length} 个交易日`,
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

  const indicatorTiles = goldIndicatorTiles(gold);

  return { quotes, perCurrency, trendTone, trendBadge, trendTitle, trendDetail, indicatorTiles };
}

// 观察分（0–100）画成币种卡片里的一根细条，原来藏在「查看判断依据」折叠里。
function goldScoreMeter(score) {
  if (!Number.isFinite(score)) return { hasScore: false, scoreText: "", scoreWidth: 0 };
  const clamped = Math.max(0, Math.min(100, score));
  return { hasScore: true, scoreText: String(score), scoreWidth: Math.max(4, Math.round(clamped)) };
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

// 持仓表只剩裸代码（没有 issuer/name）时括注中文名——「TSM 5.4%」对没炒过
// 美股的读者不成句子，「TSM（台积电）5.4%」才是。有全称的不动。
function guruHoldingName(holding) {
  const hasFullName = Boolean(holding && (holding.issuer || holding.name));
  if (hasFullName || !holding || !holding.ticker) return holdingLabel(holding);
  return `${tickerZhLabel(holding.ticker)}${instrumentSuffix(holding.putCall)}`;
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
  // 裸代码（TSM/AMD…）括注中文名，「TSM」对没炒过美股的读者不成句子。
  const label = tickerZhLabel(row.name || row.symbol) || "待更新";
  return { key: row.symbol || row.name, label, tone, badge, widthPct };
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

// 报告期"2026-06-30" → "26Q2"，8 期历史挤在一条横向图表里，完整日期放不下。
function guruQuarterLabel(reportDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(reportDate || ""));
  if (!match) return reportDate || "待更新";
  const quarter = Math.ceil(Number(match[2]) / 3);
  return `${match[1].slice(2)}Q${quarter}`;
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
  const profiles = allItems(snapshot, "guru").filter((item) => item.group !== "overlap");
  const trend = buildGuruTrend(snapshot);
  const trendRows = guruTrendRowsFrom(trend);
  const marketTag = { us: "美", hk: "港", a: "A" };
  const institutionList = profiles.map((item) => {
    // 「约 30% 年化」「12.18% 年化」抽出数字，右侧只摆一个大数；原文带「约」的
    // 保留成 ≈，小数最多一位，不把估算值写得比原文更精确。
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
  const holdingsByInstitution = {};
  profiles.forEach((item) => {
    const holdings = Array.isArray(item.raw?.holdings) ? item.raw.holdings : [];
    // 13F/十大重仓最多给到 10 条（answers.js 的 smartMoneyItems 已 slice(0,10)），
    // 这里跟着展示到 10，默认只露前 5，其余靠「展开」按需加载，不新取数。
    const topWeight = Math.max(...holdings.slice(0, 10).map((holding) => Number(holding.weight)).filter(Number.isFinite), 1e-6);
    const rows = holdings.slice(0, 10).map((holding) => {
      const weight = Number(holding.weight);
      const move = String(holding.changeLabel || "");
      return {
        name: guruHoldingName(holding),
        weightText: Number.isFinite(weight) ? `${weight.toFixed(1)}%` : "—",
        weightBar: Number.isFinite(weight) ? Math.max(3, Math.round((weight / topWeight) * 100)) : 0,
        moveText: move || "—",
        // 和「共同方向」条形图同一套色：加仓绿、减仓红，持有类中性。
        moveTone: /新进|新建|增持/.test(move) ? "worth" : (/减持|清仓|退出/.test(move) ? "avoid" : ""),
      };
    });
    // 美股 13F 经理（group:us/hk）披露单位是美元，东方财富A股基金（group:a）是人民币。
    const currency = item.group === "a" ? "¥" : "$";
    const history = Array.isArray(item.raw?.history) ? item.raw.history : [];
    // isLive 为真代表这条数据来自 investors[] 的实时 13F 快照；为假的 6 家
    // （3 港股 + 3 A股样本基金）用的是静态定期报告样本，不是 13F，要诚实标注，
    // 复用 detail/index.js 里已经在用的同一套 isLive 判断。
    const isLive = Boolean(item.raw?.isLive);
    const trackingScore = Number.isFinite(Number(item.raw?.trackingScore)) ? Number(item.raw.trackingScore) : null;
    const shortDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).slice(2) : "—");
    holdingsByInstitution[item.id] = {
      rows,
      hint: rows.length ? `重仓前 ${rows.length}` : "暂无持仓披露",
      // 报告期 / 披露日 / 来源 / 可靠度四格，取代原来三行说明文字。
      stats: [
        { label: "报告期", value: shortDate(item.raw?.reportDate) },
        { label: "披露日", value: shortDate(item.raw?.filingDate) },
        { label: "来源", value: isLive ? "SEC 13F" : "定期报告" },
        { label: "可靠度", value: trackingScore != null ? String(trackingScore) : "—" },
      ],
      isLive,
      trackingScore,
      historyChart: guruHistoryChart(history, currency),
      historyRowsData: guruHistoryRows(history, currency),
      historyHint: history.length >= 2 ? `近 ${history.length} 期季度披露` : "",
      // 东方财富十大重仓股接口不披露基金总规模/持仓数，即使有多期 history，
      // portfolioValue 也一直是 null，图表画不出来；措辞要跟"完全没有多期历史"
      // 区分开，不能让人以为下面连新增/清仓表都没有。
      historyChartEmptyText: history.length >= 2
        ? "规模未披露 · 下表为各期新增/清仓"
        : "仅有最新一期披露",
    };
  });
  const defaultId = String(
    ["us", "hk", "a"].map((group) => profiles.find((item) => item.group === group)).find(Boolean)?.id
      || (profiles[0] && profiles[0].id)
      || "",
  );
  return { profiles, trend, trendRows, institutionList, holdingsByInstitution, defaultId };
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
    const items = allItems(snapshot, "hk").filter((item) => item.group !== "ended" && item.group !== "settled");
    // 结论只从还没过截止日的里面挑：已截止的「值得打」挂在页头，用户会以为还能打。
    const stillOpen = (item) => {
      const offset = hkDeadlineOffset(item.raw && (item.raw.offerDeadline || item.raw.offerEnd));
      return offset == null || offset >= 0;
    };
    const rank = { worth: 0, caution: 1, avoid: 2 };
    const live = items
      .filter((item) => item.group !== "cancelled" && stillOpen(item))
      .sort((left, right) => (rank[left.group] ?? 3) - (rank[right.group] ?? 3));
    const lead = live[0];
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
      grade: lead
        ? `${leadLens === "cheap7" ? "低估可买入" : (leadLens === "risk7" ? "风险要减" : "七姐妹")}${scored.score != null ? ` · 综合分${scored.score}` : ""}`
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
    // 「收息样本 12」「优等收息 1」这两格原来单独占一整排，可两个数在分组浏览里
    // 一点就能看到、跟这里说的是同一件事，同一个数字印两遍。数字和入口都留给
    // 分组浏览，这里的结论行只补分组浏览没有的：收息分。
    return {
      metrics: [],
      target: top ? shortCompanyName(top.name, top.code || "—", 6) : "—",
      grade: top
        ? `${top.badge || "待定"}${scored.score != null ? ` · 收息分${scored.score}` : ""}`
        : "—",
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
    hkFirstDayChart: null,
    hkExitOptions: [],
    hkExitIndex: 0,
    hkExitSelectedId: "",
    hkExitView: null,
    hkExitChart: null,
    // 美股专属：原型的「七姐妹/热门三只」两个视图，只有 market==='us' 时渲染。
    usSubTab: "seven",
    usSevenList: [],
    usSevenHint: "",
    usSevenMix: [],
    usHotList: [],
    usHotHint: "",
    // A股收息专属：原型的「分红稳定性/分红收益性」两个前五榜单，只有 market==='a' 时渲染。
    aSubTab: "stable",
    aStableList: [],
    aYieldList: [],
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
    goldLadder: null,
    goldTrendTone: "caution",
    goldTrendBadge: "",
    goldTrendTitle: "",
    goldTrendDetail: "",
    goldIndicatorTiles: [],
    // 机构持仓专属：原型的「共同方向/机构持仓」两个视图，只有 market==='guru' 时渲染。
    guruSubTab: "trend",
    guruTrendRows: [],
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
        source,
        freshness: freshnessBanner(source, meta.kind),
        sourceLinks,
        dataAsOf: asOfText(snapshot && snapshot.updatedAt, meta.kind),
        hkApplyList: hkModule ? hkModule.applyList : [],
        hkFirstDayChart: hkModule ? hkModule.firstDayChart : null,
        hkExitOptions: hkExitList.map((item) => ({ id: item.id, text: item.text })),
        hkExitIndex: hkSelection.index,
        hkExitSelectedId: hkSelection.id,
        hkExitView: hkSelection.view,
        hkExitChart: hkModule ? hkModule.exitChart : null,
        usSevenList: usModule ? usModule.sevenList : [],
        usSevenHint: usModule ? usModule.sevenHint : "",
        usSevenMix: usModule ? usModule.sevenMix : [],
        usHotList: usModule ? usModule.hotList : [],
        usHotHint: usModule ? usModule.hotHint : "",
        aStableList: aModule ? aModule.stableList : [],
        aYieldList: aModule ? aModule.yieldList : [],
        aFund: aModule ? aModule.fund : null,
        goldQuotes: goldModule ? goldModule.quotes : [],
        goldTrendTone: goldModule ? goldModule.trendTone : "caution",
        goldTrendBadge: goldModule ? goldModule.trendBadge : "",
        goldTrendTitle: goldModule ? goldModule.trendTitle : "",
        goldTrendDetail: goldModule ? goldModule.trendDetail : "",
        goldIndicatorTiles: goldModule ? goldModule.indicatorTiles : [],
        goldPeriod: goldView.period,
        goldBadgeText: goldView.badgeText,
        goldZoneTone: goldView.zoneTone,
        goldCurrencyLabel: goldView.currencyLabel,
        goldPeriods: goldView.periods,
        goldChart: goldView.chart,
        goldChartNote: goldView.chartNote,
        goldLadder: goldView.ladder,
        guruTrendRows: guruModule ? guruModule.trendRows : [],
        guruInstitutionList: guruModule ? guruModule.institutionList : [],
        guruInstitutionListShown: institutionListShown(
          guruModule ? guruModule.institutionList : [],
          this.data.guruInstitutionExpanded,
        ),
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
      }, () => {
        this.drawGoldChart();
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
    this.setData({ usSubTab: id });
    track("section_tab", { market: "us", tab: String(id) });
  },
  openUsDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openDetail(id, "section_us");
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
  // 和详情页 resolveCanvasNode 同一套重试逻辑：setData 回调触发时 canvas 节点
  // 有时还没被原生层量出真实尺寸，size.width 读到 0，需要退避重试。
  resolveGoldCanvasNode(attempt, onReady) {
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
