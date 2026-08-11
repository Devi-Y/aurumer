const { openPage, goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER, RISK_LABEL } = require("../../utils/disclaimer");
const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { findItem, money, INVESTOR_NAMES, formatRange, shortCompanyName, shortOrgList } = require("../../utils/answers");
const { scoreForItem } = require("../../utils/strategy-score");
const { buildStrategySignal } = require("../../utils/strategy-signals");
const { buildHkExitPlan } = require("../../utils/hk-exit-plan");
const strategyEvidence = require("../../data/strategy-evidence");
const { captureFact, captureDecisionEvidence } = require("../../utils/fact-snapshot");
const {
  REASON_OPTIONS,
  REVIEW_CONDITION_OPTIONS,
  addDaysLabel,
  todayLabelLocal,
} = require("../../utils/change-center");
const { loadWorkspace, saveDecision, saveWatchItem } = require("../../services/member");

function normalizeMatchCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.HK$/i, "")
    .replace(/\.(SH|SZ)$/i, "");
}

const DETAIL_META = {
  hk: { label: "港股打新", icon: "/assets/home/hk.svg", tone: "hk" },
  us: { label: "美股投资", icon: "/assets/home/us.svg", tone: "us" },
  a: { label: "A股收息", icon: "/assets/home/a.svg", tone: "a" },
  gold: { label: "黄金追踪", icon: "/assets/home/gold.svg", tone: "gold" },
  guru: { label: "机构持仓", icon: "/assets/home/guru.svg", tone: "guru" },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatPercent(value) {
  return hasNumber(value)
    ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`
    : "暂缺";
}

function formatLarge(value) {
  if (!hasNumber(value)) return "暂缺";
  const amount = Number(value);
  const trim = (text) => String(text).replace(/\.0$/, "");
  if (Math.abs(amount) >= 1e12) return `${trim((amount / 1e12).toFixed(2))}万亿`;
  if (Math.abs(amount) >= 1e8) return `${trim((amount / 1e8).toFixed(1))}亿`;
  if (Math.abs(amount) >= 1e4) return `${trim((amount / 1e4).toFixed(1))}万`;
  return amount.toFixed(0);
}


function formatNumber(value, suffix = "") {
  return hasNumber(value) ? `${Number(value).toFixed(2)}${suffix}` : "暂缺";
}

function isSparseValue(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return true;
  return ["暂缺", "待公布", "待解析", "待核验", "暂未披露", "—", "暂无", "资料不足"].includes(text);
}

function compactFacts(rows, limit = 24) {
  return (rows || [])
    .filter((row) => Array.isArray(row) && row[0] && !isSparseValue(row[1]))
    .slice(0, limit);
}

function daysFromToday(dateText) {
  if (!dateText) return null;
  const stamp = Date.parse(String(dateText).replace(/\./g, "-"));
  if (Number.isNaN(stamp)) return null;
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(new Date(stamp).getUTCFullYear(), new Date(stamp).getUTCMonth(), new Date(stamp).getUTCDate());
  return Math.round((target - start) / 86400000);
}

function hkCohortVisual(evidence) {
  const hk = evidence && evidence.markets ? evidence.markets.hk : null;
  if (!hk) return null;
  const rows = [
    hasNumber(hk.averageGreyMarket)
      ? { label: "样本暗盘", value: hk.averageGreyMarket, valueText: `${Number(hk.averageGreyMarket).toFixed(1)}%` }
      : null,
    hasNumber(hk.averageFirstDay)
      ? { label: "样本首日", value: hk.averageFirstDay, valueText: `${Number(hk.averageFirstDay).toFixed(1)}%` }
      : null,
    hasNumber(hk.firstDayWinRate)
      ? { label: "首日胜率", value: hk.firstDayWinRate, valueText: `${Number(hk.firstDayWinRate).toFixed(1)}%` }
      : null,
  ].filter(Boolean);
  if (rows.length < 2) return null;
  return solidVisual(rows, "历史样本对照", {
    hint: `基于 ${hk.points || "多"} 个 IPO 事件样本均值，只作对照，不预测本股。`,
  });
}

function setCharts(base, ...charts) {
  base.charts = charts.filter(Boolean);
  base.visual = base.charts[0] || null;
}

function joinNames(values, fallback = "暂缺") {
  if (Array.isArray(values) && values.length) return shortOrgList(values, "", 2);
  const text = String(fallback || "").trim();
  if (!text || text === "暂缺") return "";
  const parts = text.split(/[、,，/]/).map((part) => part.trim()).filter(Boolean);
  return shortOrgList(parts.length ? parts : [text], "", 2);
}

function announceKindLabel(kind, reason) {
  if (reason && String(reason).trim()) return String(reason).trim().slice(0, 10);
  const map = {
    pricing: "定价公告",
    prospectus: "招股书",
    allotment: "配发结果",
    listing: "上市安排",
    withdrawn: "取消发行",
    update: "进展更新",
  };
  const key = String(kind || "").trim().toLowerCase();
  return map[key] || (key ? "公告已解析" : "");
}

function researchNoteShort(view = {}) {
  const state = String(view.state || "");
  if (state === "complete") return "字段已齐";
  if (state === "limited") return "字段不足";
  if (state === "withdrawn") return "发行取消";
  if (state === "review") return "待再核验";
  const note = String(view.note || "").trim();
  return note ? note.slice(0, 10) : "";
}

function compactRangeText(range, digits = 0) {
  if (!range) return null;
  const low = Number(range.low);
  const high = Number(range.high);
  if (Number.isFinite(low) && Number.isFinite(high) && low !== high) {
    return `${low.toFixed(digits)}–${high.toFixed(digits)}`;
  }
  const value = Number.isFinite(low) ? low : high;
  return Number.isFinite(value) ? value.toFixed(digits) : null;
}

function withChartMeta(chart, hint) {
  if (!chart) return null;
  // 图表教学文案默认关闭，避免详情页信息过载；仅保留标题与数字。
  return chart;
}

function priceVisual(history, title, formatter = (value) => Number(value).toFixed(2), hint) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2) return null;
  const sampleCount = Math.min(36, values.length);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (values.length - 1));
    return values[sourceIndex];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const span = Math.max(high - low, 1);
  const change = values[0] ? ((latest - values[0]) / Math.abs(values[0])) * 100 : 0;
  return withChartMeta({
    kind: "columns",
    title,
    items: samples.map((value, index) => {
      const isLatest = index === samples.length - 1;
      const isHigh = value === high;
      const isLow = value === low;
      return {
        id: `${index}-${value}`,
        height: Math.round(16 + ((value - low) / span) * 84),
        tone: isLatest ? "latest" : (isHigh ? "peak" : (isLow ? "floor" : "")),
      };
    }),
    lowLabel: `最低 ${formatter(low)}`,
    latestLabel: `最新 ${formatter(latest)}`,
    highLabel: `最高 ${formatter(high)}`,
    stats: [
      { label: "样本", value: `${values.length}` },
      { label: "中位", value: formatter(median) },
      { label: "均价", value: formatter(mean) },
      { label: "高低差", value: formatter(high - low) },
      { label: "区间涨跌", value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` },
    ],
  }, hint || "柱越高价格越高；只看历史，不预测明天。");
}

function barVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  const showStats = options.stats !== false && usable.length >= 2;
  return withChartMeta({
    kind: "bars",
    title,
    stats: showStats
      ? [
          { label: "对比项", value: `${usable.length}` },
          { label: "最高项", value: usable.slice().sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))[0].label },
        ]
      : [],
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      width: Math.max(14, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
      colorIndex: index % 4,
    })),
  }, options.hint);
}

/** 扁平竖柱对比：仅用于同一量纲的指标。 */
function solidVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  const unique = new Set(usable.map((item) => Number(item.value).toFixed(4)));
  const showStats = options.stats !== false && usable.length >= 2 && unique.size > 1;
  return withChartMeta({
    kind: "solid",
    title,
    stats: showStats
      ? [
          { label: "对比项", value: `${usable.length}` },
          { label: "最高", value: usable.slice().sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))[0].valueText },
          { label: "最低", value: usable.slice().sort((a, b) => Math.abs(Number(a.value)) - Math.abs(Number(b.value)))[0].valueText },
        ]
      : (usable.length === 1 || unique.size === 1
        ? [{ label: "说明", value: unique.size === 1 ? "数值相同" : "单值" }]
        : []),
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      height: Math.max(22, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
      colorIndex: index % 4,
    })),
  }, options.hint);
}

function scoreMeter(score, title, badge, hint) {
  if (!hasNumber(score)) return null;
  const value = Math.max(0, Math.min(100, Math.round(Number(score))));
  return withChartMeta({
    kind: "meter",
    title,
    percent: value,
    lowLabel: "0",
    midLabel: "",
    highLabel: "100",
    stats: [
      { label: "研究分", value: `${value}` },
      ...(badge ? [{ label: "建议", value: String(badge) }] : []),
    ],
  }, "");
}

