import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { findItem } = require("../miniprogram/utils/answers");
const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));

function loadPageExports(relPath, names) {
  const url = new URL(`../${relPath}`, import.meta.url);
  const context = { require: createRequire(url), Page(def) { context.__page = def; }, console, wx: {}, getApp() { return {}; } };
  vm.runInNewContext(`${readFileSync(url, "utf8")}\nglobalThis.testApi = {${names.join(",")}};`, context);
  return { api: context.testApi, page: context.__page };
}

test("A-share Xiji benchmark: 12-month dividend calendar, life-expense mapping, 1yr yield percentile & DRIP", () => {
  const { api: secApi } = loadPageExports("miniprogram/pages/section/index.js", [
    "buildAModule", "buildLifeSummaryLine", "formatCalendarRows",
  ]);
  const aMod = secApi.buildAModule(snapshot);
  const cal = aMod.calendar;
  assert.equal(cal.months.length, 12);
  assert.ok(cal.months.filter((m) => m.count > 0).length >= 6, "calendar covers multiple payout months");
  const julyRows = formatRowsHelper(secApi.formatCalendarRows, cal.byMonth.get(7) || [], 10);
  assert.ok(julyRows.length >= 2);
  assert.match(julyRows[0].cashNote, /投10万单次约领 ¥/);
  assert.match(secApi.buildLifeSummaryLine(aMod.stableList, 10), /息覆生活/);

  const { api: detApi, page: detPage } = loadPageExports("miniprogram/pages/detail/index.js", ["detailView"]);
  const item = findItem(snapshot, "a", "600900.SH");
  const view = detApi.detailView(item, snapshot);
  assert.ok(view.dividendCharts.some((c) => /股息率分位/.test(c.title)), "exposes 1-year yield percentile meter");
  assert.ok(Array.isArray(view.recentDistributions) && view.recentDistributions.length >= 2, "exposes real ex-dividend log");
  const drip10 = detPage.formatDividendCalc(view.dividendCalc, 1000, 10);
  assert.ok(drip10.dripSharesText && drip10.yocText && drip10.lifeTag && drip10.dilutedCostText);
});

function formatRowsHelper(fn, rows, wan) {
  return fn(rows, wan);
}

test("HK IPO Futu/Zhangle/TradeGo benchmark: cornerstone de-noising, sponsor win-rates, 4-way sort & IPO calculator", () => {
  const { api: secApi } = loadPageExports("miniprogram/pages/section/index.js", [
    "buildHkModule", "cleanCornerstoneNames", "sortHkHistoryRows",
  ]);
  const cleaned = Array.from(secApi.cleanCornerstoneNames(["广发基金", "禁售期", "国际财务报告准则", "汇添富基金", "补充协议"]));
  assert.deepEqual(cleaned, ["广发基金", "汇添富基金"]);

  const hkMod = secApi.buildHkModule(snapshot);
  assert.ok(hkMod.sponsorRows.length >= 3, "aggregates sponsor track records from 45 IPOs");
  assert.ok(hkMod.crowdBuckets.length >= 2, "aggregates oversubscription crowd buckets");
  const topPnl = secApi.sortHkHistoryRows(hkMod.historyRowsAll, "pnl");
  assert.ok((topPnl[0].pnlNum ?? 0) >= (topPnl[1].pnlNum ?? 0));

  const { api: detApi, page: detPage } = loadPageExports("miniprogram/pages/detail/index.js", ["detailView"]);
  const activeHk = snapshot.hk.listings.find((l) => !l.withdrawn && l.entryFee > 0);
  assert.ok(activeHk);
  const hkView = detApi.detailView(findItem(snapshot, "hk", activeHk.rawCode || activeHk.id), snapshot);
  assert.ok(hkView.hkIpoCalc, "active HK IPO exposes fee & breakeven calculator");
  assert.doesNotMatch(JSON.stringify(hkView.facts), /国际财务报告准则|会计准则理事会/);
  const marginCalc = detPage.formatHkIpoCalc(hkView.hkIpoCalc, "margin10");
  assert.match(marginCalc.principalText, /^HK\$/);
  assert.match(marginCalc.breakevenText, /\+/);
});

test("US Mag7 Futu/Eastmoney/IBKR benchmark: peer comparison matrix, 4yr F10 pillar charts & guru endorsements", () => {
  const { api: secApi } = loadPageExports("miniprogram/pages/section/index.js", ["buildUsModule"]);
  const usMod = secApi.buildUsModule(snapshot);
  assert.ok(usMod.sevenCompare && usMod.sevenCompare.rows.length === 7);
  assert.ok(usMod.sevenCompare.benchPills.length >= 3);
  assert.ok(usMod.sevenList.some((r) => r.guruChip.includes("大师重仓")));
  assert.ok(usMod.filingsFeed.length >= 5 && usMod.filingsFeed[0].formZh);

  const { api: detApi } = loadPageExports("miniprogram/pages/detail/index.js", ["detailView"]);
  const nvda = detApi.detailView(findItem(snapshot, "us", "NVDA"), snapshot);
  assert.ok(nvda.dynamicsCharts.some((c) => c.kind === "solid" && c.title.includes("近4财年营收阶梯")));
  assert.ok(nvda.evidenceCharts.some((c) => c.title.includes("同业基准对照")));
  assert.ok(nvda.holdings.length >= 1, "surfaces institutional guru holdings on Mag7");
});
