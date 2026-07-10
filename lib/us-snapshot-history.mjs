import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_HISTORY_LIMIT = 420;
const DEFAULT_HOLDING_DAYS = [5, 20];
const DEFAULT_TRANSACTION_COST_BPS = 10;
const DEFAULT_MIN_TRADING_DAYS = 60;

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function signalDate(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function qualitySnapshot(fundamental) {
  if (!fundamental) {
    return {
      liquidAssets: null,
      netIncome: null,
      revenueGrowth: null,
      profitMargin: null,
      qualityCriteria: null,
      qualityMatchCount: 0,
      qualityEligible: false,
    };
  }
  return {
    liquidAssets: finite(fundamental.liquidAssets),
    netIncome: finite(fundamental.netIncome),
    revenueGrowth: finite(fundamental.revenueGrowth),
    profitMargin: finite(fundamental.profitMargin),
    qualityCriteria: fundamental.qualityCriteria || null,
    qualityMatchCount: Number(fundamental.qualityMatchCount || 0),
    qualityEligible: Boolean(
      fundamental.qualityEligible && fundamental.qualityMatchCount >= 2,
    ),
  };
}

export function buildUSSignalSnapshot(payload, capturedAt = new Date()) {
  const quotes = new Map(
    (payload.us?.stocks || []).map((stock) => [stock.symbol, stock]),
  );
  const fundamentals = new Map(
    (payload.us?.fundamentals || []).map((fundamental) => [
      fundamental.symbol,
      fundamental,
    ]),
  );
  const eligible = (payload.us?.stocks || [])
    .map((stock) => ({ stock, fundamental: fundamentals.get(stock.symbol) }))
    .filter(
      ({ fundamental }) =>
        fundamental?.qualityEligible && fundamental.qualityMatchCount >= 2,
    )
    .sort((left, right) =>
      Number(right.stock.heatScore || 0) - Number(left.stock.heatScore || 0),
    );
  const selectedRanks = new Map(
    eligible.slice(0, 10).map(({ stock }, index) => [stock.symbol, index + 1]),
  );
  const stocks = [...quotes.values()].map((stock) => {
    const fundamental = fundamentals.get(stock.symbol);
    const rank = selectedRanks.get(stock.symbol) || null;
    return {
      symbol: stock.symbol,
      price: finite(stock.price),
      asOf: stock.asOf || null,
      heatScore: finite(stock.heatScore),
      heatRank: rank,
      volumeRatio: finite(stock.volumeRatio),
      changePercent: finite(stock.changePercent),
      weeklyChange: finite(stock.weeklyChange),
    financial: qualitySnapshot(fundamental),
      signal: {
        selected: Boolean(rank),
        rank,
        reason: rank
          ? "通过财务三选二并进入热度前十"
          : fundamental?.qualityEligible && fundamental.qualityMatchCount >= 2
            ? "通过财务门槛但未进入热度前十"
            : "未通过财务三选二门槛",
      },
    };
  });
  for (const stock of stocks) {
    stock.financial.snapshotAsOf = payload.updatedAt || null;
  }
  return {
    signalDate: signalDate(capturedAt),
    capturedAt: new Date(capturedAt).toISOString(),
    universeSize: stocks.length,
    selectedCount: selectedRanks.size,
    stocks,
  };
}

function emptyStore() {
  return { version: 1, updatedAt: null, days: [], backtest: null };
}

export async function readUSSnapshotHistory(filePath) {
  try {
    await access(filePath);
  } catch {
    return emptyStore();
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      ...emptyStore(),
      ...parsed,
      days: Array.isArray(parsed.days) ? parsed.days : [],
    };
  } catch {
    return emptyStore();
  }
}

function summarize(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { average: null, median: null, minimum: null, maximum: null };
  }
  const ordered = [...finiteValues].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return {
    average: round(
      finiteValues.reduce((sum, value) => sum + value, 0) /
        finiteValues.length,
      3,
    ),
    median: round(
      ordered.length % 2
        ? ordered[middle]
        : (ordered[middle - 1] + ordered[middle]) / 2,
      3,
    ),
    minimum: round(ordered[0], 3),
    maximum: round(ordered.at(-1), 3),
  };
}

