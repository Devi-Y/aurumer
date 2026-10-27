import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { marketReferenceAsOf, referenceDateText } = require("../miniprogram/utils/historical-reference");
const { freshnessBanner } = require("../miniprogram/utils/freshness-ui");
const { findItem } = require("../miniprogram/utils/answers");
const { allItems } = require("../miniprogram/utils/answers");
const { buildDailyAnswers } = require("../miniprogram/utils/daily-answers");

function pageFunctions(path, names) {
  const url = new URL(`../${path}`, import.meta.url);
  const context = { require: createRequire(url), Page() {}, console, wx: {}, getApp() { return {}; } };
  vm.runInNewContext(`${readFileSync(url, "utf8")}\nglobalThis.testApi = {${names.join(",")}};`, context);
  return context.testApi;
}

test("historical quote dates never borrow a newer processing timestamp", () => {
  const snapshot = { updatedAt: "2026-10-27T01:00:00Z", us: { stocks: [{ asOf: "2026-10-23T20:00:00Z" }] } };
  assert.equal(marketReferenceAsOf(snapshot, "us"), "报价 2026-10-23");
  snapshot.us.stocks[0].asOf = null;
  assert.equal(marketReferenceAsOf(snapshot, "us"), "报价日期待核验");
  assert.equal(referenceDateText(["2026-13-03"]), "报价日期待核验");
  assert.equal(referenceDateText(["2026-10-22", "2026-10-23"]), "报价 2026-10-22—2026-10-23");
});

test("a newer independent gold quote cannot overwrite a historical close in either chart", () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, close: 100 + index }));
  const snapshot = { gold: { history: { international: history }, quotes: { international: { price: 999, asOf: "2026-10-13" } } } };
  const original = JSON.stringify(snapshot);
  const { buildHomeTrends } = pageFunctions("miniprogram/pages/index/index.js", ["buildHomeTrends"]);
  const home = buildHomeTrends(snapshot).find((card) => card.id === "gold");
  assert.equal(home.value, "$111");
  assert.equal(home.asOf, "走势至 2026-10-12");
  const { buildGoldModule } = pageFunctions("miniprogram/pages/section/index.js", ["buildGoldModule"]);
  const module = buildGoldModule(snapshot);
  assert.equal(module.perCurrency.usd.chartsByPeriod.all.latestLabel, "期末 111");
  assert.equal(module.quotes[0].priceText, "999", "independent quote remains intact and separately dated");
  assert.equal(module.quotes[0].asOfText, "报价 2026-10-13");
  assert.equal(JSON.stringify(snapshot), original);
});

test("historical views do not offer instant order cards even for an otherwise fresh quote", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
  snapshot.actionsFresh = true;
  snapshot.us.stocks.forEach((stock) => { stock.actionsFresh = true; });
  const { buildUsModule } = pageFunctions("miniprogram/pages/section/index.js", ["buildUsModule"]);
  const module = buildUsModule(snapshot);
  assert.equal(module.triggerTiles.length, 0);
  assert.equal(module.allList.some((row) => row.hasOrder), false);
  const { detailView } = pageFunctions("miniprogram/pages/detail/index.js", ["detailView"]);
  const detail = detailView(findItem(snapshot, "us", snapshot.us.stocks[0].symbol), snapshot);
  assert.equal(detail.overview.orderPlan, null);
  assert.equal(detail.metrics.some((row) => /当前价格|今日涨跌/.test(row[0])), false);
});

test("historical presentation keeps upstream failure and missing-data warnings visible", () => {
  for (const kind of ["cached", "offline", "partial", "stale"]) {
    const banner = freshnessBanner("数据源暂时不可用", kind);
    assert.equal(banner.show, true);
    assert.equal(banner.showRetry, true);
    assert.ok(banner.tip);
  }
});

test("gold entry cards and deep links retain dated facts without buy/sell instructions", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
  snapshot.updatedAt = new Date().toISOString();
  snapshot.actionsFresh = true;
  snapshot.gold.actionsFresh = true;
  snapshot.gold.answer.action = "可分批加大";
  Object.values(snapshot.gold.quotes).forEach((quote) => { quote.asOf = snapshot.updatedAt; quote.actionsFresh = true; });
  const cards = buildDailyAnswers(snapshot, "gold");
  assert.equal(cards.some((card) => ["gold-buy", "gold-sell"].includes(card.id)), false);
  assert.equal(cards.find((card) => card.id === "gold-price").question, "历史报价");
  const entries = allItems(snapshot, "gold");
  assert.equal(entries.some((entry) => /现在怎么做|可分批加大/.test(`${entry.name} ${entry.badge} ${entry.one}`)), false);
  const { detailView } = pageFunctions("miniprogram/pages/detail/index.js", ["detailView"]);
  for (const entry of entries) assert.doesNotMatch(JSON.stringify(detailView(entry, snapshot)), /可分批加大/);
});

test("A-share detail removes model target-price intervals instead of relabeling them as history", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
  const { detailView } = pageFunctions("miniprogram/pages/detail/index.js", ["detailView"]);
  const view = detailView(findItem(snapshot, "a", snapshot.aShare.quotes[0].code), snapshot);
  assert.equal(view.overview.priceCard, null);
  assert.doesNotMatch(JSON.stringify(view.metrics), /参考买入|参考卖出/);
  assert.equal(view.trendCharts.some((chart) => chart.title === "参考买卖区间"), false);
});

test("historical US and A-share cards and old action-group links cannot expose model price targets", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
  for (const market of ["us", "a"]) {
    const cards = buildDailyAnswers(snapshot, market);
    assert.equal(cards.some((card) => ["us-risk", "us-cheap", "a-add", "a-trim"].includes(card.id)), false);
    if (market === "a") for (const card of cards) {
      assert.doesNotMatch(JSON.stringify(card), /参考买|参考卖|什么价可加大|什么价可兑现/);
    }
  }
  const filename = new URL("../miniprogram/pages/list/index.js", import.meta.url);
  const localRequire = createRequire(filename);
  for (const [market, group] of [["a", "add"], ["a", "trim"], ["us", "risk7"], ["us", "cheap7"], ["gold", "plan"]]) {
    let page;
    vm.runInNewContext(readFileSync(filename, "utf8"), {
      require: (id) => id === "../../data/store" ? { loadSnapshot: (callback) => callback(snapshot, "历史资料", { kind: "fresh" }) }
        : id === "../../utils/analytics" ? { track() {} } : localRequire(id),
      Page: (definition) => { page = definition; page.setData = (data, done) => { Object.assign(page.data, data); if (done) done(); }; },
      wx: { setNavigationBarTitle() {} }, console,
    });
    page.onLoad({ market, group });
    assert.notEqual(page.data.group, group, `${market}/${group} redirects to a fact group`);
    assert.equal(page.data.groups.some((item) => item.id === group), false);
  }
});
