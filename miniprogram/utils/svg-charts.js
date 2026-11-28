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

module.exports = {
  PALETTE,
  donutSvg,
  gaugeSvg,
  groupedBarsSvg,
  zoneSparklineSvg,
};
