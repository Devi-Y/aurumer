import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import { validUSActionReference } from "./public-quote-contract.mjs";

// Run with: node --test scripts/test-data-reliability.mjs
// No network, cloud writes, wx payments, snapshot writes, or fixed calendar dates.
// Real fixture structure and facts are retained; only clock-relative quote times,
// explicit action flags and small test price plans are replaced in memory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const original = JSON.parse(readFileSync(path.join(root, "data/live-snapshot.json"), "utf8"));
const mini = require("../miniprogram/utils/action-freshness.js");
const cloud = require("../cloudfunctions/aurum-data/action-freshness.js");
const { allItems, findItem } = require("../miniprogram/utils/answers.js");
const { buildStrategySignal } = require("../miniprogram/utils/strategy-signals.js");
const { yieldImpliedPlan } = require("../miniprogram/utils/market-lenses.js");
const { usOrderState, aOrderState } = require("../miniprogram/utils/order-plan.js");
const { buildDailyAnswers } = require("../miniprogram/utils/daily-answers.js");
const { sanitizeSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");

const hour = 60 * 60 * 1000;
const iso = (offset = -hour) => new Date(Date.now() + offset).toISOString();
const clone = (value) => structuredClone(value);

test("publication accepts dated US fallback without reintroducing action prices", () => {
  const row = { symbol: "NVDA", price: 100, asOf: iso(-72 * hour), actionsFresh: false, actionNote: "本轮获取失败，保留原日期资料" };
  assert.equal(validUSActionReference(row), true);
  assert.equal(validUSActionReference({ ...row, pricePlan: { buy: 90 } }), false);
  assert.equal(validUSActionReference({ ...row, actionNote: "" }), false);
  assert.equal(validUSActionReference({ ...row, asOf: "" }), false);
});

test("missing current references cannot silently masquerade as a disabled fallback", () => {
  const row = { symbol: "NVDA", price: 100, asOf: iso(-hour) };
  assert.equal(validUSActionReference(row), false);
  assert.equal(validUSActionReference({ ...row, technicalPlan: { buy: 90, stop: 80, tp: [110, 120] } }), true);
});

function freshFixture(offset = -hour) {
  const data = clone(original);
  const stamp = iso(offset);
  data.status = "live";
  data.updatedAt = stamp;
  delete data.revisionAt; // Synthetic quote batches must not inherit a real correction timestamp.
  delete data.actionsFresh;
  delete data.actionFreshness;
  delete data.actionDegradeReason;
  const reset = (row) => {
    if (!row) return;
    delete row.actionsFresh;
    delete row.actionNote;
    delete row.snapshotUpdatedAt;
    row.asOf = stamp;
    if ("priceAsOf" in row) row.priceAsOf = stamp;
  };
  for (const stock of data.us.stocks) {
    reset(stock);
    const price = Number(stock.price);
    stock.pricePlan = { buy: price * 0.95, stop: price * 0.8, sell: [price * 1.1] };
  }
  for (const quote of data.aShare.quotes) reset(quote);
  for (const fund of data.aShare.funds || []) reset(fund);
  delete data.gold.actionsFresh;
  delete data.gold.snapshotUpdatedAt;
  delete data.gold.actionNote;
  data.gold.status = "live";
  data.gold.updatedAt = stamp;
  for (const quote of Object.values(data.gold.quotes || {})) reset(quote);
  const intl = Number(data.gold.quotes.international.price);
  const domestic = Number(data.gold.quotes.domestic.price);
  data.gold.answer.pricePlan = {
    status: "available",
    internationalWatch: { low: intl * 0.9, high: intl * 0.95, currency: "USD/oz" },
    internationalUpper: { low: intl * 1.1, high: intl * 1.2, currency: "USD/oz" },
    internationalRisk: { low: intl * 0.8, currency: "USD/oz" },
    domesticWatch: { low: domestic * 0.9, high: domestic * 0.95, currency: "CNY/g" },
    domesticUpper: { low: domestic * 1.1, high: domestic * 1.2, currency: "CNY/g" },
    domesticRisk: { low: domestic * 0.8, currency: "CNY/g" },
  };
  return data;
}

function partialGoldFixture() {
  const data = freshFixture();
  data.status = "partial";
  data.gold.status = "partial";
  data.gold.answer.pricePlan = { status: "unavailable" };
  return data;
}

function loadCjs(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    process,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    ...globals,
  });
  new vm.Script(readFileSync(filename, "utf8"), { filename }).runInContext(context);
  return module.exports;
}

