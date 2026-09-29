// 小走势图：首页走势卡、美股每行、红利 ETF 卡、黄金指标共用这一套画法；零轴柱首页和港股栏目共用。
// 走势线出成 SVG 图片（<image src="data:...">），不走 canvas：canvas 是原生层，
// 开发者工具里偶尔会画到别的格子上，而且 wx:if 切换后还得重画；图片跟着布局走，不会错位。
// 线一律品牌蓝（蓝白灰主色调），涨跌只看旁边那个红涨绿跌的数字。
// 黄金栏目那张带坐标标签的大图另有 paintGoldLineChart，不走这里。

const LINE_COLOR = "#1d5fd1";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toneOf(value) {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

// 序列太长时等距抽点，保留首尾，画出来的形状不变、图片也不会太大。
function sampleSeries(values, limit = 60) {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => values[Math.round((index / (limit - 1)) * (values.length - 1))]);
}

// SVG 文本只有 ASCII（标签、数字、颜色），按字节直接编码，不依赖 btoa。
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

const fmt = (value) => String(Math.round(value * 10) / 10);

// width/height 用 rpx 数值，和 WXML 里图片的 CSS 尺寸同比例，线宽 3 ≈ 1.5px 不会被拉变形。
function sparklineSvg(values, { width = 300, height = 100, color = LINE_COLOR } = {}) {
  const series = (values || []).filter((value) => Number.isFinite(value));
  if (series.length < 2) return "";
  const low = Math.min(...series);
  const high = Math.max(...series);
  const span = Math.max(high - low, 1e-6);
  const padTop = 8;
  const padBottom = 6;
  const padX = 6;
  const plotH = height - padTop - padBottom;
  const stepX = (width - padX * 2) / (series.length - 1);
  const pts = series.map((value, index) => [padX + index * stepX, padTop + (1 - (value - low) / span) * plotH]);
  let line = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    line += `Q${fmt(pts[i][0])} ${fmt(pts[i][1])} ${fmt((pts[i][0] + pts[i + 1][0]) / 2)} ${fmt((pts[i][1] + pts[i + 1][1]) / 2)}`;
  }
  const end = pts[pts.length - 1];
  line += `L${fmt(end[0])} ${fmt(end[1])}`;
  const area = `${line}L${fmt(end[0])} ${height}L${fmt(pts[0][0])} ${height}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.2"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${area}" fill="url(#f)"/>`
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${fmt(end[0])}" cy="${fmt(end[1])}" r="5" fill="${color}"/>`
    + "</svg>";
  return `data:image/svg+xml;base64,${asciiBase64(svg)}`;
}

// 零轴柱：正数从零轴往上、负数往下，高度按整组最大跨度归一，最矮留 3% 保证看得见。
// 返回的是直接塞进 style 的字符串，WXML 里不用再算。
function zeroAxisBars(values) {
  const maxPos = Math.max(0, ...values);
  const minNeg = Math.min(0, ...values);
  const range = maxPos - minNeg || 1;
  const zero = (-minNeg / range) * 100;
  return {
    zeroStyle: `bottom:${zero.toFixed(1)}%`,
    bars: values.map((value, index) => {
      const height = Math.max(3, (Math.abs(value) / range) * 100);
      const bottom = value >= 0 ? zero : Math.max(0, zero - height);
      return { key: index, tone: toneOf(value), style: `height:${height.toFixed(1)}%;bottom:${bottom.toFixed(1)}%` };
    }),
  };
}

module.exports = { toneOf, sampleSeries, sparklineSvg, zeroAxisBars };
