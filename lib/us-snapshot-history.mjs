import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_HISTORY_LIMIT = 420;
const DEFAULT_HOLDING_DAYS = [5, 20];
const DEFAULT_TRANSACTION_COST_BPS = 10;
const DEFAULT_MIN_TRADING_DAYS = 90;
const DEFAULT_CANDIDATE_MIN_SAMPLES = 150;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function fallbackSignalDate(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function newYorkDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function marketSignalDate(stocks, capturedAt) {
  const latestAsOf = (stocks || [])
    .map((stock) => stock.asOf)
    .filter(Boolean)
    .sort()
    .at(-1);
  return newYorkDate(latestAsOf) || fallbackSignalDate(capturedAt);
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
      technicalPlan: stock.technicalPlan
        ? {
            atr: finite(stock.technicalPlan.atr),
            buy: finite(stock.technicalPlan.buy),
            stop: finite(stock.technicalPlan.stop),
            tp: Array.isArray(stock.technicalPlan.tp)
              ? stock.technicalPlan.tp.map(finite)
              : null,
          }
        : null,
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
    signalDate: marketSignalDate(stocks, capturedAt),
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

function evaluateHorizon(
  days,
  horizon,
  transactionCostBps,
  isSelected = (stock) => Boolean(stock.signal?.selected),
) {
  const events = [];
  const pricePlanEvents = [];
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
      if (!isSelected(stock) || !Number.isFinite(stock.price)) continue;
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
      const plan = stock.technicalPlan;
      const buy = finite(plan?.buy);
      const stop = finite(plan?.stop);
      const target = finite(plan?.tp?.[0]);
      if (buy !== null && stop !== null && target !== null && path.length) {
        let entered = false;
        let outcome = "未触发买入";
        for (const futurePrice of path) {
          if (!entered && futurePrice <= buy) {
            entered = true;
            outcome = "持有中";
          }
          if (!entered) continue;
          if (futurePrice >= target) {
            outcome = "达到卖出价";
            break;
          }
          if (futurePrice <= stop) {
            outcome = "触及风险下沿";
            break;
          }
        }
        pricePlanEvents.push({
          signalDate: day.signalDate,
          symbol: stock.symbol,
          buy: round(buy, 3),
          target: round(target, 3),
          stop: round(stop, 3),
          outcome,
        });
      }
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
    pricePlan: {
      sampleCount: pricePlanEvents.length,
      buyTriggered: pricePlanEvents.filter((event) => event.outcome !== "未触发买入").length,
      targetHitRate: pricePlanEvents.length
        ? round(
            (pricePlanEvents.filter((event) => event.outcome === "达到卖出价").length /
              pricePlanEvents.length) *
              100,
            2,
          )
        : null,
      stopHitRate: pricePlanEvents.length
        ? round(
            (pricePlanEvents.filter((event) => event.outcome === "触及风险下沿").length /
              pricePlanEvents.length) *
              100,
            2,
          )
        : null,
    },
    transactionCostBps,
    examples: events.slice(-20),
  };
}

const MAGNIFICENT_SEVEN = new Set([
  "NVDA",
  "MSFT",
  "AAPL",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
]);

const TECHNICAL_CANDIDATES = [
  {
    id: "trend_atr_pullback",
    name: "上升趋势 ATR 回撤",
    trendFloor: 1,
    buyAtr: 0.75,
    stopAtr: 1.25,
    targetAtr: 2.5,
  },
  {
    id: "support_retest",
    name: "趋势支撑回踩",
    trendFloor: 0.95,
    buyAtr: 0.45,
    supportAtr: 0.25,
    stopAtr: 1.2,
    targetAtr: 2.4,
  },
  {
    id: "deep_pullback",
    name: "深度回撤分批关注",
    trendFloor: 0.9,
    buyAtr: 1.2,
    stopAtr: 1.4,
    targetAtr: 3,
  },
  {
    id: "high_retest",
    name: "阶段高点回踩",
    trendFloor: 1,
    highFloor: 0.92,
    buyAtr: 0.6,
    stopAtr: 1.3,
    targetAtr: 2.8,
  },
  {
    id: "recovery_pullback_40d",
    name: "深回撤后四十日修复",
    trendFloor: 0.9,
    buyAtr: 1,
    stopAtr: 3,
    targetAtr: 2.5,
    entryWindow: 8,
    holdingDays: 40,
  },
  {
    id: "deep_recovery_60d",
    name: "深度低吸六十日修复",
    trendFloor: 0.85,
    buyAtr: 1.5,
    stopAtr: 3.5,
    targetAtr: 3,
    entryWindow: 10,
    holdingDays: 60,
  },
  {
    id: "support_recovery_40d",
    name: "支撑位四十日修复",
    trendFloor: 0.9,
    buyAtr: 0.75,
    supportAtr: 0.15,
    stopAtr: 2.75,
    targetAtr: 2.25,
    entryWindow: 8,
    holdingDays: 40,
  },
  {
    id: "drawdown_recovery_60d",
    name: "阶段回撤十个百分点修复",
    trendFloor: 0.75,
    minimumDrawdownFromHigh: 10,
    minimumSma200Ratio: 0.8,
    buyAtr: 0.4,
    stopAtr: 3.5,
    targetAtr: 3,
    entryWindow: 8,
    holdingDays: 60,
  },
  {
    id: "deep_drawdown_90d",
    name: "深度回撤九十日修复",
    trendFloor: 0.65,
    minimumDrawdownFromHigh: 18,
    minimumSma200Ratio: 0.7,
    buyAtr: 0.25,
    stopAtr: 4,
    targetAtr: 4,
    entryWindow: 10,
    holdingDays: 90,
  },
  {
    id: "rsi_oversold_60d",
    name: "RSI 超卖六十日修复",
    trendFloor: 0.7,
    maximumRsi: 35,
    minimumSma200Ratio: 0.8,
    buyAtr: 0.25,
    stopAtr: 3,
    targetAtr: 2.5,
    entryWindow: 6,
    holdingDays: 60,
  },
  {
    id: "sma_discount_60d",
    name: "中长期均线折价修复",
    trendFloor: 0.7,
    maximumSma60Ratio: 0.95,
    minimumSma200Ratio: 0.85,
    buyAtr: 0.35,
    stopAtr: 3.25,
    targetAtr: 2.75,
    entryWindow: 8,
    holdingDays: 60,
  },
];

function average(values) {
  const rows = values.filter(Number.isFinite);
  return rows.length
    ? rows.reduce((sum, value) => sum + value, 0) / rows.length
    : null;
}

function normalizeOHLC(rows) {
  return (rows || [])
    .map((row) => ({
      date: row.date,
      open: finite(row.open),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close),
    }))
    .filter(
      (row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null,
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildHistoricalTechnicalPlan(rows, index, candidate) {
  if (index < 60) return null;
  const recent = rows.slice(index - 60, index + 1);
  const atrRows = recent.slice(-15);
  const trueRanges = atrRows.slice(1).map((row, offset) => {
    const previousClose = atrRows[offset].close;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    );
  });
  const atr = average(trueRanges);
  if (!Number.isFinite(atr) || atr <= 0) return null;
  const close = rows[index].close;
  const sma60 = average(recent.map((row) => row.close));
  const support20 = Math.min(...recent.slice(-20).map((row) => row.low));
  const high20 = Math.max(...recent.slice(-20).map((row) => row.high));
  const high60 = Math.max(...recent.map((row) => row.high));
  const drawdownFromHigh = ((high60 - close) / high60) * 100;
  const longHistory = rows.slice(Math.max(0, index - 199), index + 1);
  const sma200 = longHistory.length >= 200
    ? average(longHistory.map((row) => row.close))
    : null;
  const rsiRows = recent.slice(-15);
  const rsiChanges = rsiRows.slice(1).map(
    (row, offset) => row.close - rsiRows[offset].close,
  );
  const averageGain = average(rsiChanges.map((value) => Math.max(value, 0)));
  const averageLoss = average(rsiChanges.map((value) => Math.max(-value, 0)));
  const rsi = averageLoss === 0
    ? 100
    : 100 - 100 / (1 + averageGain / averageLoss);
  if (close < sma60 * candidate.trendFloor) return null;
  if (candidate.highFloor && close < high20 * candidate.highFloor) return null;
  if (
    candidate.minimumDrawdownFromHigh &&
    drawdownFromHigh < candidate.minimumDrawdownFromHigh
  ) return null;
  if (candidate.maximumRsi && rsi > candidate.maximumRsi) return null;
  if (
    candidate.minimumSma200Ratio &&
    (!Number.isFinite(sma200) || close < sma200 * candidate.minimumSma200Ratio)
  ) return null;
  if (candidate.maximumSma60Ratio && close > sma60 * candidate.maximumSma60Ratio) {
    return null;
  }
  let buy = close - atr * candidate.buyAtr;
  if (Number.isFinite(candidate.supportAtr)) {
    buy = Math.min(buy, support20 + atr * candidate.supportAtr);
  }
  if (buy <= 0) return null;
  return {
    buy,
    stop: buy - atr * candidate.stopAtr,
    target: buy + atr * candidate.targetAtr,
  };
}

function simulateTechnicalCandidate(
  symbol,
  rows,
  candidate,
  startIndex,
  endIndex,
  options,
) {
  const events = [];
  const entryWindow = candidate.entryWindow || options.entryWindow || 5;
  const holdingDays = candidate.holdingDays || options.holdingDays || 20;
  const transactionCost = ((options.transactionCostBps || 10) * 2) / 100;
  let signalIndex = Math.max(60, startIndex);
  while (signalIndex <= endIndex) {
    const plan = buildHistoricalTechnicalPlan(rows, signalIndex, candidate);
    if (!plan) {
      signalIndex += 1;
      continue;
    }
    let entryIndex = null;
    let entryPrice = null;
    const entryLimit = Math.min(signalIndex + entryWindow, endIndex);
    for (let index = signalIndex + 1; index <= entryLimit; index += 1) {
      if (rows[index].low > plan.buy) continue;
      entryIndex = index;
      entryPrice = Number.isFinite(rows[index].open)
        ? Math.min(plan.buy, rows[index].open)
        : plan.buy;
      break;
    }
    if (entryIndex === null) {
      signalIndex += entryWindow;
      continue;
    }
    const stop = entryPrice - (plan.buy - plan.stop);
    const target = entryPrice + (plan.target - plan.buy);
    const finalIndex = Math.min(entryIndex + holdingDays - 1, endIndex);
    let exitIndex = finalIndex;
    let exitPrice = rows[finalIndex].close;
    let outcome = "到期卖出";
    let lowest = entryPrice;
    for (let index = entryIndex; index <= finalIndex; index += 1) {
      const row = rows[index];
      lowest = Math.min(lowest, row.low);
      if (row.low <= stop) {
        exitIndex = index;
        exitPrice = Number.isFinite(row.open) && row.open < stop ? row.open : stop;
        outcome = "触及风险下沿";
        break;
      }
      if (row.high >= target) {
        exitIndex = index;
        exitPrice = target;
        outcome = "达到卖出价";
        break;
      }
    }
    const grossReturn = ((exitPrice - entryPrice) / entryPrice) * 100;
    events.push({
      symbol,
      signalDate: rows[signalIndex].date,
      entryDate: rows[entryIndex].date,
      exitDate: rows[exitIndex].date,
      entry: round(entryPrice, 3),
      exit: round(exitPrice, 3),
      netReturn: round(grossReturn - transactionCost, 3),
      maxDrawdown: round(((lowest - entryPrice) / entryPrice) * 100, 3),
      outcome,
    });
    signalIndex = exitIndex + 1;
  }
  return events;
}

function equityMaxDrawdown(events) {
  let equity = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  for (const event of [...events].sort((left, right) =>
    left.exitDate.localeCompare(right.exitDate))) {
    equity *= 1 + event.netReturn / 100;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.min(maximumDrawdown, ((equity - peak) / peak) * 100);
  }
  return round(maximumDrawdown, 2);
}

function summarizeTechnicalEvents(events) {
  const returns = events.map((event) => event.netReturn);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value <= 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    sampleCount: events.length,
    winRate: events.length ? round((wins.length / events.length) * 100, 2) : null,
    averageNetReturn: round(average(returns), 3),
    medianNetReturn: summarize(returns).median,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : null,
    averageMaxDrawdown: round(average(events.map((event) => event.maxDrawdown)), 3),
    worstTrade: returns.length ? round(Math.min(...returns), 3) : null,
    equityMaxDrawdown: equityMaxDrawdown(events),
    targetHitRate: events.length
      ? round((events.filter((event) => event.outcome === "达到卖出价").length / events.length) * 100, 2)
      : null,
    stopHitRate: events.length
      ? round((events.filter((event) => event.outcome === "触及风险下沿").length / events.length) * 100, 2)
      : null,
  };
}

export function evaluateUSTechnicalCandidates(stocks, options = {}) {
  const universe = (stocks || [])
    .filter((stock) => MAGNIFICENT_SEVEN.has(stock.symbol))
    .map((stock) => ({
      symbol: stock.symbol,
      rows: normalizeOHLC(stock.historyOHLC),
    }))
    .filter((stock) => stock.rows.length >= 220);
  const candidates = TECHNICAL_CANDIDATES.map((candidate) => {
    const trainingEvents = [];
    const validationEvents = [];
    for (const stock of universe) {
      const splitIndex = Math.max(140, Math.floor(stock.rows.length * 0.7));
      trainingEvents.push(
        ...simulateTechnicalCandidate(
          stock.symbol,
          stock.rows,
          candidate,
          60,
          splitIndex - 1,
          options,
        ),
      );
      validationEvents.push(
        ...simulateTechnicalCandidate(
          stock.symbol,
          stock.rows,
          candidate,
          splitIndex,
          stock.rows.length - 1,
          options,
        ),
      );
    }
    const training = summarizeTechnicalEvents(trainingEvents);
    const validation = summarizeTechnicalEvents(validationEvents);
    const eligibleForReview = Boolean(
      training.sampleCount >= 80 &&
      training.averageNetReturn > 0 &&
      validation.sampleCount >= 40 &&
      validation.winRate >= 55 &&
      validation.averageNetReturn >= 0.5 &&
      validation.profitFactor >= 1.25 &&
      validation.equityMaxDrawdown >= -20 &&
      validation.worstTrade >= -12,
    );
    return {
      id: candidate.id,
      name: candidate.name,
      training,
      validation,
      eligibleForReview,
    };
  });
  const ranked = [...candidates].sort(
    (left, right) =>
      (right.validation.averageNetReturn ?? -Infinity) -
      (left.validation.averageNetReturn ?? -Infinity),
  );
  const candidateForReview =
    ranked.find((candidate) => candidate.eligibleForReview) || null;
  return {
    status: candidateForReview
      ? "candidate_requires_review"
      : universe.length === MAGNIFICENT_SEVEN.size
        ? "no_validated_candidate"
        : "insufficient_history",
    autoApply: false,
    universe: universe.map((stock) => stock.symbol),
    historyDays: universe.length
      ? Math.min(...universe.map((stock) => stock.rows.length))
      : 0,
    split: "每只股票前 70% 交易日训练，后 30% 交易日独立验证",
    transactionCostBps: options.transactionCostBps || 10,
    candidates,
    candidateForReview: candidateForReview
      ? { id: candidateForReview.id, name: candidateForReview.name }
      : null,
    note: candidateForReview
      ? "候选必须人工复核，不会自动改写用户页面价格。"
      : "样本外收益、胜率或回撤未全部过线，用户页面继续不发布该价格计划。",
  };
}

const CANDIDATE_POLICIES = [
  {
    id: "quality_top_10",
    name: "财务达标且热度前十",
    matches: (stock) => Boolean(stock.signal?.selected),
  },
  {
    id: "quality_top_5",
    name: "财务达标且热度前五",
    matches: (stock) => Number(stock.signal?.rank) <= 5,
  },
  {
    id: "quality_top_3",
    name: "财务达标且热度前三",
    matches: (stock) => Number(stock.signal?.rank) <= 3,
  },
  {
    id: "high_quality_top_10",
    name: "三项财务条件均满足且热度前十",
    matches: (stock) =>
      Boolean(stock.signal?.selected) &&
      Number(stock.financial?.qualityMatchCount) >= 3,
  },
];

function compactCandidateHorizon(result) {
  return {
    sampleCount: result.sampleCount,
    winRate: result.winRate,
    averageNetReturn: result.return.average,
    averageMaxDrawdown: result.drawdown.average,
    worstMaxDrawdown: result.drawdown.minimum,
    pricePlanSampleCount: result.pricePlan.sampleCount,
    targetHitRate: result.pricePlan.targetHitRate,
    stopHitRate: result.pricePlan.stopHitRate,
  };
}

export function evaluateUSStrategyCandidates(history, options = {}) {
  const days = Array.isArray(history) ? history : history?.days || [];
  const holdingDays = options.holdingDays || DEFAULT_HOLDING_DAYS;
  const transactionCostBps =
    options.transactionCostBps ?? DEFAULT_TRANSACTION_COST_BPS;
  const minimumTradingDays =
    options.minimumTradingDays ?? DEFAULT_MIN_TRADING_DAYS;
  const minimumSamples =
    options.minimumSamples ?? DEFAULT_CANDIDATE_MIN_SAMPLES;
  const orderedDays = [...days]
    .filter((day) => day?.signalDate && Array.isArray(day.stocks))
    .sort((left, right) => left.signalDate.localeCompare(right.signalDate));
  const primaryHorizon = holdingDays[0];
  const candidates = CANDIDATE_POLICIES.map((policy) => {
    const horizons = Object.fromEntries(
      holdingDays.map((horizon) => [
        String(horizon),
        compactCandidateHorizon(
          evaluateHorizon(
            orderedDays,
            horizon,
            transactionCostBps,
            policy.matches,
          ),
        ),
      ]),
    );
    const primary = horizons[String(primaryHorizon)];
    const eligibleForReview = Boolean(
      orderedDays.length >= minimumTradingDays &&
        primary.sampleCount >= minimumSamples &&
        primary.pricePlanSampleCount >= Math.ceil(minimumSamples / 2) &&
        (primary.winRate || 0) >= 55 &&
        (primary.averageNetReturn || 0) > 0,
    );
    return {
      id: policy.id,
      name: policy.name,
      horizons,
      eligibleForReview,
    };
  });
  const ranked = [...candidates].sort((left, right) => {
    const leftReturn = left.horizons[String(primaryHorizon)].averageNetReturn ?? -Infinity;
    const rightReturn = right.horizons[String(primaryHorizon)].averageNetReturn ?? -Infinity;
    return rightReturn - leftReturn;
  });
  const candidateForReview = ranked.find((candidate) => candidate.eligibleForReview) || null;

  return {
    status: candidateForReview ? "candidate_requires_review" : "collecting_history",
    autoApply: false,
    snapshotDays: orderedDays.length,
    minimumTradingDays,
    minimumSamples,
    holdingDays,
    transactionCostBps,
    candidates,
    candidateForReview: candidateForReview
      ? {
          id: candidateForReview.id,
          name: candidateForReview.name,
        }
      : null,
    note: candidateForReview
      ? "候选仅供人工复核，不会自动改写公开页面的结论或价格。"
      : "持续收集交易日快照，样本满足门槛后才生成待复核候选。",
  };
}

const HK_APPLICATION_POLICIES = [
  {
    id: "user_rule_combo",
    name: "行业强势 + 少保荐 + 非 A+H",
    matches: (row) =>
      !row.isAH &&
      row.industrySampleCount >= 3 &&
      row.industryWinRate >= 80 &&
      row.marketWinRate >= 70 &&
      Number.isFinite(row.sponsorCount) &&
      row.sponsorCount > 0 &&
      row.sponsorCount <= 2 &&
      !row.hasHuatai,
  },
  {
    id: "non_ah_industry_regime",
    name: "非 A+H + 强行业 + 强市场",
    matches: (row) =>
      !row.isAH &&
      row.industrySampleCount >= 3 &&
      row.industryWinRate >= 85 &&
      row.marketWinRate >= 70,
  },
  {
    id: "non_ah_cornerstone_regime",
    name: "非 A+H + 高基石 + 强市场",
    matches: (row) =>
      !row.isAH &&
      Number.isFinite(row.cornerstonePercent) &&
      row.cornerstonePercent >= 30 &&
      row.marketWinRate >= 80,
  },
  {
    id: "non_ah_small_offer",
    name: "非 A+H + 小发行规模 + 强市场",
    matches: (row) =>
      !row.isAH &&
      Number.isFinite(row.globalOfferShares) &&
      Number.isFinite(row.offerSharesMedian) &&
      row.globalOfferShares <= row.offerSharesMedian &&
      row.marketWinRate >= 80,
  },
  {
    id: "high_price_small_offer",
    name: "高定价 + 小发行规模 + 非 A+H",
    matches: (row) =>
      !row.isAH &&
      Number.isFinite(row.offerPrice) &&
      Number.isFinite(row.offerPriceUpperQuartile) &&
      Number.isFinite(row.globalOfferShares) &&
      Number.isFinite(row.offerSharesMedian) &&
      row.offerPrice >= row.offerPriceUpperQuartile &&
      row.globalOfferShares <= row.offerSharesMedian &&
      row.marketWinRate >= 70,
  },
  {
    id: "few_sponsors_no_huatai",
    name: "少保荐人 + 无华泰 + 非 A+H",
    matches: (row) =>
      !row.isAH &&
      row.sponsorCount > 0 &&
      row.sponsorCount <= 2 &&
      !row.hasHuatai &&
      row.marketWinRate >= 75,
  },
  {
    id: "user_price_balance",
    name: "高定价 + 低总额 + 非 A+H",
    matches: (row) =>
      !row.isAH &&
      Number.isFinite(row.offerPrice) &&
      Number.isFinite(row.offerPriceUpperQuartile) &&
      Number.isFinite(row.globalOfferShares) &&
      Number.isFinite(row.offerSharesMedian) &&
      row.offerPrice >= row.offerPriceUpperQuartile &&
      row.globalOfferShares <= row.offerSharesMedian &&
      row.marketWinRate >= 70,
  },
  {
    id: "strict_consensus",
    name: "行业、基石、市场三重确认",
    matches: (row) =>
      !row.isAH &&
      row.industrySampleCount >= 3 &&
      row.industryWinRate >= 80 &&
      Number.isFinite(row.cornerstonePercent) &&
      row.cornerstonePercent >= 20 &&
      row.marketWinRate >= 80,
  },
  {
    id: "non_ah_very_hot_regime",
    name: "非 A+H + 极强市场环境",
    matches: (row) => !row.isAH && row.marketWinRate >= 90,
  },
];

const HK_APPLICATION_RISK_VETOES = [
  {
    id: "pre_profit_biotech",
    name: "未盈利生物科技",
    applies: (row) => /-B$/i.test(row.name || ""),
  },
  {
    id: "high_entry_amount",
    name: "一手入场金额较高",
    applies: (row) => row.boardLotAmount >= 8_000,
  },
  {
    id: "low_cornerstone",
    name: "基石比例偏低",
    applies: (row) =>
      Number.isFinite(row.cornerstonePercent) && row.cornerstonePercent < 20,
  },
  {
    id: "new_industry",
    name: "同行业历史样本不足",
    applies: (row) => row.industrySampleCount < 3,
  },
  {
    id: "unknown_sponsor",
    name: "保荐人资料缺失",
    applies: (row) => !Number.isFinite(row.sponsorCount),
  },
];

function hkIndustryKey(value) {
  return String(value || "").split("/")[0].trim();
}

function hkQuantile(values, percentile) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const index = (ordered.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
}

function hkRate(rows, predicate) {
  return rows.length
    ? (rows.filter(predicate).length / rows.length) * 100
    : null;
}

function buildHKPointInTimeRows(completed) {
  const ordered = (completed || [])
    .filter((row) => row?.listingDate && Number.isFinite(row.firstDayChange))
    .sort((left, right) => left.listingDate.localeCompare(right.listingDate));
  const rows = [];
  for (let index = 20; index < ordered.length; index += 1) {
    const record = ordered[index];
    const prior = ordered.slice(0, index);
    const recentMarket = prior.slice(-10);
    const industry = hkIndustryKey(record.industry);
    const industryRows = prior.filter(
      (candidate) => hkIndustryKey(candidate.industry) === industry,
    );
    const offerPrices = prior.map((candidate) => candidate.offerPrice);
    const offerShares = prior.map((candidate) => candidate.globalOfferShares);
    rows.push({
      stockCode: record.stockCode,
      name: record.name || null,
      listingDate: record.listingDate,
      industry,
      isAH: Boolean(record.isAH),
      offerPrice: finite(record.offerPrice),
      boardLotAmount: finite(record.boardLotAmount),
      globalOfferShares: finite(record.globalOfferShares),
      cornerstonePercent: finite(record.cornerstonePercent),
      sponsorCount: finite(record.sponsorCount),
      hasHuatai: Boolean(record.hasHuatai),
      marketWinRate: hkRate(
        recentMarket,
        (candidate) => candidate.firstDayChange > 0,
      ),
      industrySampleCount: industryRows.length,
      industryWinRate: hkRate(
        industryRows,
        (candidate) => candidate.firstDayChange > 0,
      ),
      offerPriceUpperQuartile: hkQuantile(offerPrices, 0.75),
      offerSharesMedian: hkQuantile(offerShares, 0.5),
      greyMarketChange: finite(record.greyMarketChange),
      firstDayChange: finite(record.firstDayChange),
    });
  }
  const trainingEnd = Math.floor(rows.length * 0.6);
  const validationEnd = Math.floor(rows.length * 0.8);
  return rows.map((row, index) => ({
    ...row,
    phase:
      index < trainingEnd
        ? "training"
        : index < validationEnd
          ? "validation"
          : "holdout",
  }));
}

function wilsonUpperLossBound(losses, sampleCount) {
  if (!sampleCount) return null;
  const z = 1.96;
  const proportion = losses / sampleCount;
  const denominator = 1 + (z * z) / sampleCount;
  const center = proportion + (z * z) / (2 * sampleCount);
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion)) / sampleCount +
      (z * z) / (4 * sampleCount * sampleCount),
  );
  return round(((center + margin) / denominator) * 100, 2);
}

