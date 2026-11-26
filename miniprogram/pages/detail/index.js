const { openPage, goHome } = require("../../utils/nav");
const PRODUCT = require("../../config/product");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER, RISK_LABEL } = require("../../utils/disclaimer");
const { loadSnapshot, snapshotVersionKey } = require("../../data/store");
const { plainLabel, simpleHighlights } = require("../../utils/plain-reading");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, findItem, money, INVESTOR_NAMES, formatRange, shortCompanyName, shortOrgList, normalizeHkAction, usHeatDriver, tickerZhLabel, tickerShortZh, usPoolItems } = require("../../utils/answers");
const { scoreForItem } = require("../../utils/strategy-score");
const { buildStrategySignal } = require("../../utils/strategy-signals");
const { buildHkExitPlan, buildHkExitBands, HK_HOT_OVERSUBSCRIPTION } = require("../../utils/hk-exit-plan");
const { isPositionChange, instrumentSuffix } = require("../../utils/guru-changes");
const { hkLeverageEligible, goldPlanView } = require("../../utils/market-lenses");
const { goldTurningViews } = require("../../utils/daily-answers");
const strategyEvidence = require("../../data/strategy-evidence");
const { captureFact, captureDecisionEvidence } = require("../../utils/fact-snapshot");
const { marketSources, dedupeSources, sourceName } = require("../../utils/sources");
const { filingsFor, formatFiling, formatFilingLine, filingCoverageNote } = require("../../utils/us-filings");
const { eventSummary, eventSources, eventFactFor } = require("../../utils/us-event-facts");
const { getDividendStability } = require("../../utils/dividend-stability");
// 「毛利率 43%」本身不回答"这算高还是低"。望潮池子里 30 只美股、20 只 A 股
// 的同口径字段就摆在快照里，把它算成「池内第 6/30」是零新增数据的一次密度提升。
const { poolRankVisual } = require("../../utils/pool-rank");
const { sparklineSvg } = require("../../utils/sparkline");
const { annualRank } = require("../../utils/smart-money");
// 黄金四个报价之间唯一那条换算（1 金衡盎司 = 31.1035 克），栏目页和详情页共用。
const { goldParity } = require("../../utils/gold-parity");
const { recentChange, historicalGoldSeries, domesticGoldClose } = require("../../utils/gold-series");
const { marketReferenceAsOf } = require("../../utils/historical-reference");
// 快照给的日期有 ISO 时间戳、M/D/YYYY、YYYY-MM-DD 三种写法混着来。新闻资讯页
// 一进门就归一到 YYYY-MM-DD，这一页以前没做，于是同一屏并排出现「行情截至
// 2026-09-02T20:00:00.000Z」和「披露日期 2026-08-14」。共用同一个归一函数。
const { dayText, asOfText } = require("../../utils/dates");
const { isQuickStarred, toggleQuickStar } = require("../../utils/quick-stars");
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
  guru: { label: "聪明钱跟踪", icon: "/assets/home/guru.svg", tone: "guru" },
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

let lineChartSeq = 0;

// 券商行情图那种折线走势：出成 SVG 图片（utils/sparkline.js，和首页走势卡同一套画法）。
// 以前用 canvas 原生层，切 tab 后偶尔整张画到页头上、自己的格子空着；图片跟着布局走，
// 也不用等节点量尺寸再重画。600×200 和 .line-chart-img 的 100%×200rpx 大致同比例。
const LINE_SVG = { width: 600, height: 200, grid: true };