async function loadFromStore(bundle, remote) {
  const store = loadCjs("miniprogram/data/store.js", { "./live-snapshot": bundle }, {
    wx: { cloud: { callFunction: async () => ({ result: { ok: true, data: remote } }) } },
  });
  const updates = [];
  await new Promise((resolve) => store.loadSnapshot(
    (snapshot, source, meta) => updates.push({ snapshot, source, meta }),
    resolve,
    { force: true },
  ));
  return { store, updates, latest: updates.at(-1) };
}

function mockHttps(outcomes, requested) {
  return {
    get(url, options, callback) {
      requested.push(String(url));
      const request = new EventEmitter();
      request.destroy = (error) => request.emit("error", error);
      const outcome = outcomes[String(url).includes("raw.githubusercontent.com") ? "raw" : "pages"];
      setTimeout(() => {
        if (outcome.error) return request.emit("error", new Error(outcome.error));
        const response = new EventEmitter();
        response.statusCode = outcome.status ?? 200;
        response.headers = {};
        response.resume = () => {};
        callback(response);
        response.emit("data", Buffer.from(JSON.stringify(outcome.data)));
        response.emit("end");
      }, outcome.delay ?? 0);
      return request;
    },
  };
}

function cloudHandler(outcomes, requested = []) {
  return loadCjs("cloudfunctions/aurum-data/index.js", {
    "node:https": mockHttps(outcomes, requested),
    "./fact-versions": { writeFactVersions: async () => null },
    "./ops-alert": { alertOpsOnce: async () => null },
    "wx-server-sdk": { init() {}, database: () => null },
  });
}

test("fresh quotes retain plans through allItems → signal → order helpers", () => {
  const data = freshFixture();
  const us = allItems(data, "us").find((item) => item.group === "seven");
  const a = allItems(data, "a").find((item) => item.raw.assetType !== "fund");
  assert.ok(us && a, "real fixture must cover both stock markets");
  assert.notEqual(buildStrategySignal(us).label, "数据待更新");
  assert.ok(usOrderState(us.raw), "a verified fresh US plan must remain usable");
  assert.notEqual(buildStrategySignal(a).label, "数据待更新");
  assert.ok(yieldImpliedPlan(a.raw), "fresh A-share dividend prices must remain usable");
  assert.ok(aOrderState(a.raw));
});

test("old snapshots cannot regenerate signals or orders, even if a row has a recent quote", () => {
  const data = freshFixture();
  data.updatedAt = iso(-72 * hour);
  for (const item of allItems(data, "us")) {
    assert.equal(buildStrategySignal(item).label, "数据待更新");
    assert.equal(usOrderState(item.raw), null);
  }
  for (const item of allItems(data, "a")) {
    if (item.raw.assetType !== "fund") assert.equal(buildStrategySignal(item).label, "数据待更新");
    assert.equal(yieldImpliedPlan(item.raw), null);
    assert.equal(aOrderState(item.raw), null);
  }
});

test("A-share detail-only fallback inherits an expired snapshot gate", () => {
  const data = freshFixture();
  data.updatedAt = iso(-72 * hour);
  const represented = new Set(allItems(data, "a").map((item) => item.code));
  const outside = data.aShare.quotes.find((row) => !represented.has(row.code));
  assert.ok(outside, "fixture must include an A-share outside the 10-item visible sample");
  const fallback = findItem(data, "a", outside.code);
  assert.equal(buildStrategySignal(fallback).label, "数据待更新", "detail fallback must inherit the snapshot gate");
  assert.equal(aOrderState(fallback.raw), null);
});