function meterVisual(history, currentPrice, title, formatter = money, hint) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2 || !hasNumber(currentPrice)) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const price = Number(currentPrice);
  const percent = high === low ? 50 : Math.round(((price - low) / (high - low)) * 100);
  const clamped = Math.max(0, Math.min(100, percent));
  const distanceLow = price - low;
  const distanceHigh = high - price;
  return withChartMeta({
    kind: "meter",
    title,
    percent: clamped,
    lowLabel: formatter(low),
    midLabel: `${clamped}%`,
    highLabel: formatter(high),
    stats: [
      { label: "最低", value: formatter(low) },
      { label: "当前", value: formatter(price) },
      { label: "最高", value: formatter(high) },
      { label: "距低", value: formatter(distanceLow) },
      { label: "距高", value: formatter(distanceHigh) },
    ],
  }, hint || "越靠近右边，越接近这段时间的高价。");
}

function metricTilesVisual(metrics, title = "关键数据", hint) {
  const rows = (metrics || [])
    .filter((row) => Array.isArray(row) && row[1] && !isSparseValue(row[1]))
    .slice(0, 8);
  if (rows.length < 2) return null;
  return withChartMeta({
    kind: "tiles",
    title,
    stats: [],
    items: rows.map((row, index) => ({
      id: `${index}-${row[0]}`,
      label: row[0],
      valueText: String(row[1]),
    })),
  }, hint);
}

/** 招股区间：固定价不画三柱（易误解）；有高低差才画对比。 */
function offerBandVisual(raw, offerPriceText) {
  const low = hasNumber(raw.priceLow) ? Number(raw.priceLow) : null;
  const high = hasNumber(raw.priceHigh) ? Number(raw.priceHigh) : null;
  const offerMatch = String(raw.offerPrice || "").match(/[\d.]+/);
  const offer = offerMatch ? Number(offerMatch[0]) : null;
  if (low == null && high == null && offer == null) return null;
  if (low != null && high != null && low === high) {
    return metricTilesVisual([
      ["招股价", offerPriceText || `${low} 港元`],
      ["定价方式", "固定招股价"],
    ], "招股价说明");
  }
  if (low != null && high != null && low !== high) {
    return solidVisual([
      { label: "招股低", value: low, valueText: `${low}` },
      ...(offer != null ? [{ label: "招股价", value: offer, valueText: offerPriceText || `${offer}` }] : []),
      { label: "招股高", value: high, valueText: `${high}` },
    ], "招股价格带", { hint: "单位：港元。柱越高，价格越高。" });
  }
  return null;
}

function stockRange(history, currentPrice) {
  const values = (history || []).filter(hasNumber).map(Number);
  if (!values.length) return "近 60 日位置暂缺";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || high === low) return `${money(low)}–${money(high)}`;
  const position = Math.round(((price - low) / (high - low)) * 100);
  return `${money(low)}–${money(high)} · 当前约在 ${Math.max(0, Math.min(100, position))}% 位置`;
}

function historyStats(history) {
  const values = (history || []).filter(hasNumber).map(Number).sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { low: values[0], median, high: values[values.length - 1], count: values.length };
}

function investorHoldings(snapshot, symbol) {
  return (snapshot.investors || [])
    .map((investor) => {
      const holding = (investor.holdings || []).find((entry) => entry.ticker === symbol);
      if (!holding) return null;
      return {
        name: INVESTOR_NAMES[investor.id] || investor.name,
        value: `${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核验"}`,
      };
    })
    .filter(Boolean);
}

function baseView(item) {
  const meta = DETAIL_META[item.market] || DETAIL_META.hk;
  return {
    title: item.name,
    code: item.code,
    badge: item.badge,
    marketLabel: meta.label,
    icon: meta.icon,
    tone: meta.tone,
    score: item.scoreText || (item.score > 0 ? `${item.score} 分` : "待核验"),
    rank: item.rank ? `第 ${item.rank} 名` : "当前分类",
    answer: item.one,
    metrics: [],
    highlights: [],
    visual: null,
    charts: [],
    facts: [],
    holdings: [],
    analysis: [],
    factsTitle: "详细资料",
    metricsTitle: "关键数据",
    actions: [],
    risk: "数据不足时宁可不给硬答案。",
    riskItems: [],
    riskLabel: RISK_LABEL,
    pageHelp: "",
    sourceNote: "公开资料整理",
    disclaimer: RESEARCH_DISCLAIMER,
  };
}

