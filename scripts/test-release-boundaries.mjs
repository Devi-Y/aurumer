import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";

// node --test scripts/test-release-boundaries.mjs
// Offline release regression. HTTPS, database transactions, fact writes and ops
// alerts are in-memory doubles; no request or write reaches a cloud service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const original = JSON.parse(readFileSync(path.join(root, "data/live-snapshot.json"), "utf8"));
const hour = 3600000;
const iso = (offset) => new Date(Date.now() + offset * hour).toISOString();
const clone = (value) => structuredClone(value);

function snapshot(offset) {
  const data = clone(original);
  const stamp = iso(offset);
  data.status = "live";
  data.updatedAt = stamp;
  for (const key of ["actionsFresh", "actionFreshness", "actionDegradeReason"]) delete data[key];
  const reset = (row) => {
    if (!row) return;
    for (const key of ["actionsFresh", "actionNote", "snapshotUpdatedAt"]) delete row[key];
    row.asOf = stamp;
    if ("priceAsOf" in row) row.priceAsOf = stamp;
  };
  data.us.stocks.forEach(reset);
  data.aShare.quotes.forEach(reset);
  (data.aShare.funds || []).forEach(reset);
  reset(data.gold);
  data.gold.status = "live";
  data.gold.updatedAt = stamp;
  Object.values(data.gold.quotes).forEach(reset);
  return data;
}

function payload(data) {
  return { ok: true, data, updatedAt: data.updatedAt, source: "in-memory verified cache", fetchedAt: data.updatedAt };
}

function cloudFixture(initial, outcomes, options = {}) {
  let record = { payload: payload(initial), updatedAt: initial.updatedAt, storedAt: Date.now() };
  let cacheWrites = 0;
  let factsWritten = 0;
  let transactionCalls = 0;
  const requested = [];
  const doc = {
    get: async () => ({ data: clone(record) }),
    set: async ({ data }) => { cacheWrites += 1; record = clone(data); },
  };
  const db = {
    collection: () => ({ doc: () => doc }),
    runTransaction: async (callback) => {
      transactionCalls += 1;
      // Another instance commits after refresh's initial read and before this
      // transaction's atomic comparison. It must become the new watermark.
      if (options.newerBeforeTransaction) {
        const newer = options.newerBeforeTransaction;
        record = { payload: payload(newer), updatedAt: newer.updatedAt, storedAt: Date.now() };
      }
      return callback({ collection: () => ({ doc: () => doc }) });
    },
  };
  const https = {
    get(url, requestOptions, callback) {
      requested.push(String(url));
      const request = new EventEmitter();
      request.destroy = (error) => request.emit("error", error);
      const outcome = outcomes[String(url).includes("raw.githubusercontent.com") ? "raw" : "pages"];
      setTimeout(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        response.resume = () => {};
        callback(response);
        response.emit("data", Buffer.from(JSON.stringify(outcome.data)));
        response.emit("end");
      }, outcome.delay);
      return request;
    },
  };
  const filename = path.join(root, "cloudfunctions/aurum-data/index.js");
  const localRequire = createRequire(filename);
  const mocks = {
    "node:https": https,
    "wx-server-sdk": { init() {}, database: () => db },
    "./fact-versions": { writeFactVersions: async () => { factsWritten += 1; return { written: true }; } },
    "./ops-alert": { alertOpsOnce: async () => null },
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    process, Buffer, URL, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  });
  new vm.Script(readFileSync(filename, "utf8"), { filename }).runInContext(context);
  return { handler: module.exports, state: () => ({ record, cacheWrites, factsWritten, transactionCalls, requested }) };
}

test("a cold warm loads the newer DB watermark before racing fast old Pages against slower raw", async () => {
  const previous = snapshot(-2);
  const pages = snapshot(-3);
  const raw = snapshot(-1);
  const fixture = cloudFixture(previous, { pages: { data: pages, delay: 0 }, raw: { data: raw, delay: 10 } });
  const warmed = await fixture.handler.main({ action: "warm" });
  assert.equal(warmed.ok, true);
  assert.equal(warmed.warmed, true);
  assert.equal(warmed.updatedAt, raw.updatedAt);
  const result = await fixture.handler.main({ action: "getSnapshot" });
  assert.equal(result.updatedAt, raw.updatedAt);
  assert.ok(result.sourceUrl.includes("raw.githubusercontent.com"));
  const state = fixture.state();
  assert.equal(state.record.updatedAt, raw.updatedAt);
  assert.equal(state.requested.length, 2);
  assert.equal(state.cacheWrites, 1);
  assert.equal(state.factsWritten, 1);
});

