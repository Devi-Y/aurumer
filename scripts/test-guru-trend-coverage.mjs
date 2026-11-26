import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
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

function renderGuruModule(investors) {
  const page = new URL("../miniprogram/pages/section/index.js", import.meta.url);
  const context = { require: createRequire(page), Page() {} };
  vm.runInNewContext(`${readFileSync(page, "utf8")}\nglobalThis.render = buildGuruModule;`, context);
  return context.render({ investors });
}

test("the section shows distinct change types from the same two quarterly disclosures", () => {
  const dates = { reportDate: "2026-06-30", previousReportDate: "2026-03-31" };
  const view = renderGuruModule([
    investor("existing", [holding("STM", "up"), holding("BAC", "down")], dates),
    investor("new", [holding("STM", "new")], { ...dates, sold: [{ ticker: "BAC", putCall: null }] }),
    investor("unpaired", [holding("STM", "new")], { reportDate: dates.reportDate }),
    investor("skipped", [holding("BAC", "down")], { ...dates, previousReportDate: "2025-12-31" }),
    investor("other-period", [holding("STM", "up")], { reportDate: "2026-09-30", previousReportDate: "2026-06-30" }),
  ]);
  assert.equal(view.trendTitle, "报告期截至 2026-06-30");
  assert.match(view.trendHint, /^2家机构的部分持仓.*披露有滞后$/);
  assert.equal(view.trendRows.find((row) => row.key === "STM").badge, "1家增持 · 1家新进");
  assert.equal(view.trendRows.find((row) => row.key === "BAC").badge, "1家减持 · 1家清仓");
});

test("the section does not present undated or single-quarter holdings as changes", () => {
  const view = renderGuruModule([
    investor("undated", [holding("STM", "new")], { reportDate: "" }),
    investor("single-quarter", [holding("BAC", "new")]),
  ]);
  assert.equal(view.trendRows.length, 0);
  assert.equal(view.trendHint, "");
  assert.equal(view.trendEmptyText, "暂无同一报告期可比较的持仓资料");
});