function buildHKView(base, item) {
  const raw = item.raw || {};
  const review = raw.historicalReview || {};
  const answer = raw.publicAnswer || {};
  const ended = item.group === "ended";
  const offerPrice = raw.offerPrice || (raw.priceLow && raw.priceHigh ? `${raw.priceLow}-${raw.priceHigh}港元` : "待公布");
  const sponsors = joinNames(raw.sponsorNames, raw.sponsor || "");
  const underwriters = joinNames(raw.underwriterNames, "");
  const cornerstones = joinNames(raw.cornerstoneInvestors, "");
  const stabilizer = shortOrgList([raw.stabilizingManager].filter(Boolean), "", 1);
  const lotSize = raw.boardLot || (raw.boardLotShares ? `${raw.boardLotShares}` : null);
  const offer = hasNumber(raw.priceHigh) ? Number(raw.priceHigh)
    : (hasNumber(raw.priceLow) ? Number(raw.priceLow) : null);
  const publicShares = hasNumber(raw.publicOfferShares) ? Number(raw.publicOfferShares) : null;
  const publicValue = offer != null && publicShares != null ? offer * publicShares : null;
  const daysToDeadline = daysFromToday(raw.offerDeadline || raw.offerEnd);
  const daysToListing = daysFromToday(raw.listingDate);
  const announce = raw.announcementExtraction || {};
  const prospectus = raw.prospectusExtraction || {};

  base.badge = item.badge || answer.verdict || base.badge;
  base.answer = item.badge || answer.action || item.one;
  base.metrics = ended
    ? compactFacts([
        ["是否申购", item.badge || answer.verdict || "已结束"],
        ["一手中签", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(1)}%` : null],
        ["招股价", offerPrice],
        ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}港元` : null],
        ["暗盘涨跌", formatPercent(review.greyMarketChange)],
        ["首日涨跌", formatPercent(review.firstDayChange)],
        ["五日涨跌", formatPercent(review.fiveDayChange)],
        ["五日最高", formatPercent(review.fiveDayHighChange)],
        ["上市日期", raw.listingDate],
        ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)}倍` : null],
        ["公开发售", publicShares != null ? formatLarge(publicShares) : null],
        ["公开发售额", publicValue != null ? `${formatLarge(publicValue)}港元` : null],
      ], 12)
    : compactFacts([
        ["是否申购", item.badge || "先看结论"],
        ["研究分", hasNumber(answer.score) ? `${Number(answer.score)}` : null],
        ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}港元` : null],
        ["招股价", offerPrice],
        ["一手中签", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(1)}%` : null],
        ["认购截止", raw.offerDeadline || raw.offerEnd],
        ["截止剩余", daysToDeadline != null ? `${daysToDeadline}天` : null],
        ["上市日期", raw.listingDate],
        ["距上市", daysToListing != null ? `${daysToListing}天` : null],
        ["一手股数", lotSize ? `${lotSize}股` : null],
        ["公开发售", publicShares != null ? formatLarge(publicShares) : null],
        ["发售额估", publicValue != null ? `${formatLarge(publicValue)}港元` : null],
        ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)}倍` : null],
        ["基石占比", hasNumber(raw.cornerstonePercent) ? `${Number(raw.cornerstonePercent).toFixed(1)}%` : null],
      ], 14);

  base.highlights = ended
    ? [
        { label: "暗盘", value: formatPercent(review.greyMarketChange) },
        { label: "首日", value: formatPercent(review.firstDayChange) },
        { label: "五日", value: formatPercent(review.fiveDayChange) },
        { label: "中签", value: hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(1)}%` : "—" },
      ]
    : [
        { label: "结论", value: item.badge || "待定" },
        { label: "一手", value: hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}` : "—" },
        { label: "招股", value: offer != null ? offer.toFixed(2) : "—" },
        { label: "截止", value: daysToDeadline != null ? `${daysToDeadline}天` : (raw.offerDeadline || "—") },
      ];

  const scheduleTiles = metricTilesVisual([
    ["招股开始", raw.offerStart],
    ["认购截止", raw.offerDeadline || raw.offerEnd],
    ["上市日期", raw.listingDate],
    ["截止剩余", daysToDeadline != null ? `${daysToDeadline}天` : null],
    ["距上市", daysToListing != null ? `${daysToListing}天` : null],
  ].filter((row) => row[1]), "认购时间表", "先看还能不能打、什么时候上市。");

  const capitalTiles = metricTilesVisual([
    ["招股价", offer != null ? `${offer.toFixed(2)}港元` : offerPrice],
    ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}港元` : null],
    ["一手股数", lotSize ? `${lotSize}股` : null],
    ["公开发售股数", publicShares != null ? formatLarge(publicShares) : null],
    ["公开发售额", publicValue != null ? `${formatLarge(publicValue)}港元` : null],
    ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)}倍` : null],
  ].filter((row) => row[1]), "发行规模", "金额与股数都来自公开招股资料。");

  const structureTiles = metricTilesVisual([
    ["保荐人", sponsors || null],
    ["承销商", underwriters || null],
    ["稳定操作人", stabilizer || null],
    ["基石投资者", cornerstones || null],
    ["基石占比", hasNumber(raw.cornerstonePercent) ? `${Number(raw.cornerstonePercent).toFixed(1)}%` : null],
    ["基石金额", hasNumber(raw.cornerstoneAmount) ? formatLarge(raw.cornerstoneAmount) : null],
    ["A+H", raw.isAH === true ? "是" : (raw.isAH === false ? "否" : null)],
    ["所属行业", raw.industry || null],
  ].filter((row) => row[1]), "中介与结构", "有披露才展示；空白字段不占位。");

  const qualityTiles = metricTilesVisual([
    ["公告解析", hasNumber(announce.matchedFields) ? `${announce.matchedFields}/${announce.totalFields || "?"}` : null],
    ["招股书解析", hasNumber(prospectus.matchedFields) ? `${prospectus.matchedFields}/${prospectus.totalFields || "?"}` : null],
    ["资料状态", raw.researchView?.label || null],
    ["来源", raw.source || "HKEX"],
  ].filter((row) => row[1]), "资料完整度", "解析字段越多，公开资料越齐。");

  const statusTiles = metricTilesVisual([
    ["发行状态", raw.researchView?.label || item.badge || null],
    ["研究结论", item.badge || answer.verdict || null],
    ["公告类型", announceKindLabel(announce.kind, announce.reason) || null],
    ["资料说明", researchNoteShort(raw.researchView) || null],
  ].filter((row) => row[1]), "状态一览");

  const allotBars = solidVisual([
    hasNumber(raw.oneLotRate)
      ? { label: "一手中签", value: Number(raw.oneLotRate), valueText: `${Number(raw.oneLotRate).toFixed(1)}%` }
      : null,
    hasNumber(raw.cornerstonePercent)
      ? { label: "基石占比", value: Number(raw.cornerstonePercent), valueText: `${Number(raw.cornerstonePercent).toFixed(1)}%` }
      : null,
  ].filter(Boolean), "中签与基石");

  const listingBars = solidVisual([
    { label: "暗盘", value: review.greyMarketChange, valueText: formatPercent(review.greyMarketChange) },
    { label: "首日", value: review.firstDayChange, valueText: formatPercent(review.firstDayChange) },
    { label: "五日", value: review.fiveDayChange, valueText: formatPercent(review.fiveDayChange) },
    { label: "五日最高", value: review.fiveDayHighChange, valueText: formatPercent(review.fiveDayHighChange) },
  ].filter((row) => hasNumber(row.value)), "上市涨跌对比", { hint: "暗盘=上市前夜交易；都是涨跌百分比，只用于复盘。" });

  if (ended) {
    setCharts(
      base,
      listingBars,
      statusTiles,
      hkCohortVisual(strategyEvidence),
      capitalTiles,
      structureTiles,
      allotBars,
      qualityTiles,
      scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
    );
    base.pageHelp = "";
  } else {
    setCharts(
      base,
      scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
      statusTiles,
      scheduleTiles,
      capitalTiles,
      allotBars,
      hasNumber(raw.publicOversubscription)
        ? metricTilesVisual([
          ["公开认购", `${Number(raw.publicOversubscription).toFixed(1)} 倍`],
        ].filter((row) => row[1]), "认购热度")
        : null,
      offerBandVisual(raw, offerPrice),
      hkCohortVisual(strategyEvidence),
      structureTiles,
      qualityTiles,
    );
    base.pageHelp = "";
  }

  base.facts = compactFacts([
    ["公司全称", item.name],
    ["股票代码", raw.code || item.code],
    ["所属行业", raw.industry],
    ["招股期", raw.offerStart && raw.offerDeadline ? `${raw.offerStart}至${raw.offerDeadline}` : null],
    ["上市日期", raw.listingDate],
    ["一手股数", lotSize ? `${lotSize}股` : null],
    ["一手入场", hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}港元` : null],
    ["招股价", offer != null ? `${offer.toFixed(2)}港元` : null],
    ["保荐人", sponsors || null],
    ["承销商", underwriters || null],
    ["稳定操作人", stabilizer || null],
    ["基石投资者", cornerstones || null],
    ["基石金额", hasNumber(raw.cornerstoneAmount) ? formatLarge(raw.cornerstoneAmount) : null],
    ["基石占比", hasNumber(raw.cornerstonePercent) ? `${Number(raw.cornerstonePercent).toFixed(2)}%` : null],
    ["公开发售股数", publicShares != null ? formatLarge(publicShares) : null],
    ["公开发售额", publicValue != null ? `${formatLarge(publicValue)}港元` : null],
    ["公开认购", hasNumber(raw.publicOversubscription) ? `${Number(raw.publicOversubscription).toFixed(2)}倍` : null],
    ["一手中签率", hasNumber(raw.oneLotRate) ? `${Number(raw.oneLotRate).toFixed(2)}%` : null],
    ["A+H", raw.isAH === true ? "是" : (raw.isAH === false ? "否" : null)],
    ["资料来源", raw.source || "港交所公开文件"],
  ]);

  base.analysis = ended
    ? [
        { title: "结果", body: `暗盘 ${formatPercent(review.greyMarketChange)} · 首日 ${formatPercent(review.firstDayChange)} · 五日 ${formatPercent(review.fiveDayChange)}` },
        { title: "用途", body: "只复盘学习，不作当前申购依据。" },
      ]
    : [
        { title: item.badge || "结论", body: "先核一手金额与截止日；建议≠保证赚钱。" },
        { title: "风险", body: "可能破发或中签极低，盈亏自负。" },
      ];
  base.actions = [];
  base.risk = ended
    ? "历史表现只用于复盘，不能倒推当时必然值得申购。"
    : "公开资料研究观察，供参考；不是买卖指令。";
  if (ended && item.rank) base.score = `首日涨幅第 ${item.rank} 名`;
  base.sourceNote = raw.source || "港交所公开文件与历史结果整理";
}

function buildUSView(base, item, snapshot) {
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const range = historyStats(raw.history);
  const holders = investorHoldings(snapshot, raw.symbol);
  // 金额须在 sanitize 阶段转为基础美元（amountUnit=USD）；此处不再猜乘数。
  const cashValue = hasNumber(fund.liquidAssets) ? Number(fund.liquidAssets) : null;
  const ocfValue = hasNumber(fund.operatingCashFlow) ? Number(fund.operatingCashFlow) : null;
  const moneyUnitNote = fund.amountUnit === "USD" ? "美元" : "公开财报金额";

  base.metrics = [
    ["当前价格", money(raw.price)],
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["七日涨跌", formatPercent(raw.weeklyChange)],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["近 60 日最低", range ? money(range.low) : null],
    ["近 60 日最高", range ? money(range.high) : null],
    ["股东回报", formatPercent(fund.roe)],
    ["利润率", formatPercent(fund.profitMargin)],
    ["营收增长", formatPercent(fund.revenueGrowth)],
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)}倍` : null],
  ];
  base.metrics = compactFacts(base.metrics, 14);
  base.highlights = [
    { label: "现价", value: money(raw.price) },
    { label: "今日", value: formatPercent(raw.changePercent) },
    { label: "PE", value: hasNumber(fund.pe) ? Number(fund.pe).toFixed(1) : "—" },
    { label: "热度", value: hasNumber(raw.heatScore) ? `${Number(raw.heatScore)}` : "—" },
  ];

  const marginBars = solidVisual([
    hasNumber(fund.grossMargin) ? { label: "毛利率", value: fund.grossMargin, valueText: formatPercent(fund.grossMargin) } : null,
    hasNumber(fund.profitMargin) ? { label: "利润率", value: fund.profitMargin, valueText: formatPercent(fund.profitMargin) } : null,
    hasNumber(fund.roe) ? { label: "股东回报", value: fund.roe, valueText: formatPercent(fund.roe) } : null,
  ].filter(Boolean), "利润率对照", { hint: "同为百分比口径，便于对照毛利/净利/股东回报；不是收益预测。" });

  const growthTiles = metricTilesVisual([
    ["营收增长", formatPercent(fund.revenueGrowth)],
    ["净利润", hasNumber(fund.netIncome) ? formatLarge(fund.netIncome) : null],
  ].filter((row) => row[1] && !isSparseValue(row[1])), "成长与盈利额", "增长是百分比；净利润是金额，分开展示。");

  const flowTiles = metricTilesVisual([
    ["经营现金流", ocfValue != null ? formatLarge(ocfValue) : null],
    ["资本开支", hasNumber(fund.capitalExpenditures) ? formatLarge(Math.abs(Number(fund.capitalExpenditures))) : null],
  ].filter((row) => row[1]), "期间现金流", `期间流量（${moneyUnitNote}），不与现金存量混排。`);

  const stockTiles = metricTilesVisual([
    ["现金及等价物", hasNumber(fund.cashAndEquivalents) ? formatLarge(fund.cashAndEquivalents) : null],
    ["现金+短投", cashValue != null ? formatLarge(cashValue) : null],
    ["短期投资", hasNumber(fund.shortTermInvestments) ? formatLarge(fund.shortTermInvestments) : null],
  ].filter((row) => row[1]), "现金存量", `时点存量（${moneyUnitNote}），不是当期流量。`);

  const sizeTiles = metricTilesVisual([
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)} 倍` : "暂缺"],
  ], "估值与热度", "市盈率：股价相对盈利贵不贵；热度高≠马上买。");

  const revenueHistory = Array.isArray(fund.revenueHistory) ? fund.revenueHistory.filter(hasNumber).map(Number) : [];
  const revenueVisual = revenueHistory.length >= 2
    ? priceVisual(revenueHistory.slice().reverse(), "营收趋势", (value) => formatLarge(value), "近几期公开营收金额。")
    : null;

  const scoredUS = scoreForItem(item);
  setCharts(
    base,
    scoreMeter(scoredUS.score, "研究观察分", item.badge),
    priceVisual(raw.history, "近60日价格", (value) => `$${Number(value).toFixed(2)}`),
    meterVisual(raw.history, raw.price, "价格位置", money),
    marginBars,
    growthTiles,
    flowTiles,
    stockTiles,
    sizeTiles,
    revenueVisual,
  );

  base.pageHelp = "";
  base.facts = compactFacts([
    ["代码", raw.symbol || item.code],
    ["交易所", raw.exchange],
    ["行情状态", raw.marketState],
    ["数据截至", raw.asOf || fund.period],
    ["金额单位", fund.amountUnit === "USD" ? "美元（已规范化）" : null],
    ["近 60 日中位数", range ? money(range.median) : null],
    ["样本交易日", range ? `${range.count}个` : null],
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)}倍` : null],
    ["营收增长", hasNumber(fund.revenueGrowth) ? formatPercent(fund.revenueGrowth) : null],
    ["毛利率", hasNumber(fund.grossMargin) ? formatPercent(fund.grossMargin) : null],
    ["利润率", hasNumber(fund.profitMargin) ? formatPercent(fund.profitMargin) : null],
    ["股东回报", hasNumber(fund.roe) ? formatPercent(fund.roe) : null],
    ["净利润", hasNumber(fund.netIncome) ? formatLarge(fund.netIncome) : null],
    ["经营现金流", ocfValue != null ? formatLarge(ocfValue) : null],
    ["现金及等价物", hasNumber(fund.cashAndEquivalents) ? formatLarge(fund.cashAndEquivalents) : null],
    ["现金+短投", cashValue != null ? formatLarge(cashValue) : null],
    ["短期投资", hasNumber(fund.shortTermInvestments) ? formatLarge(fund.shortTermInvestments) : null],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)}倍` : null],
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : null],
    ["财报期", fund.period],
  ]);
  base.holdings = holders;
  base.analysis = [
    { title: "位置", body: stockRange(raw.history, raw.price) },
    { title: "怎么用", body: item.group === "seven" ? "七家长期跟踪样本，不急着追涨。" : "热度高只说明关注多，不等于马上买。" },
  ];
  base.actions = [];
  base.risk = "历史价格不预测未来；财报与事件可能造成跳空。";
  base.sourceNote = `公开行情与财务资料 · ${raw.asOf || fund.period || "日期待核验"}`;
}

function buildAShareFundView(base, item) {
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const price = hasNumber(raw.currentPrice) ? Number(raw.currentPrice) : null;
  const history = (raw.history || []).map((entry) => entry?.close).filter(hasNumber).map(Number);
  const fundPrice = price == null ? "暂缺" : `¥${price.toFixed(3)}`;
  const change = formatPercent(raw.changePercent);
  const size = hasNumber(financials.fundSize) ? formatLarge(financials.fundSize) : "暂缺";

  base.title = raw.shortName || "红利ETF";
  base.code = raw.code || item.code;
  base.badge = "红利ETF";
  base.answer = "指数化收息，分散单只股票风险；基金分红不固定，先看指数和公告。";
  base.metrics = [
    ["资产类型", raw.fundType || "ETF"],
    ["跟踪指数", raw.trackingIndex || "中证红利指数"],
    ["当前价格", fundPrice],
    ["今日涨跌", change],
    ["基金规模", size],
    ["管理费托管", raw.expenseRatio || "暂缺"],
    ["成立日期", raw.inceptionDate || "暂缺"],
    ["分红口径", raw.distributionNote || "以基金公告为准"],
  ];
  base.highlights = [
    { label: "类型", value: "ETF" },
    { label: "现价", value: fundPrice },
    { label: "今日", value: change },
    { label: "指数", value: "中证红利" },
  ];
  const priceBand = solidVisual([
    price != null ? { label: "现价", value: price, valueText: fundPrice } : null,
    hasNumber(raw.previousClose) ? { label: "昨收", value: Number(raw.previousClose), valueText: `¥${Number(raw.previousClose).toFixed(3)}` } : null,
  ].filter(Boolean), "ETF价格对照");
  setCharts(
    base,
    history.length >= 2 ? priceVisual(history, "红利ETF轨迹", (value) => `¥${Number(value).toFixed(3)}`) : null,
    history.length >= 2 ? meterVisual(history, price, "红利ETF位置", (value) => `¥${Number(value).toFixed(3)}`) : null,
    priceBand,
    metricTilesVisual([
      ["基金规模", size],
      ["跟踪指数", raw.trackingIndex || "中证红利指数"],
      ["管理人", raw.fundManager || "易方达基金"],
      ["分红", "以公告为准"],
    ], "基金资料"),
  );
  base.facts = compactFacts([
    ["基金全称", raw.name || "易方达中证红利ETF"],
    ["基金代码", raw.code || item.code],
    ["资产类型", raw.fundType || "ETF"],
    ["跟踪指数", raw.trackingIndex || "中证红利指数"],
    ["基金管理人", raw.fundManager || "易方达基金"],
    ["成立日期", raw.inceptionDate],
    ["基金规模", size],
    ["管理费托管", raw.expenseRatio],
    ["价格日期", raw.priceAsOf || raw.asOf],
    ["历史样本", history.length ? `${history.length}个交易日` : null],
    ["分红说明", raw.distributionNote || "以基金公告为准"],
    ["资料来源", raw.source || raw.priceSource],
  ]);
  base.analysis = [
    { title: "怎么收息", body: "ETF 用一篮子红利成分股实现分散收息，不能把单只股票的股息率直接套到基金上。" },
    { title: "先核什么", body: "先看基金公告、指数成分、分红记录和场内价格相对净值的偏离，再决定是否继续观察。" },
  ];
  base.actions = [];
  base.risk = "基金分红不固定，指数成分和估值会变化；场内价格可能偏离基金净值，不构成固定收益承诺。";
  base.riskItems = [
    { title: "产品风险", body: "ETF 不保本，基金分红不固定；不能把成分股的股息率直接当成基金收益率。" },
    { title: "指数风险", body: "红利指数会调仓，行业权重和成分质量会变；分红、净值和场内价格要分开看。" },
    { title: "价格风险", body: "若场内价格明显偏离净值，或单日跌幅扩大，先核对折溢价、指数变化和公告，再决定是否继续持有。" },
  ];
  base.sourceNote = `${raw.source || raw.priceSource || "公开行情"} · ${raw.priceAsOf || raw.asOf || "日期待核验"}`;
}

function buildAShareRiskItems(raw = {}, financials = {}) {
  const industry = String(raw.industry || financials.industry || "");
  const change = Number(raw.changePercent);
  const revenueGrowth = Number(financials.revenueGrowth);
  const profitGrowth = Number(financials.netProfitGrowth);
  const freeCashFlow = Number(financials.freeCashFlow);
  const cashConversion = Number(financials.cashConversion);
  const operatingSignals = [];
  if (Number.isFinite(revenueGrowth) && revenueGrowth < 0) operatingSignals.push(`营收同比 ${revenueGrowth.toFixed(1)}%`);
  if (Number.isFinite(profitGrowth) && profitGrowth < 0) operatingSignals.push(`净利润同比 ${profitGrowth.toFixed(1)}%`);
  if (Number.isFinite(freeCashFlow) && freeCashFlow <= 0) operatingSignals.push("自由现金流为负");
  if (Number.isFinite(cashConversion) && cashConversion < 1) operatingSignals.push(`现金利润比 ${cashConversion.toFixed(2)}`);
  const operatingBody = operatingSignals.length
    ? `经营风险：${operatingSignals.join("、")}。股息率再高也不能替代现金流，下一次财报优先核对营收、利润和经营现金流是否继续恶化。`
    : "经营风险：当前快照未触发负增长或现金流警报，但仍要按财报期复核营收、净利润、经营现金流和自由现金流。";

  let industryBody = "行业风险：行业周期、竞争格局和政策变化可能先于公司财报反映到股价；若行业景气下行与公司数据同时转弱，先降低风险敞口。";
  if (/银行|金融/u.test(industry)) {
    industryBody = "行业风险：净息差下行、资产质量恶化和房地产/地方债信用成本上升会压缩银行利润；重点盯净息差、不良率、拨备覆盖率和资本充足率。";
  } else if (/能源|油气|煤炭/u.test(industry)) {
    industryBody = "行业风险：油气/煤炭价格、产量、资本开支和能源政策共同决定盈利；商品价格下行与资本开支上升同时出现时，股息可持续性要下调。";
  } else if (/公用事业|水电|电力/u.test(industry)) {
    industryBody = "行业风险：来水、上网电价、利用小时和大额资本开支会影响现金流；若电价下调或负债扩张，稳定股息不等于没有回撤。";
  } else if (/钢铁|水泥|建材/u.test(industry)) {
    industryBody = "行业风险：地产/基建需求、产能过剩和原材料价格决定利润；产品价格下行而库存或负债上升时，先核现金流再看股息。";
  } else if (/家电|消费|食品|汽车/u.test(industry)) {
    industryBody = "行业风险：终端需求、价格战、原材料和渠道库存会压缩利润；若营收放缓叠加毛利率下滑，不要只看过去股息。";
  } else if (/高速|交通|铁路|港口/u.test(industry)) {
    industryBody = "行业风险：车流/货运量、收费政策、维护资本开支和债务会影响稳定现金流；客流或货运量连续下降时应重新评估分红。";
  }

  const priceBody = Number.isFinite(change)
    ? change <= -5
      ? `价格风险：今日跌幅 ${change.toFixed(1)}%，已触发价格警报；先查公告、业绩和行业事件，不在原因未明时补跌。`
      : `价格风险：今日涨跌 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%；预警线为单日跌幅≤-5%或连续两日收跌，触发后先暂停加仓并复核基本面。`
    : "价格风险：实时涨跌暂缺；预警线为单日跌幅≤-5%或连续两日收跌，触发后先核实原因。";
  const exitBody = "退出触发：价格跌破预警线且伴随经营或行业信号时，优先降低风险敞口；如果只是大盘同步波动，先确认是否有公司层面的新事实。";
  return [
    { title: "经营风险", body: operatingBody },
    { title: "行业风险", body: industryBody },
    { title: "价格风险", body: priceBody },
    { title: "退出触发", body: exitBody },
  ];
}

function buildAShareView(base, item) {
  if (item.raw?.assetType === "fund") {
    buildAShareFundView(base, item);
    return;
  }
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const annualDividend = hasNumber(raw.annualDividendPer100k) ? Number(raw.annualDividendPer100k) : null;
  const advice = raw.researchView?.label || item.scoreText || "先看分红";
  const scoredPreview = scoreForItem(item).score;

  base.badge = item.badge || (hasNumber(raw.currentDividendYield) ? `股息 ${Number(raw.currentDividendYield).toFixed(1)}%` : base.badge);
  base.answer = item.one;
  base.metrics = [
    ["收息分级", item.badge || "—"],
    ["收息观察分", scoredPreview != null ? `${scoredPreview}` : "暂缺"],
    ["当前股息", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(1)}%` : "暂缺"],
    ["可持续股息", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(1)}%` : "暂缺"],
    ["自由现金流", formatLarge(financials.freeCashFlow)],
    ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)}` : "暂缺"],
    ["股东回报", formatPercent(financials.roe)],
    ["当前价格", money(raw.currentPrice, "¥")],
    ["今日涨跌", formatPercent(raw.changePercent)],
    ["10万年息估", hasNumber(annualDividend) ? `${Math.round(annualDividend)}元` : "暂缺"],
    ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ["资料状态", advice],
  ];
  base.highlights = [
    { label: "分级", value: item.badge || "—" },
    { label: "观察分", value: scoredPreview != null ? `${scoredPreview}` : "—" },
    { label: "股息", value: hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(1)}%` : "—" },
    { label: "可持续", value: hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(1)}%` : "—" },
  ];
  base.pageHelp = "";

  const scoredA = { score: scoredPreview };
  const priceBand = solidVisual([
    hasNumber(raw.currentPrice) ? { label: "现价", value: Number(raw.currentPrice), valueText: money(raw.currentPrice, "¥") } : null,
    hasNumber(raw.previousClose) ? { label: "昨收", value: Number(raw.previousClose), valueText: money(raw.previousClose, "¥") } : null,
  ].filter(Boolean), "价格对照");

  setCharts(
    base,
    scoreMeter(scoredA.score, "收息观察分", item.badge || advice),
    solidVisual([
      { label: "当前股息", value: raw.currentDividendYield, valueText: hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(1)}%` : "暂缺" },
      { label: "可持续股息", value: raw.sustainableDividendYield, valueText: hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(1)}%` : "暂缺" },
    ].filter((row) => hasNumber(row.value)), "股息率对比"),
    metricTilesVisual([
      ["自由现金流", formatLarge(financials.freeCashFlow)],
      ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)}` : null],
      ["股东回报", formatPercent(financials.roe)],
      ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ].filter((row) => row[1] && row[1] !== "暂缺"), "现金与质量"),
    hasNumber(annualDividend)
      ? metricTilesVisual([
          ["10万年息估", `${Math.round(annualDividend)}元`],
          ["现价", money(raw.currentPrice, "¥")],
        ], "收息估算")
      : null,
    priceBand,
    solidVisual([
      hasNumber(financials.operatingCashFlow) ? { label: "经营现金流", value: financials.operatingCashFlow, valueText: formatLarge(financials.operatingCashFlow) } : null,
      hasNumber(financials.freeCashFlow) ? { label: "自由现金流", value: financials.freeCashFlow, valueText: formatLarge(financials.freeCashFlow) } : null,
    ].filter(Boolean), "期间现金流"),
    solidVisual([
      hasNumber(financials.revenueGrowth) ? { label: "营收增长", value: financials.revenueGrowth, valueText: formatPercent(financials.revenueGrowth) } : null,
      hasNumber(financials.roe) ? { label: "股东回报", value: financials.roe, valueText: formatPercent(financials.roe) } : null,
    ].filter(Boolean), "成长质量"),
  );

  base.facts = compactFacts([
    ["公司全称", item.name],
    ["股票代码", raw.code || item.code],
    ["所属行业", raw.industry || financials.industry],
    ["价格日期", raw.priceAsOf || raw.asOf],
    ["财报期", financials.reportDate || financials.period],
    ["当前价格", hasNumber(raw.currentPrice) ? money(raw.currentPrice, "¥") : null],
    ["昨收", hasNumber(raw.previousClose) ? money(raw.previousClose, "¥") : null],
    ["今日涨跌", hasNumber(raw.changePercent) ? formatPercent(raw.changePercent) : null],
    ["当前股息率", hasNumber(raw.currentDividendYield) ? `${Number(raw.currentDividendYield).toFixed(2)}%` : null],
    ["可持续股息率", hasNumber(raw.sustainableDividendYield) ? `${Number(raw.sustainableDividendYield).toFixed(2)}%` : null],
    ["10万估算年息", hasNumber(annualDividend) ? `${Math.round(annualDividend)}元` : null],
    ["经营现金流", hasNumber(financials.operatingCashFlow) ? formatLarge(financials.operatingCashFlow) : null],
    ["自由现金流", hasNumber(financials.freeCashFlow) ? formatLarge(financials.freeCashFlow) : null],
    ["自由现金流率", hasNumber(financials.freeCashFlowMargin) ? formatPercent(financials.freeCashFlowMargin) : null],
    ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)}倍` : null],
    ["营收", hasNumber(financials.revenue) ? formatLarge(financials.revenue) : null],
    ["营收增长", hasNumber(financials.revenueGrowth) ? formatPercent(financials.revenueGrowth) : null],
    ["净利润", hasNumber(financials.netProfit) ? formatLarge(financials.netProfit) : null],
    ["净利润增长", hasNumber(financials.netProfitGrowth) ? formatPercent(financials.netProfitGrowth) : null],
    ["股东回报", hasNumber(financials.roe) ? formatPercent(financials.roe) : null],
    ["资料来源", raw.priceSource || raw.source],
  ]);
  base.analysis = [
    { title: "资料", body: advice },
    { title: "现金流", body: `经营 ${formatLarge(financials.operatingCashFlow)} · 自由 ${formatLarge(financials.freeCashFlow)}` },
  ];
  base.actions = [];
  base.riskItems = buildAShareRiskItems(raw, financials);
  base.risk = base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ");
  base.sourceNote = `${raw.priceSource || raw.source || "公开行情"} · ${financials.source || "公开财务资料"}`;
}

