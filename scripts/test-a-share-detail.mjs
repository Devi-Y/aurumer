import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { findItem } = require("../miniprogram/utils/answers");
const url = new URL("../miniprogram/pages/detail/index.js", import.meta.url);
const context = { require: createRequire(url), Page() {}, console, wx: {}, getApp() { return {}; } };
vm.runInNewContext(`${readFileSync(url, "utf8")}\nglobalThis.testApi = { detailView };`, context);
const { detailView } = context.testApi;
const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));

test("A-share detail explains the sourced historical yield and keeps dividend and cash-flow charts", () => {
  const item = findItem(snapshot, "a", "600900.SH");
  assert.ok(item.raw.historicalDividendYield);
  const historical = item.raw.historicalDividendYield;
  const view = detailView(item, snapshot);
  const visible = JSON.stringify(view);
  assert.match(visible, /税前历史股息率/);
  assert.ok(visible.includes(historical.priceAsOf));
  assert.ok(visible.includes(historical.dividendSource));
  assert.ok(visible.includes(historical.priceSource));
  assert.ok(view.dividendCharts.some((chart) => chart.title.includes("所属年度分红")));
  assert.ok(view.dividendCharts.some((chart) => chart.title === "现金与质量"));
  assert.equal(view.strategy, null);
  assert.doesNotMatch(visible, /样本股息率|可持续股息率|10万年息|10万估算年息|参考买入|参考卖出/);
});

test("missing historical yield stays missing rather than falling back to old estimates", () => {
  const item = findItem(snapshot, "a", "600900.SH");
  item.raw.historicalDividendYield = null;
  item.raw.currentDividendYield = 88;
  item.raw.sustainableDividendYield = 77;
  item.raw.annualDividendPer100k = 99999;
  const view = detailView(item, snapshot);
  const visible = JSON.stringify(view);
  assert.match(view.answer, /暂不计算/);
  assert.doesNotMatch(visible, /88\.0%|77\.0%|99999|可持续股息率|10万年息/);
});

test("missing financial values remain unknown and zero cash flow is not negative", () => {
  const item = findItem(snapshot, "a", "600900.SH");
  item.raw.financials = { ...item.raw.financials, revenueGrowth: null, netProfitGrowth: null, freeCashFlow: null, cashConversion: null };
  let view = detailView(item, snapshot);
  let risk = view.riskItems.find((row) => row.title === "经营风险").body;
  assert.match(risk, /财务资料不足/);
  assert.doesNotMatch(risk, /为负|0\.00/);
  item.raw.financials.freeCashFlow = 0;
  view = detailView(item, snapshot);
  risk = view.riskItems.find((row) => row.title === "经营风险").body;
  assert.match(risk, /自由现金流为零/);
  assert.doesNotMatch(risk, /自由现金流为负/);
});
