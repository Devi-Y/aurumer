import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// node --test scripts/test-dividend-stability.mjs
// Optional: AURUM_DIVIDEND_FIXTURE=/path/to/a/real/snapshot.json
// No network or persisted data mutations. The real 20-stock fixture is checked
// using its own publication time, not the date when this regression is rerun.
const require = createRequire(import.meta.url);
const { getDividendStability } = require("../miniprogram/utils/dividend-stability.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = process.env.AURUM_DIVIDEND_FIXTURE || path.join(root, "data/live-snapshot.json");
const snapshot = JSON.parse(readFileSync(fixturePath, "utf8"));
const asOf = "2026-10-20";

const copy = (value) => structuredClone(value);
function distribution(year, amount, extra = {}) {
  return {
    reportBasis: `${year}-12-31`,
    exDividendDate: `${year + 1}-06-15`,
    noticeDate: `${year + 1}-06-01`,
    perTenSharesRmb: amount,
    plan: `10派${amount}元(含税)`,
    ...extra,
  };
}
function rawFixture(amounts = [10, 11, 12, 13, 14]) {
  return {
    financials: {
      dividendHistorySource: "test source: verified dividend event fixture",
      dividendHistory: amounts.map((amount, index) => ({
        year: String(2022 + index),
        distributions: [distribution(2021 + index, amount)],
      })),
    },
  };
}
const analyze = (raw) => getDividendStability(raw, { asOf });

test("five fiscal years are classified by reportBasis, not the payment year bucket", () => {
  const result = analyze(rawFixture());
  assert.equal(result.score, 100);
  assert.deepEqual(result.expectedYears, [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(result.window.map((row) => row.perTenSharesRmb), [10, 11, 12, 13, 14]);
  assert.equal(result.consecutiveYears, 5);
  assert.equal(result.comparisonCount, 4);
  assert.equal(result.decreaseCount, 0);
  assert.ok(result.statusBasis.includes("不代表已到账"));
});

test("interim and final distributions of the same fiscal year are added exactly once", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory.push({ year: "2025", distributions: [distribution(2025, 2, { reportBasis: "2025-06-30", exDividendDate: "2025-09-01" })] });
  const result = analyze(raw);
  assert.equal(result.window.at(-1).perTenSharesRmb, 16);
  assert.equal(result.window.at(-1).distributionCount, 2);
  assert.equal(result.window.at(-1).perShareRmb, 1.6);
});

test("a missing fiscal year stays unknown and cannot become a zero dividend", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory.splice(2, 1);
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.deepEqual(result.missingYears, [2023]);
  assert.equal(result.window.find((row) => row.year === 2023).perTenSharesRmb, null);
  assert.equal(result.consecutiveYears, 2);
  assert.equal(result.decreaseCount, null);
});

test("four genuine reductions produce a zero score with complete evidence", () => {
  const result = analyze(rawFixture([10, 9, 8, 7, 6]));
  assert.equal(result.score, 0);
  assert.equal(result.decreaseCount, 4);
  assert.equal(result.comparisonCount, 4);
  assert.equal(result.consecutiveYears, 5);
  assert.ok(result.largestCutPercent > 14);
});

test("a future ex-dividend date is excluded even when source status says implemented", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory.at(-1).distributions[0].exDividendDate = "2026-10-21";
  raw.financials.dividendHistory.at(-1).distributions[0].status = "实施分配";
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.deepEqual(result.missingYears, [2025]);
  assert.equal(result.excluded.at(-1).reason, "future-ex-date");
});

test("a plan or approval is not an implemented distribution", () => {
  for (const status of ["董事会决议通过", "股东大会通过", "预案", "未实施", "planned", "pending", "未知"]) {
    const raw = rawFixture();
    raw.financials.dividendHistory.at(-1).distributions[0].status = status;
    const result = analyze(raw);
    assert.equal(result.score, null, status);
    assert.ok(["not-implemented", "unverified-status"].includes(result.excluded.at(-1).reason));
  }
});

test("missing dates and annual bucket totals cannot prove past distributions", () => {
  const raw = rawFixture();
  const last = raw.financials.dividendHistory.at(-1);
  last.perTenSharesRmb = 99;
  last.distributions[0].exDividendDate = null;
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.equal(result.window.at(-1).perTenSharesRmb, null);
  assert.equal(result.excluded.at(-1).reason, "unverified-ex-date");
});

test("interim-only years do not masquerade as complete annual records", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory.at(-1).distributions[0].reportBasis = "2025-06-30";
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.deepEqual(result.incompleteYears, [2025]);
  assert.equal(result.window.at(-1).perTenSharesRmb, 14);
});