function summarizeHKApplicationSignals(rows) {
  const evaluable = rows.filter(
    (row) =>
      Number.isFinite(row.greyMarketChange) &&
      Number.isFinite(row.firstDayChange),
  );
  const losses = evaluable.filter(
    (row) => row.greyMarketChange <= 0 || row.firstDayChange <= 0,
  );
  return {
    signalCount: rows.length,
    sampleCount: evaluable.length,
    unknownCount: rows.length - evaluable.length,
    lossCount: losses.length,
    bothPositiveRate: hkRate(
      evaluable,
      (row) => row.greyMarketChange > 0 && row.firstDayChange > 0,
    ),
    greyMarketWinRate: hkRate(
      evaluable,
      (row) => row.greyMarketChange > 0,
    ),
    firstDayWinRate: hkRate(
      evaluable,
      (row) => row.firstDayChange > 0,
    ),
    averageGreyMarket: round(
      average(evaluable.map((row) => row.greyMarketChange)),
      2,
    ),
    averageFirstDay: round(
      average(evaluable.map((row) => row.firstDayChange)),
      2,
    ),
    worstGreyMarket: evaluable.length
      ? round(Math.min(...evaluable.map((row) => row.greyMarketChange)), 2)
      : null,
    worstFirstDay: evaluable.length
      ? round(Math.min(...evaluable.map((row) => row.firstDayChange)), 2)
      : null,
    upperLossBound95: wilsonUpperLossBound(losses.length, evaluable.length),
  };
}