function buildGuruView(base, item) {
  const raw = item.raw || {};
  const profile = raw.profile || {};
  const groupCounts = { hk: 3, us: 5, a: 3 };
  const holdings = raw.holdings || [];
  const sold = raw.sold || [];
  const filingDate = raw.filingDate || "";
  const filingTime = Date.parse(filingDate);
  const lagDays = Number.isNaN(filingTime)
    ? null
    : Math.max(0, Math.round((Date.now() - filingTime) / (24 * 60 * 60 * 1000)));
  const perfNum = Number(String(profile.performanceValue || "").match(/\d+(?:\.\d+)?/)?.[0] || 0);
  const changed = holdings.filter((row) => row.changeLabel && !/待核|不变|持平/u.test(String(row.changeLabel)));

  base.title = profile.name || base.title;
  base.code = profile.org || base.code;
  base.badge = profile.performanceValue || profile.marketLabel || base.badge;
  base.score = profile.performanceValue || "业绩待核";
  base.rank = profile.order ? `第 ${profile.order}/${groupCounts[profile.group]}` : "";
  base.answer = profile.marketLabel || item.badge;
  base.metrics = [
    ["表观年化", profile.performanceValue || "待核"],
    ["市场", profile.marketLabel || "待核"],
    ["持仓", `${holdings.length}`],
    ["退出", `${sold.length}`],
    ["披露滞后", lagDays == null ? "待核" : `${lagDays}天`],
    ["报告期", raw.reportDate || profile.report || "待核"],
  ];
  base.highlights = [
    { label: "年化", value: profile.performanceValue || "—" },
    { label: "排名", value: profile.order ? `${profile.order}/${groupCounts[profile.group]}` : "—" },
    { label: "持仓", value: `${holdings.length}` },
    { label: "滞后", value: lagDays == null ? "—" : `${lagDays}天` },
  ];
  base.holdings = holdings.slice(0, 8).map((holding) => ({
    name: holding.ticker,
    value: `${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核"}`,
  }));

  const changeBars = solidVisual(
    changed.slice(0, 6).map((holding) => ({
      label: holding.ticker,
      value: Number(holding.weight) || 1,
      valueText: String(holding.changeLabel || "").slice(0, 8),
    })),
    "仓位变化",
  );

  setCharts(
    base,
    perfNum > 0
      ? scoreMeter(Math.min(100, Math.round(perfNum * 3)), "表观业绩刻度", profile.performanceValue)
      : null,
    metricTilesVisual([
      ["持仓只数", `${holdings.length}`],
      ["退出只数", `${sold.length}`],
      ["披露滞后", lagDays == null ? null : `${lagDays}天`],
      ["有变化标注", `${changed.length}`],
    ].filter((row) => row[1]), "本期摘要"),
    solidVisual(holdings.slice(0, 8).map((holding) => ({
      label: holding.ticker,
      value: holding.weight,
      valueText: formatNumber(holding.weight, "%"),
    })), "持仓权重"),
    changeBars,
    lagDays != null
      ? meterVisual(
        [0, Math.min(180, lagDays), 180],
        Math.min(180, lagDays),
        "披露滞后位置",
        (value) => `${Math.round(value)}天`,
      )
      : null,
  );

  base.facts = compactFacts([
    ["机构", profile.name || item.name],
    ["市场", profile.marketLabel],
    ["表观年化", profile.performanceValue],
    ["业绩区间", profile.performanceDetail],
    ["持仓报告", raw.reportDate || profile.report],
    ["披露日期", filingDate],
    ["披露滞后", lagDays == null ? null : `${lagDays}天`],
    ["资料来源", raw.source || "SEC 13F"],
  ], 12);
  base.analysis = [
    { title: "为什么看它", body: String(profile.why || "公开业绩与持仓可对照学习。").slice(0, 36) },
    { title: "怎么学", body: String(profile.how || "学框架，不照抄持仓。").slice(0, 28) },
  ];
  base.actions = [];
  base.risk = "公开持仓有滞后，只能学习对照，不能当跟仓信号。";
  base.pageHelp = "";
  base.sourceNote = `${raw.source || profile.sourceName || "公开报告"} · ${filingDate || profile.report || "披露待核"}`;
}

