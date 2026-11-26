const bundledSgeClose = require("../data/gold-sge-close");

// 旧工具供存量调用方使用。历史页面使用 historicalGoldRows 单独读取日线。
// 日线只到昨天收盘，报价是今天盘中；不接上的话，同一屏上「最新」和大数字差几块钱，
// 读者会问哪个才对。报价日期比最后一根日线新就接在后面，同一天就用报价替掉那根。

function dayOf(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function withLatestQuote(history, quote) {
  const bars = (Array.isArray(history) ? history : [])
    .filter((item) => item && Number.isFinite(Number(item.close)))
    .map((item) => ({ date: item.date, close: Number(item.close) }));
  const price = Number(quote && quote.price);
  const quoteDay = dayOf(quote && quote.asOf);
  if (!bars.length || !Number.isFinite(price) || price <= 0 || !quoteDay) return bars;
  const lastDay = dayOf(bars[bars.length - 1].date);
  if (!lastDay || quoteDay < lastDay) return bars;
  if (quoteDay === lastDay) bars[bars.length - 1] = { date: quoteDay, close: price };
  else bars.push({ date: quoteDay, close: price });
  return bars;
}

// 近 N 个交易日涨跌：从倒数第 N+1 个点到最后一个点。首页、栏目页、详情页都用这一个算法，
// 同一个「近180日」不会在三个地方出三个数。序列不够长就不给数。
function recentChange(series, steps) {
  const values = (Array.isArray(series) ? series : [])
    .map((item) => Number(item && typeof item === "object" ? item.close : item))
    .filter((value) => Number.isFinite(value));
  if (!(steps > 0) || values.length <= steps) return null;
  const base = values[values.length - 1 - steps];
  if (!base) return null;
  return ((values[values.length - 1] - base) / base) * 100;
}

function calendarDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? value : "";
}

function isDailyClose(row) {
  return Boolean(calendarDay(row?.date)) && Number.isFinite(row.close) && row.close > 0;
}

function sgeSeries(rows, meta) {
  const chinaToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (meta?.symbol !== "Au99.99" || meta.currency !== "CNY/g" || meta.priceType !== "daily-close"
    || !/^https:\/\/(?:www\.)?sge\.com\.cn\/sjzx\/quotation_daily_new$/.test(meta.sourceUrl)
    || meta.completeQueries !== true || meta.interpolated !== false || !Array.isArray(rows)
    || rows.length < 2 || rows.length !== meta.sessions || rows[0]?.date !== meta.firstDate
    || rows[rows.length - 1]?.date !== meta.lastDate || !calendarDay(meta.requestedStart)
    || !calendarDay(meta.requestedEnd) || meta.firstDate < meta.requestedStart || meta.lastDate > meta.requestedEnd
    || meta.lastDate > chinaToday
    || !rows.every((row, index) => isDailyClose(row) && (index === 0 || row.date > rows[index - 1].date))) return null;
  return { rows, source: "上海黄金交易所 Au99.99", sourceUrl: meta.sourceUrl };
}

function historicalGoldSeries(snapshot, kind) {
  const gold = snapshot?.gold || snapshot || {};
  if (kind === "domestic") {
    const bundled = sgeSeries(bundledSgeClose.rows, bundledSgeClose.meta);
    const upstream = sgeSeries(gold.history?.domestic, gold.historyMeta?.domestic);
    if (upstream && (!bundled || gold.historyMeta.domestic.lastDate >= bundledSgeClose.meta.lastDate)) return upstream;
    return bundled || { rows: [], source: "上海黄金交易所 Au99.99" };
  }

  const sourceHistory = Array.isArray(gold.history?.international) ? gold.history.international : [];
  // 报价当日的日线可能还是未完成的盘中读数。没有独立收盘凭据时只收录此前日期。
  const quoteDay = calendarDay(String(gold.quotes?.international?.asOf || "").slice(0, 10));
  const batchDay = calendarDay(String(gold.updatedAt || snapshot?.updatedAt || "").slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = [quoteDay, batchDay, today].filter(Boolean).sort()[0];
  const byDay = new Map();
  for (const row of sourceHistory) {
    if (!isDailyClose(row) || row.date >= cutoff) continue;
    if (!byDay.has(row.date)) byDay.set(row.date, row.close);
    else if (byDay.get(row.date) !== row.close) byDay.set(row.date, null);
  }
  const rows = [...byDay.keys()].sort().filter((date) => byDay.get(date) !== null)
    .map((date) => ({ date, close: byDay.get(date) }));
  return { rows, source: "COMEX 黄金期货", sourceUrl: "https://finance.yahoo.com/quote/GC%3DF/history/" };
}

function historicalGoldRows(snapshot, kind = "international") {
  return historicalGoldSeries(snapshot, kind).rows;
}

function domesticGoldClose(snapshot) {
  const rows = historicalGoldRows(snapshot, "domestic");
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return { price: last.close, asOf: last.date, currency: "CNY/g", changePercent: recentChange(rows, 1) };
}

module.exports = { withLatestQuote, recentChange, historicalGoldRows, historicalGoldSeries, domesticGoldClose };
