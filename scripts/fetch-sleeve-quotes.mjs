/**
 * 拉取底仓与对比框架用到的美股 ETF 公开行情（含近60日收盘走势与过去12个月真实已实施派息股息率）。
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SLEEVE_ETFS = [
  { symbol: "VOO", name: "Vanguard 标普500 ETF" },
  { symbol: "JEPQ", name: "JPMorgan 纳指备兑 ETF" },
  { symbol: "SCHD", name: "Schwab 美股红利 ETF" },
  { symbol: "O", name: "Realty Income" },
  { symbol: "SGOV", name: "iShares 短债 ETF" },
];

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AurumSleeve/1.0)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${symbol} HTTP ${response.status}`);
  const payload = await response.json();
  const res0 = payload?.chart?.result?.[0] || {};
  const meta = res0.meta || {};
  const timestamps = Array.isArray(res0.timestamp) ? res0.timestamp : [];
  const rawCloses = res0.indicators?.quote?.[0]?.close || [];
  const bars = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = Number(timestamps[i]);
    const cl = Number(rawCloses[i]);
    if (!Number.isFinite(ts) || !Number.isFinite(cl) || cl <= 0) continue;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    bars.push({ date, close: Math.round(cl * 100) / 100 });
  }
  const history = bars.slice(-60);
  const price = Number(meta.regularMarketPrice);
  const prevBar = bars.length >= 2 ? bars[bars.length - 2].close : null;
  const previous = Number.isFinite(prevBar) && prevBar > 0
    ? prevBar
    : Number(meta.regularMarketPreviousClose ?? meta.previousClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol} 缺少可核验价格`);
  const asOfMs = Number.isFinite(Number(meta.regularMarketTime))
    ? Number(meta.regularMarketTime) * 1000
    : Date.now();
  const asOf = new Date(asOfMs).toISOString();

  const divEvents = res0.events?.dividends ? Object.values(res0.events.dividends) : [];
  const cutoffSec = asOfMs / 1000 - 366 * 86400;
  const annualDiv = divEvents
    .filter((d) => d && Number(d.date) >= cutoffSec && Number(d.amount) > 0)
    .reduce((sum, d) => sum + Number(d.amount), 0);
  const dividendYield = annualDiv > 0 ? Number(((annualDiv / price) * 100).toFixed(2)) : null;

  return {
    symbol,
    price: Math.round(price * 100) / 100,
    previousClose: Number.isFinite(previous) ? Math.round(previous * 100) / 100 : null,
    changePercent: Number.isFinite(previous) && previous > 0 ? Number(((price / previous - 1) * 100).toFixed(2)) : null,
    dividendYield,
    annualDividend: annualDiv > 0 ? Number(annualDiv.toFixed(4)) : null,
    history,
    currency: meta.currency || "USD",
    asOf,
    source: "Yahoo Finance",
  };
}

export async function fetchSleeveQuotes() {
  const quotes = [];
  const errors = [];
  for (const item of SLEEVE_ETFS) {
    try {
      const quote = await fetchYahooQuote(item.symbol);
      quotes.push({ ...quote, name: item.name });
    } catch (error) {
      errors.push(`${item.symbol}: ${error.message}`);
    }
  }
  return {
    updatedAt: quotes[0]?.asOf || new Date().toISOString(),
    source: "Yahoo Finance",
    quotes,
    errors,
  };
}

export async function writeSleeveQuotes(payload, outputPath = path.join(root, "data", "sleeve-quotes.json")) {
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const payload = await fetchSleeveQuotes();
  await writeSleeveQuotes(payload);
  console.log(
    `底仓 ETF 行情 ${payload.quotes.length}/${SLEEVE_ETFS.length}：`
    + payload.quotes.map((item) => `${item.symbol} $${item.price.toFixed(2)}${item.dividendYield ? ` (息${item.dividendYield}%)` : ""} [${item.history.length}日]`).join(" · ")
    + (payload.errors.length ? `；失败 ${payload.errors.join("；")}` : ""),
  );
}