function buildTrainingRiskVeto(rows) {
  const trainingBase = rows.filter(
    (row) => row.phase === "training" && !row.isAH && row.marketWinRate >= 80,
  );
  const diagnostics = HK_APPLICATION_RISK_VETOES.map((veto) => {
    const exposed = trainingBase.filter(veto.applies);
    const unexposed = trainingBase.filter((row) => !veto.applies(row));
    const exposedSummary = summarizeHKApplicationSignals(exposed);
    const unexposedSummary = summarizeHKApplicationSignals(unexposed);
    const exposedLossRate = Number.isFinite(exposedSummary.bothPositiveRate)
      ? 100 - exposedSummary.bothPositiveRate
      : null;
    const unexposedLossRate = Number.isFinite(unexposedSummary.bothPositiveRate)
      ? 100 - unexposedSummary.bothPositiveRate
      : null;
    const lossRateLift =
      Number.isFinite(exposedLossRate) && Number.isFinite(unexposedLossRate)
        ? exposedLossRate - unexposedLossRate
        : null;
    const selected = Boolean(
      exposedSummary.sampleCount >= 3 &&
      Number.isFinite(lossRateLift) &&
      lossRateLift >= 15,
    );
    return {
      id: veto.id,
      name: veto.name,
      exposedSampleCount: exposedSummary.sampleCount,
      exposedLossRate: round(exposedLossRate, 2),
      unexposedSampleCount: unexposedSummary.sampleCount,
      unexposedLossRate: round(unexposedLossRate, 2),
      lossRateLift: round(lossRateLift, 2),
      selected,
      applies: veto.applies,
    };
  });
  return {
    diagnostics,
    selected: diagnostics.filter((diagnostic) => diagnostic.selected),
  };
}