function buildGoldView(base, item) {
  const gold = item.raw || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const international = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const etf = gold.quotes?.etf || {};
  const usdCny = gold.quotes?.usdCny || {};
  const returns = international.returns || {};
  const scoreBundle = answer.scores || {};
  const internationalScore = Number(scoreBundle.international?.score ?? answer.internationalScore);
  const domesticScore = Number(scoreBundle.domestic?.score ?? answer.domesticScore);
  const internationalRange = historyStats((gold.history?.international || []).map((entry) => entry.close));
  const domesticRange = historyStats((gold.history?.domestic || []).map((entry) => entry.close));
  const rangeText = (range, currency) => range ? `${Number(range.low).toFixed(1)}–${Number(range.high).toFixed(1)} ${currency}` : "待核验";
  const buyIntl = compactRangeText(plan.internationalWatch, 0);
  const sellIntl = compactRangeText(plan.internationalUpper, 0);
  const riskIntl = compactRangeText(plan.internationalRisk, 0);
  const buyCny = compactRangeText(plan.domesticWatch, 1);
  const sellCny = compactRangeText(plan.domesticUpper, 1);
  const riskCny = compactRangeText(plan.domesticRisk, 1);
  const action = answer.action || answer.researchLabel || "继续观察";

  base.title = gold.view === "plan" ? "买点与卖点" : "现在怎么做";
  base.badge = action;
  base.answer = item.one;
  base.metrics = [
    ["现在动作", action],
    ["国际观察分", Number.isFinite(internationalScore) ? `${internationalScore}` : "暂缺"],
    ["人民币观察分", Number.isFinite(domesticScore) ? `${domesticScore}` : "暂缺"],
    ["国际金", hasNumber(international.price) ? `${Number(international.price).toFixed(0)}` : "暂缺"],
    ["人民币金", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(1)}` : "暂缺"],
    ["半年位置", hasNumber(international.percentile180) ? `${Number(international.percentile180)}%` : "暂缺"],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(1)}` : "暂缺"],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(2)}` : "暂缺"],
    ["20日涨跌", formatPercent(returns.day20)],
    ["60日涨跌", formatPercent(returns.day60)],
    ["买入观察", buyIntl || buyCny || "暂缺"],
    ["卖出观察", sellIntl || sellCny || "暂缺"],
    ["风险下沿", riskIntl || riskCny || "暂缺"],
  ];
  base.highlights = [
    { label: "国际金", value: hasNumber(international.price) ? `${Number(international.price).toFixed(0)}` : "—" },
    { label: "人民币金", value: hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(1)}` : "—" },
    { label: "国际分", value: Number.isFinite(internationalScore) ? `${internationalScore}` : "—" },
    { label: "人民币分", value: Number.isFinite(domesticScore) ? `${domesticScore}` : "—" },
    { label: "20日", value: formatPercent(returns.day20) },
  ];
  base.pageHelp = "";

  const intlHistory = (gold.history?.international || []).map((entry) => entry.close);
  const domesticHistory = (gold.history?.domestic || []).map((entry) => entry.close);
  const scoredGold = scoreForItem(item);
  const indicatorTiles = metricTilesVisual(
    (gold.indicators || []).slice(0, 8).map((entry) => [
      entry.label,
      hasNumber(entry.value) ? `${Number(entry.value)}${entry.unit || ""}` : null,
    ]),
    "宏观指标",
  );

  setCharts(
    base,
    scoreMeter(internationalScore, "国际金观察分", action),
    scoreMeter(domesticScore, "人民币金观察分", "国内价格"),
    priceVisual(intlHistory, "国际金轨迹", (value) => Number(value).toFixed(0)),
    meterVisual(intlHistory, international.price, "国际金位置", (value) => Number(value).toFixed(0)),
    domesticHistory.length >= 2
      ? priceVisual(domesticHistory, "人民币金轨迹", (value) => Number(value).toFixed(1))
      : null,
    solidVisual([
      hasNumber(returns.day20) ? { label: "20日", value: returns.day20, valueText: formatPercent(returns.day20) } : null,
      hasNumber(returns.day60) ? { label: "60日", value: returns.day60, valueText: formatPercent(returns.day60) } : null,
      hasNumber(returns.day180) ? { label: "180日", value: returns.day180, valueText: formatPercent(returns.day180) } : null,
    ].filter(Boolean), "区间涨跌"),
    hasNumber(international.percentile180)
      ? metricTilesVisual([
          ["半年位置", `${Number(international.percentile180)}%`],
          ["位置解读", Number(international.percentile180) <= 35 ? "偏近低位" : (Number(international.percentile180) >= 65 ? "偏近高位" : "中间区间")],
        ], "半年高低位置")
      : null,
    metricTilesVisual([
      ["国际金买入", buyIntl],
      ["国际金卖出", sellIntl],
      ["人民币金买入", buyCny],
      ["人民币金卖出", sellCny],
      ["国际金风险", riskIntl],
      ["人民币金风险", riskCny],
    ].filter((row) => row[1]), "买卖观察区"),
    indicatorTiles,
  );

  base.facts = compactFacts([
    ["现在动作", action],
    ["国际金观察分", Number.isFinite(internationalScore) ? `${internationalScore}` : null],
    ["人民币金观察分", Number.isFinite(domesticScore) ? `${domesticScore}` : null],
    ["国际金价", hasNumber(international.price) ? `${Number(international.price).toFixed(1)}${international.currency || "USD/oz"}` : null],
    ["国际金涨跌", hasNumber(international.changePercent) ? formatPercent(international.changePercent) : null],
    ["国际金截至", international.asOf],
    ["人民币金价", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)}${domestic.currency || "CNY/g"}` : null],
    ["人民币金涨跌", hasNumber(domestic.changePercent) ? formatPercent(domestic.changePercent) : null],
    ["人民币金截至", domestic.asOf],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(2)}·${formatPercent(etf.changePercent)}` : null],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(4)}` : null],
    ["国际金买入观察", buyIntl],
    ["国际金卖出观察", sellIntl],
    ["国际金风险下沿", riskIntl],
    ["人民币金买入观察", buyCny],
    ["人民币金卖出观察", sellCny],
    ["人民币金风险下沿", riskCny],
    ["国际金样本", internationalRange ? `${internationalRange.count}个·${rangeText(internationalRange, international.currency || "USD/oz")}` : null],
    ["人民币金样本", domesticRange ? `${domesticRange.count}个·${rangeText(domesticRange, domestic.currency || "CNY/g")}` : null],
    ["历史样本区间", internationalRange ? rangeText(internationalRange, international.currency || "USD/oz") : null],
    ...(gold.indicators || []).slice(0, 8).map((entry) => [entry.label, hasNumber(entry.value) ? `${entry.value}${entry.unit || ""}` : null]),
  ]);
  base.analysis = [
    { title: "双分怎么看", body: `国际金 ${Number.isFinite(internationalScore) ? internationalScore : "待核"} 分 · 人民币金 ${Number.isFinite(domesticScore) ? domesticScore : "待核"} 分；前者看国际宏观与美元，后者看上海金、汇率和国内折溢价。` },
    { title: "买卖区", body: `买 ${buyIntl || buyCny || "暂缺"} · 卖 ${sellIntl || sellCny || "暂缺"}` },
  ];
  base.actions = [];
  base.riskItems = [
    { title: "国际金风险", body: `国际金观察分 ${Number.isFinite(internationalScore) ? internationalScore : "待核"}；重点看实际利率、美元、投机持仓和国际金风险下沿 ${riskIntl || "待核"}。` },
    { title: "人民币金风险", body: `人民币金观察分 ${Number.isFinite(domesticScore) ? domesticScore : "待核"}；重点看人民币汇率、上海金折溢价和国内风险下沿 ${riskCny || "待核"}。` },
    { title: "价格触发", body: "国际金与人民币金不是同一价格；任一维度跌破自己的风险下沿，先核实汇率、国内溢价和宏观驱动，再决定是否降低风险敞口。" },
  ];
  base.risk = `${base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ")} 黄金波动可能很大，以上为观察区，不是买卖指令。`;
  base.sourceNote = (gold.sources || []).filter((source) => source.ok).map((source) => source.name).join(" · ") || "公开行情与宏观资料";
}

