import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { buildGuruTrend } = require("../miniprogram/utils/guru-trend.js");
const holding = (ticker, changeType, extra = {}) => ({ ticker, changeType, putCall: null, weight: 5, ...extra });
const investor = (id, holdings, extra = {}) => ({ id, name: id, reportDate: "2026-06-30", holdings, sold: [], ...extra });

test("coverage excludes unclassified funds before selecting a common reporting period", () => {
  const data = { investors: [
    investor("a", [holding("AAPL", "up")]),
    investor("b", [holding("AAPL", "new")]),
    ...[1, 2, 3].map((n) => investor(`unknown-${n}`, [{ ticker: "600036.SH" }], { reportDate: "2026-09-30" })),
    investor("old", [holding("MSFT", "down")], { reportDate: "2026-03-31" }),
  ] };
  const trend = buildGuruTrend(data);
  assert.equal(trend.reportPeriod, "2026-06-30");
  assert.equal(trend.investorCount, 2);
  assert.equal(trend.excludedInvestorCount, 4);
  assert.equal(trend.consensusAdds[0].adders.length, 2);
});

test("option exits and legacy exits with missing instrument type cannot become stock reductions", () => {
  const row = investor("a", [holding("AAPL", "same")], { sold: [
    { ticker: "PLTR", putCall: "Put" },
    { ticker: "TSLA", putCall: "Call" },
    { ticker: "UNKNOWN" },
    { ticker: "MSFT", putCall: null },
  ] });
  const trend = buildGuruTrend({ investors: [row] });
  assert.equal(trend.totals.exit, 1);
  assert.equal(trend.unverifiedExitCount, 1);
  assert.deepEqual(trend.cuts.map((item) => item.symbol), ["MSFT"]);
});

test("one manager is counted once per stock and opposing managers remain a split", () => {
  const trend = buildGuruTrend({ investors: [
    investor("a", [holding("AAPL", "up"), holding("AAPL", "new")]),
    investor("b", [holding("AAPL", "down")]),
  ] });
  assert.equal(trend.split.length, 1);
  assert.equal(trend.split[0].adders.length, 1);
  assert.equal(trend.split[0].cutters.length, 1);
  assert.equal(trend.consensusAdds.length, 0);
});

test("no verified ordinary-stock changes means no trend denominator", () => {
  const trend = buildGuruTrend({ investors: [investor("a", [holding("PLTR", "new", { putCall: "Put" })])] });
  assert.equal(trend.investorCount, 0);
  assert.equal(trend.reportPeriod, "");
  assert.equal(trend.adds.length, 0);
});

const { buildGuruChanges } = require("../miniprogram/utils/guru-changes.js");
test("single-manager direction accepts canonical up/down codes and leaves unknown holdings unknown", () => {
  const rows = [holding("AAPL", "up"), holding("MSFT", "down"), holding("GOOGL", "same"), { ticker: "UNKNOWN" }];
  const result = buildGuruChanges({ investors: [investor("a", rows)] })[0];
  assert.deepEqual(result.increased.map((row) => row.ticker), ["AAPL"]);
  assert.deepEqual(result.decreased.map((row) => row.ticker), ["MSFT"]);
  assert.deepEqual(result.topHoldings.map((row) => row.changeLabel), ["up", "down", "same", ""]);
});
