"use strict";

// Historical cash distributions, not a forecast of future dividends. Fiscal years
// come from reportBasis; payment calendar buckets are deliberately not compared.
const ALGORITHM_VERSION = "dividend-history-five-years-v1";

function finite(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function dayOf(value) {
  if (value instanceof Date || typeof value === "number") {
    const stamp = value instanceof Date ? value.getTime() : value;
    if (!Number.isFinite(stamp)) return null;
    const date = new Date(stamp);
    if (!Number.isFinite(date.getTime())) return null;
    value = date.toISOString();
  }
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const stamp = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === text ? text : null;
  }
  const stamp = Date.parse(text);
  if (!Number.isFinite(stamp)) return null;
  // A-share dates use the China market calendar, including around New Year.
  return new Date(stamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function explicitStage(record) {
  return String(record.implementationStatus || record.assignProgress || record.ASSIGN_PROGRESS || record.status || "");
}

function isPlanned(stage) {
  return /预案|董事会|股东大会|未实施|尚未|取消|撤回|planned|proposed|pending|cancelled/i.test(stage);
}

function isImplemented(stage) {
  return /实施分配|已实施|已除息|已派发|已发放|implemented|paid|ex-date-passed/i.test(stage);
}

function getDividendStability(raw = {}, options = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  const financials = raw.financials || raw;
  const history = Array.isArray(financials.dividendHistory) ? financials.dividendHistory : [];
  const source = financials.dividendHistorySource || "";
  const asOf = dayOf(options.asOf || raw.snapshotUpdatedAt || raw.priceAsOf || raw.asOf || Date.now());
  const windowYears = 5;
  const latestYear = asOf ? Number(asOf.slice(0, 4)) - 1 : null;
  const expectedYears = latestYear === null ? [] : Array.from({ length: windowYears }, (_, index) => latestYear - windowYears + 1 + index);
  const excluded = [];
  const events = new Map();
  const conflicts = new Set();
  const nonComparableYears = new Set();

  for (const bucket of history) {
    for (const record of Array.isArray(bucket?.distributions) ? bucket.distributions : []) {
      if (!record || typeof record !== "object") {
        excluded.push({ year: null, reason: "invalid-record" });
        continue;
      }
      const reportBasis = dayOf(record.reportBasis);
      const year = reportBasis ? Number(reportBasis.slice(0, 4)) : null;
      const exDividendDate = dayOf(record.exDividendDate);
      const amount = finite(record.perTenSharesRmb);
      const stage = explicitStage(record);
      const plan = String(record.plan || "");
      const item = { year, reportBasis, exDividendDate, perTenSharesRmb: amount };
      let reason = null;
      if (!asOf) reason = "invalid-as-of";
      else if (year === null || amount === null || amount < 0) reason = "invalid-record";
      else if (isPlanned(stage)) reason = "not-implemented";
      else if (stage && !isImplemented(stage)) reason = "unverified-status";
      else if (!exDividendDate) reason = "unverified-ex-date";
      else if (exDividendDate > asOf) reason = "future-ex-date";
      else if (/特别|特殊|special/i.test(String(record.dividendType || "") + plan)) reason = "special-dividend";
      if (reason) {
        excluded.push({ ...item, reason });
        continue;
      }

      // A positive past ex-date is evidence of a completed ex-dividend event,
      // not proof that cash reached an account. Keep that distinction explicit.
      const event = {
        ...item,
        noticeDate: dayOf(record.noticeDate),
        plan,
        stage: stage || "ex-date-passed",
        statusBasis: stage ? "source-status-and-past-ex-date" : "past-ex-date",
      };
      const key = String(record.eventId || record.id || `${reportBasis}|${exDividendDate}`);
      const existing = events.get(key);
      if (existing && Math.abs(existing.perTenSharesRmb - amount) > 1e-8) {
        conflicts.add(year);
        excluded.push({ ...item, reason: "conflicting-event-amount" });
        continue;
      }
      if (!existing) events.set(key, event);
      if (/(?:送|转(?:增)?)\s*\d|stock split|stock dividend/i.test(plan)) nonComparableYears.add(year);
    }
  }

  const byYear = new Map();
  for (const event of events.values()) {
    const annual = byYear.get(event.year) || {
      year: event.year,
      perTenSharesRmb: 0,
      distributionCount: 0,
      hasYearEndDistribution: false,
      records: [],
    };
    annual.perTenSharesRmb += event.perTenSharesRmb;
    annual.distributionCount += 1;
    annual.hasYearEndDistribution ||= event.reportBasis.endsWith("-12-31");
    annual.records.push(event);
    byYear.set(event.year, annual);
  }
  const years = [...byYear.values()].sort((left, right) => left.year - right.year).map((year) => ({
    ...year,
    perTenSharesRmb: Number(year.perTenSharesRmb.toFixed(6)),
    perShareRmb: Number((year.perTenSharesRmb / 10).toFixed(7)),
    complete: year.hasYearEndDistribution && !conflicts.has(year.year),
    shareBasisComparable: !nonComparableYears.has(year.year),
  }));
  const yearMap = new Map(years.map((year) => [year.year, year]));
  const window = expectedYears.map((year) => yearMap.get(year) || { year, perTenSharesRmb: null, perShareRmb: null, distributionCount: 0, complete: false, records: [] });
  const missingYears = window.filter((year) => year.distributionCount === 0).map((year) => year.year);
  const incompleteYears = window.filter((year) => year.distributionCount > 0 && !year.complete).map((year) => year.year);
  const observedYears = window.filter((year) => year.distributionCount > 0).map((year) => year.year);
  let consecutiveYears = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (!window[index].complete || !(window[index].perTenSharesRmb > 0)) break;
    consecutiveYears += 1;
  }
  const comparable = window.length === windowYears && window.every((year) => year.complete && year.shareBasisComparable);
  const changes = [];
  if (comparable) {
    for (let index = 1; index < window.length; index += 1) {
      const previous = window[index - 1];
      const current = window[index];
      const decreased = current.perTenSharesRmb < previous.perTenSharesRmb - 1e-6;
      changes.push({
        fromYear: previous.year,
        toYear: current.year,
        decreased,
        changePercent: previous.perTenSharesRmb > 0 ? (current.perTenSharesRmb / previous.perTenSharesRmb - 1) * 100 : null,
      });
    }
  }
  const decreases = changes.filter((change) => change.decreased);
  const allPaid = comparable && window.every((year) => year.perTenSharesRmb > 0);
  const score = allPaid && source ? Math.round(100 * (changes.length - decreases.length) / changes.length) : null;
  const relevantNonComparable = expectedYears.filter((year) => nonComparableYears.has(year));
  return {
    score,
    state: score !== null ? "complete" : (history.length ? "insufficient" : "unavailable"),
    asOf,
    source,
    hasSource: Boolean(source),
    algorithmVersion: ALGORITHM_VERSION,
    windowYears,
    startYear: expectedYears[0] ?? null,
    endYear: latestYear,
    expectedYears,
    observedYears,
    consecutiveYears,
    missingYears,
    incompleteYears,
    nonComparableYears: relevantNonComparable,
    conflictingYears: expectedYears.filter((year) => conflicts.has(year)),
    comparisonCount: changes.length,
    decreaseCount: comparable ? decreases.length : null,
    largestCutPercent: comparable ? Math.max(0, ...decreases.map((change) => -change.changePercent)) : null,
    changes,
    window,
    years,
    excluded,
    coverageBasis: "report-year-with-year-end-distribution-and-past-ex-date",
    statusBasis: "除息日已过；不代表已到账，未保留付款日时不作到账断言",
    scoreBasis: "最近5个完整所属年度，4次同比未减息占比；不含现金流、ROE或未来收益预测",
  };
}

module.exports = { getDividendStability, ALGORITHM_VERSION };
