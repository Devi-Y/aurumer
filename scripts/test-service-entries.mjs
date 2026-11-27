import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const offers = require("../miniprogram/config/offers.js");
const originalReviews = require("../miniprogram/config/service-verification.js");

function pageFixture(relative, reviews = originalReviews, suppliedOffers = offers) {
  const filename = new URL(relative, import.meta.url);
  const localRequire = createRequire(filename);
  const calls = { copies: [], images: [], routes: [] };
  let page;
  const mocks = {
    "../../config/service-verification": reviews,
    "../../config/offers": suppliedOffers,
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
  assert.equal(JSON.stringify(entries.slice(5).map((entry) => entry.title)), JSON.stringify(["会员群", "港美股指引", "A股开户", "海外访问"]));
  for (const entry of entries.slice(5)) page.openGridEntry({ currentTarget: { dataset: { id: entry.id } } });
  assert.equal(calls.routes.length, 4);
  assert.equal(calls.copies.length, 0, "home opens service pages instead of copying promotional material");
});

test("the shared overseas-account tile retains separate Hong Kong and US destinations", () => {
  const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js");
  page.onLoad({ topic: "accounts" });
  assert.equal(JSON.stringify(page.data.choices.map((entry) => entry.title)), JSON.stringify(["港股渠道", "美股渠道"]));
  for (const choice of page.data.choices) page.openChoice({ currentTarget: { dataset: { topic: choice.topic } } });
  assert.equal(new Set(calls.routes).size, 2);
});

test("provided materials remain accessible without implying channel verification", () => {
  for (const [topic, id] of [["hk-open", "hk-open-account"], ["us-start", "open-account"], ["a-open", "a-open-account"], ["info", "global-access"]]) {
    const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js");
    page.onLoad({ topic });
    const offer = offers.find(item => item.id === id);
    assert.equal(page.data.offer.mode, offer.image ? "image" : "copy", topic);
    if (offer.image) assert.equal(page.data.offer.image, offer.image, topic);
    else { page.copyOffer(); assert.equal(calls.copies[0], offer.copy, topic); }
    assert.equal(originalReviews[id].status, "pending", "display does not certify the provider");
  }
});

test("missing materials cannot trigger a copy or display a QR", () => {
  const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js", originalReviews, []);
  page.onLoad({ topic: "a-open" });
  assert.equal(page.data.offer, null);
  page.copyOffer(); page.copyPendingContact();
  assert.equal(calls.copies.length, 0);
  assert.equal(calls.images.length, 0);
});

test("A-share consultation directly displays the supplied contact QR", () => {
  const record = originalReviews["a-open-account"];
  assert.equal(record.status, "pending");
  assert.match(record.provider, /华宝证券/);
  assert.equal(record.qualification, "");
  assert.equal(record.authorization, "");
  const { page } = pageFixture("../miniprogram/pages/guide/index.js");
  page.onLoad({ topic: "a-open" });
  assert.equal(page.data.offer.mode, "image");
  assert.equal(page.data.offer.image, offers.find(item => item.id === "a-open-account").image);
  assert.doesNotMatch(JSON.stringify(page.data), /华宝/);
  const template = readFileSync(new URL("../miniprogram/pages/guide/index.wxml", import.meta.url), "utf8");
  assert.doesNotMatch(template, /华宝/);
  assert.match(template, /src="{{offer\.image}}"/);
  assert.match(template, /show-menu-by-longpress="{{true}}"/);
  assert.doesNotMatch(template, /bindtap="previewOffer"/);
  page.onOfferImageError(); assert.equal(page.data.offerImageError, true);
  page.onOfferImageLoad(); assert.equal(page.data.offerImageError, false);
});

test("complete offline review fixtures preserve the original material without sending or registering", () => {
  const reviews = Object.fromEntries(Object.keys(originalReviews).map((id) => [id, {
    status: "verified", provider: "offline test fixture", qualification: "offline fixture", authorization: "offline fixture",
  }]));
  for (const [topic, id] of [["hk-open", "hk-open-account"], ["us-start", "open-account"], ["a-open", "a-open-account"], ["info", "global-access"]]) {
    const { page, calls } = pageFixture("../miniprogram/pages/guide/index.js", reviews);
    page.onLoad({ topic });
    const offer = offers.find((entry) => entry.id === id);
    assert.equal(page.data.lead, "", topic);
    if (id === "a-open-account") assert.match(page.data.offer.body, /企业微信.*一对一/);
    if (offer.image) assert.equal(page.data.offer.image, offer.image);
    else { page.copyOffer(); assert.equal(calls.copies[0], offer.copy); }
  }
});
