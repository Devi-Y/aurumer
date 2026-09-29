// 金价折线 = 快照里的日线收盘 + 最新一笔报价。
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

module.exports = { withLatestQuote, recentChange };