test("individual quote age survives a newly fetched snapshot and a second degradation pass", () => {
  const data = freshFixture();
  data.us.stocks[0].asOf = iso(-72 * hour);
  data.aShare.quotes[0].priceAsOf = iso(-72 * hour);
  for (const helper of [mini, cloud]) {
    const once = helper.degradeStaleActions(data);
    const twice = helper.degradeStaleActions(once);
    assert.equal(twice.us.stocks[0].actionsFresh, false);
    assert.equal(twice.us.stocks[0].pricePlan, undefined);
    assert.equal(twice.aShare.quotes[0].actionsFresh, false);
    assert.equal(twice.us.stocks[0].asOf, data.us.stocks[0].asOf);
  }
});

test("missing quote time is never proof of action freshness", () => {
  for (const helper of [mini, cloud]) {
    assert.equal(helper.isActionDataFresh({ price: 100 }), false);
    const data = freshFixture();
    delete data.us.stocks[0].asOf;
    delete data.us.stocks[0].priceAsOf;
    const item = allItems(helper.degradeStaleActions(data), "us").find((row) => row.id === data.us.stocks[0].symbol);
    assert.equal(buildStrategySignal(item).label, "数据待更新");
    assert.equal(usOrderState(item.raw), null);
  }
});

test("future snapshot and future quote times cannot issue actions", () => {
  for (const helper of [mini, cloud]) {
    assert.equal(helper.isActionFresh(iso(hour)), false);
    assert.equal(helper.isActionDataFresh({ price: 100, asOf: iso(hour) }), false);
    const future = freshFixture(hour);
    assert.equal(helper.degradeStaleActions(future).actionsFresh, false);
    assert.equal(usOrderState(allItems(future, "us")[0].raw), null);
  }
});

test("partial gold degrades gold actions while fresh US and A-share actions remain usable", () => {
  const data = partialGoldFixture();
  for (const helper of [mini, cloud]) {
    const next = helper.degradeStaleActions(data);
    assert.equal(next.actionsFresh, true);
    assert.equal(helper.marketActionsFresh(next, "us"), true);
    assert.equal(helper.marketActionsFresh(next, "a"), true);
    assert.equal(helper.marketActionsFresh(next, "gold"), false);
    assert.equal(next.gold.actionsFresh, false);
    assert.equal(next.gold.answer.pricePlan.internationalWatch, null);
    assert.ok(usOrderState(allItems(next, "us")[0].raw));
    assert.ok(aOrderState(allItems(next, "a").find((item) => item.raw.assetType !== "fund").raw));
  }
});

test("partial status does not bypass the required dual-gold-quote structure", () => {
  const data = partialGoldFixture();
  data.gold.quotes.domestic = null;
  assert.throws(() => sanitizeSnapshot(data), /黄金双市场资料不完整/);
});

test("store accepts a newer partial-gold snapshot over an older full gold plan", async () => {
  const bundled = freshFixture(-2 * hour);
  const remote = partialGoldFixture();
  remote.us.stocks[0].price += 1;
  const { latest } = await loadFromStore(bundled, remote);
  assert.equal(latest.snapshot.updatedAt, remote.updatedAt);
  assert.equal(latest.snapshot.us.stocks[0].price, remote.us.stocks[0].price);
  assert.equal(latest.snapshot.gold.actionsFresh, false);
  assert.equal(latest.snapshot.actionsFresh, true);
});

test("store rejects a future snapshot so it cannot block subsequent valid updates", async () => {
  const bundle = freshFixture(-2 * hour);
  const future = freshFixture(24 * hour);
  const { latest } = await loadFromStore(bundle, future);
  assert.equal(latest.snapshot.updatedAt, bundle.updatedAt);
});

test("partial gold does not delete the dated gold quote fact card", () => {
  const data = partialGoldFixture();
  const cards = buildDailyAnswers(data, "gold");
  const fact = cards.find((item) => item.id === "gold-price");
  assert.ok(fact, "gold price fact card must exist");
  const international = String(fact.answer).match(/国际金\s*([\d,.]+)/);
  const domestic = String(fact.answer).match(/人民币金\s*([\d,.]+)/);
  assert.ok(international && Math.abs(Number(international[1].replaceAll(",", "")) - data.gold.quotes.international.price) <= 0.5, "published international quote remains readable at whole-dollar or finer precision");
  assert.ok(domestic && Math.abs(Number(domestic[1].replaceAll(",", "")) - data.gold.quotes.domestic.price) <= 0.1, "domestic quote remains readable at 0.1 yuan or finer precision");
  assert.ok(cards.filter((item) => ["gold-buy", "gold-sell"].includes(item.id)).every((item) => item.state === "stale" || item.enabled === false));
});