function detailView(item, snapshot) {
  const base = baseView(item);
  if (item.market === "hk") buildHKView(base, item);
  else if (item.market === "us") buildUSView(base, item, snapshot);
  else if (item.market === "a") buildAShareView(base, item);
  else if (item.market === "gold") buildGoldView(base, item);
  else buildGuruView(base, item);

  base.strategy = buildStrategySignal(item, { snapshot, evidence: strategyEvidence });

  const scored = scoreForItem(item);
  if (scored.score != null) {
    const metrics = Array.isArray(base.metrics) ? base.metrics.slice() : [];
    const hasScore = item.market === "gold"
      ? metrics.some((row) => row[0] === "国际观察分" || row[0] === "人民币观察分")
      : metrics.some((row) => (
      row[0] === scored.label
      || row[0] === "研究分"
      || row[0] === "研究观察分"
      || row[0] === "综合分"
      || row[0] === "收息分"
      || row[0] === "收息观察分"
      || row[0] === "观察分"
      ));
    if (!hasScore) metrics.unshift([scored.label, `${scored.score}`]);
    base.metrics = metrics;
    base.researchScore = scored.score;
    base.researchScoreLabel = scored.label;
    base.researchScoreBasis = "";
  }

  base.evidenceHint = "";

  base.analysis = (base.analysis || []).map((entry, index) => ({
    ...entry,
    indexLabel: String(index + 1).padStart(2, "0"),
  }));
  const metricHint = (base.metrics || [])
    .slice(0, 2)
    .map((row) => `${row[1]}`)
    .filter((value) => value && value !== "暂缺" && value !== "待公布" && value !== "待解析")
    .join(" · ");
  const quickAnswer = [base.badge || base.answer, metricHint].filter(Boolean).join(" · ");
  base.quickAnswer = quickAnswer.length > 48 ? `${quickAnswer.slice(0, 48)}…` : (quickAnswer || "先看关键数据");
  base.metrics = compactFacts(base.metrics || [], 14);
  base.facts = compactFacts(base.facts || [], 28);
  if (!Array.isArray(base.highlights) || !base.highlights.length) {
    base.highlights = (base.metrics || []).slice(0, 4).map((row) => ({
      label: row[0],
      value: row[1],
    }));
  }
  base.factsTitle = base.factsTitle || "已披露资料";
  base.metricsTitle = "关键数据";
  base.chartsTitle = "图表解读";
  base.analysisTitle = "研究要点";
  if (!Array.isArray(base.charts)) base.charts = [];
  base.charts = base.charts.filter(Boolean);
  if (!base.charts.length) {
    const fallback = metricTilesVisual(base.metrics);
    if (fallback) base.charts = [fallback];
  }
  base.charts = base.charts.slice(0, 8);
  base.visual = base.charts[0] || null;
  base.group = item.group;
  base.market = item.market;
  // 标题用简称；全称放在公司资料里。
  base.title = item.raw?.assetType === "fund"
    ? (item.raw.shortName || item.name || base.title)
    : shortCompanyName(item.name || base.title, base.title, 10);
  base.fullName = item.name || base.title;
  if (item.market !== "guru") base.rank = "";
  return base;
}