export function evaluateHKApplicationCandidates(completed) {
  const rows = buildHKPointInTimeRows(completed);
  const trainingVeto = buildTrainingRiskVeto(rows);
  const policies = [
    ...HK_APPLICATION_POLICIES,
    {
      id: "training_selected_veto",
      name: "训练段自动风险否决",
      matches: (row) =>
        !row.isAH &&
        row.marketWinRate >= 80 &&
        trainingVeto.selected.every(
          (diagnostic) => !diagnostic.applies(row),
        ),
    },
  ];
  const candidates = policies.map((policy) => {
    const signals = rows.filter(policy.matches);
    const training = summarizeHKApplicationSignals(
      signals.filter((row) => row.phase === "training"),
    );
    const validation = summarizeHKApplicationSignals(
      signals.filter((row) => row.phase === "validation"),
    );
    const holdout = summarizeHKApplicationSignals(
      signals.filter((row) => row.phase === "holdout"),
    );
    const combined = summarizeHKApplicationSignals(signals);
    const eligibleForReview = Boolean(
      training.sampleCount >= 10 &&
      validation.sampleCount >= 5 &&
      holdout.sampleCount >= 5 &&
      training.lossCount === 0 &&
      validation.lossCount === 0 &&
      holdout.lossCount === 0 &&
      combined.sampleCount >= 60 &&
      combined.upperLossBound95 <= 5,
    );
    return {
      id: policy.id,
      name: policy.name,
      usesPostApplicationData: false,
      training,
      validation,
      holdout,
      combined,
      failureExamples: signals
        .filter(
          (row) =>
            Number.isFinite(row.greyMarketChange) &&
            Number.isFinite(row.firstDayChange) &&
            (row.greyMarketChange <= 0 || row.firstDayChange <= 0),
        )
        .map((row) => ({
          stockCode: row.stockCode,
          name: row.name,
          listingDate: row.listingDate,
          phase: row.phase,
          industry: row.industry,
          isAH: row.isAH,
          offerPrice: row.offerPrice,
          boardLotAmount: row.boardLotAmount,
          globalOfferShares: row.globalOfferShares,
          cornerstonePercent: row.cornerstonePercent,
          sponsorCount: row.sponsorCount,
          hasHuatai: row.hasHuatai,
          marketWinRate: round(row.marketWinRate, 2),
          industrySampleCount: row.industrySampleCount,
          industryWinRate: round(row.industryWinRate, 2),
          greyMarketChange: row.greyMarketChange,
          firstDayChange: row.firstDayChange,
        })),
      eligibleForReview,
    };
  });
  const candidateForReview = candidates.find(
    (candidate) => candidate.eligibleForReview,
  );
  return {
    status: candidateForReview
      ? "candidate_requires_review"
      : "no_zero_loss_candidate",
    autoApply: false,
    usesPostApplicationData: false,
    sampleCount: rows.length,
    split: "按上市时间前 60% 训练、中间 20% 验证、最后 20% 留出测试",
    successDefinition: "暗盘和上市首日涨幅都必须大于 0",
    forbiddenFeatures: [
      "最终公开认购倍数",
      "配发结果",
      "暗盘实际涨幅",
      "上市首日实际涨幅",
    ],
    trainingRiskDiagnostics: trainingVeto.diagnostics.map(
      ({ applies, ...diagnostic }) => diagnostic,
    ),
    selectedTrainingVetoes: trainingVeto.selected.map(
      ({ applies, ...diagnostic }) => diagnostic,
    ),
    candidates,
    candidateForReview: candidateForReview
      ? { id: candidateForReview.id, name: candidateForReview.name }
      : null,
    note: candidateForReview
      ? "候选仍需人工复核，不会自动发布申购建议。"
      : "没有规则同时通过三段零亏损与统计置信门槛，前台不得声称稳赚。",
  };
}