test("partial gold does not erase fresh daily answers in other markets", () => {
  const data = partialGoldFixture();
  for (const market of ["us", "a"]) {
    const cards = buildDailyAnswers(data, market);
    assert.ok(cards.some((item) => item.enabled && item.state !== "stale"), `${market} keeps fresh cards`);
  }
});

test("US hot three can include a magnificent-seven stock from the actual pool", () => {
  const data = freshFixture();
  const pick = data.us.stocks.find((row) => row.symbol === "NVDA");
  assert.ok(pick);
  for (const row of data.us.stocks) row.heatScore = row === pick ? 1000 : 1;
  const hot = allItems(data, "us").filter((row) => row.group === "hot");
  assert.equal(hot.length, Math.min(3, data.us.stocks.length));
  assert.equal(hot[0].code, "NVDA");
});

test("missing heat data does not fabricate a hot-three ranking from fixture order", () => {
  const data = freshFixture();
  for (const row of data.us.stocks) delete row.heatScore;
  assert.equal(allItems(data, "us").filter((row) => row.group === "hot").length, 0);
});

test("client failure keeps bundled facts and retries after the degraded TTL", async () => {
  const bundle = freshFixture(-2 * hour);
  const remote = freshFixture();
  let clock = Date.now();
  let calls = 0;
  const store = loadCjs("miniprogram/data/store.js", { "./live-snapshot": bundle }, {
    Date: class extends Date { static now() { return clock; } },
    wx: { cloud: { callFunction: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary test failure");
      return { result: { ok: true, data: remote } };
    } } },
  });
  const load = () => new Promise((resolve) => {
    const updates = [];
    store.loadSnapshot((snapshot, source, meta) => updates.push({ snapshot, source, meta }), () => resolve(updates));
  });
  const failed = await load();
  assert.equal(failed.at(-1).snapshot.updatedAt, bundle.updatedAt);
  assert.equal(failed.at(-1).meta.kind, "cached");
  clock += 30 * 1000;
  await load();
  assert.equal(calls, 1, "failure retries must still respect the short TTL");
  clock += 31 * 1000;
  const recovered = await load();
  assert.equal(calls, 2, "a failed response must not pin the client for 10 minutes");
  assert.equal(recovered.at(-1).snapshot.updatedAt, remote.updatedAt);
  assert.equal(recovered.at(-1).meta.kind, "fresh");
});

test("two failed cloud sources return a bounded explicit unavailable response", async () => {
  const requested = [];
  const handler = cloudHandler({ pages: { error: "pages test failure" }, raw: { error: "raw test failure" } }, requested);
  const result = await handler.main({ action: "getSnapshot", force: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "DATA_TEMPORARILY_UNAVAILABLE");
  assert.equal(requested.length, 2);
});

test("a fast malformed source cannot beat the valid slower cloud fallback", async () => {
  const handler = cloudHandler({ pages: { data: {}, delay: 0 }, raw: { data: freshFixture(), delay: 10 } });
  const result = await handler.main({ action: "getSnapshot", force: true });
  assert.equal(result.ok, true, "fallback validation belongs inside each source race candidate");
  assert.ok(result.sourceUrl.includes("raw.githubusercontent.com"));
  assert.equal(result.data.actionsFresh, true);
});

test("a fast expired source cannot beat the valid slower fresh cloud fallback", async () => {
  const expired = freshFixture(-72 * hour);
  const current = freshFixture();
  const handler = cloudHandler({ pages: { data: expired, delay: 0 }, raw: { data: current, delay: 10 } });
  const result = await handler.main({ action: "getSnapshot", force: true });
  assert.equal(result.ok, true);
  assert.ok(result.sourceUrl.includes("raw.githubusercontent.com"));
  assert.equal(result.data.updatedAt, current.updatedAt);
  assert.equal(result.data.actionsFresh, true);
});
