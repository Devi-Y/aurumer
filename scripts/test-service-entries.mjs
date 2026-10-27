import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const offers = require("../miniprogram/config/offers.js");
const originalReviews = require("../miniprogram/config/service-verification.js");

function pageFixture(relative, reviews = originalReviews) {
  const filename = new URL(relative, import.meta.url);
  const localRequire = createRequire(filename);
  const calls = { copies: [], images: [], routes: [] };
  let page;
  const mocks = {
    "../../config/service-verification": reviews,
    "../../utils/nav": { goHome() {}, openPage: (url) => calls.routes.push(url) },
    "../../utils/analytics": { track() {}, trackHomeVisit() {} },
  };
  const context = vm.createContext({
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    Page: (definition) => { page = definition; page.setData = (next) => Object.assign(page.data, next); },
    wx: { setNavigationBarTitle() {}, setClipboardData: (options) => calls.copies.push(options.data), previewImage: (options) => calls.images.push(options.current) },
    console,
  });
  new vm.Script(readFileSync(filename, "utf8")).runInContext(context);
  return { page, calls };
}

test("home has exactly nine working entries and keeps services after free research", () => {
  const { page, calls } = pageFixture("../miniprogram/pages/index/index.js");
  const entries = page.data.entries;
  assert.equal(entries.length, 9);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 9);
  assert.equal(entries.some((entry) => entry.reserved), false);
  assert.equal(JSON.stringify(entries.slice(5).map((entry) => entry.title)), JSON.stringify(["会员群", "港美股开户", "A股开户", "VPN开通"]));
  for (const entry of entries.slice(5)) page.openGridEntry({ currentTarget: { dataset: { id: entry.id } } });
  assert.equal(calls.routes.length, 4);
  assert.equal(calls.copies.length, 0, "home opens service pages instead of copying promotional material");
});

test("the shared overseas-account tile retains separate Hong Kong and US destinations", () => {
  const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js");
  page.onLoad({ topic: "accounts" });
  assert.equal(JSON.stringify(page.data.choices.map((entry) => entry.title)), JSON.stringify(["港股开户", "美股开户"]));
  for (const choice of page.data.choices) page.openChoice({ currentTarget: { dataset: { topic: choice.topic } } });
  assert.equal(new Set(calls.routes).size, 2);
});

test("unverified channels stay closed through old deep links and direct action handlers", () => {
  for (const topic of ["hk-open", "us-start", "a-open", "vpn", "info"]) {
    const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js");
    page.onLoad({ topic });
    assert.equal(page.data.offer.mode, "unavailable", topic);
    page.copyOffer(); page.copyPendingContact(); page.previewOffer();
    assert.equal(calls.copies.length, 0, topic);
    assert.equal(calls.images.length, 0, topic);
  }
});

test("missing reviews or a bare verified flag cannot enable a channel", () => {
  const reviews = Object.fromEntries(Object.keys(originalReviews).map((id) => [id, { status: "verified", provider: "fixture only" }]));
  for (const records of [{}, reviews]) {
    const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js", records);
    page.onLoad({ topic: "a-open" });
    page.previewOffer();
    assert.equal(page.data.offer.mode, "unavailable");
    assert.equal(calls.images.length, 0);
  }
});

test("complete offline review fixtures preserve the original material without sending or registering", () => {
  const reviews = Object.fromEntries(Object.keys(originalReviews).map((id) => [id, {
    status: "verified", provider: "offline test fixture", qualification: "offline fixture", authorization: "offline fixture",
  }]));
  for (const [topic, id, action] of [["hk-open", "hk-open-account", "copyPendingContact"], ["us-start", "open-account", "copyPendingContact"], ["a-open", "a-open-account", "previewOffer"], ["vpn", "global-access", "copyOffer"]]) {
    const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js", reviews);
    page.onLoad({ topic }); page[action]();
    const offer = offers.find((entry) => entry.id === id);
    if (offer.pendingContact) assert.equal(calls.copies[0], offers.find((entry) => entry.id === offer.pendingContact).copy);
    else if (offer.image) assert.equal(calls.images[0], offer.image);
    else assert.equal(calls.copies[0], offer.copy);
  }
});