export function buildStrategyAudit({ history, hkBacktest, usMarketData, generatedAt }) {
  const hkValidation = hkBacktest?.modelValidation || null;
  return {
    version: 1,
    generatedAt: generatedAt || new Date().toISOString(),
    autoApply: false,
    hk: {
      sampleCount: hkBacktest?.sampleCount || 0,
      fiveDaySampleCount: hkValidation?.fiveDay?.sampleCount || 0,
      fiveDayHighSampleCount: hkValidation?.fiveDayHigh?.sampleCount || 0,
      priceAnswersReleased: Boolean(hkValidation?.releaseReady),
      algorithmVersion: hkValidation?.algorithmVersion || null,
      releaseThresholds: hkValidation?.releaseThresholds || null,
      metrics: hkValidation
        ? {
            greyMarket: hkValidation.greyMarket,
            firstDay: hkValidation.firstDay,
            fiveDay: hkValidation.fiveDay,
            fiveDayHigh: hkValidation.fiveDayHigh,
          }
        : null,
    },
    hkApplication: evaluateHKApplicationCandidates(hkBacktest?.completed),
    us: evaluateUSStrategyCandidates(history),
    usTechnical: evaluateUSTechnicalCandidates(usMarketData),
  };
}

export async function writeStrategyAudit(filePath, options) {
  const audit = buildStrategyAudit(options);
  await writeFile(filePath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return audit;
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
  const enoughSignals = (primary?.sampleCount || 0) >= minimumSamples;
  const enoughPricePlan = (primary?.pricePlan?.sampleCount || 0) >= 80;
  const healthyReturn = (primary?.return?.average || 0) > 2;
  const healthyWinRate = (primary?.winRate || 0) >= 58;
  const healthyDrawdown =
    (primary?.drawdown?.average ?? -Infinity) >= -15 &&
    (primary?.drawdown?.minimum ?? -Infinity) >= -30;
  const releaseReady = Boolean(
    enoughHistory &&
      enoughSignals &&
      enoughPricePlan &&
      healthyWinRate &&
      healthyReturn &&
      healthyDrawdown,
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
    pricePlanReleaseReady: false,
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
  const normalizedExisting = existing.days.map((day) => ({
    ...day,
    signalDate: marketSignalDate(day.stocks, day.capturedAt),
  }));
  const days = [...new Map(
    [...normalizedExisting, snapshot].map((day) => [day.signalDate, day]),
  ).values()]
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