function detailModules(market) {
  if (market === "gold") {
    return [
      { id: "summary", label: "结论" },
      { id: "price", label: "金价" },
      { id: "finance", label: "驱动" },
      { id: "source", label: "资料" },
      { id: "research", label: "研究" },
      { id: "risk", label: "风险" },
    ];
  }
  if (market === "guru") {
    return [
      { id: "summary", label: "结论" },
      { id: "price", label: "持仓" },
      { id: "finance", label: "业绩" },
      { id: "source", label: "资料" },
      { id: "research", label: "研究" },
      { id: "risk", label: "风险" },
    ];
  }
  return [
    { id: "summary", label: "结论" },
    { id: "price", label: "价格" },
    { id: "finance", label: "财务" },
    { id: "source", label: "资料" },
    { id: "research", label: "研究" },
    { id: "risk", label: "风险" },
  ];
}

function buildDetailModules(view, market) {
  const charts = Array.isArray(view.charts) ? view.charts : [];
  const chartText = (chart) => String(chart?.title || "");
  const pricePattern = market === "gold"
    ? /金|价格|位置|买卖/u
    : market === "guru"
      ? /持仓|仓位|滞后/u
      : /价格|位置|轨迹|涨跌|招股价|退出/u;
  const financePattern = market === "gold"
    ? /指标|驱动|位置/u
    : market === "guru"
      ? /业绩|摘要/u
      : /股息|现金|成长|质量|利润|估值|认购|中签|发行规模/u;
  const priceCharts = charts.filter((chart) => pricePattern.test(chartText(chart)));
  const financeCharts = charts.filter((chart) => !pricePattern.test(chartText(chart)) && financePattern.test(chartText(chart)));
  const researchCharts = charts.filter((chart) => !priceCharts.includes(chart) && !financeCharts.includes(chart));
  return {
    ...view,
    modules: detailModules(market),
    priceCharts: priceCharts.length ? priceCharts : charts.slice(0, 2),
    financeCharts: financeCharts.length ? financeCharts : charts.slice(0, 2),
    researchCharts: researchCharts.length ? researchCharts : charts.slice(-2),
  };
}

