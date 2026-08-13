/**
 * 拉取底仓框架用到的 ETF 公开行情。失败时保持空白，不补虚拟价格。
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AurumSleeve/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${symbol} HTTP ${response.status}`);
  const payload = await response.json();
  const meta = payload?.chart?.result?.[0]?.meta || {};
  const price = Number(meta.regularMarketPrice);
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose);
  if (!Number.isFinite(price)) throw new Error(`${symbol} 缺少可核验价格`);
  const asOf = Number.isFinite(Number(meta.regularMarketTime))
    ? new Date(Number(meta.regularMarketTime) * 1000).toISOString()
    : new Date().toISOString();
  return {
    symbol,
    price,
    previousClose: Number.isFinite(previous) ? previous : null,
    changePercent: Number.isFinite(previous) && previous > 0 ? (price / previous - 1) * 100 : null,
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
    + payload.quotes.map((item) => `${item.symbol} $${item.price.toFixed(2)}`).join(" · ")
    + (payload.errors.length ? `；失败 ${payload.errors.join("；")}` : ""),
  );
}
