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

test("A-share Xiji benchmark: full 20-stock pool, 12-month calendar, cost-yield switcher, 1yr yield percentile & DRIP", () => {
  const { api: secApi } = loadPageExports("miniprogram/pages/section/index.js", [
    "buildAModule", "buildLifeSummaryLine", "formatCalendarRows",
  ]);
  const aMod = secApi.buildAModule(snapshot);
  assert.equal(aMod.allList.length, 20, "all-20 tab genuinely covers all 20 A-share dividend stocks");
  assert.match(aMod.answerBar, /^20 只收息股/, "answerBar reflects all 20 A-share stocks");
  assert.ok(aMod.sectorDonut && aMod.sectorDonut.src.startsWith("data:image/svg+xml;base64,"), "A-share section exposes sector allocation donut SVG");
  assert.ok(aMod.sectorDonut.legend.every((s) => s.avgYieldText.startsWith("均息 ")), "A-share sector donut shows per-sector average dividend yield");
  const cal = aMod.calendar;
  assert.equal(cal.months.length, 12);
  assert.ok(cal.months.filter((m) => m.count > 0).length >= 6, "calendar covers multiple payout months");
  const julyRows = formatRowsHelper(secApi.formatCalendarRows, cal.byMonth.get(7) || [], 10);
  assert.ok(julyRows.length >= 2);
  assert.match(julyRows[0].cashNote, /投10万单次约领 ¥/);
  assert.match(secApi.buildLifeSummaryLine(aMod.stableList, 10), /投10万均领 ¥.*约抵/);

  const { api: detApi, page: detPage } = loadPageExports("miniprogram/pages/detail/index.js", ["detailView", "buildPeerNav"]);
  for (const code of ["600900.SH", "601398.SH"]) {
    const item = findItem(snapshot, "a", code);
    const view = detApi.detailView(item, snapshot);
    assert.ok(view.dividendCharts.some((c) => c.kind === "gauge" && /股息率.*(分位|表盘)/.test(c.title)), `${code} exposes 1-year yield percentile gauge`);
    assert.ok(view.dividendCharts.some((c) => c.kind === "donut" && /派息结构/.test(c.title)), `${code} exposes real payout-ratio donut`);
    assert.ok(view.evidenceCharts.some((c) => c.kind === "dualbars" && /近4财年营收与归母净利对比/.test(c.title)), `${code} exposes 4yr revenue & profit dual bars`);
    assert.ok(view.trendCharts.some((c) => c.kind === "dualline" && /对比红利ETF/.test(c.title)), `${code} exposes dual-line return chart vs 515180`);
    assert.ok(Array.isArray(view.recentDistributions) && view.recentDistributions.length >= 1, `${code} exposes real ex-dividend log`);
    const spotCalc = detPage.formatDividendCalc(view.dividendCalc, 1000, 10, "spot");
    const dipCalc = detPage.formatDividendCalc(view.dividendCalc, 1000, 10, "dip12");
    assert.ok(spotCalc.dripSharesText && spotCalc.yocText && spotCalc.lifeTag && spotCalc.dilutedCostText);
    assert.ok(parseFloat(dipCalc.entryYieldText) > parseFloat(spotCalc.entryYieldText), "lower buy cost increases cost-basis dividend yield");
    assert.match(dipCalc.costDiffText, /比现价少掏 ¥/);
    const peerNav = detApi.buildPeerNav(snapshot, item);
    assert.ok(peerNav && peerNav.indexText.endsWith("/20"), `${code} participates in 20-stock peer swipe queue`);
  }
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
  assert.ok(hkMod.industryRows.length >= 3, "aggregates industry first-day win-rate leaderboard");
  assert.equal(hkMod.stageCompare.length, 3, "exposes grey/firstDay/fiveDay 3-stage win-rate & avg-return chart");
  assert.ok(Array.isArray(hkMod.freshApplyList) && hkMod.freshApplyList.length <= hkMod.applyList.length, "separates fresh live IPOs from stale unarchived rows");
  assert.ok(hkMod.applyList.every((r) => !/股份有限$/.test(r.name)), "strips -B/-W legal tails cleanly");
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

test("US Mag7 & Smart-Money Futu/Eastmoney/IBKR benchmark: FCF vs CapEx matrix, 4yr F10 pillar charts, search & bidirectional guru links", () => {
  const { api: secApi } = loadPageExports("miniprogram/pages/section/index.js", ["buildUsModule", "buildGuruModule", "buildGoldModule"]);
  const usMod = secApi.buildUsModule(snapshot);
  assert.ok(usMod.sevenCompare && usMod.sevenCompare.rows.length === 7);
  assert.ok(usMod.sevenCompare.rows.some((r) => r.fcfText && r.fcfText !== "—" && r.capexText !== "—"), "computes CapEx & Free Cash Flow across Mag7");
  assert.ok(usMod.sevenCompare.benchPills.length >= 3);
  assert.equal(usMod.etfList.length, 5, "activates all 5 US sleeve benchmark ETFs with live Yahoo quotes");
  assert.ok(usMod.etfList.every((e) => e.sparkSrc && e.yieldText), "every US benchmark ETF carries 60d sparkline and TTM yield");
  assert.ok(usMod.sectorDonut && usMod.sectorDonut.src.startsWith("data:image/svg+xml;base64,"), "exposes 30-stock US sector donut SVG");
  assert.ok(usMod.sevenList.some((r) => r.guruChip.includes("大师重仓")));
  assert.ok(usMod.filingsFeed.length >= 5 && usMod.filingsFeed[0].formZh);

  const goldMod = secApi.buildGoldModule(snapshot);
  assert.ok(goldMod.perCurrency.usd.ladder && goldMod.perCurrency.usd.ladder.tiles.length === 3, "gold exposes 3-level historical observation ladder");

  const guruMod = secApi.buildGuruModule(snapshot);
  assert.ok(guruMod.actionDonut && guruMod.actionDonut.src.startsWith("data:image/svg+xml;base64,"), "guru exposes quarterly action breakdown donut SVG");
  assert.ok(guruMod.holdingsByInstitution.druckenmiller.soldPills.length >= 1, "surfaces disclosed sold/exited positions on guru holding cards");
  assert.ok(guruMod.overlapRows.some((r) => r.linkMarket === "us" && r.linkId), "guru overlap rows link to in-pool US stocks");
  assert.ok(guruMod.overlapRows.every((r) => !/德鲁肯米$/.test(r.holdersText)), "does not chop Druckenmiller surname");

  const { api: detApi } = loadPageExports("miniprogram/pages/detail/index.js", ["detailView"]);
  const nvda = detApi.detailView(findItem(snapshot, "us", "NVDA"), snapshot);
  assert.ok(nvda.dynamicsCharts.some((c) => c.kind === "dualbars" && c.title.includes("近4财年营收与净利润对比")));
  assert.ok(nvda.evidenceCharts.some((c) => c.kind === "compare" && c.title.includes("七巨头中位")));
  assert.ok(nvda.trendCharts.some((c) => c.kind === "gauge" && c.title.includes("价格分位表盘")));
  assert.ok(nvda.trendCharts.some((c) => c.kind === "dualline" && c.title.includes("对比标普500")));
  assert.ok(nvda.holdings.length >= 1 && nvda.holdings[0].investorId, "surfaces clickable institutional guru holdings on Mag7");

  const { api: homeApi } = loadPageExports("miniprogram/pages/index/index.js", ["buildSearchIndex"]);
  const searchIdx = homeApi.buildSearchIndex(snapshot);
  const changjiangHits = searchIdx.filter((r) => r.name === "长江电力");
  assert.equal(changjiangHits.length, 1, "deduplicates 600900 vs 600900.SH in home search");
  assert.ok(searchIdx.every((r) => !String(r.id).startsWith("overlap-")), "excludes non-detail overlap rows from search");
  assert.ok(searchIdx.some((r) => r.id === "600036" && r.haystack.includes("招行")), "supports colloquial bank aliases");
  assert.ok(searchIdx.some((r) => r.market === "guru" && r.haystack.includes("腾讯")), "indexes guru top holdings for reverse search");
});
