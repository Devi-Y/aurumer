import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  appendUSSnapshot,
  readUSSnapshotHistory,
  writeStrategyAudit,
} from "../lib/us-snapshot-history.mjs";

const livePath = resolve("data/live-snapshot.json");
const historyPath = resolve("data/us-signal-snapshots.json");
const strategyAuditPath = resolve("data/strategy-audit.json");
const live = JSON.parse(await readFile(livePath, "utf8"));
const symbols = (live.us?.stocks || []).map((stock) => stock.symbol);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "aurumer-daily-snapshot/1.0" },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchQuote(symbol) {
  const result = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d&events=div%2Csplits`,
  );
  const chart = result.chart?.result?.[0];
  if (!chart) throw new Error(`Yahoo 没有返回 ${symbol}`);
  const timestamps = chart.timestamp || [];
  const quote = chart.indicators?.quote?.[0] || {};
  const rows = timestamps
    .map((time, index) => ({
      time,
      close: quote.close?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      volume: quote.volume?.[index],
    }))
    .filter((row) => Number.isFinite(row.close));
  const price = Number(chart.meta?.regularMarketPrice || rows.at(-1)?.close);
  const previous = Number(
    chart.meta?.regularMarketPreviousClose || rows.at(-2)?.close,
  );
  const recentVolumes = rows.map((row) => row.volume).filter(Number.isFinite);
  const averageVolume = recentVolumes.length > 1
    ? recentVolumes.slice(0, -1).reduce((sum, value) => sum + value, 0) /
      (recentVolumes.length - 1)
    : null;
  const volumeRatio = averageVolume > 0
    ? recentVolumes.at(-1) / averageVolume
    : null;
  const weekStart = rows.at(-6)?.close;
  const changePercent = previous > 0 ? ((price - previous) / previous) * 100 : null;
  const weeklyChange = weekStart > 0 ? ((price - weekStart) / weekStart) * 100 : null;
  const heatScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (volumeRatio || 1) * 35 +
          Math.abs(changePercent || 0) * 6 +
          Math.abs(weeklyChange || 0) * 2,
      ),
    ),
  );
  const recent = rows.slice(-20);
  const trueRanges = recent.slice(1).map((row, index) => {
    const previousClose = recent[index].close;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    );
  }).filter(Number.isFinite);
  const atr = trueRanges.length
    ? trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length
    : null;
  const support = recent.length
    ? Math.min(...recent.map((row) => row.low).filter(Number.isFinite))
    : null;
  const technicalPlan = Number.isFinite(atr) && Number.isFinite(support)
    ? {
        atr: Number(atr.toFixed(4)),
        buy: Number(Math.min(price - atr * 0.55, support + atr * 0.35).toFixed(4)),
        stop: Number((support - atr * 0.8).toFixed(4)),
        tp: [
          Number((price + atr * 2).toFixed(4)),
          Number((price + atr * 3.2).toFixed(4)),
        ],
      }
    : null;
  return {
    price: Number(price.toFixed(4)),
    changePercent: Number((changePercent || 0).toFixed(2)),
    weeklyChange: Number((weeklyChange || 0).toFixed(2)),
    volumeRatio: volumeRatio === null ? null : Number(volumeRatio.toFixed(2)),
    heatScore,
    technicalPlan,
    asOf: chart.meta?.regularMarketTime
      ? new Date(chart.meta.regularMarketTime * 1000).toISOString()
      : null,
    history: rows.slice(-60).map((row) => Number(row.close.toFixed(4))),
  };
}

const settled = await Promise.allSettled(symbols.map(fetchQuote));
const quotes = new Map();
settled.forEach((result, index) => {
  if (result.status === "fulfilled") quotes.set(symbols[index], result.value);
});
if (quotes.size < Math.max(25, symbols.length - 5)) {
  throw new Error(`Yahoo 可用股票不足：${quotes.size}/${symbols.length}`);
}

const stocks = (live.us.stocks || []).map((stock) => ({
  ...stock,
  ...(quotes.get(stock.symbol) || {}),
  source: quotes.has(stock.symbol) ? "Yahoo Finance" : stock.source,
}));
const payload = {
  ...live,
  updatedAt: new Date().toISOString(),
  us: {
    ...live.us,
    stocks,
    fundamentals: live.us.fundamentals,
  },
};
const history = await appendUSSnapshot(payload, historyPath);
payload.strategyHealth = {
  ...live.strategyHealth,
  us: {
    ...live.strategyHealth?.us,
    ...history.health,
  },
};
payload.us.strategyBacktest = history.health.backtest;
await writeStrategyAudit(strategyAuditPath, {
  history: history.history,
  hkBacktest: live.hk?.backtest,
  generatedAt: payload.updatedAt,
});
payload.sources = (live.sources || []).map((source) =>
  source.id === "yahoo" ? { ...source, ok: true, error: null } : source,
);
await writeFile(livePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      status: "captured",
      signalDate: history.snapshot.signalDate,
      quotes: quotes.size,
      snapshotDays: history.health.snapshotDays,
      backtestStatus: history.health.status,
    },
    null,
    2,
  ),
);
