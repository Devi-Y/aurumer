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
  delete data.revisionAt; // Synthetic quote batches must not inherit a real correction timestamp.
  delete data.revisionAt;
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
  return { ok: true, data, updatedAt: data.updatedAt,
    ...(data.revisionAt ? { revisionAt: data.revisionAt } : {}),
    source: "in-memory verified cache", fetchedAt: data.updatedAt };
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

function transportFixture(route) {
  const requests = [];
  const https = {
    get(url, options, callback) {
      const request = new EventEmitter();
      request.url = String(url);
      request.destroyed = false;
      const timers = new Set();
      const later = (delay, task) => {
        const timer = setTimeout(() => { timers.delete(timer); if (!request.destroyed) task(); }, delay);
        timers.add(timer);
      };
      request.destroy = () => {
        request.destroyed = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      };
      const respond = (statusCode = 200, headers = {}) => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.headers = headers;
        response.resume = () => {};
        response.destroy = () => request.destroy();
        callback(response);
        return response;
      };
      requests.push(request);
      route(String(url), { request, later, respond });
      return request;
    },
  };
  const filename = path.join(root, "cloudfunctions/aurum-data/index.js");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require: (name) => name === "node:https" ? https : localRequire(name),
    process, Buffer, URL, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  });
  new vm.Script(`${readFileSync(filename, "utf8")}\nglobalThis.transport = { readJson, readLatestSnapshot };`, { filename }).runInContext(context);
  return { ...context.transport, requests };
}

test("a source that never connects is destroyed at the complete-download deadline", { timeout: 1000 }, async () => {
  const fixture = transportFixture(() => {});
  await assert.rejects(fixture.readJson("https://source.test/stalled", 40), /请求超时/);
  assert.equal(fixture.requests[0].destroyed, true);
});

test("continuous response chunks cannot extend the complete-download deadline", { timeout: 1000 }, async () => {
  let chunks = 0;
  const fixture = transportFixture((url, { later, respond }) => {
    later(0, () => {
      const response = respond();
      const stream = () => { chunks += 1; response.emit("data", Buffer.from(" ")); later(5, stream); };
      stream();
    });
  });
  await assert.rejects(fixture.readJson("https://source.test/slow", 50), /请求超时/);
  assert.ok(chunks >= 2, "the response remained active rather than timing out on inactivity");
  assert.equal(fixture.requests[0].destroyed, true);
});

test("a redirect shares the original deadline instead of restarting its budget", { timeout: 1000 }, async () => {
  const fixture = transportFixture((url, { later, respond }) => {
    if (url.endsWith("/start")) later(45, () => respond(302, { location: "/body" }));
    else later(55, () => {
      const response = respond();
      response.emit("data", Buffer.from('{"ok":true}'));
      response.emit("end");
    });
  });
  await assert.rejects(fixture.readJson("https://source.test/start", 80), /请求超时/);
  assert.equal(fixture.requests.length, 2);
  assert.ok(fixture.requests.every((request) => request.destroyed));
});

test("a valid winning source immediately cancels a stalled competing download", { timeout: 1000 }, async () => {
  const data = snapshot(-1);
  const fixture = transportFixture((url, { later, respond }) => {
    if (url.includes("raw.githubusercontent.com")) return;
    later(0, () => {
      const response = respond();
      response.emit("data", Buffer.from(JSON.stringify(data)));
      response.emit("end");
    });
  });
  const result = await fixture.readLatestSnapshot(500);
  assert.equal(result.data.updatedAt, data.updatedAt);
  assert.equal(fixture.requests.find((request) => request.url.includes("raw.githubusercontent.com")).destroyed, true);
});

test("an invalid fast source cannot cancel a valid slower source", { timeout: 1000 }, async () => {
  const data = snapshot(-1);
  const fixture = transportFixture((url, { later, respond }) => {
    const raw = url.includes("raw.githubusercontent.com");
    later(raw ? 15 : 0, () => {
      const response = respond();
      response.emit("data", Buffer.from(JSON.stringify(raw ? data : { updatedAt: data.updatedAt })));
      response.emit("end");
    });
  });
  const result = await fixture.readLatestSnapshot(500);
  assert.ok(result.url.includes("raw.githubusercontent.com"));
  assert.equal(fixture.requests.find((request) => request.url.includes("raw.githubusercontent.com")).destroyed, false);
});

test("an interrupted response fails promptly and releases its request", { timeout: 1000 }, async () => {
  const fixture = transportFixture((url, { later, respond }) => {
    later(0, () => respond().emit("aborted"));
  });
  await assert.rejects(fixture.readJson("https://source.test/interrupted", 500), /下载中断/);
  assert.equal(fixture.requests[0].destroyed, true);
});

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