Page({
  data: {
    market: "hk",
    group: "",
    id: "",
    ready: false,
    loading: true,
    loadError: "",
    detailsExpanded: false,
    activeModule: "summary",
    activeCharts: [],
    view: {},
    source: "正在读取同步数据",
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    snapshotSheetOpen: false,
    snapshotSaving: false,
    snapshotSaved: false,
    snapshotPreview: null,
    reasonOptions: REASON_OPTIONS,
    reviewConditionOptions: REVIEW_CONDITION_OPTIONS,
    reasonIndex: 0,
    reviewConditionIndex: 0,
    reviewAtPreset: 14,
    snapshotNote: "",
    snapshotReviewAt: "",
    memberActive: false,
    writable: false,
  },
  onLoad(options) {
    this._detailItem = null;
    this._latestSnapshot = null;
    this.setData({
      market: options.market || "hk",
      id: decodeURIComponent(options.id || ""),
      loading: true,
      ready: false,
      loadError: "",
      snapshotReviewAt: addDaysLabel(todayLabelLocal(), 14),
    });
    track("detail_open", { market: String(options.market || "hk") });
    this.refresh();
  },
  onShow() {
    this.refreshMemberLink();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
  retryFreshness() { this.refresh(null, true); },
  refreshMemberLink() {
    loadWorkspace()
      .then((workspace) => {
        const code = normalizeMatchCode(this.data.view.code || this.data.id);
        const name = String(this.data.view.title || "");
        const savedWatch = (workspace.watchItems || []).some((item) => {
          const itemCode = normalizeMatchCode(item.code);
          return (code && itemCode === code)
            || (name && item.name && item.name === name);
        });
        const savedDecision = (workspace.decisions || []).some((item) => {
          const itemCode = normalizeMatchCode(item.code);
          return (code && itemCode === code)
            || (name && item.title && item.title.includes(name.slice(0, 8)));
        });
        this.setData({
          memberActive: Boolean(workspace.active),
          writable: Boolean(workspace.writable),
          snapshotSaved: savedWatch || savedDecision,
        });
      })
      .catch(() => {});
  },
  refresh(done, force = false) {
    // 先渲染快照，会员态异步补齐，避免云函数卡住时一直「资料暂不可用」。
    this.setData({ loading: true, loadError: "" });
    let rendered = false;
    loadSnapshot((snapshot, source, meta = {}) => {
      rendered = true;
      this._latestSnapshot = snapshot;
      const freshness = freshnessBanner(source, meta.kind);
      try {
        const item = findItem(snapshot, this.data.market, this.data.id);
        if (!item) {
          this.setData({
            ready: false,
            loading: false,
            loadError: "未找到该标的，请返回列表重试",
            source,
            freshness,
          });
          return;
        }
        const view = buildDetailModules(detailView(item, snapshot), item.market);
        if (item.market === "hk") {
          view.exitPlan = buildHkExitPlan(item, { evidence: strategyEvidence });
        } else {
          view.exitPlan = null;
        }
        this._detailItem = item;
        this.setData({
          ready: true,
          loading: false,
          loadError: "",
          view,
          activeModule: "summary",
          activeCharts: view.priceCharts || [],
          group: item.group || "",
          source,
          freshness,
        });
        wx.setNavigationBarTitle({ title: view.title || "资料详情" });
        this.refreshMemberLink();
      } catch (error) {
        console.error("[望潮] detail render failed", error);
        this.setData({
          ready: false,
          loading: false,
          loadError: "资料渲染失败，请下拉重试",
          source,
          freshness,
        });
      }
    }, () => {
      if (!rendered) {
        this.setData({
          ready: false,
          loading: false,
          loadError: this.data.loadError || "资料暂不可用",
        });
      }
      if (typeof done === "function") done();
    }, { force });
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  toggleDetails() {
    this.setData({ detailsExpanded: !this.data.detailsExpanded });
  },
  switchModule(event) {
    const moduleId = String(event.currentTarget.dataset.module || "summary");
    const view = this.data.view || {};
    if (!(view.modules || []).some((item) => item.id === moduleId)) return;
    const chartMap = {
      price: view.priceCharts,
      finance: view.financeCharts,
      research: view.researchCharts,
    };
    track("detail_module_switch", { market: this.data.market, module: moduleId });
    this.setData({
      activeModule: moduleId,
      activeCharts: chartMap[moduleId] || [],
      detailsExpanded: moduleId === "research" ? this.data.detailsExpanded : false,
    });
  },
  openMember() {
    track("member_open", { from: "detail" });
    openPage("/pages/member/index");
  },
  openWorkspace() {
    this.openSnapshotSheet();
  },
  openWorkspaceAction(event) {
    const addon = event.currentTarget.dataset.addon || "track";
    if (addon === "track" || addon === "evidence" || addon === "snapshot") {
      this.openSnapshotSheet();
      return;
    }
    const market = ["hk", "us", "a", "gold"].includes(this.data.market) ? this.data.market : "other";
    const focus = addon === "remind" || addon === "calendar" ? "calendar" : "watch";
    const query = [
      `market=${encodeURIComponent(market)}`,
      `name=${encodeURIComponent(this.data.view.title || "")}`,
      `code=${encodeURIComponent(this.data.view.code || "")}`,
      `addon=${encodeURIComponent(addon)}`,
      `focus=${encodeURIComponent(focus)}`,
    ].join("&");
    track("workspace_open", { from: "detail", addon });
    openPage(`/pages/workspace/index?${query}`);
  },
  openSnapshotSheet() {
    if (this.data.snapshotSaved) {
      track("snapshot_open", { market: this.data.market });
      const market = ["hk", "us", "a", "gold"].includes(this.data.market) ? this.data.market : "other";
      openPage(`/pages/workspace/index?market=${encodeURIComponent(market)}&name=${encodeURIComponent(this.data.view.title || "")}&code=${encodeURIComponent(this.data.view.code || "")}&focus=review&addon=evidence`);
      return;
    }
    const probe = {
      market: ["hk", "us", "a", "gold"].includes(this.data.market) ? this.data.market : "other",
      code: this.data.view.code || this.data.id || "",
      name: this.data.view.title || "",
    };
    const fact = captureFact(probe, this._latestSnapshot);
    const preview = {
      ...fact,
      researchScore: this.data.view.researchScore,
      researchScoreLabel: this.data.view.researchScoreLabel || "研究观察分",
      risk: fact.risk || this.data.view.risk || "",
      analysis: (this.data.view.quickAnswer || this.data.view.answer || "").slice(0, 120),
    };
    track("snapshot_preview", { market: probe.market });
    this.setData({
      snapshotSheetOpen: true,
      snapshotPreview: preview,
      snapshotNote: "",
      reasonIndex: 0,
      reviewConditionIndex: 0,
      reviewAtPreset: 14,
      snapshotNote: "",
      snapshotReviewAt: addDaysLabel(todayLabelLocal(), 14),
    });
  },
  closeSnapshotSheet() {
    this.setData({ snapshotSheetOpen: false });
  },
  selectReasonChip(event) {
    this.setData({ reasonIndex: Number(event.currentTarget.dataset.index) || 0 });
  },
  selectReviewChip(event) {
    this.setData({ reviewConditionIndex: Number(event.currentTarget.dataset.index) || 0 });
  },
  selectReviewAtPreset(event) {
    const days = Number(event.currentTarget.dataset.days) || 14;
    this.setData({
      reviewAtPreset: days,
      snapshotReviewAt: addDaysLabel(todayLabelLocal(), days),
    });
  },
  changeReason(event) {
    this.setData({ reasonIndex: Number(event.detail.value) || 0 });
  },
  changeReviewCondition(event) {
    this.setData({ reviewConditionIndex: Number(event.detail.value) || 0 });
  },
  inputSnapshotNote(event) {
    this.setData({ snapshotNote: event.detail.value });
  },
  inputSnapshotReviewAt(event) {
    this.setData({ snapshotReviewAt: event.detail.value, reviewAtPreset: 0 });
  },
  confirmSnapshotSave() {
    if (this.data.snapshotSaving) return;
    const reason = REASON_OPTIONS[this.data.reasonIndex] || REASON_OPTIONS[0];
    const condition = REVIEW_CONDITION_OPTIONS[this.data.reviewConditionIndex] || REVIEW_CONDITION_OPTIONS[0];
    const market = ["hk", "us", "a", "gold"].includes(this.data.market) ? this.data.market : "other";
    const name = this.data.view.title || "";
    const code = this.data.view.code || this.data.id || "";
    const preview = this.data.snapshotPreview || {};
    const payloadBase = {
      market,
      name,
      code,
      note: this.data.snapshotNote || "",
      thesis: reason.label,
      invalidation: condition.label,
      reasonId: reason.id,
      reasonLabel: reason.label,
      reviewConditionId: condition.id,
      reviewConditionLabel: condition.label,
      nextReviewAt: this.data.snapshotReviewAt || "",
      pageSource: "detail",
      baselineFact: preview,
    };

    // 非会员也可预览；正式保存时若额度不足再进入会员说明。
    this.setData({ snapshotSaving: true });
    wx.showLoading({ title: "正在保存", mask: true });
    const evidence = captureDecisionEvidence({
      title: `决策快照 · ${name}`,
      market,
      name,
      code,
    }, this._latestSnapshot);

    saveWatchItem(payloadBase)
      .then((workspace) => saveDecision({
        title: `决策快照 · ${name}`,
        note: this.data.snapshotNote || "",
        market,
        name,
        code,
        invalidation: condition.label,
        nextReviewAt: this.data.snapshotReviewAt || "",
        reasonId: reason.id,
        reasonLabel: reason.label,
        reviewConditionId: condition.id,
        reviewConditionLabel: condition.label,
        pageSource: "detail",
        evidence,
      }).catch((error) => {
        // 关注基线已写入时，想法额度用尽不阻断主流程。
        if (error && (error.code === "FREE_LIMIT" || error.code === "WORKSPACE_LIMIT")) {
          return workspace;
        }
        throw error;
      }))
      .then(() => {
        track("snapshot_create", { market, free: !this.data.memberActive });
        this.setData({
          snapshotSheetOpen: false,
          snapshotSaved: true,
        });
        wx.showToast({ title: "决策快照已保存", icon: "success" });
      })
      .catch((error) => {
        if (error && (error.code === "ENTITLEMENT_REQUIRED" || error.code === "FREE_LIMIT" || /会员|免费/.test(error.message || ""))) {
          track("member_purchase_from_snapshot", { market });
          this.setData({ snapshotSheetOpen: false });
          wx.showModal({
            title: "保存需要会员或免费额度",
            content: (error.message || "公开答案仍免费。会员用于持续跟踪、决策快照与节点提醒。") + "\n\n刚才只是预览，尚未保存成功。",
            confirmText: "查看会员",
            success: (result) => {
              if (result.confirm) openPage("/pages/member/index");
            },
          });
          return;
        }
        wx.showModal({
          title: "未能保存",
          content: error.message || "请稍后重试",
          showCancel: false,
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ snapshotSaving: false });
      });
  },
  onShareAppMessage() {
    track("share_tap", { page: "detail" });
    return { title: `${this.data.view.title || "研究资料"}｜望潮 Aurum`, path: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(this.data.id)}` };
  },
});