test("a concurrent newer DB commit is not overwritten by the older candidate or its fact versions", async () => {
  const initial = snapshot(-4);
  const candidate = snapshot(-2);
  const newer = snapshot(-1);
  const fixture = cloudFixture(initial, { pages: { data: candidate, delay: 0 }, raw: { data: candidate, delay: 10 } }, { newerBeforeTransaction: newer });
  const result = await fixture.handler.main({ action: "getSnapshot", force: true });
  assert.equal(result.updatedAt, newer.updatedAt);
  assert.equal(result.data.updatedAt, newer.updatedAt);
  const state = fixture.state();
  assert.equal(state.transactionCalls, 1);
  assert.equal(state.record.updatedAt, newer.updatedAt);
  assert.equal(state.cacheWrites, 0);
  assert.equal(state.factsWritten, 0);
});

const html = readFileSync(path.join(root, "index.html"), "utf8");
function inlineFunction(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(html);
  assert.ok(start, `inline function ${name} exists`);
  const rest = html.slice(start.index);
  const next = /\n(?:async )?function \w+\(/.exec(rest);
  assert.ok(next, `inline function ${name} has a following declaration`);
  return rest.slice(0, next.index);
}
function browserFixture(live, digest) {
  const context = vm.createContext({
    LIVE: live,
    location: { hostname: "devi-y.github.io" },
    fetch: async () => ({ ok: true, json: async () => clone(digest) }),
  });
  const code = [
    "const ACTION_MAX_AGE_MS = 36*60*60*1000;",
    inlineFunction("snapshotAgeMs"),
    inlineFunction("isSnapshotActionFresh"),
    inlineFunction("loadDailyDigest"),
    inlineFunction("dailyAnswerBoard"),
    "globalThis.run = { loadDailyDigest, dailyAnswerBoard };",
  ].join("\n");
  new vm.Script(code, { filename: "index.html release functions" }).runInContext(context);
  return { context, run: context.run };
}
function digest(stamp) {
  const card = { question: "可核验测试问题", answer: "release-action-marker", enabled: true, href: "#/us" };
  return { updatedAt: stamp, markets: { hk: [card], us: [card], gold: [card] } };
}

test("website matching digest loads; mismatched or missing snapshot version cannot attach action cards", async () => {
  const stamp = iso(-1);
  const current = browserFixture({ updatedAt: stamp, actionsFresh: true }, digest(stamp));
  current.context.LIVE.digest = await current.run.loadDailyDigest(stamp);
  assert.ok(current.run.dailyAnswerBoard("us").includes("release-action-marker"));
  const mismatched = browserFixture({ updatedAt: stamp, actionsFresh: true }, digest(iso(-2)));
  mismatched.context.LIVE.digest = await mismatched.run.loadDailyDigest(stamp);
  assert.equal(mismatched.context.LIVE.digest, null);
  assert.equal(mismatched.run.dailyAnswerBoard("us"), "");
  assert.equal(await mismatched.run.loadDailyDigest(null), null);
});

test("website expired or future snapshots do not render daily action boards", () => {
  for (const stamp of [iso(-72), iso(1)]) {
    const fixture = browserFixture({ updatedAt: stamp, actionsFresh: true, digest: digest(stamp) }, null);
    assert.equal(fixture.run.dailyAnswerBoard("us"), "");
    assert.equal(fixture.run.dailyAnswerBoard("hk"), "");
  }
});

test("website partial gold hides its actions while preserving fresh US action cards", () => {
  const stamp = iso(-1);
  const fixture = browserFixture({ updatedAt: stamp, actionsFresh: true, gold: { actionsFresh: false }, digest: digest(stamp) }, null);
  assert.equal(fixture.run.dailyAnswerBoard("gold"), "");
  assert.ok(fixture.run.dailyAnswerBoard("us").includes("release-action-marker"));
  fixture.context.LIVE.actionsFresh = false;
  assert.equal(fixture.run.dailyAnswerBoard("us"), "");
});