test("equal quote timestamps cannot roll an official 74-day revision back to an older 49-day body", async () => {
  const old = snapshot(-3);
  const revised = clone(old);
  revised.revisionAt = iso(-1);
  const official = JSON.parse(readFileSync(path.join(root, "scripts/fixtures/sge-au9999-official-20261020.json"), "utf8"));
  revised.gold.history.domestic = official.rows;
  old.gold.history.domestic = official.rows.slice(-49);
  old.gold.answer.score = 48;
  revised.gold.answer.score = 50;
  assert.ok(revised.gold.history.domestic.length >= 74, "official real fixture provides 74 or more daily closes");
  const fixture = cloudFixture(revised, { pages: { data: old, delay: 0 }, raw: { data: revised, delay: 10 } });
  const result = await fixture.handler.main({ action: "getSnapshot", force: true });
  assert.ok(result.sourceUrl.includes("raw.githubusercontent.com"));
  assert.equal(result.updatedAt, old.updatedAt);
  assert.equal(result.revisionAt, revised.revisionAt);
  assert.equal(result.data.revisionAt, revised.revisionAt);
  assert.equal(result.data.gold.history.domestic.length, revised.gold.history.domestic.length);
  assert.equal(result.data.gold.answer.score, 50);
  assert.equal(fixture.state().record.payload.revisionAt, revised.revisionAt);
});

test("an equal-timestamp DB revision committed during refresh wins the atomic comparison", async () => {
  const initial = snapshot(-3);
  const candidate = clone(initial); candidate.revisionAt = iso(-2);
  const revised = clone(initial); revised.revisionAt = iso(-1);
  const fixture = cloudFixture(initial, { pages: { data: candidate, delay: 0 }, raw: { data: candidate, delay: 10 } }, { newerBeforeTransaction: revised });
  const result = await fixture.handler.main({ action: "getSnapshot", force: true });
  assert.equal(result.updatedAt, initial.updatedAt);
  assert.equal(result.revisionAt, revised.revisionAt);
  assert.equal(result.data.revisionAt, revised.revisionAt);
  assert.equal(fixture.state().cacheWrites, 0);
  assert.equal(fixture.state().factsWritten, 0);
});

test("cloud and mini version comparison keep quote time primary and revision secondary", () => {
  const localRequire = createRequire(import.meta.url);
  const helpers = [localRequire("../cloudfunctions/aurum-data/action-freshness.js"), localRequire("../miniprogram/utils/action-freshness.js")];
  for (const helper of helpers) {
    const old = { updatedAt: iso(-3) };
    const revised = { ...old, revisionAt: iso(-1) };
    assert.equal(helper.compareSnapshotVersions(revised, old), 1);
    assert.equal(helper.compareSnapshotVersions(old, revised), -1);
    assert.equal(helper.compareSnapshotVersions(old, { ...old, revisionAt: old.updatedAt }), 0);
    assert.equal(helper.compareSnapshotVersions({ updatedAt: iso(-2) }, revised), 1);
    const stale = snapshot(-72); stale.revisionAt = iso(-1);
    assert.equal(helper.degradeStaleActions(stale).actionsFresh, false, "a correction must not refresh old market facts");
  }
});

test("mini store rejects an older equal-timestamp revision and accepts a newer one", async () => {
  const bundle = snapshot(-3); bundle.revisionAt = iso(-1);
  const old = clone(bundle); delete old.revisionAt; old.gold.history.domestic = old.gold.history.domestic.slice(-49);
  const revised = clone(bundle); revised.revisionAt = iso(-0.5);
  let remote = old;
  const filename = path.join(root, "miniprogram/data/store.js");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require: (name) => name === "./live-snapshot" ? bundle : localRequire(name),
    console: { warn() {} },
    wx: { cloud: { callFunction: async () => ({ result: { ok: true, data: remote } }) } },
  });
  new vm.Script(readFileSync(filename, "utf8"), { filename }).runInContext(context);
  const load = () => new Promise((resolve) => {
    const updates = [];
    module.exports.loadSnapshot((data) => updates.push(data), () => resolve(updates.at(-1)), { force: true });
  });
  const retained = await load();
  assert.equal(retained.revisionAt, bundle.revisionAt);
  assert.equal(retained.gold.history.domestic.length, bundle.gold.history.domestic.length);
  remote = revised;
  const accepted = await load();
  assert.equal(accepted.updatedAt, bundle.updatedAt);
  assert.equal(accepted.revisionAt, revised.revisionAt);
  assert.equal(accepted.gold.quotes.domestic.asOf, bundle.gold.quotes.domestic.asOf);
  const invalid = clone(revised); invalid.revisionAt = iso(24);
  assert.equal(module.exports.isUsableSnapshot(invalid), false);
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

test("website digest with equal updatedAt but an older content revision cannot attach", async () => {
  const stamp = iso(-3);
  const revisionAt = iso(-1);
  const currentDigest = { ...digest(stamp), revisionAt };
  const current = browserFixture({ updatedAt: stamp, revisionAt, actionsFresh: true }, currentDigest);
  current.context.LIVE.digest = await current.run.loadDailyDigest(stamp, revisionAt);
  assert.ok(current.run.dailyAnswerBoard("us").includes("release-action-marker"));
  const older = browserFixture({ updatedAt: stamp, revisionAt, actionsFresh: true }, digest(stamp));
  older.context.LIVE.digest = await older.run.loadDailyDigest(stamp, revisionAt);
  assert.equal(older.context.LIVE.digest, null);
  assert.equal(older.run.dailyAnswerBoard("us"), "");
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