function priceVisual(history, title, formatter = (value) => Number(value).toFixed(2), hint, changeLabel = "涨跌") {
  const values = (history || []).filter(hasNumber).map(Number);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = values[values.length - 1];
  const change = values[0] ? ((latest - values[0]) / Math.abs(values[0])) * 100 : 0;
  return withChartMeta({
    kind: "line",
    title,
    src: sparklineSvg(values, LINE_SVG),
    lowLabel: `最低 ${formatter(low)}`,
    latestLabel: `期末 ${formatter(latest)}`,
    highLabel: `最高 ${formatter(high)}`,
    // 只留涨跌一格：时间段写在标题里（「近180日国际金价」），最低/最新/最高在图下；
    // 「中位」是统计词，「样本 181」读者不知道是什么的 181，都撤掉。
    stats: [
      { label: changeLabel, value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` },
    ],
  }, hint || "曲线越靠上价格越高；只看历史，不预测明天。");
}

// 借鉴 Simply Wall St 雪花雷达图：N 边形多层同心网 + 柔和蓝色多边形 + 发光顶点 + 指标分值。
function paintRadarChart(ctx, width, height, axes) {
  ctx.clearRect(0, 0, width, height);
  const n = axes.length;
  const cx = width / 2;
  const cy = height / 2 + 4;
  const labelPad = 36;
  const radius = Math.max(24, Math.min(width, height) / 2 - labelPad);
  const angleAt = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointAt = (i, r) => {
    const angle = angleAt(i);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  [1, 0.75, 0.5, 0.25].forEach((f, idx) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pointAt(i % n, radius * f);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = idx % 2 === 0 ? "rgba(241, 245, 252, 0.55)" : "rgba(255, 255, 255, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  for (let i = 0; i < n; i++) {
    const [x, y] = pointAt(i, radius);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#e2e8f0";
    ctx.stroke();
  }

  ctx.beginPath();
  axes.forEach((axis, i) => {
    const val = Math.max(8, Math.min(100, Number(axis.value) || 0));
    const [x, y] = pointAt(i, radius * (val / 100));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  grad.addColorStop(0, "rgba(29, 95, 209, 0.34)");
  grad.addColorStop(1, "rgba(56, 189, 248, 0.18)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#1d5fd1";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  axes.forEach((axis, i) => {
    const val = Math.max(8, Math.min(100, Number(axis.value) || 0));
    const [dotX, dotY] = pointAt(i, radius * (val / 100));
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(29, 95, 209, 0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = "#1d5fd1";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });

  ctx.font = "600 11px -apple-system, sans-serif";
  axes.forEach((axis, i) => {
    const angle = angleAt(i);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const [lx, ly] = pointAt(i, radius + 14);
    ctx.fillStyle = "#334155";
    ctx.textAlign = Math.abs(cos) < 0.35 ? "center" : (cos > 0 ? "left" : "right");
    ctx.textBaseline = Math.abs(sin) < 0.35 ? "middle" : (sin > 0 ? "top" : "bottom");
    ctx.fillText(axis.label, lx, ly);
  });
}

// 借鉴韭圈儿×Claude 高颜值研报卡片：把结构化结论、体检条、依据与风险画成可保存转发的高清海报图。
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapPosterText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(String(text || ""));
  let line = "";
  let lineCount = 0;
  let curY = y;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lineCount += 1;
      if (lineCount >= maxLines) {
        ctx.fillText(`${line.slice(0, Math.max(0, line.length - 1))}…`, x, curY);
        return curY + lineHeight;
      }
      ctx.fillText(line, x, curY);
      line = chars[i];
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

function paintSharePoster(ctx, width, height, view, dataAsOf) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f4f6fa";
  ctx.fillRect(0, 0, width, height);

  // 顶部深海精装横幅
  const headerH = 128;
  const headerGrad = ctx.createLinearGradient(0, 0, width, headerH);
  headerGrad.addColorStop(0, "#0d1a33");
  headerGrad.addColorStop(0.6, "#162b52");
  headerGrad.addColorStop(1, "#1d3c74");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, width, headerH);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 11px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`望潮 Aurum · ${view.marketLabel || "公开研究卡片"}`, 20, 18);

  ctx.textAlign = "right";
  ctx.fillText(String(dataAsOf || "历史资料参考").slice(0, 22), width - 20, 18);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 24px -apple-system, sans-serif";
  ctx.fillText(String(view.title || "").slice(0, 12), 20, 44);

  if (view.code) {
    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.font = "500 12px -apple-system, sans-serif";
    ctx.fillText(String(view.code), 20, 78);
  }

  // 结论卡片
  let y = 104;
  drawRoundedRect(ctx, 16, y, width - 32, 92, 14);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#e6ebf3";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#1d5fd1";
  ctx.font = "700 12px -apple-system, sans-serif";
  ctx.fillText(`核心结论 · ${view.primaryJudgment || "先看依据"}`, 30, y + 14);

  ctx.fillStyle = "#0f172a";
  ctx.font = "500 12px -apple-system, sans-serif";
  const reasonText = (view.overview && view.overview.reason) || view.answer || "历史资料仅供研究对照";
  wrapPosterText(ctx, reasonText, 30, y + 36, width - 60, 18, 2);
  y += 104;

  // 核心指标双格
  const highlights = (view.highlights || []).slice(0, 2);
  if (highlights.length) {
    const cellW = (width - 42) / 2;
    highlights.forEach((cell, idx) => {
      const cx = 16 + idx * (cellW + 10);
      drawRoundedRect(ctx, cx, y, cellW, 56, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#e6ebf3";
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "500 11px -apple-system, sans-serif";
      ctx.fillText(String(cell.label || ""), cx + 12, y + 10);
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 16px -apple-system, sans-serif";
      ctx.fillText(String(cell.value || "—").slice(0, 14), cx + 12, y + 29);
    });
    y += 68;
  }

  // Simply Wall St 客观体检条
  const checks = ((view.overview && view.overview.healthChecks) || []).slice(0, 3);
  if (checks.length) {
    const cardH = 34 + checks.length * 32;
    drawRoundedRect(ctx, 16, y, width - 32, cardH, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#e6ebf3";
    ctx.stroke();
    ctx.fillStyle = "#334155";
    ctx.font = "700 12px -apple-system, sans-serif";
    ctx.fillText("客观体检对照", 30, y + 12);
    checks.forEach((chk, idx) => {
      const ry = y + 34 + idx * 30;
      ctx.fillStyle = "#475569";
      ctx.font = "500 11px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(chk.label, 30, ry);
      ctx.fillStyle = chk.tone === "good" ? "#15803d" : (chk.tone === "warn" ? "#b45309" : "#0f172a");
      ctx.font = "700 11px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(chk.valueText, width - 30, ry);
      ctx.textAlign = "left";
      drawRoundedRect(ctx, 30, ry + 16, width - 60, 6, 3);
      ctx.fillStyle = "#e6ebf2";
      ctx.fill();
      const fillW = Math.max(8, Math.round(((width - 60) * Math.min(100, Math.max(5, Number(chk.percent) || 0))) / 100));
      drawRoundedRect(ctx, 30, ry + 16, fillW, 6, 3);
      ctx.fillStyle = chk.tone === "good" ? "#16a34a" : (chk.tone === "warn" ? "#d97706" : "#1d5fd1");
      ctx.fill();
    });
    y += cardH + 12;
  }

  // 主要风险框
  const riskText = (view.overview && view.overview.keyRisk) || view.risk || "";
  if (riskText && y < height - 92) {
    drawRoundedRect(ctx, 16, y, width - 32, 68, 12);
    ctx.fillStyle = "#fffbeb";
    ctx.fill();
    ctx.strokeStyle = "#fde68a";
    ctx.stroke();
    ctx.fillStyle = "#b45309";
    ctx.font = "700 11px -apple-system, sans-serif";
    ctx.fillText("主要风险提示", 30, y + 10);
    ctx.fillStyle = "#78350f";
    ctx.font = "500 11px -apple-system, sans-serif";
    wrapPosterText(ctx, riskText, 30, y + 28, width - 60, 16, 2);
  }

  // 底部免责与品牌落款
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 10px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("公开历史资料整理，不构成投资建议 · 微信搜「望潮」免费查阅", width / 2, height - 24);
  ctx.textAlign = "left";
}

// 散点图画法：零轴（0%）是暗盘/首日涨跌天然的破发分界线，画成虚线；点数
// 少（通常只有"本股"和"样本均值"两个），标签直接贴着点摆，不用图例。
function paintScatterChart(ctx, width, height, points, xLabel, yLabel) {
  ctx.clearRect(0, 0, width, height);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const padTop = 14, padBottom = 22, padLeft = 8, padRight = 8;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const xMin = Math.min(0, ...xs);
  const xMax = Math.max(0, ...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const xPad = Math.max(xMax - xMin, 1e-6) * 0.25;
  const yPad = Math.max(yMax - yMin, 1e-6) * 0.25;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;
  const xAt = (v) => padLeft + ((v - xLo) / (xHi - xLo)) * plotW;
  const yAt = (v) => padTop + (1 - (v - yLo) / (yHi - yLo)) * plotH;

  ctx.strokeStyle = "#e3e6ec";
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft, padTop, plotW, plotH);

  ctx.setLineDash([2, 2]);
  if (xLo < 0 && xHi > 0) {
    ctx.beginPath();
    ctx.moveTo(xAt(0), padTop);
    ctx.lineTo(xAt(0), padTop + plotH);
    ctx.stroke();
  }
  if (yLo < 0 && yHi > 0) {
    ctx.beginPath();
    ctx.moveTo(padLeft, yAt(0));
    ctx.lineTo(padLeft + plotW, yAt(0));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.font = "10px sans-serif";
  const pixelPoints = points.map((point) => ({ x: xAt(point.x), y: yAt(point.y) }));
  points.forEach((point, i) => {
    const { x, y } = pixelPoints[i];
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = point.tone === "cohort" ? "#d99a12" : "#1d5fd1";
    ctx.fill();
    ctx.fillStyle = "#4c5057";
    const alignRight = x > padLeft + plotW * 0.6;
    ctx.textAlign = alignRight ? "right" : "left";
    // "本股"和"样本均值"数值越接近，两个点在画布上就靠得越近——只按象限判断
    // 上/下会让两条标签压在一起；离得近时改成按顺序错开到点的上方/下方。
    const nearAnother = pixelPoints.some((other, j) => j !== i && Math.hypot(other.x - x, other.y - y) < 26);
    const above = nearAnother ? i % 2 === 0 : y > padTop + plotH * 0.3;
    ctx.textBaseline = above ? "bottom" : "top";
    ctx.fillText(point.label, x + (alignRight ? -7 : 7), y + (above ? -6 : 6));
  });

  ctx.fillStyle = "#797d85";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(xLabel, padLeft, height - 4);
  ctx.textBaseline = "top";
  ctx.fillText(yLabel, padLeft, 2);
}

function barVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  // 每行已经写着标签和数值，不再在上面加「对比项/最高项」把同一组数念第二遍。
  return withChartMeta({
    kind: "bars",
    title,
    stats: [],
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      width: Math.max(14, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
    })),
  }, options.hint);
}

/**
 * 用报告所属年度汇总已过除息日的分红，和稳定性榜共用同一份记录。
 * 自然年收到的钱可能来自两个报告年度，不能直接拿它判断年度减息。
 * 支持按 5年 / 10年 / 全部（实际收录年限，不凑满）自由切换回看。
 */
function dividendHistoryVisual(raw, asOf, rangeId = "10") {
  const cutoff = asOf || raw.snapshotUpdatedAt || raw.priceAsOf || raw.asOf;
  if (!cutoff) return null;
  const result = getDividendStability(raw, { asOf: cutoff });
  if (!result.expectedYears.length) return null;
  const years = result.years || [];
  const totalYears = years.length;
  const endYear = Math.max(result.endYear, ...years.map((row) => row.year));
  const earliestYear = years.length ? Math.min(result.startYear, ...years.map((row) => row.year)) : result.startYear;
  const startYear = rangeId === "all"
    ? earliestYear
    : rangeId === "5"
      ? Math.max(endYear - 4, earliestYear)
      : Math.max(endYear - 9, earliestYear);
  const yearMap = new Map(years.map((row) => [row.year, row]));
  const rows = Array.from({ length: endYear - startYear + 1 }, (_, index) => {
    const year = startYear + index;
    return yearMap.get(year) || { year, perTenSharesRmb: null, complete: false };
  }).reverse();
  const maximum = Math.max(...rows.map((row) => Number(row.perTenSharesRmb) || 0), 1);
  const ranges = [];
  if (totalYears > 5) {
    ranges.push({ id: "5", label: "近5年" });
    if (totalYears > 10) ranges.push({ id: "10", label: "近10年" });
    ranges.push({ id: "all", label: `全部${totalYears}年` });
  }
  const activeRange = ranges.some((r) => r.id === rangeId)
    ? rangeId
    : (ranges[0] ? ranges[ranges.length - 1].id : "all");
  return withChartMeta({
    kind: "bars",
    isDividendHistory: true,
    activeRange,
    ranges,
    title: "所属年度分红（每10股，含税）",
    hint: `截至${result.asOf}，按所属年度倒序汇总；缺数不记0，除息日已过不代表已到账。`,
    stats: [
      { label: "近5年资料", value: `${result.observedYears.length}/5年` },
      { label: "分红稳定性", value: result.score == null ? "资料不足" : `${result.score}分` },
      ...(totalYears > 0 ? [{ label: "已收录", value: `${totalYears}年` }] : []),
    ],
    items: rows.map((row) => ({
      id: `dividend-${row.year}`,
      label: `${row.year}年`,
      valueText: hasNumber(row.perTenSharesRmb)
        ? `¥${Number(row.perTenSharesRmb).toFixed(2)}${row.complete ? "" : " · 未完整"}`
        : "资料缺失",
      width: hasNumber(row.perTenSharesRmb) ? Math.max(8, Math.round((Number(row.perTenSharesRmb) / maximum) * 100)) : 0,
      tone: "up",
    })),
  });
}

/** 扁平竖柱对比：仅用于同一量纲的指标。 */
function solidVisual(rows, title, options = {}) {
  const usable = (rows || []).filter((item) => hasNumber(item.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((item) => Math.abs(Number(item.value))), 1);
  const unique = new Set(usable.map((item) => Number(item.value).toFixed(4)));
  // 柱顶已经标着数值，多根柱子时不再重复「对比项/最高/最低」；只有全一样高时说一声，免得像没画出来。
  return withChartMeta({
    kind: "solid",
    title,
    stats: options.stats !== false && (usable.length === 1 || unique.size === 1)
      ? [{ label: "说明", value: unique.size === 1 ? "数值相同" : "单值" }]
      : [],
    items: usable.map((item, index) => ({
      id: `${index}-${item.label}`,
      label: item.label,
      valueText: item.valueText,
      height: Math.max(22, Math.round((Math.abs(Number(item.value)) / max) * 100)),
      tone: Number(item.value) < 0 ? "down" : "up",
    })),
  }, options.hint);
}

function scoreMeter(score, title, badge, hint) {
  if (!hasNumber(score)) return null;
  const value = Math.max(0, Math.min(100, Math.round(Number(score))));
  return withChartMeta({
    kind: "meter",
    // 卡片标题写的是「国际金观察分」「收息观察分」，里面那一格却统一硬编成
    // 「研究分」——五类资产里四类的分名和自己的标题对不上。分值连同满分口径
    // 一起并进标题，格子里只留真正是另一码事的「结论」。
    title: `${title} ${value}/100`,
    percent: value,
    lowLabel: "0",
    midLabel: "",
    highLabel: "100",
    stats: badge ? [{ label: "结论", value: String(badge) }] : [],
  }, hint || "");
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

/** 与 meterVisual 同构，但区间来自显式 low/high（如按股息率回推的参考买卖价），
 * 不是历史价格数组；复用同一个 meter 图表模板，不需要新增 WXML。 */
function bandMeterVisual(low, high, current, title, formatter = money, hint) {
  if (!hasNumber(low) || !hasNumber(high) || !hasNumber(current)) return null;
  const lowValue = Math.min(Number(low), Number(high));
  const highValue = Math.max(Number(low), Number(high));
  const price = Number(current);
  const percent = highValue === lowValue ? 50 : Math.round(((price - lowValue) / (highValue - lowValue)) * 100);
  const clamped = Math.max(0, Math.min(100, percent));
  return withChartMeta({
    kind: "meter",
    title,
    percent: clamped,
    lowLabel: formatter(lowValue),
    midLabel: `样本报价 ${formatter(price)}`,
    highLabel: formatter(highValue),
    stats: [
      { label: "参考买入", value: formatter(lowValue) },
      { label: "样本报价", value: formatter(price) },
      { label: "参考卖出", value: formatter(highValue) },
    ],
  }, hint || "");
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

/** 雷达图：把若干个已经统一到 0–100 量纲的百分比指标画成一个多边形轮廓——
 * 形状本身就是"哪个维度强、哪个维度弱"的答案，比逐条读数字更快建立整体
 * 印象。轴数不足三个时多边形退化成线，直接不画。 */
function radarVisual(axes, title, hint) {
  const usable = (axes || []).filter((axis) => axis && hasNumber(axis.value));
  if (usable.length < 3) return null;
  lineChartSeq += 1;
  return withChartMeta({
    kind: "radar",
    canvasId: `radar-${lineChartSeq}`,
    title,
    axes: usable.map((axis) => ({
      label: axis.label,
      value: Math.max(0, Math.min(100, Number(axis.value))),
    })),
    stats: usable.map((axis) => ({
      label: axis.label,
      value: axis.valueText || `${Math.round(Number(axis.value))}`,
    })),
  }, hint);
}

/** 散点图：两个可比的点（通常是"本股"和"历史样本均值"）摆在同一个二维
 * 平面上，比两根分别站在各自柱状图里的柱子更容易看出相对位置和方向。
 * 目前只服务"两轴都是百分比涨跌"这一种场景，够用即可，不做成通用坐标系。 */
function scatterVisual(points, title, xLabel, yLabel, hint) {
  const usable = (points || []).filter((point) => point && hasNumber(point.x) && hasNumber(point.y));
  if (usable.length < 2) return null;
  lineChartSeq += 1;
  return withChartMeta({
    kind: "scatter",
    canvasId: `scatter-${lineChartSeq}`,
    title,
    xLabel,
    yLabel,
    points: usable.map((point) => ({
      label: point.label,
      x: Number(point.x),
      y: Number(point.y),
      tone: point.tone || "self",
    })),
    stats: usable.map((point) => ({
      label: point.label,
      value: `${point.x.toFixed(1)} / ${point.y.toFixed(1)}`,
    })),
  }, hint);
}

/** 上市后表现曲线：把暗盘/首日/五日/五日最高四个独立百分比，串成一条从
 * 发行价（0%）出发的涨跌路径——复用现成的 line 图表种类和画法；比四根独立柱子更看得出"越走越强/越走越弱"的走势。 */
function hkPerformanceCurveVisual(review) {
  const points = [
    { label: "发行价", value: 0 },
    hasNumber(review?.greyMarketChange) ? { label: "暗盘", value: Number(review.greyMarketChange) } : null,
    hasNumber(review?.firstDayChange) ? { label: "首日", value: Number(review.firstDayChange) } : null,
    hasNumber(review?.fiveDayChange) ? { label: "五日", value: Number(review.fiveDayChange) } : null,
    hasNumber(review?.fiveDayHighChange) ? { label: "五日最高", value: Number(review.fiveDayHighChange) } : null,
  ].filter(Boolean);
  if (points.length < 3) return null;
  const values = points.map((point) => point.value);
  const latest = points[points.length - 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  return withChartMeta({
    kind: "line",
    title: "上市后表现曲线",
    src: sparklineSvg(values, LINE_SVG),
    lowLabel: `最低 ${formatPercent(low)}`,
    latestLabel: `${latest.label} ${formatPercent(latest.value)}`,
    highLabel: `最高 ${formatPercent(high)}`,
    stats: points.map((point) => ({ label: point.label, value: formatPercent(point.value) })),
  }, "以发行价为基准（0%）；曲线向上表示相对发行价上涨。");
}

/** 资料完整度 + 认购热度画像：把原来几个独立文字方块（解析度、基石占比、
 * 认购倍数……）收进一张雷达图——量纲都统一成 0–100，一眼能看出这只新股是
 * "资料全、热度高"还是"资料缺、冷门"的整体形状，不用逐条读数字。认购倍数
 * 按用户自己的 100 倍门槛归一（100 倍=满格），到边缘正好对应
 * buildPersonalIPORule 第五步的判断线。 */
function hkQualityRadarVisual(raw, announce, prospectus) {
  const parseRate = (info) => (
    info && hasNumber(info.matchedFields) && hasNumber(info.totalFields) && Number(info.totalFields) > 0
  ) ? (Number(info.matchedFields) / Number(info.totalFields)) * 100 : null;
  const announceRate = parseRate(announce);
  const prospectusRate = parseRate(prospectus);
  const axes = [
    announceRate != null ? { label: "公告解析", value: announceRate, valueText: `${announceRate.toFixed(0)}%` } : null,
    prospectusRate != null ? { label: "招股书解析", value: prospectusRate, valueText: `${prospectusRate.toFixed(0)}%` } : null,
    hasNumber(raw.cornerstonePercent)
      ? { label: "基石占比", value: Number(raw.cornerstonePercent), valueText: `${Number(raw.cornerstonePercent).toFixed(1)}%` }
      : null,
    hasNumber(raw.oneLotRate)
      ? { label: "一手中签", value: Number(raw.oneLotRate), valueText: `${Number(raw.oneLotRate).toFixed(1)}%` }
      : null,
    hasNumber(raw.publicOversubscription)
      ? { label: "公开认购", value: Math.min(100, Number(raw.publicOversubscription)), valueText: `${Number(raw.publicOversubscription).toFixed(1)}倍` }
      : null,
  ].filter(Boolean);
  return radarVisual(axes, "资料与认购画像", "五个维度都换算到 0–100；认购倍数按 100 倍封顶，够到边缘即达标。");
}

/** 本股 vs 历史样本：把 hkCohortVisual 里两个独立柱状平均值，换成"本股"和
 * "样本均值"两个点摆在暗盘×首日的平面上——散点比柱状图更容易看出本股相对
 * 历史样本是偏强还是偏弱、方向是否一致（同涨/同跌/背离）。 */
function hkCohortScatterVisual(review, evidence) {
  const hk = evidence && evidence.markets ? evidence.markets.hk : null;
  if (!hk || !hasNumber(hk.averageGreyMarket) || !hasNumber(hk.averageFirstDay)) return null;
  if (!hasNumber(review?.greyMarketChange) || !hasNumber(review?.firstDayChange)) return null;
  const points = [
    { label: "本股", x: Number(review.greyMarketChange), y: Number(review.firstDayChange), tone: "self" },
    { label: "样本均值", x: Number(hk.averageGreyMarket), y: Number(hk.averageFirstDay), tone: "cohort" },
  ];
  return scatterVisual(
    points,
    "暗盘×首日：本股对照样本",
    "暗盘涨跌%",
    "首日涨跌%",
    `样本均值来自 ${hk.points || "多"} 个 IPO 事件，只作对照，不预测本股。`,
  );
}

/** 「打中后观察分位」原来是四行密文字，每行把热/冷两档中位、映射价、收正
 * 只数、区间挤在一句里，读起来很费劲。改成横向柱状图：中位涨跌一眼比出
 * 超购热门批（≥1000倍）和一般批的差距；收正只数并入柱子自己的数字，历史
 * 样本量与首日胜率挪到底部 stats。分档口径和原文字版一致——暗盘/首日
 * 能分档就分档，分不开时退回合并中位；首周历史上从不分档，只有一档。 */
function hkExitTierBarsVisual(bands) {
  if (!bands) return null;
  const rows = [];
  const addTier = (key, label) => {
    const hot = bands.hot && bands.hot[key];
    const cool = bands.cool && bands.cool[key];
    if (hot && hot.n && hasNumber(hot.p50) && cool && cool.n && hasNumber(cool.p50)) {
      rows.push({ label: `${label}·热门批`, value: hot.p50, valueText: `${formatPercent(hot.p50)}（${hot.positive}/${hot.n}收正）` });
      rows.push({ label: `${label}·一般批`, value: cool.p50, valueText: `${formatPercent(cool.p50)}（${cool.positive}/${cool.n}收正）` });
    } else {
      const combined = bands[key];
      if (combined && combined.n && hasNumber(combined.p50)) {
        rows.push({ label, value: combined.p50, valueText: `${formatPercent(combined.p50)}（${combined.positive}/${combined.n}收正）` });
      }
    }
  };
  addTier("grey", "暗盘");
  addTier("firstDay", "首日");
  const fiveDay = bands.fiveDay;
  if (fiveDay && fiveDay.n && hasNumber(fiveDay.p50)) {
    rows.push({ label: "首周", value: fiveDay.p50, valueText: `${formatPercent(fiveDay.p50)}（${fiveDay.positive}/${fiveDay.n}收正）` });
  }
  if (rows.length < 2) return null;
  const chart = barVisual(rows, "打中后同类新股涨跌分布", { stats: false });
  if (!chart) return null;
  chart.stats = [
    { label: "历史样本", value: `${bands.sampleCount || 0}只` },
    { label: "热门批口径", value: `超购${HK_HOT_OVERSUBSCRIPTION}倍以上` },
  ];
  return chart;
}

/** 用户五步打新规则：用柱状图展示每一步的判定强度，比纯文字列表更快看出
 * 在哪一步定案——通过/命中=100（决定性正向或放行），不通过=0（一票否决，
 * 只在第一步出现），未命中=50（不否决，进入下一步）。只有真正跑到的步骤
 * 才在 personalRule.steps 里，后面步骤因为提前收敛压根没跑，图上不出现——
 * 不是被隐藏，是没发生。 */
function personalRuleStepsVisual(personalRule) {
  const steps = (personalRule && personalRule.steps) || [];
  if (steps.length < 2) return null;
  // 不通过用负值而不是 0——solidVisual 按正负分配颜色（down=暖色警示），一票
  // 否决的那一步理应是满格的暖色柱子，不能矮矮地和"未命中"一样是绿色。
  const strengthOf = (result) => {
    if (result === "通过" || result === "命中") return 100;
    if (result === "不通过") return -100;
    if (result === "未命中") return 50;
    return null;
  };
  const rows = steps
    .map((step) => {
      const strength = strengthOf(step.result);
      return strength == null ? null : { label: `第${step.step}步`, value: strength, valueText: step.result };
    })
    .filter(Boolean);
  if (rows.length < 2) return null;
  const chart = solidVisual(rows, "我的五步打新规则", { stats: false });
  if (!chart) return null;
  chart.stats = [{ label: "结论", value: personalRule.verdict || "—" }];
  return chart;
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
        // 这只票自己的详情页也会读到这份持仓：不标出期权，读的人会以为
        // 这家机构是在买正股，而实际可能是一张方向相反的看跌/看涨期权。
        value: `${formatNumber(holding.weight, "%")}${instrumentSuffix(holding.putCall)} · ${holding.changeLabel || "变化待核验"}`,
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

function buildHKView(base, item, snapshot) {
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
  // group 是否 ended 只看上游配发结果/结论，不看日期——认购截止到配发结果出来
  // 之前有个空档，这段时间 group 仍是「非 ended」，但「可关注申购」这种邀请
  // 继续申购的措辞已经不成立了，得单独判一次日期。
  const deadlinePassed = !ended && daysToDeadline != null && daysToDeadline < 0;
  // 原定上市日已过但快照仍没有上市结果时，不能继续把旧进度写成「等待上市」。
  const listingProgressUnverified = !ended && daysToListing != null && daysToListing < 0;
  const deadlineLabel = (value) => (value == null ? null : (value < 0 ? "已截止" : (value === 0 ? "今天" : `${value}天`)));

  base.badge = item.badge || answer.verdict || base.badge;
  // 详情页读的是 raw.publicAnswer，绕过了 hkActionFromItem，所以退掉的措辞要在
  // 这里再过一次同一个归一化，否则首页改好了详情页还留着「卖点」。
  base.answer = listingProgressUnverified
    ? "原定上市日期已过，上市及配发进展待核验。"
    : deadlinePassed
    ? `认购已截止，等待${raw.listingDate ? `上市（${raw.listingDate}）` : "配发结果"}。`
    : (normalizeHkAction(answer.action, "") || item.one || item.badge);
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
        ["截止剩余", deadlineLabel(daysToDeadline)],
        ["上市日期", raw.listingDate],
        ["距预计上市", daysToListing != null && daysToListing >= 0 ? `${daysToListing}天` : null],
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
        // 第一格原本又写一遍 item.badge，和正上方那条绿色「结论」条一字不差；
        // 退成「研究分」又会和标题下那枚「研究分 77」胶囊在同一屏撞第二次。
        // 中签率、公开认购倍数要等配售结果才有，有就优先显示；都没有时改放上市
        // 日——打新的人这一屏真正缺的是钱要锁到哪天，而它只躺在「资料」里。
        // 另外「一手 3949」「招股 19.55」都没有单位，单位直接写进数字。
        hasNumber(raw.oneLotRate)
          ? { label: "一手中签", value: `${Number(raw.oneLotRate).toFixed(1)}%` }
          : (hasNumber(raw.publicOversubscription)
            ? { label: "公开认购", value: `${Number(raw.publicOversubscription).toFixed(1)}倍` }
            : { label: listingProgressUnverified ? "原定上市" : "预计上市", value: raw.listingDate ? String(raw.listingDate).slice(5) : "待公布" }),
        { label: "一手金额", value: hasNumber(raw.entryFee) ? `${Number(raw.entryFee).toFixed(0)}港元` : "待公布" },
        { label: "招股价", value: offer != null ? `${offer.toFixed(2)}港元` : "待公布" },
        // 「截止 0天」读起来像已经结束了，其实是今天最后一天；负数则是
        // 认购期已过、配发结果还没出来的空档，写「已截止」而不是「-2天」。
        {
          label: "认购截止",
          value: daysToDeadline == null
            ? (raw.offerDeadline || "待公布")
            : (daysToDeadline > 0 ? `还剩${daysToDeadline}天` : deadlineLabel(daysToDeadline)),
        },
      ];

  const scheduleTiles = metricTilesVisual([
    ["招股开始", raw.offerStart],
    ["认购截止", raw.offerDeadline || raw.offerEnd],
    [listingProgressUnverified ? "原定上市" : "预计上市", raw.listingDate],
    ["截止剩余", deadlineLabel(daysToDeadline)],
    ["距预计上市", daysToListing != null && daysToListing >= 0 ? `${daysToListing}天` : null],
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

  // 解析字段数、基石占比、一手中签、公开认购这些数字已经并入下面的雷达图；
  // 这里只留雷达图管不了的分类信息（状态/类型/文字说明/来源），不重复摆数字。
  const qualityTiles = metricTilesVisual([
    ["资料状态", raw.researchView?.label || null],
    ["公告类型", announceKindLabel(announce.kind, announce.reason) || null],
    ["资料说明", researchNoteShort(raw.researchView) || null],
    ["来源", sourceName(raw.source) || "港交所"],
  ].filter((row) => row[1]), "资料说明", "解析字段占比等数字见上方雷达图。");

  const qualityRadar = hkQualityRadarVisual(raw, announce, prospectus);
  const performanceCurve = hkPerformanceCurveVisual(review);
  const cohortScatter = hkCohortScatterVisual(review, strategyEvidence);
  const ruleSteps = personalRuleStepsVisual(raw.personalRule);
  // ended（已上市）看自己这一只的实际结果，走 performanceCurve；非 ended
  // （还在认购中）没有本股结果，只能看同类历史样本分布，走这张分档柱状图。
  const exitTierBars = ended ? null : hkExitTierBarsVisual(buildHkExitBands(snapshot));

  if (ended) {
    setCharts(
      base,
      performanceCurve,
      cohortScatter || hkCohortVisual(strategyEvidence),
      qualityRadar,
      capitalTiles,
      structureTiles,
      qualityTiles,
      scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
    );
    base.pageHelp = "";
  } else {
    setCharts(
      base,
      scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
      ruleSteps,
      qualityRadar,
      scheduleTiles,
      capitalTiles,
      offerBandVisual(raw, offerPrice),
      exitTierBars,
      hkCohortVisual(strategyEvidence),
      structureTiles,
      qualityTiles,
    );
    base.pageHelp = "";
  }

  // 四标签下「申购」「卖出」「依据」各自拥有的图表，不再靠标题正则猜归属。
  base.subscribeCharts = (ended
    ? [qualityRadar, capitalTiles, structureTiles, offerBandVisual(raw, offerPrice)]
    : [ruleSteps, qualityRadar, scheduleTiles, capitalTiles, offerBandVisual(raw, offerPrice), structureTiles]
  ).filter(Boolean);
  // hkCohortVisual/cohortScatter 恒放最后一位兜底：即便还没配发结果，卖出
  // tab 也不能是空的。exitTierBars 放最前——它是「打中后观察分位」原本
  // 那批文字的直接替代，理应是非 ended 卖出 tab 第一眼看到的内容。
  base.sellCharts = (ended
    ? [performanceCurve, cohortScatter || hkCohortVisual(strategyEvidence)]
    : [exitTierBars, hkCohortVisual(strategyEvidence)]
  ).filter(Boolean);
  base.evidenceCharts = [
    scoreMeter(answer.score, "研究分", item.badge || answer.verdict),
    ruleSteps,
    qualityTiles,
  ].filter(Boolean);

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
    ["资料来源", sourceName(raw.source) || "港交所公开文件"],
  ]);

  // 招股价/上市日/一手中签率/公开认购/距截止/首日涨跌这批数字已经在上方
  // highlights 条和「资料」tab 的 facts 表里各出现过一次，这里不再拼成
  // 第三份「公开事实」句子——「关键依据」应该只放事实表给不出的判断，
  // 不是同一批数字的第三种排列。
  base.analysis = ended
    ? [
        { title: "结果", body: `暗盘 ${formatPercent(review.greyMarketChange)} · 首日 ${formatPercent(review.firstDayChange)} · 五日 ${formatPercent(review.fiveDayChange)}` },
      ]
    : (deadlinePassed ? [] : [
        // 已截止就没有「要不要融资打」这个问题了，整行不出。
        {
          title: "融资申购",
          body: hkLeverageEligible(item) ? "可以考虑融资，仍只打一手" : "不适合融资，只用自有资金",
        },
      ]);
  base.actions = [];
  base.riskItems = ended
    ? [
        { title: "历史结果仅供复盘", body: "历史表现只用于复盘，不能倒推当时必然值得申购。" },
      ]
    : [
        { title: "破发/中签风险", body: "可能破发或中签极低，盈亏自负。" },
      ];
  base.risk = base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ");
  if (ended && item.rank) base.score = `首日涨幅第 ${item.rank} 名`;
  base.sourceNote = sourceName(raw.source) || "港交所公开文件与历史结果整理";
  // 供 buildOverview 拼「阶段与关键节点」卡片，避免重算一遍 ended/截止/上市日逻辑。
  base.stageInfo = {
    ended,
    deadlinePassed,
    listingProgressUnverified,
    daysToDeadline,
    daysToListing,
    listingDate: raw.listingDate || "",
    offerDeadline: raw.offerDeadline || raw.offerEnd || "",
    firstDayChange: review.firstDayChange,
  };
}

function buildUSView(base, item, snapshot) {
  const raw = item.raw || {};
  const fund = raw.fund || {};
  const history = (Array.isArray(raw.history) ? raw.history : []).filter((value) => hasNumber(value) && Number(value) > 0);
  const range = historyStats(history);
  const symbol = raw.symbol || item.code;
  const eventFact = eventFactFor(snapshot, symbol);
  const eventVerified = eventFact.state === "verified";
  const event = eventSummary(snapshot, symbol);
  const quote = hasNumber(raw.price) && Number(raw.price) > 0 ? Number(raw.price) : null;
  const quoteDate = dayText(raw.asOf);
  const chart = range && priceVisual(history, `${range.count} 个交易日价格`, money, "", "区间涨跌");
  const pricePosition = range && quote != null && quoteDate && range.high > range.low
    ? (quote - range.low) / (range.high - range.low)
    : null;
  let priceSummary = "价格区间资料不足。";
  if (pricePosition != null) {
    const position = pricePosition >= 0.8 ? "靠近样本高点" : pricePosition <= 0.2 ? "靠近样本低点" : "在样本区间中部";
    priceSummary = `在 ${range.count} 个交易日样本中，这次报价${position}。`;
  } else if (quote != null && quoteDate) {
    priceSummary = `${quoteDate} 的历史报价为 ${money(quote)}。`;
  }
  base.badge = eventVerified ? "公司近况" : "价格回顾";
  base.score = "";
  base.answer = eventVerified ? event : priceSummary;
  base.usPriceChart = chart || null;
  const holders = investorHoldings(snapshot, raw.symbol);
  // 金额须在 sanitize 阶段转为基础美元（amountUnit=USD）；此处不再猜乘数。
  const cashValue = hasNumber(fund.liquidAssets) ? Number(fund.liquidAssets) : null;
  const ocfValue = hasNumber(fund.operatingCashFlow) ? Number(fund.operatingCashFlow) : null;
  const moneyUnitNote = fund.amountUnit === "USD" ? "美元" : "公开财报金额";

  base.metrics = [
    ["历史报价", money(quote)],
    ["报价日涨跌", formatPercent(raw.changePercent)],
    ["近5个交易日涨跌", formatPercent(raw.weeklyChange)],
    ["热度", hasNumber(raw.heatScore) ? `${Number(raw.heatScore)} 分` : "暂缺"],
    ["市盈率", hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)} 倍` : "暂缺"],
    ["市值", hasNumber(fund.marketCap) ? formatLarge(fund.marketCap) : "暂缺"],
    ["近 60 日最低", range ? money(range.low) : null],
    ["近 60 日最高", range ? money(range.high) : null],
    // 股东回报/利润率/营收增长已由「依据」tab 的 marginBars/growthTiles 图表
    // 承载，这里不再重复罗列，避免同一个数字在图表和关键数据里各出现一次。
    ["成交量比", hasNumber(raw.volumeRatio) ? `${Number(raw.volumeRatio).toFixed(2)}倍` : null],
  ];
  base.metrics = compactFacts(base.metrics, 14);
  base.highlights = [
    quote != null ? { label: "历史报价", value: money(quote) } : null,
    hasNumber(raw.changePercent) ? { label: "报价日涨跌", value: formatPercent(raw.changePercent) } : null,
  ].filter(Boolean);

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

  // 池内分位：同一份快照里 30 只美股的同口径字段，横过来比一遍。
  // 只陈述"比它高的有几只"这个可以自己复算的事实，不含方向判断——所以市盈率
  // 那一行明写"越高越贵"，柱子长不代表好。
  const usPool = Array.isArray(snapshot?.us?.fundamentals) ? snapshot.us.fundamentals : [];
  const usPoolOf = (key) => usPool.map((entry) => entry && entry[key]);
  const usRank = poolRankVisual([
    { label: "毛利率", value: fund.grossMargin, valueText: formatPercent(fund.grossMargin), pool: usPoolOf("grossMargin") },
    { label: "利润率", value: fund.profitMargin, valueText: formatPercent(fund.profitMargin), pool: usPoolOf("profitMargin") },
    { label: "股东回报", value: fund.roe, valueText: formatPercent(fund.roe), pool: usPoolOf("roe") },
    { label: "营收增长", value: fund.revenueGrowth, valueText: formatPercent(fund.revenueGrowth), pool: usPoolOf("revenueGrowth") },
    {
      label: "市盈率",
      value: fund.pe,
      valueText: hasNumber(fund.pe) ? `${Number(fund.pe).toFixed(1)}倍` : "",
      pool: usPoolOf("pe"),
    },
  ], "池内分位 · 质量与估值", {
    poolLabel: `望潮美股池 ${usPool.length} 只`,
    reading: "池内排名，非全市场",
  });

  const revenueHistory = Array.isArray(fund.revenueHistory) ? fund.revenueHistory.filter(hasNumber).map(Number) : [];
  const revenueVisual = revenueHistory.length >= 2
    ? priceVisual(revenueHistory.slice().reverse(), "营收趋势", (value) => formatLarge(value), "近几期公开营收金额。", "营收变化")
    : null;
  const netIncomeHistory = Array.isArray(fund.netIncomeHistory) ? fund.netIncomeHistory.filter(hasNumber).map(Number) : [];
  const netIncomeVisual = netIncomeHistory.length >= 2
    ? priceVisual(netIncomeHistory.slice().reverse(), "净利润趋势", (value) => formatLarge(value), "近几期公开净利润金额。", "净利变化")
    : null;

  setCharts(
    base,
    chart,
    meterVisual(history, quote, "价格位置", money),
    usRank,
    marginBars,
    growthTiles,
    flowTiles,
    stockTiles,
    sizeTiles,
    revenueVisual,
    netIncomeVisual,
  );

  // 「价格」保留走势和区间，「动态」集中展示公告与近期营收/盈利趋势。
  base.trendCharts = [
    chart,
    meterVisual(history, quote, "价格位置", money),
  ].filter(Boolean);
  base.dynamicsCharts = [revenueVisual, netIncomeVisual].filter(Boolean);
  base.evidenceCharts = [
    usRank,
    marginBars,
    growthTiles,
    flowTiles,
    stockTiles,
    sizeTiles,
  ].filter(Boolean);

  base.pageHelp = "";
  base.facts = compactFacts([
    ["代码", raw.symbol || item.code],
    ["交易所", raw.exchange],
    ["行情状态", raw.marketState],
    // 原来这一行写 ["数据截至", raw.asOf || fund.period]：行情日期缺失时会退回
    // 财报期，于是一个 2025-12-31 的报告期被标成"数据截至"，读起来像是昨天的行情。
    // 行情和财报是两种日期，各自成行，缺哪个就少哪一行，不互相顶替。
    ["行情截至", dayText(raw.asOf)],
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
    ["财报期", dayText(fund.period)],
  ]);
  base.holdings = holders;
  // 公告是发行人自己提交的备案，不是我们的归纳，
  // 但也绝不写成「因为业绩所以涨」——只说同期发生了什么，因果留给读的人。
  const usFilings = filingsFor(snapshot, raw.symbol || item.code);
  const filingBody = usFilings.length
    ? `${formatFilingLine(usFilings, 3)}。公告与股价同期发生，不代表因果；原文链接见「来源」。`
    : (typeof filingCoverageNote === "function"
      ? filingCoverageNote(snapshot, raw.symbol || item.code)
      : "公告覆盖待核验；当前未收录备案，不能据此判断近期没有公告。建议核对 SEC 或公司投资者关系页面。");
  base.dynamics = {
    event,
    eventVerified,
    eventSourceUrl: eventVerified ? eventFact.facts[0].sourceUrl : "",
    heat: usHeatDriver(raw),
    filings: filingBody,
    // 借鉴 Quartr：结构化 SEC 公告时间轴，单条可一键复制官方原文。
    filingCards: usFilings.slice(0, 5).map((filing, index) => ({
      key: `filing-${index}-${filing.filingDate}`,
      date: filing.filingDate || "日期待核",
      form: filing.form || "公告",
      summary: (filing.labels || []).join(" · ") || "公开备案",
      sourceUrl: filing.sourceUrl || "",
    })),
  };
  base.analysis = [];
  base.actions = [];
  base.riskItems = [
    eventVerified
      ? { title: "解读边界", body: "公告和股价出现在同一时期，单靠日期无法判断涨跌原因。" }
      : { title: "估值参考", body: "样本内的股价位置只反映过去的波动。判断估值还要看盈利和财报日期。" },
  ];
  base.risk = base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ");
  base.sourceNote = raw.asOf
    ? `公开行情与财务资料 · 行情截至 ${dayText(raw.asOf)}`
    : fund.period
      ? `公开财务资料 · 财报期 ${dayText(fund.period)}`
      : "公开行情与财务资料 · 日期待核验";
}

function buildAShareFundView(base, item) {
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const price = hasNumber(raw.currentPrice) ? Number(raw.currentPrice) : null;
  const historyRows = (Array.isArray(raw.history) ? raw.history : [])
    .filter((entry) => entry?.date && hasNumber(entry.close) && Number(entry.close) > 0)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const history = historyRows.map((entry) => Number(entry.close));
  const formatFundPrice = (value) => `¥${Number(value).toFixed(3)}`;
  const priceChart = history.length >= 2 ? priceVisual(history, `${history.length} 个交易日走势`, formatFundPrice,
    `${dayText(historyRows[0].date)} 至 ${dayText(historyRows[historyRows.length - 1].date)}`, "区间涨跌") : null;
  const pricePosition = meterVisual(history, price, "红利ETF位置", formatFundPrice);
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
    ["历史报价", fundPrice],
    ["报价日涨跌", change],
    ["基金规模", size],
    ["管理费托管", raw.expenseRatio || "暂缺"],
    ["成立日期", raw.inceptionDate || "暂缺"],
    ["分红口径", raw.distributionNote || "以基金公告为准"],
  ];
  base.highlights = [
    { label: "类型", value: "ETF" },
    { label: "样本报价", value: fundPrice },
    { label: "报价日", value: change },
    { label: "指数", value: "中证红利" },
  ];
  const priceBand = solidVisual([
    price != null ? { label: "样本报价", value: price, valueText: fundPrice } : null,
    hasNumber(raw.previousClose) ? { label: "昨收", value: Number(raw.previousClose), valueText: `¥${Number(raw.previousClose).toFixed(3)}` } : null,
  ].filter(Boolean), "ETF价格对照");
  const fundInfoTiles = metricTilesVisual([
    ["基金规模", size],
    ["跟踪指数", raw.trackingIndex || "中证红利指数"],
    ["管理人", raw.fundManager || "易方达基金"],
    ["分红", "以公告为准"],
  ], "基金资料");
  setCharts(
    base,
    priceChart,
    pricePosition,
    priceBand,
    fundInfoTiles,
  );
  base.trendCharts = [
    priceChart,
    pricePosition,
    priceBand,
  ].filter(Boolean);
  base.dividendCharts = [fundInfoTiles].filter(Boolean);
  base.evidenceCharts = [];
  base.facts = compactFacts([
    ["基金全称", raw.name || "易方达中证红利ETF"],
    ["基金代码", raw.code || item.code],
    ["资产类型", raw.fundType || "ETF"],
    ["跟踪指数", raw.trackingIndex || "中证红利指数"],
    ["基金管理人", raw.fundManager || "易方达基金"],
    ["成立日期", raw.inceptionDate],
    ["基金规模", size],
    ["管理费托管", raw.expenseRatio],
    ["价格日期", dayText(raw.priceAsOf || raw.asOf)],
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
  base.sourceNote = `${raw.source || raw.priceSource || "公开行情"} · ${dayText(raw.priceAsOf || raw.asOf) || "日期待核验"}`;
}

function buildAShareRiskItems(raw = {}, financials = {}) {
  const industry = String(raw.industry || financials.industry || "");
  const change = Number(raw.changePercent);
  const revenueGrowth = Number(financials.revenueGrowth);
  const profitGrowth = Number(financials.netProfitGrowth);
  const freeCashFlow = Number(financials.freeCashFlow);
  const cashConversion = Number(financials.cashConversion);
  const operatingSignals = [];
  if (hasNumber(financials.revenueGrowth) && revenueGrowth < 0) operatingSignals.push(`营收同比 ${revenueGrowth.toFixed(1)}%`);
  if (hasNumber(financials.netProfitGrowth) && profitGrowth < 0) operatingSignals.push(`净利润同比 ${profitGrowth.toFixed(1)}%`);
  if (hasNumber(financials.freeCashFlow) && freeCashFlow < 0) operatingSignals.push("自由现金流为负");
  else if (hasNumber(financials.freeCashFlow) && freeCashFlow === 0) operatingSignals.push("自由现金流为零");
  if (hasNumber(financials.cashConversion) && cashConversion < 1) operatingSignals.push(`现金利润比 ${cashConversion.toFixed(2)}`);
  const hasOperatingData = [financials.revenueGrowth, financials.netProfitGrowth, financials.freeCashFlow, financials.cashConversion].some(hasNumber);
  const operatingBody = operatingSignals.length
    ? `${operatingSignals.join("、")}；下期财报先核是否继续恶化。`
    : (hasOperatingData ? "已有财务数据未显示负增长或现金流警报，仍需结合完整财报。" : "财务资料不足，暂不能判断现金流风险。");

  let industryBody = "行业周期、竞争格局和政策变化可能先于公司财报反映到股价；若行业景气下行与公司数据同时转弱，先降低风险敞口。";
  if (/银行|金融/u.test(industry)) {
    industryBody = "净息差下行、资产质量恶化和房地产/地方债信用成本上升会压缩银行利润；重点盯净息差、不良率、拨备覆盖率和资本充足率。";
  } else if (/能源|油气|煤炭/u.test(industry)) {
    industryBody = "油气/煤炭价格、产量、资本开支和能源政策共同决定盈利；商品价格下行与资本开支上升同时出现时，股息可持续性要下调。";
  } else if (/公用事业|水电|电力/u.test(industry)) {
    industryBody = "来水、上网电价、利用小时和大额资本开支会影响现金流；若电价下调或负债扩张，稳定股息不等于没有回撤。";
  } else if (/钢铁|水泥|建材/u.test(industry)) {
    industryBody = "地产/基建需求、产能过剩和原材料价格决定利润；产品价格下行而库存或负债上升时，先核现金流再看股息。";
  } else if (/家电|消费|食品|汽车/u.test(industry)) {
    industryBody = "终端需求、价格战、原材料和渠道库存会压缩利润；若营收放缓叠加毛利率下滑，不要只看过去股息。";
  } else if (/高速|交通|铁路|港口/u.test(industry)) {
    industryBody = "车流/货运量、收费政策、维护资本开支和债务会影响稳定现金流；客流或货运量连续下降时应重新评估分红。";
  }

  const priceBody = hasNumber(raw.changePercent)
    ? `报价日涨跌 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%；历史涨跌不能预测未来表现。`
    : "报价日涨跌暂缺，历史价格也不能预测未来表现。";
  const exitBody = "历史价格变化需与同期经营、行业和大盘信号对照；单次报价不能作为交易指令。";
  return [
    { title: "经营风险", body: operatingBody },
    { title: "行业风险", body: industryBody },
    { title: "价格风险", body: priceBody },
    { title: "历史风险复核", body: exitBody },
  ];
}

function buildAShareView(base, item, snapshot) {
  if (item.raw?.assetType === "fund") {
    buildAShareFundView(base, item);
    return;
  }
  const raw = item.raw || {};
  const financials = raw.financials || {};
  const historical = raw.historicalDividendYield;
  const yieldText = historical ? `${Number(historical.yieldPercent).toFixed(2)}%` : "资料待核";
  const dividendText = historical ? `${Number(Number(historical.dividendPerShare).toFixed(7))}元/股` : null;
  base.badge = "历史分红参考";
  base.score = "";
  base.answer = historical
    ? `${historical.year}年度每股分红 ${dividendText}，按 ${historical.priceAsOf} 报价计算，税前股息率 ${yieldText}。`
    : "缺少完整分红或报价资料，历史股息率暂不计算。";
  base.metrics = [
    ["税前历史股息率", yieldText],
    ["分红所属年度", historical ? `${historical.year}年` : null],
    ["每股分红（税前）", dividendText],
    ["计算所用报价", historical ? money(historical.price, "¥") : null],
    ["报价日期", historical ? historical.priceAsOf : null],
  ];
  const stabilityInfo = getDividendStability(raw, { asOf: snapshot.updatedAt });
  base.highlights = historical ? [
    { label: "税前历史股息率", value: yieldText },
    ...(stabilityInfo.score != null ? [{ label: "近5年稳定性", value: `${stabilityInfo.score}分` }] : [{ label: "分红年度", value: `${historical.year}年` }]),
    ...(hasNumber(financials.cashConversion)
      ? [{ label: "现金利润比", value: `${Number(financials.cashConversion).toFixed(2)}倍` }]
      : (hasNumber(financials.roe) ? [{ label: "股东回报", value: formatPercent(financials.roe) }] : [])),
    { label: "历史报价", value: money(historical.price, "¥") },
  ] : [{ label: "历史股息率", value: "资料待核" }];
  base.pageHelp = "";
  const yieldDetails = historical ? metricTilesVisual([
    ["税前历史股息率", yieldText],
    ["分红所属年度", `${historical.year}年`],
    ["每股分红（税前）", dividendText],
    ["计算所用报价", money(historical.price, "¥")],
    ["报价日期", historical.priceAsOf],
  ], "历史股息率计算") : null;
  const aHistory = (Array.isArray(raw.history) ? raw.history : [])
    .map((entry) => Number(entry && entry.close != null ? entry.close : entry))
    .filter((value) => Number.isFinite(value) && value > 0);
  const aHistoryDates = (Array.isArray(raw.history) ? raw.history : [])
    .map((entry) => String(entry && entry.date || ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const aPriceLine = aHistory.length >= 10
    ? priceVisual(
      aHistory,
      `近 ${aHistory.length} 个交易日收盘走势`,
      (value) => money(value, "¥"),
      aHistoryDates.length >= 2 ? `${aHistoryDates[0]} 至 ${aHistoryDates[aHistoryDates.length - 1]} 前复权历史收盘` : "公开前复权历史收盘",
      "区间涨跌",
    )
    : null;
  const aPriceMeter = aHistory.length >= 10 && hasNumber(raw.currentPrice)
    ? meterVisual(aHistory, Number(raw.currentPrice), "历史区间位置", (value) => money(value, "¥"), "按已收录历史收盘价计算的相对位置，不代表估值高低。")
    : null;
  const priceBand = solidVisual([
    hasNumber(raw.currentPrice) ? { label: "样本报价", value: Number(raw.currentPrice), valueText: money(raw.currentPrice, "¥") } : null,
    hasNumber(raw.previousClose) ? { label: "昨收", value: Number(raw.previousClose), valueText: money(raw.previousClose, "¥") } : null,
  ].filter(Boolean), "价格对照");

  setCharts(
    base,
    yieldDetails,
    metricTilesVisual([
      ["自由现金流", formatLarge(financials.freeCashFlow)],
      ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)}` : null],
      ["股东回报", formatPercent(financials.roe)],
      ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ].filter((row) => row[1] && row[1] !== "暂缺"), "现金与质量"),
    aPriceLine || priceBand,
    aPriceMeter,
    solidVisual([
      hasNumber(financials.operatingCashFlow) ? { label: "经营现金流", value: financials.operatingCashFlow, valueText: formatLarge(financials.operatingCashFlow) } : null,
      hasNumber(financials.freeCashFlow) ? { label: "自由现金流", value: financials.freeCashFlow, valueText: formatLarge(financials.freeCashFlow) } : null,
    ].filter(Boolean), "期间现金流"),
    solidVisual([
      hasNumber(financials.revenueGrowth) ? { label: "营收增长", value: financials.revenueGrowth, valueText: formatPercent(financials.revenueGrowth) } : null,
      hasNumber(financials.roe) ? { label: "股东回报", value: financials.roe, valueText: formatPercent(financials.roe) } : null,
    ].filter(Boolean), "成长质量"),
  );

  base.trendCharts = aPriceLine
    ? [aPriceLine, aPriceMeter].filter(Boolean)
    : [priceBand].filter(Boolean);
  base.dividendCharts = [
    dividendHistoryVisual(raw, snapshot.updatedAt),
    yieldDetails,
    metricTilesVisual([
      ["自由现金流", formatLarge(financials.freeCashFlow)],
      ["现金利润比", hasNumber(financials.cashConversion) ? `${Number(financials.cashConversion).toFixed(2)}` : null],
      ["股东回报", formatPercent(financials.roe)],
      ["经营现金流", formatLarge(financials.operatingCashFlow)],
    ].filter((row) => row[1] && row[1] !== "暂缺"), "现金与质量"),
  ].filter(Boolean);
  base.evidenceCharts = [
    solidVisual([
      hasNumber(financials.revenueGrowth) ? { label: "营收增长", value: financials.revenueGrowth, valueText: formatPercent(financials.revenueGrowth) } : null,
      hasNumber(financials.roe) ? { label: "股东回报", value: financials.roe, valueText: formatPercent(financials.roe) } : null,
    ].filter(Boolean), "成长质量"),
  ].filter(Boolean);

  base.facts = compactFacts([
    ["公司全称", item.name],
    ["股票代码", raw.code || item.code],
    ["所属行业", raw.industry || financials.industry],
    ["价格日期", dayText(raw.priceAsOf || raw.asOf)],
    ["财报期", dayText(financials.reportDate || financials.period)],
    ["历史报价", hasNumber(raw.currentPrice) ? money(raw.currentPrice, "¥") : null],
    ["昨收", hasNumber(raw.previousClose) ? money(raw.previousClose, "¥") : null],
    ["报价日涨跌", hasNumber(raw.changePercent) ? formatPercent(raw.changePercent) : null],
    ["税前历史股息率", historical ? yieldText : null],
    ["分红所属年度", historical ? `${historical.year}年` : null],
    ["每股分红（税前）", dividendText],
    ["股息率计算报价", historical ? money(historical.price, "¥") : null],
    ["股息率报价日期", historical?.priceAsOf],
    ["分红数据来源", historical?.dividendSource],
    ["股息率报价来源", historical?.priceSource],
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
    { title: "计算口径", body: historical ? `${historical.year}年度税前每股分红 ÷ ${historical.priceAsOf} 报价；过去分红不代表未来收益。` : "分红记录或报价不完整，暂不计算历史股息率。" },
    { title: "现金流", body: `经营 ${formatLarge(financials.operatingCashFlow)} · 自由 ${formatLarge(financials.freeCashFlow)}` },
  ].filter(Boolean);
  base.actions = [];
  base.riskItems = buildAShareRiskItems(raw, financials);
  base.risk = base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ");
  base.sourceNote = `${raw.priceSource || raw.source || "公开行情"} · ${financials.source || "公开财务资料"}`;
  // 借鉴 Stock Events：仅在具备真实历史分红与对应股价时提供按股数纯算对照，不回退旧估算字段。
  base.dividendCalc = historical && hasNumber(historical.dividendPerShare) && hasNumber(historical.price)
    ? {
        year: historical.year,
        dps: Number(historical.dividendPerShare),
        price: Number(historical.price),
        priceAsOf: historical.priceAsOf,
        yieldPercent: Number(historical.yieldPercent),
      }
    : null;
}

function buildGuruView(base, item) {
  const raw = item.raw || {};
  const profile = raw.profile || {};
  const annual = annualRank(profile);
  const holdings = raw.holdings || [];
  const sold = raw.sold || [];
  // 13F 有真正的披露日；港股/A 股这六只基金只有月报、半年报、季报的报告期，
  // answers.js 把报告期一并塞进了 filingDate（「2026-05-29 月报」），Date.parse
  // 直接 NaN，于是「滞后」这一格和「披露滞后」这一行对它们永远是「待核」。
  // 先把日期从字符串里取出来；两者口径不同，不能混成一个词——有披露日就说披露
  // 滞后，只有报告期就说报告期距今；连日期都取不到（「2026年一季报」）才留空。
  const filingDate = raw.filingDate || "";
  const filingDay = (String(filingDate).match(/\d{4}-\d{2}-\d{2}/) || [])[0] || "";
  const filingTime = Date.parse(filingDay);
  const lagDays = Number.isNaN(filingTime)
    ? null
    : Math.max(0, Math.round((Date.now() - filingTime) / (24 * 60 * 60 * 1000)));
  // 「披露滞后 45天」是行话；说成「持仓公布 45天前」。基金月报没有公布日，只有报告期。
  const lagLabel = raw.isLive ? "持仓公布" : "报告截至";
  const lagText = lagDays == null ? null : (lagDays === 0 ? "今天" : `${lagDays}天前`);
  // 港股三只基金的持仓标注是「月报持有」，以前的反向判断会把它当成一次仓位
  // 变化，于是详情页写「本期 3 项仓位变化」——月报根本没说有变化。
  const changed = holdings.filter(isPositionChange);

  base.title = profile.name || base.title;
  base.code = profile.org || base.code;
  base.badge = profile.performanceValue || profile.marketLabel || base.badge;
  base.score = profile.performanceValue || "业绩待核";
  // 「1/9」会被看成一月九日。
  const rankText = annual ? `${annual.count}家中第${annual.rank}` : "";
  base.rank = rankText;
  // 「先看答案」原本只填 profile.marketLabel，渲染出来就是孤零零一个「美股」——
  // 既不是答案，也不是新信息（市场在关键数据里已经单独占了一格）。改成这期 13F
  // 到底说了什么：报告期、第一大持仓、本期有多少项仓位变化，全部取自已算好的字段。
  const topHolding = holdings
    .filter((row) => row && row.ticker)
    .reduce((best, row) => (best && Number(best.weight) >= Number(row.weight) ? best : row), null);
  // 港股/A 股基金的 reportDate 本身就带文体（「2026-05-29 月报」），后面再缀一个
  // 「报告期」就成了「月报 报告期」。前缀式两种写法都读得通。
  base.answer = [
    (raw.reportDate || profile.report) ? `报告期 ${raw.reportDate || profile.report}` : null,
    topHolding
      ? `第一大持仓 ${tickerZhLabel(topHolding.ticker, topHolding.issuer || topHolding.name)}${instrumentSuffix(topHolding.putCall)}${hasNumber(topHolding.weight) ? ` 占${formatNumber(topHolding.weight, "%")}` : ""}`
      : null,
    changed.length ? `本期 ${changed.length} 项仓位变化` : null,
  ].filter(Boolean).join(" · ") || profile.marketLabel || item.badge;
  base.metrics = [
    // performanceValue 自带「年化」二字，标签再写一遍就是「表观年化：13.2% 年化」。
    ["表观年化", String(profile.performanceValue || "待核").replace(/\s*年化$/u, "")],
    ["市场", profile.marketLabel || "待核"],
    ["持仓", `${holdings.length} 只`],
    // 和上面的核心数据同一口径：月报、季报没披露过退出，不能写成「0」。
    ["退出", raw.isLive ? `${sold.length} 只` : "未披露"],
    [lagLabel, lagText || "待核"],
    ["报告期", dayText(raw.reportDate || profile.report) || "待核"],
  ];
  base.highlights = [
    // 第一格原本是 profile.performanceValue，而徽章就是同一个字段，渲染出来是
    // 「年化：13.2% 年化」——同一屏印两遍，「年化」两个字还印了三遍。排名本来
    // 就是按表观年化在同组内排的，把口径写进标签，年化这一格便不必再留一次。
    { label: "年化排名", value: rankText || "暂缺" },
    { label: "持仓", value: `${holdings.length}只` },
    // 清仓数只有 13F 真正披露；月报、季报没说过，写「0」会被读成「一只都没卖」。
    { label: "清仓", value: raw.isLive ? `${sold.length}只` : "未披露" },
    { label: lagLabel, value: lagText || "暂缺" },
  ];
  base.holdings = holdings.slice(0, 8).map((holding) => ({
    name: `${tickerZhLabel(holding.ticker, holding.issuer || holding.name)}${instrumentSuffix(holding.putCall)}`,
    value: `${formatNumber(holding.weight, "%")} · ${holding.changeLabel || "变化待核"}`,
  }));

  // 图表标签空间有限：有中文名只写中文名，期权缀「看涨/看跌」两个字，不写 PUT/CALL。
  // 个别 13F 行没有代码只有发行人全名（「CHUBB LIMITED」），对不上中文名时只取首词。
  const chartTicker = (holding) => {
    const raw = String(holding.ticker || "");
    const zh = tickerShortZh(raw, holding.issuer || holding.name);
    const ticker = zh !== raw ? zh : (/\s/.test(raw) && raw.length > 6 ? raw.split(/\s+/)[0] : raw);
    const mark = String(holding.putCall || "").trim().toLowerCase();
    if (mark === "put") return `${ticker}看跌`;
    if (mark === "call") return `${ticker}看涨`;
    return ticker;
  };

  const changeBars = barVisual(
    changed.slice(0, 6).map((holding) => ({
      label: chartTicker(holding),
      value: Number(holding.weight) || 1,
      valueText: String(holding.changeLabel || ""),
    })),
    "仓位变化",
  );

  // 「持仓」标签只放持仓构成本身；「依据」标签放摘要+滞后位置。以前靠
  // pricePattern/financePattern 两条正则去猜这 4 张图该进哪个旧标签，
  // 正则把 4 张全吃进「持仓/业绩」两档，researchCharts 兜底 slice(-2) 又把
  // 「仓位变化」重复搬进「研究」标签，同一张图显示了两遍。改成显式分组后
  // 每张图只出现一次，也不用再猜。
  base.holdingsCharts = [
    // 横条而不是 8 根竖柱：竖柱每列太窄，代码会被截成「RSP-...」，横条一行一个名字放得下。
    barVisual(holdings.slice(0, 8).map((holding) => ({
      label: chartTicker(holding),
      value: holding.weight,
      valueText: hasNumber(holding.weight) ? `${Number(holding.weight).toFixed(1)}%` : "—",
    })), "持仓权重"),
    changeBars,
  ].filter(Boolean);
  base.evidenceCharts = [
    // 这里原来把表观年化 ×3 截到 100 当成分数画进 0–100 刻度条，格子里还写着
    // 「研究分 23」——聪明人持仓根本没有研究分，这个 3 倍也没有任何口径依据。
    // 同组年化名次已经在核心数据里，下面几张图又全是真实披露，直接去掉。
    metricTilesVisual([
      ["持仓", `${holdings.length}只`],
      ["清仓", raw.isLive ? `${sold.length}只` : "未披露"],
      [lagLabel, lagText],
      ["有仓位变化", `${changed.length}只`],
    ].filter((row) => row[1]), "本期摘要"),
    // 原来还有一条 0–180 天的「披露滞后位置」刻度条：180 是随手定的上限，
    // 条上的位置不对应任何东西，上面一格已经写了「xx天前」，撤掉。
  ].filter(Boolean);

  base.facts = compactFacts([
    ["机构", profile.name || item.name],
    ["市场", profile.marketLabel],
    ["表观年化", profile.performanceValue],
    ["业绩区间", profile.performanceDetail],
    ["持仓报告", raw.reportDate || profile.report],
    ["披露日期", dayText(filingDate)],
    [lagLabel, lagText],
    ["资料来源", sourceName(raw.source) || "美国证监会持仓申报"],
  ], 12);
  // 报告期/披露日/滞后天数已经在「资料」tab 的 facts 表里各出现过一次，
  // 「只含多头」在风险卡里单独有一条，这里不重复。
  base.analysis = [
    { title: "为什么看它", body: `【望潮研究归纳】${String(profile.why || "公开业绩与持仓可对照学习。").slice(0, 100)}` },
    { title: "怎么学", body: `【望潮研究归纳】${String(profile.how || "学框架，不照抄持仓。").slice(0, 100)}` },
    {
      title: "应该避免",
      body: "不照抄旧仓位；几个月前公布的持仓不等于今天的操作；不学它加杠杆、重仓一两只。",
    },
    {
      title: "跟随边界",
      body: "公开持仓有滞后且不完整；只能学习框架与风险，不能当实时跟仓或买卖指令。",
    },
  ];
  base.actions = [];
  base.riskItems = [
    {
      title: "持仓是旧的",
      body: lagDays == null
        ? "公开持仓是过去某一天的仓位，不等于现在的仓位。"
        : `这份持仓 ${lagDays} 天前公布，之后可能已经大幅调仓。`,
    },
    {
      title: "只含多头",
      body: "法定披露通常不包含空头与完整衍生品，不能还原全部策略。",
    },
  ];
  base.risk = base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ");
  base.pageHelp = "";
  base.sourceNote = `${sourceName(raw.source || profile.sourceName) || "公开报告"} · ${filingDate || profile.report || "披露待核"}`;
}

function goldCloseVisual(series, label, decimals, currency) {
  const rows = series.rows;
  if (rows.length < 2) return null;
  return priceVisual(rows.map((row) => row.close), `${label}收盘走势`,
    (value) => `${currency}${Number(value).toFixed(decimals)}`,
    `${rows[0].date} 至 ${rows[rows.length - 1].date} · ${series.source}`);
}

function buildGoldView(base, item) {
  const gold = item.raw || {};
  const answer = gold.answer || {};
  const plan = goldPlanView(null); // 历史参考不提供模型买卖阈值。
  const international = gold.quotes?.international || {};
  const domestic = domesticGoldClose(gold) || {};
  const etf = gold.quotes?.etf || {};
  const usdCny = gold.quotes?.usdCny || {};
  // 涨跌不用引擎单独给的 returns（它和快照里的日线对不上，首页算出 -7.4%、这里写 -6.6%），
  // 只从历史日线算涨跌；独立报价保留自身日期，不覆盖收盘。
  const internationalHistory = historicalGoldSeries(gold, "international");
  const domesticHistory = historicalGoldSeries(gold, "domestic");
  const intlSeries = internationalHistory.rows;
  const cnySeries = domesticHistory.rows;
  const returns = {
    day20: recentChange(intlSeries, 20),
    day60: recentChange(intlSeries, 60),
    day180: recentChange(intlSeries, 180),
  };
  // 一位小数，跟首页、栏目页同一个写法；-7.45% 和 -7.4% 并排出现会被当成两个数。
  const pct = (value) => (hasNumber(value) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%` : "暂缺");
  const scoreBundle = answer.scores || {};
  const internationalScore = Number(scoreBundle.international?.score ?? answer.internationalScore);
  const domesticScore = Number(scoreBundle.domestic?.score ?? answer.domesticScore);
  const internationalRange = historyStats(intlSeries.map((entry) => entry.close));
  const domesticRange = historyStats(cnySeries.map((entry) => entry.close));
  const rangeText = (range, currency) => range ? `${Number(range.low).toFixed(1)}–${Number(range.high).toFixed(1)} ${currency}` : "待核验";
  const buyIntl = compactRangeText(plan.internationalWatch, 0);
  const sellIntl = compactRangeText(plan.internationalUpper, 0);
  const riskIntl = compactRangeText(plan.internationalRisk, 0);
  const buyCny = compactRangeText(plan.domesticWatch, 1);
  const sellCny = compactRangeText(plan.domesticUpper, 1);
  const riskCny = compactRangeText(plan.domesticRisk, 1);
  const action = "历史走势参考";

  // 标题是这一页说的东西（黄金），不是一个问句——「现在怎么做」当标题，读者会等下面给答案。
  base.title = gold.view === "plan" ? "黄金历史对照" : "黄金";
  // 列表条目的 code 是「黄金 / 观察区」，跟在标题后面就成了「黄金 黄金」。
  // code 还是记录页存档的键，不能清空，只在页头不显示。
  base.hideCode = true;
  base.badge = action;
  // 「先看答案」原本直接用 item.one，而它那一行六项里有五项就是正上方结论条和
  // 四格核心数据的原样重排（继续观察／国际金 4473／人民币金 938／两个观察分），
  // 真正新的只有位置一项。列表页没有那四格，item.one 保持不动，只在详情
  // 页换成同屏还没说过的位置与动能。
  // 「半年位 18%」是上游百分位，读者不知道 18% 是什么的 18%；换成离近180日
  // 最低价还有多远，和「价格」tab 位置条用的是同一组最高最低。
  const aboveLow = internationalRange && hasNumber(international.price) && internationalRange.low > 0
    ? ((Number(international.price) - internationalRange.low) / internationalRange.low) * 100
    : null;
  const aboveLowLabel = "国际金报价较区间最低收盘价";
  base.answer = [
    intlSeries.length ? `国际金收盘至 ${intlSeries[intlSeries.length - 1].date}` : null,
    cnySeries.length ? `人民币金收盘至 ${cnySeries[cnySeries.length - 1].date}` : null,
  ].filter(Boolean).join(" · ") || "收盘资料待核验";
  base.metrics = [
    ["样本判断", action],
    ["国际观察分", Number.isFinite(internationalScore) ? `${internationalScore}` : "暂缺"],
    ["人民币观察分", Number.isFinite(domesticScore) ? `${domesticScore}` : "暂缺"],
    ["国际金", hasNumber(international.price) ? `${Number(international.price).toFixed(0)}` : "暂缺"],
    ["人民币金收盘", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)}` : "暂缺"],
    [aboveLowLabel, aboveLow != null ? pct(aboveLow) : null],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(1)}` : "暂缺"],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(2)}` : "暂缺"],
    ["近20个交易日涨跌", pct(returns.day20)],
    ["近60个交易日涨跌", pct(returns.day60)],
    ["观察低位", buyIntl || buyCny || "暂缺"],
    ["观察上沿", sellIntl || sellCny || "暂缺"],
    ["风险下沿", riskIntl || riskCny || "暂缺"],
  ];
  base.highlights = [
    // 这两个价一个是美元/盎司、一个是元/克，差三个数量级，原来都只有裸数字。
    { label: "国际金收盘/盎司", value: intlSeries.length ? `$${intlSeries[intlSeries.length - 1].close.toFixed(0)}` : "—" },
    { label: "人民币金收盘/克", value: cnySeries.length ? `¥${cnySeries[cnySeries.length - 1].close.toFixed(2)}` : "—" },
  ];
  base.pageHelp = "";

  // 四口径同屏：COMEX、折算克价、上海金、GLD 摆在一起，读的人才知道这四个数
  // 是同一块金子。缺任一必需报价时 goldParity 返回 null，这一格整块不出。
  const parityDay = dayText(international.asOf);
  const parity = parityDay && parityDay === domestic.asOf && parityDay === dayText(usdCny.asOf)
    ? goldParity({ quotes: { ...gold.quotes, domestic } })
    : null;
  const parityTiles = parity
    ? {
      kind: "tiles",
      title: "同一块金子的四个报价",
      stats: [
        { label: "国内对国际", value: parity.direction },
        { label: "折算克价", value: `${parity.parity} 元/克` },
        { label: "汇率", value: `${parity.rateText.replace("美元兑人民币 ", "")}` },
      ],
      items: parity.cells.map((cell) => ({
        id: cell.id,
        label: cell.meta ? `${cell.label} · ${cell.meta}` : cell.label,
        valueText: `${cell.value} ${cell.unit}`,
      })),
    }
    : null;

  const intlHistory = intlSeries.map((entry) => entry.close);
  const turns = goldTurningViews(gold);
  const scoredGold = scoreForItem(item);
  const indicatorTiles = metricTilesVisual(
    (gold.indicators || []).slice(0, 8).map((entry) => [
      entry.label,
      hasNumber(entry.value) ? `${Number(entry.value)}${entry.unit || ""}` : null,
    ]),
    "宏观指标",
  );

  // 四标签下「价格」只放走势、位置与四口径对照；「驱动」放近期变化和宏观
  // 指标；「依据」放两个观察分和买卖/风险阈值的深挖图表，跟美股/A股/港股
  // 新股/机构持仓同一套分装规则，不再靠标题正则猜归属（旧版这里用
  // setCharts 塞 10 张图再靠正则分类，超出上限的图会被无声丢弃，「驱动」
  // tab 因此空过）。
  base.trendCharts = [
    goldCloseVisual(internationalHistory, "国际金", 0, "$"),
    goldCloseVisual(domesticHistory, "人民币金", 2, "¥"),
    parityTiles,
    meterVisual(intlHistory, international.price, "国际金位置", (value) => Number(value).toFixed(0)),
    // 原来这里还有一张「半年位置 xx%」卡，用的是上游的百分位，和正上方位置条
    // （按最高最低算）是两种算法、两个数，同一屏出两个「位置」，撤掉。
  ].filter(Boolean);
  base.dynamicsCharts = [
    solidVisual([
      hasNumber(returns.day20) ? { label: "20个交易日", value: returns.day20, valueText: pct(returns.day20) } : null,
      hasNumber(returns.day60) ? { label: "60个交易日", value: returns.day60, valueText: pct(returns.day60) } : null,
      hasNumber(returns.day180) ? { label: "180个交易日", value: returns.day180, valueText: pct(returns.day180) } : null,
    ].filter(Boolean), "区间涨跌"),
    indicatorTiles,
  ].filter(Boolean);
  base.evidenceCharts = [
    scoreMeter(internationalScore, "国际金观察分", action),
    scoreMeter(domesticScore, "人民币金观察分", "国内价格"),
    metricTilesVisual([
      ["国际金观察低位", buyIntl],
      ["国际金观察上沿", sellIntl],
      ["人民币金观察低位", buyCny],
      ["人民币金观察上沿", sellCny],
      ["国际金风险", riskIntl],
      ["人民币金风险", riskCny],
    ].filter((row) => row[1]), "价格观察区"),
  ].filter(Boolean);

  base.facts = compactFacts([
    ["样本判断", action],
    ["国际金观察分", Number.isFinite(internationalScore) ? `${internationalScore}` : null],
    ["人民币金观察分", Number.isFinite(domesticScore) ? `${domesticScore}` : null],
    ["国际金价", hasNumber(international.price) ? `${Number(international.price).toFixed(1)}${international.currency || "USD/oz"}` : null],
    ["国际金涨跌", hasNumber(international.changePercent) ? formatPercent(international.changePercent) : null],
    ["国际金截至", dayText(international.asOf)],
    ["人民币金价", hasNumber(domestic.price) ? `${Number(domestic.price).toFixed(2)}${domestic.currency || "CNY/g"}` : null],
    ["人民币金涨跌", hasNumber(domestic.changePercent) ? formatPercent(domestic.changePercent) : null],
    ["人民币金收盘日", dayText(domestic.asOf)],
    ["GLD", hasNumber(etf.price) ? `${Number(etf.price).toFixed(2)}·${formatPercent(etf.changePercent)}` : null],
    ["美元兑人民币", hasNumber(usdCny.price) ? `${Number(usdCny.price).toFixed(4)}` : null],
    ["国际金折算克价", parity ? `${parity.parity}CNY/g` : null],
    ["上海金折溢价", parity ? `${parity.premium >= 0 ? "+" : ""}${parity.premium}%` : null],
    ["折算口径", parity ? parity.formula : null],
    ["国际金观察低位", buyIntl],
    ["国际金观察上沿", sellIntl],
    ["国际金风险下沿", riskIntl],
    ["人民币金观察低位", buyCny],
    ["人民币金观察上沿", sellCny],
    ["人民币金风险下沿", riskCny],
    ["国际金样本", internationalRange ? `${internationalRange.count}个·${rangeText(internationalRange, international.currency || "USD/oz")}` : null],
    ["人民币金样本", domesticRange ? `${domesticRange.count}个·${rangeText(domesticRange, domestic.currency || "CNY/g")}` : null],
    ["历史样本区间", internationalRange ? rangeText(internationalRange, international.currency || "USD/oz") : null],
    ...(gold.indicators || []).slice(0, 8).map((entry) => [entry.label, hasNumber(entry.value) ? `${entry.value}${entry.unit || ""}` : null]),
  ]);
  // 持有观察/观察上沿/现价这三项，「依据」tab 的「价格观察区」图表和 facts
  // 表已经各展示过一遍，这里不再拼第三份「美元金」「人民币金」句子——
  // 「两个评分」已经把两个观察分的口径说清楚了。
  base.analysis = [
    parity
      ? { title: "国内外金价对得上吗", body: `${parity.headline}。算法：${parity.formula}（1 盎司 = 31.1035 克）。` }
      : null,
    {
      title: "两个评分",
      body: `国际金 ${Number.isFinite(internationalScore) ? internationalScore : "待核"} 分、人民币金 ${Number.isFinite(domesticScore) ? domesticScore : "待核"} 分（满分 100）；前者主要看美国利率和美元，后者看上海金价、人民币汇率和国内比国际贵多少。`,
    },
    ...turns.map((view) => ({ title: `${view.label}拐点`, body: view.detail })),
  ].filter(Boolean);
  base.actions = [];
  base.riskItems = [
    { title: "国际金风险", body: "历史金价会受利率、美元与资金持仓等因素影响；过去走势不代表未来收益。" },
    { title: "人民币金风险", body: "人民币汇率与上海金折溢价会影响本地价格；不同市场与日期的报价不能直接混用。" },
    { title: "样本局限", body: "图表只说明已收录期间，不能据此确定当下买卖时点；缺失日期和来源需另行核对。" },
  ];
  base.risk = `${base.riskItems.map((entry) => `${entry.title}：${entry.body}`).join(" ")} 历史资料仅供参考。`;
  base.sourceNote = (gold.sources || []).filter((source) => source.ok).map((source) => sourceName(source.name)).join(" · ") || "公开行情与宏观资料";
}

// 美股「下单参考」：参考买入价 / 跌破就卖 / 分批卖出价三档，加两个自己判断用的数。
// 三档来自引擎的 pricePlan（清洗层从 technicalPlan 挑出来的），这里只算它们离现价多远，
// 不新造价位；快照过期时 pricePlan 已被剥掉，整张卡不出现。
// 结论是「风险升高」时不给买入价——同一屏一边说先停追、一边给个买入价，读的人会问到底买不买；
// 这时另外两档只对手里已经有的人有用，标上「已持有」，免得读的人问「不买哪来的卖」。
function applyUSOrderPlan(base, item) {
  const raw = item.raw || {};
  const plan = raw.pricePlan;
  const price = Number(raw.price);
  if (!plan || !(price > 0) || !(plan.buy > 0) || !(plan.stop > 0) || !Array.isArray(plan.sell) || !plan.sell.length) return;
  const gap = (level) => {
    const pct = ((level - price) / price) * 100;
    return `比现价${pct >= 0 ? "高" : "低"} ${Math.abs(pct).toFixed(1)}%`;
  };
  const noBuy = base.strategy?.label === "风险升高";
  // 「离近60日最高差几%」跟关键风险里那句同一个算法（以最高价为底），同一屏不出两个数。
  const range = historyStats(raw.history);
  const sell = plan.sell.slice(0, 2);
  const rows = [
    noBuy
      ? { key: "buy", label: "参考买入价", value: "暂不买", note: "风险升高" }
      : { key: "buy", label: "参考买入价", value: money(plan.buy), note: gap(plan.buy) },
    { key: "stop", label: noBuy ? "已持有：跌破就卖" : "跌破就卖", value: money(plan.stop), note: gap(plan.stop) },
    {
      key: "sell",
      label: noBuy ? "已持有：分批卖出价" : "分批卖出价",
      value: sell.map((level) => money(level)).join(" / "),
      note: `比现价高 ${sell.map((level) => Math.abs(((level - price) / price) * 100).toFixed(1)).join("% / ")}%`,
    },
    range && range.high > 0
      ? { key: "high", label: "离近60日最高", value: price >= range.high ? "已是最高" : `差 ${(((range.high - price) / range.high) * 100).toFixed(1)}%` }
      : null,
    plan.dailyMove > 0
      ? { key: "move", label: "一天大概涨跌", value: `约 ${money(plan.dailyMove)}`, note: `约现价的 ${((plan.dailyMove / price) * 100).toFixed(1)}%` }
      : null,
  ].filter(Boolean);
  base.orderPlan = { title: "下单参考", rows };

  // 有了买入价和跌破就卖的价，「关键风险」换成读的人下单前最想知道的：买错了亏多少。
  // 这个价挡不住财报跳空，所以写明可能亏更多，不说成「最多亏」。
  if (!noBuy) {
    const loss = plan.buy - plan.stop;
    base.riskItems = [
      {
        title: "如果买错",
        body: `按参考买入价 ${money(plan.buy)} 买、跌破 ${money(plan.stop)} 就卖，每股约亏 ${money(loss)}（${((loss / plan.buy) * 100).toFixed(1)}%）；财报前后大跌可能亏更多。`,
      },
      ...(base.riskItems || []),
    ];
  }
}

// 「资料」tab 里的官方出处。照新闻资讯页的做法：能核验的地址摆出来，点一下
// 复制走。以前这一页只有 sourceNote 一个来源"名字"，还压在风险 tab 最底下，
// 用户想核对得自己去搜——而快照里其实躺着两类真实深链：港交所每只新股的
// 招股章程/上市公告/配发结果 PDF，以及每家机构自己的 SEC EDGAR 备案页。
//
// 顺序是先条目级深链、后栏目级入口：深链直接指向这一只标的的原始文件，
// 站点入口只是兜底。没有地址的来源不放进来（见 utils/sources.js 的 sourceLink）。
// 决策概览：把结论/先看答案/策略信号里重复的判断合并成一句主判断+一句理由，
// 首屏最多给 3 条依据、1 条风险、1 个下一步关注点，具体口径见 Section 五。
function buildOverview(base, item) {
  if (!["us", "a", "hk", "guru", "gold"].includes(item.market)) return;
  const raw = item.raw || {};
  const strategy = base.strategy || {};
  const evidenceBullets = (base.analysis || [])
    .filter((entry) => entry && entry.title && entry.body)
    .slice(0, 3)
    .map((entry) => `${entry.title}：${entry.body}`);
  const keyRisk = (base.riskItems && base.riskItems[0])
    ? `${base.riskItems[0].title}：${base.riskItems[0].body}`
    : (base.risk || "数据不足时宁可不给硬答案。");
  let nextWatch = "对照历史样本和原始披露；判断变化需等待后续财报、公告或收盘记录。";

  let priceCard = null;
  if (item.market === "us") {
    priceCard = base.usPriceChart || null;
  } else if (item.market === "a") {
    if (raw.assetType === "fund") {
      priceCard = base.trendCharts?.find((chart) => chart.kind === "line") || null;
    } else {
      const implied = null; // 历史参考不展示分红假设回推的买卖价。
      priceCard = (implied && hasNumber(raw.currentPrice))
        ? bandMeterVisual(implied.addPrice, implied.trimPrice, raw.currentPrice, "参考买卖区间", (value) => money(value, "¥"), "按当前每股分红回推的参考区间，不是目标价承诺。")
        : null;
    }
  } else if (item.market === "hk") {
    const stage = base.stageInfo || {};
    const stageLabel = stage.ended
      ? (hasNumber(stage.firstDayChange) ? `已上市 · 首日 ${formatPercent(stage.firstDayChange)}` : "已上市")
      : (stage.listingProgressUnverified ? "上市进展待核" : (stage.deadlinePassed ? "等配发结果" : "认购中"));
    const watchLabel = stage.ended ? "上市日期" : (stage.listingProgressUnverified ? "原定上市" : (stage.deadlinePassed ? "预计上市" : "认购截止"));
    const watchValue = stage.ended
      ? (stage.listingDate || "待核验")
      : (stage.deadlinePassed || stage.listingProgressUnverified ? (stage.listingDate || "待公布") : (stage.offerDeadline || "待公布"));
    if (stage.listingProgressUnverified) {
      nextWatch = "先核对港交所最新上市公告与配发结果，再看上市后的公开价格。";
    }
    priceCard = metricTilesVisual([
      ["当前阶段", stageLabel],
      [watchLabel, watchValue],
      ["基石占比", hasNumber(raw.cornerstonePercent) ? `${Number(raw.cornerstonePercent).toFixed(1)}%` : null],
      ["所属行业", raw.industry || null],
    ], "阶段与关键节点");
  } else if (item.market === "guru") {
    // guru 没有价格。年化排名/持仓/退出/披露滞后四格已经在标题下的 highlights
    // 条里，概览再摆一遍就是同屏重复；改放持仓权重条，一眼看组合集中在哪。
    priceCard = (base.holdingsCharts || [])[0] || null;
  } else if (item.market === "gold") {
    // 黄金没有单一现价，概览卡原来复用 highlights 摆四格数字（国际金/人民币金/
    // 两个观察分），但这四格和下面「关键依据」、「价格」tab 说的是同一件事。
    // 换成价格走势图，概览一眼看的是"这段时间涨跌"，不是再摆一次同一批数字。
    priceCard = (base.trendCharts || []).find((chart) => chart.kind === "line") || null;
  }

  // 借鉴 Stock Events / Simply Wall St：提炼 2~3 个客观体检微勋章 + 可视化体检进度条 + 两条事实依据，
  // 让普通用户在「怎么看」首屏 20 秒内就能看清结论、图表、依据和主要风险。
  const badges = [];
  const keyFacts = [];
  const healthChecks = [];
  const radarAxes = [];
  let yearDots = [];
  const clampBar = (pct) => Math.max(8, Math.min(100, Math.round(pct)));
  if (item.market === "a" && raw.assetType !== "fund") {
    const fin = raw.financials || {};
    const stab = getDividendStability(raw, { asOf: raw.snapshotUpdatedAt || raw.priceAsOf || raw.asOf });
    if (Array.isArray(stab.window) && stab.window.length) {
      const changeMap = new Map((stab.changes || []).map((c) => [c.toYear, c]));
      yearDots = stab.window.map((entry) => {
        const yy = String(entry.year || "").slice(-2);
        if (!entry.complete || !(entry.perTenSharesRmb > 0)) return { year: yy, state: "miss" };
        const ch = changeMap.get(entry.year);
        return { year: yy, state: ch && ch.decreased ? "cut" : "ok" };
      });
    }
    if (Array.isArray(stab.years) && stab.years.length > 0) {
      badges.push({ label: `已收录 ${stab.years.length} 年分红`, tone: "good" });
    }
    if (stab.decreaseCount === 0 && stab.observedYears.length === 5) {
      badges.push({ label: "近5年 0 次减息", tone: "good" });
    } else if (stab.decreaseCount != null) {
      badges.push({ label: `近5年 ${stab.decreaseCount} 次减息`, tone: stab.decreaseCount <= 1 ? "plain" : "warn" });
    }
    if (hasNumber(fin.cashConversion)) {
      const cc = Number(fin.cashConversion);
      badges.push({ label: `现金利润比 ${cc.toFixed(2)}倍`, tone: cc >= 1 ? "good" : "warn" });
    }
    if (stab.score != null) {
      healthChecks.push({
        label: "近5年分红稳度",
        valueText: `${stab.score}分`,
        percent: clampBar(stab.score),
        tone: stab.score >= 75 ? "good" : (stab.score >= 50 ? "plain" : "warn"),
      });
      radarAxes.push({ label: "分红稳度", value: clampBar(stab.score) });
    }
    if (raw.historicalDividendYield) {
      const hy = raw.historicalDividendYield;
      const yBar = clampBar((Number(hy.yieldPercent) / 8) * 100);
      healthChecks.push({
        label: "税前历史股息率",
        valueText: `${Number(hy.yieldPercent).toFixed(2)}%`,
        percent: yBar,
        tone: Number(hy.yieldPercent) >= 4 ? "good" : "plain",
      });
      radarAxes.push({ label: "股息水平", value: yBar });
      keyFacts.push(`${hy.year}年度税前分红每股 ${Number(hy.dividendPerShare).toFixed(4)} 元，按 ${hy.priceAsOf} 报价算得历史股息率 ${Number(hy.yieldPercent).toFixed(2)}%`);
    }
    if (hasNumber(fin.cashConversion)) {
      const cc = Number(fin.cashConversion);
      const ccBar = clampBar((Math.max(0, cc) / 2) * 100);
      healthChecks.push({
        label: "现金利润覆盖",
        valueText: `${cc.toFixed(2)}倍`,
        percent: ccBar,
        tone: cc >= 1 ? "good" : "warn",
      });
      radarAxes.push({ label: "现金覆盖", value: ccBar });
    }
    if (hasNumber(fin.roe)) {
      radarAxes.push({ label: "股东回报", value: clampBar((Math.max(0, Number(fin.roe)) / 25) * 100) });
    }
    if (hasNumber(fin.freeCashFlowMargin)) {
      radarAxes.push({ label: "自由现金", value: clampBar((Math.max(0, Number(fin.freeCashFlowMargin)) / 30) * 100) });
    }
    if (hasNumber(fin.freeCashFlow) || hasNumber(fin.operatingCashFlow)) {
      keyFacts.push(`经营现金流 ${formatLarge(fin.operatingCashFlow)}，自由现金流 ${formatLarge(fin.freeCashFlow)}${hasNumber(fin.roe) ? `，股东回报 ${formatPercent(fin.roe)}` : ""}`);
    }
  } else if (item.market === "us") {
    const fin = raw.fund || {};
    if (hasNumber(fin.grossMargin)) {
      const gm = Number(fin.grossMargin);
      badges.push({ label: `毛利率 ${gm.toFixed(1)}%`, tone: gm >= 50 ? "good" : "plain" });
      healthChecks.push({
        label: "毛利率",
        valueText: `${gm.toFixed(1)}%`,
        percent: clampBar(gm),
        tone: gm >= 50 ? "good" : "plain",
      });
      radarAxes.push({ label: "毛利率", value: clampBar(gm) });
    }
    if (hasNumber(fin.profitMargin)) {
      radarAxes.push({ label: "净利率", value: clampBar((Math.max(0, Number(fin.profitMargin)) / 45) * 100) });
    }
    if (hasNumber(fin.revenueGrowth)) {
      const rg = Number(fin.revenueGrowth);
      const rgBar = clampBar(rg >= 0 ? (rg / 40) * 100 : 12);
      badges.push({ label: `营收 ${formatPercent(rg)}`, tone: rg >= 10 ? "good" : "plain" });
      healthChecks.push({
        label: "营收增速",
        valueText: formatPercent(rg),
        percent: rgBar,
        tone: rg >= 10 ? "good" : (rg < 0 ? "warn" : "plain"),
      });
      radarAxes.push({ label: "营收增速", value: rgBar });
    }
    if (hasNumber(fin.roe)) {
      radarAxes.push({ label: "股东回报", value: clampBar((Math.max(0, Number(fin.roe)) / 45) * 100) });
    }
    const closes = (Array.isArray(raw.history) ? raw.history : [])
      .map((entry) => Number(entry && entry.close != null ? entry.close : entry))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (closes.length >= 10 && hasNumber(raw.price)) {
      const lo = Math.min(...closes);
      const hi = Math.max(...closes);
      if (hi > lo) {
        const pos = Math.max(0, Math.min(100, Math.round(((Number(raw.price) - lo) / (hi - lo)) * 100)));
        healthChecks.push({
          label: `近${closes.length}日价格位置`,
          valueText: `${pos}% 分位`,
          percent: clampBar(pos),
          tone: pos <= 35 ? "good" : (pos >= 80 ? "warn" : "plain"),
        });
        radarAxes.push({ label: "低位缓冲", value: clampBar(100 - pos) });
      }
    }
    if (hasNumber(fin.pe) && Number(fin.pe) > 0) badges.push({ label: `市盈率 ${Number(fin.pe).toFixed(1)}倍`, tone: "plain" });
    if (hasNumber(fin.marketCap) || hasNumber(fin.pe)) {
      keyFacts.push(`公开财务期 ${dayText(fin.period) || "待核"}：市值 ${formatLarge(fin.marketCap)}，市盈率 ${hasNumber(fin.pe) ? `${Number(fin.pe).toFixed(1)}倍` : "暂缺"}`);
    }
    if (hasNumber(fin.operatingCashFlow) || hasNumber(fin.netIncome)) {
      keyFacts.push(`盈利与现金：净利润 ${formatLarge(fin.netIncome)}，经营现金流 ${formatLarge(fin.operatingCashFlow)}`);
    }
  } else if (item.market === "hk") {
    if (raw.industry) badges.push({ label: raw.industry, tone: "plain" });
    if (hasNumber(raw.cornerstonePercent)) {
      const cp = Number(raw.cornerstonePercent);
      badges.push({ label: `基石 ${cp.toFixed(1)}%`, tone: cp >= 30 ? "good" : "plain" });
      healthChecks.push({ label: "基石认购占比", valueText: `${cp.toFixed(1)}%`, percent: clampBar(cp), tone: cp >= 30 ? "good" : "plain" });
    }
    if (hasNumber(raw.oneLotRate)) {
      const ol = Number(raw.oneLotRate);
      healthChecks.push({ label: "一手中签率", valueText: `${ol.toFixed(1)}%`, percent: clampBar(ol), tone: "plain" });
    }
    if (hasNumber(raw.publicOversubscription)) badges.push({ label: `超购 ${Math.round(Number(raw.publicOversubscription))}倍`, tone: "plain" });
    if (evidenceBullets.length) keyFacts.push(...evidenceBullets.slice(0, 2));
  } else if (item.market === "guru") {
    if (raw.reportDate) badges.push({ label: `报告期 ${dayText(raw.reportDate)}`, tone: "plain" });
    if (hasNumber(raw.trackingScore)) {
      const ts = Number(raw.trackingScore);
      badges.push({ label: `披露可靠度 ${ts}`, tone: ts >= 75 ? "good" : "plain" });
      healthChecks.push({ label: "披露可靠度", valueText: `${ts}分`, percent: clampBar(ts), tone: ts >= 75 ? "good" : "plain" });
    }
    if (evidenceBullets.length) keyFacts.push(...evidenceBullets.slice(0, 2));
  } else if (item.market === "gold") {
    const intlSeries = historicalGoldSeries(raw, "international");
    const domSeries = historicalGoldSeries(raw, "domestic");
    if (intlSeries.rows.length) {
      badges.push({ label: `国际金 ${intlSeries.rows.length}日收盘`, tone: "plain" });
      const vals = intlSeries.rows.map((r) => Number(r.close)).filter(Number.isFinite);
      if (vals.length >= 10) {
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        if (hi > lo) {
          const pos = Math.max(0, Math.min(100, Math.round(((vals[vals.length - 1] - lo) / (hi - lo)) * 100)));
          healthChecks.push({ label: "国际金区间位置", valueText: `${pos}% 分位`, percent: clampBar(pos), tone: pos <= 35 ? "good" : (pos >= 80 ? "warn" : "plain") });
        }
      }
    }
    if (domSeries.rows.length) badges.push({ label: `上海金 ${domSeries.rows.length}日收盘`, tone: "plain" });
    if (evidenceBullets.length) keyFacts.push(...evidenceBullets.slice(0, 2));
  }
  if (!keyFacts.length && evidenceBullets.length) keyFacts.push(...evidenceBullets.slice(0, 2));

  const filingCount = (base.dynamics && Array.isArray(base.dynamics.filingCards))
    ? base.dynamics.filingCards.length
    : 0;

  // 借鉴 TradingView：仅从真实历史收盘序列提取多周期涨跌对照（近5日/20日/60日/90日）。
  const periodReturns = [];
  const extractCloses = () => {
    if (item.market === "gold") {
      const intl = historicalGoldSeries(raw, "international");
      return (intl.rows || []).map((r) => Number(r.close)).filter((v) => Number.isFinite(v) && v > 0);
    }
    return (Array.isArray(raw.history) ? raw.history : [])
      .map((entry) => Number(entry && entry.close != null ? entry.close : entry))
      .filter((v) => Number.isFinite(v) && v > 0);
  };
  const seriesCloses = extractCloses();
  if (seriesCloses.length >= 6) {
    const lastClose = seriesCloses[seriesCloses.length - 1];
    const pushWindow = (days, label) => {
      if (seriesCloses.length < days) return;
      const baseClose = seriesCloses[seriesCloses.length - days];
      if (!(baseClose > 0)) return;
      const pct = ((lastClose - baseClose) / baseClose) * 100;
      periodReturns.push({
        label,
        valueText: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
        tone: pct > 0.05 ? "up" : (pct < -0.05 ? "down" : "flat"),
      });
    };
    pushWindow(5, "近5日");
    pushWindow(20, "近20日");
    pushWindow(60, "近60日");
    if (seriesCloses.length >= 85) pushWindow(seriesCloses.length, `近${seriesCloses.length}日`);
  }

  // 借鉴 Perplexity Finance：把最核心的 3 个决策疑问直接答成零术语白话卡片（纯基于已核验字段）。
  const qaCards = [];
  if (item.market === "a" && raw.assetType !== "fund") {
    const fin = raw.financials || {};
    const stab = getDividendStability(raw, { asOf: raw.snapshotUpdatedAt || raw.priceAsOf || raw.asOf });
    if (Array.isArray(stab.years) && stab.years.length > 0) {
      qaCards.push({
        q: "分红连续性稳不稳？",
        a: `已收录 ${stab.years.length} 个年度分红记录${stab.decreaseCount != null ? `，近5个完整所属年度出现 ${stab.decreaseCount} 次减息` : "，部分年度记录待补齐"}。`,
      });
    }
    if (hasNumber(fin.operatingCashFlow) && hasNumber(fin.freeCashFlow)) {
      qaCards.push({
        q: "真金白银现金流够不够？",
        a: `经营现金流 ${formatLarge(fin.operatingCashFlow)}，自由现金流 ${formatLarge(fin.freeCashFlow)}${hasNumber(fin.cashConversion) ? `，现金利润覆盖 ${Number(fin.cashConversion).toFixed(2)} 倍` : ""}。`,
      });
    }
    if (raw.historicalDividendYield) {
      const hy = raw.historicalDividendYield;
      qaCards.push({
        q: "税前历史股息率怎么算出来的？",
        a: `按 ${hy.year} 年度已实施税前每股分红 ${Number(hy.dividendPerShare).toFixed(4)} 元 ÷ ${hy.priceAsOf} 报价，算得 ${Number(hy.yieldPercent).toFixed(2)}%（过去分红不代表未来）。`,
      });
    }
  } else if (item.market === "us") {
    const fin = raw.fund || {};
    if (hasNumber(fin.grossMargin)) {
      qaCards.push({
        q: "生意赚钱能力厚不厚？",
        a: `毛利率 ${Number(fin.grossMargin).toFixed(1)}%${hasNumber(fin.profitMargin) ? `，净利率 ${Number(fin.profitMargin).toFixed(1)}%` : ""}${hasNumber(fin.roe) ? `，股东回报率 ${Number(fin.roe).toFixed(1)}%` : ""}。`,
      });
    }
    if (hasNumber(fin.revenueGrowth) || hasNumber(fin.netIncome)) {
      qaCards.push({
        q: "最近一期增长还在不在？",
        a: `${hasNumber(fin.revenueGrowth) ? `公开财报期营收同比 ${formatPercent(fin.revenueGrowth)}` : "营收增速待核"}${hasNumber(fin.netIncome) ? `，净利润 ${formatLarge(fin.netIncome)}` : ""}。`,
      });
    }
    if (hasNumber(fin.pe) || seriesCloses.length >= 10) {
      const lo = seriesCloses.length >= 10 ? Math.min(...seriesCloses) : null;
      const hi = seriesCloses.length >= 10 ? Math.max(...seriesCloses) : null;
      const pos = (lo != null && hi != null && hi > lo && hasNumber(raw.price))
        ? Math.max(0, Math.min(100, Math.round(((Number(raw.price) - lo) / (hi - lo)) * 100)))
        : null;
      qaCards.push({
        q: "估值与近期位置在哪？",
        a: `${hasNumber(fin.pe) && Number(fin.pe) > 0 ? `市盈率 ${Number(fin.pe).toFixed(1)} 倍；` : ""}${pos != null ? `该次历史报价位于近 ${seriesCloses.length} 个交易日的 ${pos}% 分位。` : "请结合财报期综合对照。"}`,
      });
    }
  } else if (item.market === "hk") {
    qaCards.push({
      q: "参与一手需要准备多少资金？",
      a: `${hasNumber(raw.entryFee) ? `一手入场约 ${Number(raw.entryFee).toFixed(0)} 港元` : "入场金额见招股书"}${hasNumber(raw.oneLotRate) ? `，一手中签率 ${Number(raw.oneLotRate).toFixed(1)}%` : ""}。`,
    });
    if (hasNumber(raw.cornerstonePercent) || raw.sponsor) {
      qaCards.push({
        q: "基石与保荐人阵容如何？",
        a: `${hasNumber(raw.cornerstonePercent) ? `基石认购占比 ${Number(raw.cornerstonePercent).toFixed(1)}%` : "基石占比待披露"}${raw.industry ? `，所属行业为${raw.industry}` : ""}。`,
      });
    }
  } else if (item.market === "gold") {
    if (seriesCloses.length >= 10) {
      const lo = Math.min(...seriesCloses);
      const hi = Math.max(...seriesCloses);
      const pos = hi > lo ? Math.round(((seriesCloses[seriesCloses.length - 1] - lo) / (hi - lo)) * 100) : 50;
      qaCards.push({
        q: "金价在近期历史中处于什么位置？",
        a: `国际金最新收录收盘价处于近 ${seriesCloses.length} 个交易日的 ${pos}% 分位，分位仅反映过去高低，不预测明日方向。`,
      });
    }
  } else if (item.market === "guru") {
    qaCards.push({
      q: "普通人读机构持仓最该注意什么？",
      a: "法定持仓披露仅含多头且有时间滞后，适合学习长线选股方向，切忌把几个月前的持仓当成今天买卖信号照抄。",
    });
  }

  base.overview = {
    orderPlan: base.orderPlan || null,
    priceCard,
    scoreCard: base.scoreCard || null,
    badges: badges.slice(0, 3),
    yearDots,
    periodReturns: periodReturns.slice(0, 4),
    qaCards: qaCards.slice(0, 3),
    radar: radarAxes.length >= 3 ? { canvasId: "overview-health-radar", axes: radarAxes.slice(0, 5) } : null,
    healthChecks: healthChecks.slice(0, 3),
    filingCount,
    keyFacts: keyFacts.slice(0, 2),
    evidenceBullets,
    keyRisk,
    nextWatch,
    reason: base.stageInfo && base.stageInfo.listingProgressUnverified
      ? base.answer
      : (strategy.action || base.answer || ""),
  };
}

function buildSourceLinks(item, snapshot) {
  const raw = (item && item.raw) || {};
  const own = [];
  if (item.market === "gold") {
    const domestic = historicalGoldSeries(raw, "domestic");
    if (domestic.rows.length) own.push({ id: "gold-sge-close", name: "上海黄金交易所 Au99.99 每日行情", url: domestic.sourceUrl });
  }
  if (item.market === "hk") {
    own.push(
      raw.prospectusUrl ? { id: "hk-prospectus", name: "招股章程（港交所 PDF）", url: raw.prospectusUrl } : null,
      raw.announcementUrl ? { id: "hk-announcement", name: "上市公告（港交所 PDF）", url: raw.announcementUrl } : null,
      raw.allotmentUrl ? { id: "hk-allotment", name: "配发结果（港交所 PDF）", url: raw.allotmentUrl } : null,
    );
  }
  if (item.market === "guru" && raw.sourceUrl) {
    // 13F 机构（raw.isLive）确实备案在 SEC EDGAR；港股/A 股那几只基金没有 13F，
    // 走的是基金月报/半年报，硬写「美国证监会备案」是张冠李戴。有 raw.source
    // 就用它本来的名字（如「惠理基金月报」），没有才退回「官方原文」。
    const sourceLabel = raw.isLive
      ? "美国证监会备案"
      : sourceName(raw.source || (raw.profile && raw.profile.sourceName)) || "官方原文";
    own.push({ id: "guru-source", name: `${item.name || "该机构"} 的 ${sourceLabel}`, url: raw.sourceUrl });
  }
  if (item.market === "us") {
    own.push(...eventSources(snapshot, raw.symbol || item.code));
    // 「同期公告」那张卡只写日期和事件类型，是我们的转述；能点开核对的原文
    // 才是这一栏成立的理由，所以每条公告都在来源里留一个可复制的深链。
    for (const filing of filingsFor(snapshot, raw.symbol || item.code)) {
      if (!filing.sourceUrl) continue;
      own.push({
        id: `us-filing-${filing.filingDate}-${filing.form}`,
        name: `${formatFiling(filing)}（SEC ${filing.form} 原文）`,
        url: filing.sourceUrl,
      });
    }
  }
  // guru 栏目的市场级出处（sec）是给真正披露 13F 的机构用的；港股/A 股基金
  // 没有 13F 义务，挂 SEC EDGAR 链接是张冠李戴——宁可少这一条，也不能挂错。
  const marketLevel = marketSources(snapshot, item.market).filter(
    (source) => !(item.market === "guru" && source.id === "sec" && !raw.isLive),
  );
  return dedupeSources(own.filter(Boolean).concat(marketLevel));
}

function detailView(item, snapshot) {
  const base = baseView(item);
  if (item.market === "hk") buildHKView(base, item, snapshot);
  else if (item.market === "us") buildUSView(base, item, snapshot);
  else if (item.market === "a") buildAShareView(base, item, snapshot);
  else if (item.market === "gold") buildGoldView(base, item);
  else buildGuruView(base, item);

  base.sourceLinks = buildSourceLinks(item, snapshot);
  const showStrategy = item.market !== "us" && !(item.market === "a" && item.raw?.assetType !== "fund");
  base.strategy = showStrategy ? buildStrategySignal(item, { snapshot, evidence: strategyEvidence }) : null;
  // 历史参考不生成下单卡；保留事实、走势与研究依据。
  base.orderPlan = null;
  buildOverview(base, item);

  const scored = showStrategy ? scoreForItem(item) : null;
  if (scored?.score != null) {
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
  // NVDA 这类标的曾把「七姐妹」这种分类标签当结论展示在最显眼的位置；分类
  // 不是判断。美股/A股/港股新股优先用策略信号的真实结论，金/机构持仓两类
  // 未改动结构，公式退化到原来的 badge/quickAnswer，输出与旧版逐字节相同。
  base.primaryJudgment = ["us", "a", "hk"].includes(item.market)
    ? (base.strategy?.label || base.badge || base.quickAnswer)
    : (base.badge || base.quickAnswer);
  base.metrics = compactFacts(base.metrics || [], 14);
  base.facts = compactFacts(base.facts || [], 28);
  if (!Array.isArray(base.highlights) || !base.highlights.length) {
    base.highlights = (base.metrics || []).slice(0, 4).map((row) => ({
      label: row[0],
      value: row[1],
    }));
  }
  // 四格全是「—」（如已取消发行的新股）就整条不画，一排空格子看着像页面坏了；结论条已经说清楚了。
  if (base.highlights.every((cell) => !cell || cell.value == null || cell.value === "" || cell.value === "—")) {
    base.highlights = [];
  }
  // 偏旧快照保留可核对的历史报价，但不能把报价日的涨跌写成今天的行情。
  { // 无论批次是否新鲜，报价都是带日期的历史参考。
    const historicalLabels = { "现价": "历史报价", "今日": "报价日涨跌" };
    base.highlights = base.highlights.map((cell) => ({ ...cell, label: historicalLabels[cell.label] || cell.label }));
    base.metrics = base.metrics.map((row) => [historicalLabels[row[0]] || row[0], row[1]]);
    base.facts = base.facts.map((row) => [historicalLabels[row[0]] || row[0], row[1]]);
    if (base.overview) {
      base.overview.orderPlan = null;
      base.overview.reason = base.answer || "历史资料仅供研究对照";
    }
    if (base.overview && base.overview.keyRisk) {
      base.overview.keyRisk = base.overview.keyRisk.replace(/现价/g, "该次报价");
    }
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
  // base.charts/base.visual 现在只喂上面「上限从 8 提到 10」年代的正则分类
  // 兜底（summary/price/finance/research 那组旧 tab id）——美股/A股/港股
  // 新股/机构持仓/黄金五个市场都已经改用 trendCharts/dynamicsCharts/...
  // 精确分装，没有市场会再走到这段截断，留作未注册新市场时的安全网。
  base.charts = base.charts.slice(0, 10);
  base.visual = base.charts[0] || null;
  base.group = item.group;
  base.market = item.market;
  // 标题用简称；全称放在公司资料里。黄金条目的 name 是列表里的问句
  // （「现在怎么做」），buildGoldView 已经给了标题，这里不再盖回去。
  if (item.market !== "gold") {
    base.title = item.raw?.assetType === "fund"
      ? (item.raw.shortName || item.name || base.title)
      : shortCompanyName(item.name || base.title, base.title, 10);
  }
  base.fullName = item.name || base.title;
  if (item.market !== "guru") base.rank = "";
  base.primaryJudgment = plainLabel(base.primaryJudgment);
  base.highlights = simpleHighlights(base.highlights);
  return base;
}

function detailModules(market) {
  if (market === "gold") {
    return [
      { id: "overview", label: "怎么看" },
      { id: "trend", label: "价格" },
      { id: "dynamics", label: "驱动" },
      { id: "evidence", label: "依据" },
    ];
  }
  if (market === "guru") {
    return [
      { id: "overview", label: "怎么看" },
      { id: "holdings", label: "持仓" },
      { id: "evidence", label: "依据" },
    ];
  }
  // 美股/A股/港股新股/机构持仓改为「决策概览＋标签」，id 全部换新字符串，
  // 避免和上面黄金仍在用的 summary/price/finance/source/research/risk
  // 撞车——WXML 里旧六标签内容块只按 activeModule 判断，不看 market。
  if (market === "us") {
    return [
      { id: "overview", label: "怎么看" },
      { id: "trend", label: "价格" },
      { id: "dynamics", label: "近况" },
      { id: "evidence", label: "依据" },
    ];
  }
  if (market === "a") {
    return [
      { id: "overview", label: "怎么看" },
      { id: "trend", label: "价格" },
      { id: "dividend", label: "分红" },
      { id: "evidence", label: "依据" },
    ];
  }
  return [
    { id: "overview", label: "怎么看" },
    { id: "subscribe", label: "申购" },
    { id: "sell", label: "卖出" },
    { id: "evidence", label: "依据" },
  ];
}

function buildDetailModules(view, market) {
  // 美股/A股/港股新股/机构持仓/黄金：每个 buildXView 已经把图表直接分装进
  // trendCharts/dynamicsCharts/dividendCharts/subscribeCharts/sellCharts/
  // holdingsCharts/evidenceCharts，不再靠标题正则去猜该进哪个 tab。下面的
  // 正则分类逻辑现在没有市场会走到，留作未注册新市场时的兜底，不删。
  if (market === "us" || market === "a" || market === "hk" || market === "guru" || market === "gold") {
    return {
      ...view,
      modules: detailModules(market),
      trendCharts: view.trendCharts || [],
      dynamicsCharts: view.dynamicsCharts || [],
      dividendCharts: view.dividendCharts || [],
      subscribeCharts: view.subscribeCharts || [],
      sellCharts: view.sellCharts || [],
      holdingsCharts: view.holdingsCharts || [],
      evidenceCharts: view.evidenceCharts || [],
    };
  }
  const charts = Array.isArray(view.charts) ? view.charts : [];
  const chartText = (chart) => String(chart?.title || "");
  const pricePattern = /金|价格|位置|买卖/u;
  const financePattern = /指标|驱动|位置/u;
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

// price/finance/research 是黄金沿用的旧 tab id；trend/dynamics/dividend/
// subscribe/sell/holdings/evidence 是美股/A股/港股新股/机构持仓的新 tab id。
// refresh() 和 switchModule() 共用这一份映射，避免两处各写一次、以后加 tab
// 漏改一处。
function chartsForModule(view, moduleId) {
  const chartMap = {
    // 概览卡的 priceCard 不走 wx:for 的 activeCharts 循环（它是单独一个
    // template 调用，见 wxml），但画布同样要靠 drawActiveLineCharts() 才会
    // 落笔——只有黄金的 priceCard 是 canvas 折线图，其余市场是 meter/tiles，
    // kind 对不上 line/radar/scatter，drawActiveLineCharts() 里天然跳过。
    overview: view.overview && view.overview.priceCard ? [view.overview.priceCard] : [],
    price: view.priceCharts,
    finance: view.financeCharts,
    research: view.researchCharts,
    trend: view.trendCharts,
    dynamics: view.dynamicsCharts,
    dividend: view.dividendCharts,
    subscribe: view.subscribeCharts,
    sell: view.sellCharts,
    holdings: view.holdingsCharts,
    evidence: view.evidenceCharts,
  };
  return chartMap[moduleId] || [];
}

// 借鉴抖音连刷体验：自动构建同市场有序队列，详情页内无缝切上一只/下一只，零页面栈堆积。
function buildPeerNav(snapshot, item) {
  if (!snapshot || !item || item.market === "gold") return null;
  let pool = [];
  if (item.market === "us") {
    const items = allItems(snapshot, "us");
    const seven = items.filter((row) => row.group === "seven");
    if (seven.some((row) => row.id === item.id)) pool = seven;
    else pool = usPoolItems(snapshot);
  } else if (item.market === "a") {
    pool = allItems(snapshot, "a").filter((row) => row.raw?.assetType !== "fund");
    if (item.raw?.assetType === "fund") return null;
  } else if (item.market === "guru") {
    pool = allItems(snapshot, "guru").filter((row) => row.group !== "overlap");
  } else if (item.market === "hk") {
    const items = allItems(snapshot, "hk");
    const live = items.filter((row) => (row.lenses || []).some((l) => l === "live" || l === "date-pending"));
    pool = live.some((row) => row.id === item.id) ? live : items.filter((row) => row.group === item.group);
  }
  const seen = new Set();
  const unique = pool.filter((row) => {
    if (!row || !row.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const index = unique.findIndex((row) => row.id === item.id);
  if (index < 0 || unique.length < 2) return null;
  const pick = (row) => ({ id: row.id, name: shortCompanyName(row.name, row.code || row.id, 6) });
  return {
    prev: pick(unique[(index - 1 + unique.length) % unique.length]),
    next: pick(unique[(index + 1) % unique.length]),
    indexText: `${index + 1}/${unique.length}`,
  };
}

// 借鉴 Perplexity Finance 同池可比公司卡：挑选 3 只同板块核心可比标的，一键原地切换对比。
function buildPeerCompare(snapshot, item) {
  if (!snapshot || !item) return [];
  if (item.market === "a" && item.raw?.assetType !== "fund") {
    const curInd = String(item.raw?.industry || "").split("/")[0].trim();
    const peers = allItems(snapshot, "a")
      .filter((row) => row && row.id !== item.id && row.raw?.assetType !== "fund");
    peers.sort((a, b) => {
      const aSame = curInd && String(a.raw?.industry || "").includes(curInd) ? 1 : 0;
      const bSame = curInd && String(b.raw?.industry || "").includes(curInd) ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      const ay = a.raw?.historicalDividendYield?.yieldPercent || 0;
      const by = b.raw?.historicalDividendYield?.yieldPercent || 0;
      return by - ay;
    });
    return peers.slice(0, 3).map((row) => {
      const hy = row.raw?.historicalDividendYield;
      const stab = getDividendStability(row.raw);
      return {
        id: row.id,
        name: shortCompanyName(row.name, row.code, 5),
        metric1: hy ? `股息率 ${Number(hy.yieldPercent).toFixed(2)}%` : "股息率待核",
        metric2: stab.score != null ? `稳度 ${stab.score}分` : (row.raw?.industry || "").slice(0, 6),
      };
    });
  }
  if (item.market === "us") {
    const pool = usPoolItems(snapshot).filter((row) => row && row.id !== item.id);
    const isSeven = item.group === "seven";
    pool.sort((a, b) => {
      const aSeven = a.group === "seven" ? 1 : 0;
      const bSeven = b.group === "seven" ? 1 : 0;
      if (isSeven && aSeven !== bSeven) return bSeven - aSeven;
      return (Number(b.raw?.fund?.marketCap) || 0) - (Number(a.raw?.fund?.marketCap) || 0);
    });
    return pool.slice(0, 3).map((row) => {
      const f = row.raw?.fund || {};
      return {
        id: row.id,
        name: shortCompanyName(row.name, row.code, 5),
        metric1: hasNumber(f.pe) && Number(f.pe) > 0 ? `PE ${Number(f.pe).toFixed(1)}x` : row.code,
        metric2: hasNumber(f.grossMargin) ? `毛利 ${Number(f.grossMargin).toFixed(0)}%` : "",
      };
    });
  }
  return [];
}

function buildShareCardText(view, dataAsOf) {
  if (!view) return "";
  const lines = [
    `【望潮 Aurum · 历史资料参考】`,
    `${view.title || ""}${view.code && !view.hideCode ? `（${view.code}）` : ""}`,
    dataAsOf ? `时间口径：${dataAsOf}` : "",
    view.overview?.reason ? `核心结论：${view.overview.reason}` : "",
  ];
  const facts = (view.overview && view.overview.keyFacts) || [];
  facts.forEach((fact, idx) => lines.push(`依据${idx + 1}：${fact}`));
  if (view.overview && view.overview.keyRisk) lines.push(`主要风险：${view.overview.keyRisk}`);
  lines.push("注：以上为公开历史资料整理，仅供参考，不构成投资建议。");
  return lines.filter(Boolean).join("\n");
}

function slimViewForSetData(view) {
  if (!view || typeof view !== "object") return {};
  const {
    charts,
    trendCharts,
    dynamicsCharts,
    dividendCharts,
    subscribeCharts,
    sellCharts,
    holdingsCharts,
    evidenceCharts,
    priceCharts,
    financeCharts,
    researchCharts,
    ...slim
  } = view;
  return slim;
}

Page({
  data: {
    pricePlanOpen: false,
    overviewMoreOpen: false,
    market: "hk",
    group: "",
    id: "",
    ready: false,
    loading: true,
    loadError: "",
    detailsExpanded: false,
    moreEvidenceExpanded: false,
    strategyExpanded: false,
    activeModule: "summary",
    activeCharts: [],
    peerNav: null,
    view: {},
    source: "正在读取同步数据",
    // 页头那句「数据截至 …」和新闻资讯页、栏目页、明细页共用 asOfText()。
    // 同一份快照在四个页面上说的时间必须是同一个，各写各的迟早会飘。
    dataAsOf: "",
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
    memberToolsEnabled: PRODUCT.memberToolsEnabled,
    writable: false,
    dividendShares: 1000,
    dividendCalcView: null,
    posterBusy: false,
    starred: false,
    peerCompare: [],
  },
  togglePricePlan() { this.setData({ pricePlanOpen: !this.data.pricePlanOpen }); },
  toggleOverviewMore() { this.setData({ overviewMoreOpen: !this.data.overviewMoreOpen }); },
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
    if (PRODUCT.memberToolsEnabled) this.refreshMemberLink();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
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
    if (!this.data.ready) this.setData({ loading: true, loadError: "" });
    let rendered = false;
    loadSnapshot((snapshot, source, meta = {}) => {
      rendered = true;
      const versionKey = meta.versionKey || snapshotVersionKey(snapshot, meta.kind);
      if (!force && this.data.ready && versionKey && versionKey === this._renderedKey) return;
      this._renderedKey = versionKey;
      this._latestSnapshot = snapshot;
      const freshness = freshnessBanner(source, meta.kind);
      let dataAsOf = marketReferenceAsOf(snapshot, this.data.market, meta.kind);
      try {
        const item = findItem(snapshot, this.data.market, this.data.id);
        if (!item) {
          this.setData({
            ready: false,
            loading: false,
            loadError: "未找到该标的，请返回列表重试",
            source,
            freshness,
            dataAsOf,
          });
          return;
        }
        dataAsOf = marketReferenceAsOf(snapshot, item.market, meta.kind, item);
        const view = buildDetailModules(detailView(item, snapshot), item.market);
        view.exitPlan = null; // 历史参考保留同类样本图，不给即时卖出指令。
        this._detailItem = item;
        this._fullView = view;
        const firstModuleId = (view.modules && view.modules[0] && view.modules[0].id) || "summary";
        const activeModule = this.data.ready && (view.modules || []).some((m) => m.id === this.data.activeModule)
          ? this.data.activeModule
          : firstModuleId;
        this.setData({
          ready: true,
          loading: false,
          loadError: "",
          view: slimViewForSetData(view),
          peerNav: buildPeerNav(snapshot, item),
          peerCompare: buildPeerCompare(snapshot, item),
          starred: isQuickStarred(item.market, item.id),
          dividendCalcView: this.formatDividendCalc(view.dividendCalc, this.data.dividendShares),
          activeModule,
          activeCharts: chartsForModule(view, activeModule),
          group: item.group || "",
          source,
          freshness,
          dataAsOf,
        }, () => this.drawActiveLineCharts());
        wx.setNavigationBarTitle({ title: view.title || "资料详情" });
        if (PRODUCT.memberToolsEnabled) this.refreshMemberLink();
      } catch (error) {
        console.error("[望潮] detail render failed", error);
        this.setData({
          ready: false,
          loading: false,
          loadError: "资料渲染失败，请下拉重试",
          source,
          freshness,
          dataAsOf,
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
  switchDividendRange(event) {
    const rangeId = String(event.currentTarget.dataset.range || "10");
    if (!this._detailItem || !this._latestSnapshot || !this._fullView) return;
    const nextChart = dividendHistoryVisual(this._detailItem.raw || {}, this._latestSnapshot.updatedAt, rangeId);
    if (!nextChart) return;
    const nextDividendCharts = (this._fullView.dividendCharts || []).map((chart) => (
      chart && chart.isDividendHistory ? nextChart : chart
    ));
    this._fullView.dividendCharts = nextDividendCharts;
    if (this.data.activeModule === "dividend") {
      this.setData({ activeCharts: nextDividendCharts });
    }
  },
  // 抖音式连刷：原地切换上一只/下一只标的，不堆积微信页面栈。
  switchPeer(event) {
    const nextId = String(event.currentTarget.dataset.id || "");
    if (!nextId || nextId === this.data.id) return;
    track("detail_open", { market: this.data.market, from: "peer_nav" });
    this._renderedKey = "";
    this.setData({
      id: nextId,
      overviewMoreOpen: false,
      pricePlanOpen: false,
      detailsExpanded: false,
      moreEvidenceExpanded: false,
    }, () => {
      this.refresh();
      if (typeof wx.pageScrollTo === "function") wx.pageScrollTo({ scrollTop: 0, duration: 150 });
    });
  },
  toggleStar() {
    const item = this._detailItem;
    const view = this._fullView || this.data.view;
    if (!item || !view) return;
    const result = toggleQuickStar({
      market: item.market,
      id: item.id,
      name: view.title || item.name,
      code: view.code || item.code || "",
    });
    this.setData({ starred: result.starred });
    if (result.starred) {
      track("add_holding", { market: String(item.market), from: "quick_star" });
    } else {
      track("holding_delete", { market: String(item.market), from: "quick_star" });
    }
    if (typeof wx.showToast === "function") {
      wx.showToast({ title: result.starred ? "已星标（首页搜索框可直达）" : "已取消星标", icon: "none" });
    }
  },
  formatDividendCalc(calc, shares) {
    if (!calc || !hasNumber(calc.dps) || !hasNumber(calc.price)) return null;
    const count = Number(shares) || 1000;
    return {
      shares: count,
      year: calc.year,
      dpsText: `¥${Number(calc.dps).toFixed(4)}`,
      cashText: `¥${(Number(calc.dps) * count).toFixed(2)}`,
      costText: `¥${Math.round(Number(calc.price) * count).toLocaleString("en-US")}`,
      priceAsOf: calc.priceAsOf,
    };
  },
  selectDividendShares(event) {
    const shares = Number(event.currentTarget.dataset.shares) || 1000;
    const calc = this._fullView && this._fullView.dividendCalc;
    if (!calc) return;
    this.setData({
      dividendShares: shares,
      dividendCalcView: this.formatDividendCalc(calc, shares),
    });
  },
  // 借鉴韭圈儿×Claude：一键把当前详情页绘制成高清研报图片卡，支持长按保存或直接转发群聊。
  generateSharePoster() {
    if (this.data.posterBusy) return;
    const view = this._fullView || this.data.view;
    if (!view || !view.title) return;
    track("share_tap", { page: "detail_poster", market: this.data.market });
    this.setData({ posterBusy: true });
    if (typeof wx.showLoading === "function") wx.showLoading({ title: "正在生成研报图..." });
    const done = () => {
      if (typeof wx.hideLoading === "function") wx.hideLoading();
      this.setData({ posterBusy: false });
    };
    this.resolveCanvasNode("share-poster-canvas", 0, (ctx, w, h, canvas) => {
      try {
        paintSharePoster(ctx, w, h, view, this.data.dataAsOf);
      } catch (err) {
        done();
        if (typeof wx.showToast === "function") wx.showToast({ title: "海报绘制失败，可先复制文字摘要", icon: "none" });
        return;
      }
      if (typeof wx.canvasToTempFilePath !== "function") {
        done();
        return;
      }
      wx.canvasToTempFilePath({
        canvas,
        fileType: "png",
        quality: 1,
        success: (res) => {
          done();
          if (res && res.tempFilePath && typeof wx.previewImage === "function") {
            wx.previewImage({ current: res.tempFilePath, urls: [res.tempFilePath] });
          }
        },
        fail: () => {
          done();
          if (typeof wx.showToast === "function") wx.showToast({ title: "图片导出失败，可点右侧复制摘要", icon: "none" });
        },
      });
    });
  },
  // 借鉴韭圈儿一图/研报分享：一键复制带日期与风控边界的结构化研报摘要，便于发群交流。
  copyShareCard() {
    const text = buildShareCardText(this._fullView || this.data.view, this.data.dataAsOf);
    if (!text) return;
    track("share_tap", { page: "detail_card", market: this.data.market });
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "已复制研报摘要", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  openUsStart() {
    track("path_open", { path: "us-start", from: "detail" });
    openPage("/pages/guide/index?topic=us-start&from=detail");
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  toggleDetails() {
    this.setData({ detailsExpanded: !this.data.detailsExpanded });
  },
  toggleMoreEvidence() {
    this.setData({ moreEvidenceExpanded: !this.data.moreEvidenceExpanded });
  },
  toggleStrategy() {
    this.setData({ strategyExpanded: !this.data.strategyExpanded });
  },
  switchModule(event) {
    const moduleId = String(event.currentTarget.dataset.module || "summary");
    const view = this._fullView || this.data.view || {};
    if (!(view.modules || []).some((item) => item.id === moduleId)) return;
    track("detail_module_switch", { market: this.data.market, module: moduleId });
    this.setData({
      activeModule: moduleId,
      activeCharts: chartsForModule(view, moduleId),
      detailsExpanded: moduleId === "research" ? this.data.detailsExpanded : false,
      moreEvidenceExpanded: moduleId === "evidence" ? this.data.moreEvidenceExpanded : false,
    }, () => this.drawActiveLineCharts());
  },
  // 方法名留着没改（调用点还叫 drawActiveLineCharts）。折线已经是 SVG 图片，
  // 这里只剩 radar/scatter 两种 canvas 图表，共用同一套节点探测与重试逻辑。
  drawActiveLineCharts() {
    (this.data.activeCharts || []).forEach((item) => {
      if (!item) return;
      if (item.kind === "radar" && Array.isArray(item.axes)) {
        this.drawRadarChart(item.canvasId, item.axes);
      } else if (item.kind === "scatter" && Array.isArray(item.points)) {
        this.drawScatterChart(item.canvasId, item.points, item.xLabel, item.yLabel);
      }
    });
  },
  resolveCanvasNode(canvasId, attempt, onReady) {
    if (!canvasId) return;
    wx.createSelectorQuery()
      .in(this)
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const hit = res && res[0];
        if (!hit || !hit.node || !hit.width) {
          if (attempt < 10) {
            setTimeout(() => this.resolveCanvasNode(canvasId, attempt + 1, onReady), 40);
          }
          return;
        }
        const canvas = hit.node;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 1;
        canvas.width = hit.width * dpr;
        canvas.height = hit.height * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        onReady(ctx, hit.width, hit.height, canvas);
      });
  },
  drawRadarChart(canvasId, axes) {
    if (!Array.isArray(axes) || axes.length < 3) return;
    this.resolveCanvasNode(canvasId, 0, (ctx, w, h) => paintRadarChart(ctx, w, h, axes));
  },
  drawScatterChart(canvasId, points, xLabel, yLabel) {
    if (!Array.isArray(points) || points.length < 2) return;
    this.resolveCanvasNode(canvasId, 0, (ctx, w, h) => paintScatterChart(ctx, w, h, points, xLabel, yLabel));
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
