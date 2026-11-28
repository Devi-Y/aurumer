"use strict";

// 高级金融矢量图表引擎：纯 ASCII 几何 SVG + 自包含 Base64 Data-URI。
// 零原生 Canvas 层级穿透问题、零中文字体缺失风险（文字全部交由外层 WXML 渲染），
// 在 320px 小屏手机、标准手机、折叠屏、iPad 平板与电脑端微信上均保持 100% 锐利矢量缩放。

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const PALETTE = [
  "#1d5fd1", // 品牌蓝
  "#0f9f6e", // 翡翠绿
  "#d97706", // 琥珀金
  "#6366f1", // 靛青紫
  "#ec4899", // 珊瑚粉
  "#94a3b8", // 岩石灰（其余项）
];

function asciiBase64(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 3) {
    const n = (text.charCodeAt(i) << 16) | ((text.charCodeAt(i + 1) || 0) << 8) | (text.charCodeAt(i + 2) || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < text.length ? B64[(n >> 6) & 63] : "=")
      + (i + 2 < text.length ? B64[n & 63] : "=");
  }
  return out;
}

const f1 = (v) => String(Math.round(Number(v) * 10) / 10);
const f2 = (v) => String(Math.round(Number(v) * 100) / 100);

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${asciiBase64(svg)}`;
}

/**
 * 1. 环形饼图 / 扇形占比图 (donutSvg)
 * 对标富途明星机构持仓饼图、捷利交易宝首日涨跌扇形图、息记资产结构环图。
 */
function donutSvg(segments, { size = 180, strokeWidth = 28 } = {}) {
  const valid = (Array.isArray(segments) ? segments : [])
    .map((seg, idx) => ({
      value: Number(seg && seg.value),
      color: (seg && seg.color) || PALETTE[idx % PALETTE.length],
    }))
    .filter((seg) => Number.isFinite(seg.value) && seg.value > 0);
  if (!valid.length) return "";
  const total = valid.reduce((sum, seg) => sum + seg.value, 0);
  if (!(total > 0)) return "";

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth - 8) / 2;
  const c = 2 * Math.PI * r;
  const gap = valid.length > 1 ? Math.min(3.2, c * 0.01) : 0;

  let offset = 0;
  const rings = valid.map((seg) => {
    const rawLen = (seg.value / total) * c;
    const drawLen = Math.max(1, rawLen - gap);
    const dashArray = `${f2(drawLen)} ${f2(Math.max(0, c - drawLen))}`;
    const dashOffset = f2(-offset);
    offset += rawLen;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="none" stroke="${seg.color}" stroke-width="${f1(strokeWidth)}" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${f1(cx)} ${f1(cy)})"/>`;
  }).join("");

  const innerR = Math.max(8, r - strokeWidth / 2 - 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="none" stroke="#eef2f7" stroke-width="${f1(strokeWidth)}"/>`
    + rings
    + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(innerR)}" fill="#ffffff"/>`
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 2. 半圆扇形冷热仪表盘 / 分位表盘 (gaugeSvg)
 * 对标息记股息率冷热温度计、美股/黄金高低分位扇形表盘。
 * mode = "yield" 时右边高息为翠绿、左边低息为琥珀；默认左边低位翠绿、右边高位琥珀。
 */
function gaugeSvg(percent, { width = 260, height = 142, mode = "price" } = {}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(Number(percent)) ? Number(percent) : 50));
  const cx = width / 2;
  const cy = height - 18;
  const r = Math.min(cx - 18, cy - 16);
  const sw = 18;

  const polar = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arc = (startDeg, endDeg, color) => {
    const [x1, y1] = polar(startDeg);
    const [x2, y2] = polar(endDeg);
    return `<path d="M${f1(x1)} ${f1(y1)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(x2)} ${f1(y2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt"/>`;
  };

  const colors = mode === "yield"
    ? ["#d97706", "#1d5fd1", "#159960"]
    : ["#159960", "#1d5fd1", "#d97706"];

  // 半圆从 180°（左端）顺时针到 360°（右端），中间留两道白缝增强仪表刻度感。
  const bgTrack = arc(180, 360, "#eef2f7");
  const seg1 = arc(180, 238, colors[0]);
  const seg2 = arc(241, 299, colors[1]);
  const seg3 = arc(302, 360, colors[2]);

  const needleDeg = 180 + (p / 100) * 180;
  const needleRad = (needleDeg * Math.PI) / 180;
  const nx = cx + (r - 12) * Math.cos(needleRad);
  const ny = cy + (r - 12) * Math.sin(needleRad);
  const baseRad1 = needleRad + Math.PI / 2;
  const baseRad2 = needleRad - Math.PI / 2;
  const b1x = cx + 4.5 * Math.cos(baseRad1);
  const b1y = cy + 4.5 * Math.sin(baseRad1);
  const b2x = cx + 4.5 * Math.cos(baseRad2);
  const b2y = cy + 4.5 * Math.sin(baseRad2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + bgTrack
    + seg1 + seg2 + seg3
    + `<polygon points="${f1(b1x)},${f1(b1y)} ${f1(nx)},${f1(ny)} ${f1(b2x)},${f1(b2y)}" fill="#182235"/>`
    + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="8" fill="#182235"/>`
    + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="3.5" fill="#ffffff"/>`
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 3. 双色并排对比柱状走势图 (groupedBarsSvg)
 * 对标东方财富 F10 / 富途美股财报：同一坐标系并排展示「营收 vs 净利润」多年趋势（支持负值零轴）。
 */
function groupedBarsSvg(groups, { width = 340, height = 148, colorA = "#1d5fd1", colorB = "#0f9f6e", negColorB = "#dc4c3e" } = {}) {
  const valid = (Array.isArray(groups) ? groups : []).filter((g) => g && (Number.isFinite(g.a) || Number.isFinite(g.b)));
  if (valid.length < 2) return "";
  const allVals = valid.flatMap((g) => [Number(g.a) || 0, Number(g.b) || 0]);
  const maxPos = Math.max(1e-6, ...allVals, 0);
  const minNeg = Math.min(0, ...allVals);
  const span = maxPos - minNeg || 1;

  const padX = 14;
  const padTop = 12;
  const padBottom = 10;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const zeroY = padTop + (maxPos / span) * plotH;
  const slotW = plotW / valid.length;
  const barW = Math.min(22, Math.max(8, slotW * 0.28));
  const gap = Math.max(3, barW * 0.22);

  const grid = [0.25, 0.65].map((f) => {
    const gy = padTop + plotH * f;
    return `<line x1="${padX}" y1="${f1(gy)}" x2="${width - padX}" y2="${f1(gy)}" stroke="#edf1f7" stroke-width="1"/>`;
  }).join("");
  const zeroLine = `<line x1="${padX}" y1="${f1(zeroY)}" x2="${width - padX}" y2="${f1(zeroY)}" stroke="#cbd5e1" stroke-width="1.2"/>`;

  const rectFor = (val, x, posColor, negColor) => {
    if (!Number.isFinite(val)) return "";
    const rawH = (Math.abs(val) / span) * plotH;
    const h = Math.max(3, rawH);
    const y = val >= 0 ? Math.max(padTop, zeroY - h) : zeroY;
    const fill = val < 0 ? negColor : posColor;
    return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(barW)}" height="${f1(h)}" rx="3.5" fill="${fill}"/>`;
  };

  const bars = valid.map((g, idx) => {
    const center = padX + slotW * (idx + 0.5);
    const xA = center - barW - gap / 2;
    const xB = center + gap / 2;
    return rectFor(Number(g.a), xA, colorA, colorA) + rectFor(Number(g.b), xB, colorB, negColorB);
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + grid + zeroLine + bars
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 4. 带高低参考区间色带与虚线的专业走势图 (zoneSparklineSvg)
 * 在美股 / A股 / 黄金首屏走势线上直接叠加参考低位绿虚线、参考高位橙虚线与浅色带，一眼识高低。
 */
function zoneSparklineSvg(values, { width = 340, height = 128, buyPrice = null, sellPrice = null } = {}) {
  const series = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (series.length < 2) return "";
  const buy = Number.isFinite(Number(buyPrice)) && Number(buyPrice) > 0 ? Number(buyPrice) : null;
  const sell = Number.isFinite(Number(sellPrice)) && Number(sellPrice) > 0 ? Number(sellPrice) : null;

  const refPoints = [...series];
  if (buy !== null) refPoints.push(buy);
  if (sell !== null) refPoints.push(sell);
  const low = Math.min(...refPoints);
  const high = Math.max(...refPoints);
  const span = Math.max(high - low, 1e-6);

  const padTop = 10;
  const padBottom = 10;
  const padX = 8;
  const plotH = height - padTop - padBottom;
  const stepX = (width - padX * 2) / (series.length - 1);
  const yAt = (v) => padTop + (1 - (v - low) / span) * plotH;

  const strokeColor = series[series.length - 1] > series[0]
    ? "#dc4c3e"
    : (series[series.length - 1] < series[0] ? "#159960" : "#1d5fd1");

  const pts = series.map((v, i) => [padX + i * stepX, yAt(v)]);
  let line = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    line += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1((pts[i][0] + pts[i + 1][0]) / 2)} ${f1((pts[i][1] + pts[i + 1][1]) / 2)}`;
  }
  const end = pts[pts.length - 1];
  line += `L${f1(end[0])} ${f1(end[1])}`;
  const area = `${line}L${f1(end[0])} ${height}L${f1(pts[0][0])} ${height}Z`;

  let zoneBand = "";
  if (buy !== null && sell !== null && sell > buy) {
    const yTop = yAt(sell);
    const yBot = yAt(buy);
    zoneBand += `<rect x="${padX}" y="${f1(yTop)}" width="${width - padX * 2}" height="${f1(Math.max(2, yBot - yTop))}" fill="#1d5fd1" fill-opacity="0.045" rx="3"/>`;
  }
  if (buy !== null) {
    const yb = yAt(buy);
    zoneBand += `<line x1="${padX}" y1="${f1(yb)}" x2="${width - padX}" y2="${f1(yb)}" stroke="#159960" stroke-width="1.4" stroke-dasharray="4 3" stroke-opacity="0.72"/>`;
  }
  if (sell !== null) {
    const ys = yAt(sell);
    zoneBand += `<line x1="${padX}" y1="${f1(ys)}" x2="${width - padX}" y2="${f1(ys)}" stroke="#d97706" stroke-width="1.4" stroke-dasharray="4 3" stroke-opacity="0.72"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<defs><linearGradient id="zf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${strokeColor}" stop-opacity="0.17"/><stop offset="0.75" stop-color="${strokeColor}" stop-opacity="0.03"/><stop offset="1" stop-color="${strokeColor}" stop-opacity="0"/></linearGradient></defs>`
    + zoneBand
    + `<path d="${area}" fill="url(#zf)"/>`
    + `<path d="${line}" fill="none" stroke="${strokeColor}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${f1(end[0])}" cy="${f1(end[1])}" r="8" fill="${strokeColor}" fill-opacity="0.16"/>`
    + `<circle cx="${f1(end[0])}" cy="${f1(end[1])}" r="4.2" fill="${strokeColor}"/>`
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 5. 搜索栏矢量放大镜图标 (searchIconSvg)
 * 替换原生字体偏基线的字符，保证各系统渲染锐利对齐。
 */
function searchIconSvg(color = "#1d5fd1") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.8" cy="10.8" r="6.8"/><line x1="15.9" y1="15.9" x2="20.6" y2="20.6"/></svg>`;
  return toDataUri(svg);
}

/**
 * 6. 首页三地代表卡片全宽极简走势曲线 (cleanSparkSvg)
 * 极窄左右留白、统一金融蓝渐变，避免与单日涨跌红绿胶囊产生撞色冲突。
 */
function cleanSparkSvg(values, { width = 196, height = 56, color = "#2563eb" } = {}) {
  const series = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (series.length < 2) return "";
  const low = Math.min(...series);
  const high = Math.max(...series);
  const span = Math.max(high - low, 1e-6);
  const padX = 4;
  const padTop = 7;
  const padBottom = 6;
  const plotH = height - padTop - padBottom;
  const stepX = (width - padX * 2) / (series.length - 1);
  const pts = series.map((v, i) => [padX + i * stepX, padTop + (1 - (v - low) / span) * plotH]);
  let line = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    line += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1((pts[i][0] + pts[i + 1][0]) / 2)} ${f1((pts[i][1] + pts[i + 1][1]) / 2)}`;
  }
  const end = pts[pts.length - 1];
  line += `L${f1(end[0])} ${f1(end[1])}`;
  const area = `${line}L${f1(end[0])} ${height}L${f1(pts[0][0])} ${height}Z`;
  const baseLine = `<line x1="${padX}" y1="${f1(pts[0][1])}" x2="${width - padX}" y2="${f1(pts[0][1])}" stroke="#dbe4f0" stroke-width="1" stroke-dasharray="3 3"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<defs><linearGradient id="cs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.20"/><stop offset="0.85" stop-color="${color}" stop-opacity="0.02"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + baseLine
    + `<path d="${area}" fill="url(#cs)"/>`
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${f1(end[0])}" cy="${f1(end[1])}" r="6" fill="${color}" fill-opacity="0.16"/>`
    + `<circle cx="${f1(end[0])}" cy="${f1(end[1])}" r="3.2" fill="${color}"/>`
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 7. 首页港股新股卡片等高矢量进度与锁仓条 (ipoTrackSvg)
 * 让未上市无日线的新股卡片与美股、A股卡片拥有 100% 对称的视觉图形高度。
 */
function ipoTrackSvg({ stepIndex = 0, lockPercent = 28, width = 196, height = 56 } = {}) {
  const step = Math.max(0, Math.min(3, Number(stepIndex) || 0));
  const lock = Math.max(12, Math.min(92, Number(lockPercent) || 28));
  const padX = 12;
  const spanW = width - padX * 2;
  const yTop = 19;
  const xs = [0, 1, 2, 3].map((i) => padX + (spanW * i) / 3);
  const activeX = xs[step];
  const nodes = xs.map((x, idx) => {
    if (idx < step) {
      return `<circle cx="${f1(x)}" cy="${yTop}" r="4.2" fill="#2563eb"/>`;
    }
    if (idx === step) {
      return `<circle cx="${f1(x)}" cy="${yTop}" r="8.5" fill="#2563eb" fill-opacity="0.16"/><circle cx="${f1(x)}" cy="${yTop}" r="4.8" fill="#2563eb"/>`;
    }
    return `<circle cx="${f1(x)}" cy="${yTop}" r="3.8" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>`;
  }).join("");
  const yBar = 40;
  const fillW = (spanW * lock) / 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<line x1="${f1(xs[0])}" y1="${yTop}" x2="${f1(xs[3])}" y2="${yTop}" stroke="#e2e8f0" stroke-width="2.6" stroke-linecap="round"/>`
    + (step > 0 ? `<line x1="${f1(xs[0])}" y1="${yTop}" x2="${f1(activeX)}" y2="${yTop}" stroke="#2563eb" stroke-width="2.6" stroke-linecap="round"/>` : "")
    + nodes
    + `<rect x="${padX}" y="${yBar}" width="${f1(spanW)}" height="6.5" rx="3.25" fill="#e8eef7"/>`
    + `<rect x="${padX}" y="${yBar}" width="${f1(fillW)}" height="6.5" rx="3.25" fill="#0f9f6e"/>`
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 8. 五维基本面多边形雷达图 (pentagonSvg)
 * 对标富途牛牛、东方财富、IBKR 基本面五维蛛网评分图，纯几何五边形无文字乱码。
 */
function pentagonSvg(scores, { size = 196, color = "#1d5fd1" } = {}) {
  const vals = (Array.isArray(scores) ? scores : []).slice(0, 5).map((v) => Math.max(12, Math.min(100, Number(v) || 50)));
  if (vals.length < 5) return "";
  const cx = size / 2;
  const cy = size / 2 + 4;
  const maxR = size * 0.41;
  const ptAt = (idx, ratio) => {
    const rad = ((-90 + idx * 72) * Math.PI) / 180;
    return [cx + maxR * ratio * Math.cos(rad), cy + maxR * ratio * Math.sin(rad)];
  };
  const polyPoints = (ratio) => [0, 1, 2, 3, 4].map((i) => {
    const [x, y] = ptAt(i, ratio);
    return `${f1(x)},${f1(y)}`;
  }).join(" ");

  const rings = [0.33, 0.66, 1].map((r, idx) => (
    `<polygon points="${polyPoints(r)}" fill="${idx === 2 ? "#f8fafd" : "none"}" stroke="#dde5f0" stroke-width="${idx === 2 ? "1.4" : "1"}"/>`
  )).join("");
  const spokes = [0, 1, 2, 3, 4].map((i) => {
    const [x, y] = ptAt(i, 1);
    return `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(x)}" y2="${f1(y)}" stroke="#e2e8f0" stroke-width="1"/>`;
  }).join("");

  const dataPts = vals.map((v, i) => ptAt(i, v / 100));
  const dataPoly = dataPts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  const dots = dataPts.map(([x, y]) => (
    `<circle cx="${f1(x)}" cy="${f1(y)}" r="4" fill="#ffffff" stroke="${color}" stroke-width="2.4"/>`
  )).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + `<polygon points="${polyPoints(1)}" fill="#f8fafd" stroke="#dce4f0" stroke-width="1.3"/>`
    + `<polygon points="${polyPoints(0.66)}" fill="none" stroke="#e5ebf4" stroke-width="1"/>`
    + `<polygon points="${polyPoints(0.33)}" fill="none" stroke="#edf1f7" stroke-width="1"/>`
    + spokes
    + `<polygon points="${dataPoly}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2.3" stroke-linejoin="round"/>`
    + dots
    + "</svg>";
  return toDataUri(svg);
}