test("special distributions are excluded from recurring dividend stability", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory.push({ distributions: [distribution(2024, 100, { reportBasis: "2024-06-30", exDividendDate: "2024-09-01", dividendType: "特别分红" })] });
  const result = analyze(raw);
  assert.equal(result.score, 100);
  assert.equal(result.window.find((row) => row.year === 2024).perTenSharesRmb, 13);
  assert.equal(result.excluded.at(-1).reason, "special-dividend");
});

test("duplicate events do not inflate a year and conflicting amounts block scoring", () => {
  const raw = rawFixture();
  const last = raw.financials.dividendHistory.at(-1).distributions[0];
  raw.financials.dividendHistory.push({ distributions: [copy(last)] });
  assert.equal(analyze(raw).window.at(-1).perTenSharesRmb, 14);
  raw.financials.dividendHistory.push({ distributions: [{ ...last, perTenSharesRmb: 15 }] });
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.deepEqual(result.conflictingYears, [2025]);
});

test("share-basis changes cannot create an unadjusted dividend-cut ranking", () => {
  const raw = rawFixture();
  raw.financials.dividendHistory[2].distributions[0].plan = "10转5派12元(含税)";
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.deepEqual(result.nonComparableYears, [2023]);
});

test("cash flow, ROE and current yield do not alter historical stability", () => {
  const raw = rawFixture();
  const altered = copy(raw);
  Object.assign(altered, { currentDividendYield: 25, sustainableDividendYield: 0.1 });
  Object.assign(altered.financials, { freeCashFlow: -1e15, operatingCashFlow: -1e15, roe: -100, cashConversion: -100 });
  assert.equal(analyze(altered).score, analyze(raw).score);
});

test("missing source and invalid date are explicit unknowns", () => {
  const raw = rawFixture();
  delete raw.financials.dividendHistorySource;
  assert.equal(analyze(raw).score, null);
  assert.equal(analyze(raw).hasSource, false);
  assert.equal(getDividendStability(rawFixture(), { asOf: "bad-date" }).score, null);
  assert.doesNotThrow(() => getDividendStability(rawFixture(), { asOf: new Date(NaN) }));
  assert.doesNotThrow(() => getDividendStability(rawFixture(), { asOf: Infinity }));
  assert.doesNotThrow(() => getDividendStability(rawFixture(), { asOf: 1e20 }));
});

test("malformed history entries and boolean amounts cannot become numeric dividends", () => {
  assert.equal(analyze(null).score, null);
  const raw = rawFixture();
  raw.financials.dividendHistory.push(null, { distributions: [null] });
  raw.financials.dividendHistory.at(0).distributions[0].perTenSharesRmb = false;
  const result = analyze(raw);
  assert.equal(result.score, null);
  assert.equal(result.window.at(0).perTenSharesRmb, null);
  assert.ok(result.excluded.some((record) => record.reason === "invalid-record"));
});

test("fiscal window follows the China market date at the New Year boundary", () => {
  const result = getDividendStability(rawFixture(), { asOf: "2026-12-31T18:00:00Z" });
  assert.equal(result.asOf, "2027-01-01");
  assert.equal(result.endYear, 2026);
  assert.equal(result.score, null);
});

test("real 20-stock snapshot keeps year gaps and future distributions visible", () => {
  const rows = snapshot.aShare.fundamentals;
  assert.equal(rows.length, 20, "real fixture must have the product's 20-stock coverage");
  const results = rows.map((row) => ({ code: row.code, ...getDividendStability(row, { asOf: snapshot.updatedAt }) }));
  for (const result of results) {
    assert.ok(result.source, `${result.code}: real source must remain traceable`);
    if (result.score !== null) {
      assert.equal(result.window.length, 5);
      assert.equal(result.consecutiveYears, 5);
      assert.equal(result.comparisonCount, 4);
      assert.ok(result.window.every((year) => year.complete && year.records.every((record) => record.exDividendDate <= result.asOf)));
    }
    if (result.missingYears.length || result.incompleteYears.length) assert.equal(result.score, null);
  }
  const summary = results.map((result) => `${result.code} score=${result.score ?? "null"} years=${result.consecutiveYears}/5 cuts=${result.decreaseCount ?? "unknown"} missing=${result.missingYears.join(",") || "none"} future=${result.excluded.filter((row) => row.reason === "future-ex-date").length}`);
  console.log(`Real fixture: ${fixturePath}; asOf=${snapshot.updatedAt}\n${summary.join("\n")}`);
});