function evaluateHorizon(days, horizon, transactionCostBps) {
  const events = [];
  for (let index = 0; index + horizon < days.length; index += 1) {
    const day = days[index];
    const futureDay = days[index + horizon];
    const futurePrices = new Map(
      futureDay.stocks
        .filter((stock) => Number.isFinite(stock.price))
        .map((stock) => [stock.symbol, stock.price]),
    );
    const pathBySymbol = new Map();
    for (let offset = 1; offset <= horizon; offset += 1) {
      const futureStocks = days[index + offset].stocks;
      for (const stock of futureStocks) {
        if (!Number.isFinite(stock.price)) continue;
        const path = pathBySymbol.get(stock.symbol) || [];
        path.push(stock.price);
        pathBySymbol.set(stock.symbol, path);
      }
    }
    for (const stock of day.stocks) {
      if (!stock.signal?.selected || !Number.isFinite(stock.price)) continue;
      const exit = futurePrices.get(stock.symbol);
      if (!Number.isFinite(exit)) continue;
      const path = pathBySymbol.get(stock.symbol) || [];
      const lowest = Math.min(stock.price, ...path);
      const grossReturn = ((exit - stock.price) / stock.price) * 100;
      const netReturn = grossReturn - (transactionCostBps * 2) / 100;
      events.push({
        signalDate: day.signalDate,
        symbol: stock.symbol,
        entry: round(stock.price, 3),
        exit: round(exit, 3),
        grossReturn: round(grossReturn, 3),
        netReturn: round(netReturn, 3),
        maxDrawdown: round(((lowest - stock.price) / stock.price) * 100, 3),
      });
    }
  }
  const returns = events.map((event) => event.netReturn);
  const drawdowns = events.map((event) => event.maxDrawdown);
  const returnSummary = summarize(returns);
  const drawdownSummary = summarize(drawdowns);
  return {
    horizon,
    sampleCount: events.length,
    winRate: returns.length
      ? round((returns.filter((value) => value > 0).length / returns.length) * 100, 2)
      : null,
    return: returnSummary,
    drawdown: drawdownSummary,
    transactionCostBps,
    examples: events.slice(-20),
  };
}

export function evaluateUSSnapshotHistory(
  days,
  options = {},
) {
  const holdingDays = options.holdingDays || DEFAULT_HOLDING_DAYS;
  const transactionCostBps =
    options.transactionCostBps ?? DEFAULT_TRANSACTION_COST_BPS;
  const minimumTradingDays =
    options.minimumTradingDays ?? DEFAULT_MIN_TRADING_DAYS;
  const orderedDays = [...days]
    .filter((day) => day?.signalDate && Array.isArray(day.stocks))
    .sort((left, right) => left.signalDate.localeCompare(right.signalDate));
  const horizons = Object.fromEntries(
    holdingDays.map((horizon) => [
      String(horizon),
      evaluateHorizon(orderedDays, horizon, transactionCostBps),
    ]),
  );
  const primary = horizons[String(holdingDays[0])];
  const enoughHistory = orderedDays.length >= minimumTradingDays;
  const enoughSignals = (primary?.sampleCount || 0) >= 100;
  const releaseReady = Boolean(
    enoughHistory &&
      enoughSignals &&
      (primary?.winRate || 0) >= 55 &&
      (primary?.return?.average || 0) > 0,
  );
  return {
    status: releaseReady
      ? "candidate_requires_review"
      : enoughHistory
        ? "enough_history_not_validated"
        : "insufficient_history",
    releaseReady,
    tradingDays: orderedDays.length,
    firstSignalDate: orderedDays[0]?.signalDate || null,
    lastSignalDate: orderedDays.at(-1)?.signalDate || null,
    minimumTradingDays,
    holdingDays,
    transactionCostBps,
    horizons,
    methodology:
      "每个信号日只使用当日已保存的财务、热度与价格字段；使用未来交易日价格计算持有期收益、胜率和路径最大回撤，并双边扣除交易成本。样本不足时不发布策略结论。",
  };
}

export function strategyHealthFromUSHistory(history) {
  const backtest =
    history.backtest || evaluateUSSnapshotHistory(history.days || []);
  const tradingDays = history.days?.length || 0;
  return {
    // 即使统计上出现候选信号，也要经过人工复核后才允许改变前台策略状态。
    releaseReady: false,
    candidateReady: Boolean(backtest.releaseReady),
    status: backtest.status,
    note: `已保存 ${tradingDays} 个交易日快照；至少需要 ${backtest.minimumTradingDays} 个交易日，完成无前视回测后才评估收益、回撤、胜率和交易成本。当前仍不承诺盈利。`,
    snapshotDays: tradingDays,
    firstSignalDate: backtest.firstSignalDate,
    lastSignalDate: backtest.lastSignalDate,
    backtest,
  };
}

export async function appendUSSnapshot(
  payload,
  filePath,
  options = {},
) {
  const existing = await readUSSnapshotHistory(filePath);
  const snapshot = buildUSSignalSnapshot(payload, options.capturedAt);
  const days = [
    ...existing.days.filter((day) => day.signalDate !== snapshot.signalDate),
    snapshot,
  ]
    .sort((left, right) => left.signalDate.localeCompare(right.signalDate))
    .slice(-(options.historyLimit || DEFAULT_HISTORY_LIMIT));
  const backtest = evaluateUSSnapshotHistory(days, options);
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    days,
    backtest,
  };
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    history: next,
    health: strategyHealthFromUSHistory(next),
    snapshot,
  };
}

export { DEFAULT_MIN_TRADING_DAYS, DEFAULT_TRANSACTION_COST_BPS };