/**
 * 9. 息记同款 12 个月派息热度柱状分布图 (monthDensitySvg)
 * 直观呈现全年各月除息密集度，当前选中月份高亮为品牌蓝。
 */
function monthDensitySvg(counts12, { width = 340, height = 84, activeMonth = 0 } = {}) {
  const counts = Array.from({ length: 12 }, (_, i) => Math.max(0, Number(counts12 && counts12[i]) || 0));
  const maxC = Math.max(1, ...counts);
  const padX = 8;
  const padTop = 8;
  const padBottom = 6;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const slotW = plotW / 12;
  const barW = Math.min(18, slotW * 0.62);

  const bars = counts.map((c, idx) => {
    const m = idx + 1;
    const isSel = m === Number(activeMonth);
    const h = c > 0 ? Math.max(8, (c / maxC) * plotH) : 4;
    const x = padX + slotW * idx + (slotW - barW) / 2;
    const y = padTop + plotH - h;
    const fill = isSel ? "#1d5fd1" : (c >= 4 ? "#0f9f6e" : (c > 0 ? "#7da6eb" : "#e5eaf2"));
    return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(barW)}" height="${f1(h)}" rx="3.5" fill="${fill}"/>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<line x1="${padX}" y1="${padTop + plotH}" x2="${width - padX}" y2="${padTop + plotH}" stroke="#e2e8f0" stroke-width="1"/>`
    + bars
    + "</svg>";
  return toDataUri(svg);
}

module.exports = {
  PALETTE,
  donutSvg,
  gaugeSvg,
  groupedBarsSvg,
  zoneSparklineSvg,
  searchIconSvg,
  cleanSparkSvg,
  ipoTrackSvg,
  pentagonSvg,
  monthDensitySvg,
};
