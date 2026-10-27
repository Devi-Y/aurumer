import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const community = require("../miniprogram/config/community.js");
const verification = require("../miniprogram/config/service-verification.js");

function fixture(file, { reviewed = false, component = false, now = Date.parse("2026-10-27T12:00:00+08:00") } = {}) {
  const filename = new URL(file, import.meta.url);
  const localRequire = createRequire(filename);
  const calls = { events: [], copies: [], images: [] };
  let page;
  const reviews = reviewed ? Object.fromEntries(Object.keys(verification).map((id) => [id, {
    status: "verified", provider: "offline fixture", qualification: "offline fixture", authorization: "offline fixture",
  }])) : verification;
  const capture = (definition) => {
    page = definition;
    page.data = { ...definition.data };
    page.setData = (next) => Object.assign(page.data, next);
    if (component) Object.assign(page, definition.methods);
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    Page: capture, Component: capture,
    require: (id) => {
      if (id === "../../utils/analytics") return { track: (name, data) => calls.events.push({ name, data }) };
      if (id === "../../config/service-verification") return reviews;
      return localRequire(id);
    },
    wx: {
      setNavigationBarTitle() {}, showToast() {},
      setClipboardData: (options) => calls.copies.push(options),
      previewImage: (options) => calls.images.push(options),
    },
  });
  new vm.Script(readFileSync(filename, "utf8")).runInContext(context);
  return { page, calls };
}

test("the group shows the confirmed annual price and offers consultation without payment", () => {
  const { page, calls } = fixture("../miniprogram/pages/community/index.js");
  page.onLoad();
  assert.equal(community.priceCny, 298);
  assert.equal(community.checkoutEnabled, false);
  assert.equal(page.data.priceLabel, "298 元 / 年");
  assert.match(page.data.purchaseNote, /暂未开放付款/);
  page.copyWechat();
  assert.equal(calls.events.filter((event) => event.name === "service_copy").length, 0);
  calls.copies[0].fail();
  assert.equal(calls.events.filter((event) => event.name === "service_copy").length, 0, "failed consultation copies are not conversions");
  page.copyWechat();
  calls.copies[1].success();
  assert.equal(calls.events.filter((event) => event.name === "service_copy").length, 1);
  assert.equal(calls.events.some((event) => /pay|fulfilled|income/.test(event.name)), false);
});

test("provider contact actions are recorded only after the native action succeeds", () => {
  for (const [topic, method, resultKey, eventName] of [
    ["hk-open", "copyOffer", "copies", "service_copy"],
    ["us-start", "copyOffer", "copies", "service_copy"],
    ["a-open", "previewOffer", "images", "offer_qr_open"],
  ]) {
    const { page, calls } = fixture("../miniprogram/pages/guide/index.js", { reviewed: true });
    page.onLoad({ topic }); page[method]();
    assert.equal(calls.events.some((event) => event.name === eventName), false);
    calls[resultKey][0].fail();
    assert.equal(calls.events.some((event) => event.name === eventName), false);
    page[method](); calls[resultKey][1].success();
    assert.equal(calls.events.filter((event) => event.name === eventName).length, 1);
    assert.equal(calls.events.some((event) => /pay|fulfilled|income/.test(event.name)), false);
  }
});

test("an empty ad slot stays absent; native load and errors never count as revenue", () => {
  const { page, calls } = fixture("../miniprogram/components/research-ad/index.js", { component: true });
  page.observers.unitId.call(page, ""); page.onLoad();
  assert.equal(page.data.visible, false);
  assert.equal(calls.events.length, 0);
  page.observers.unitId.call(page, "adunit-offlinefixture");
  assert.equal(page.data.visible, true);
  assert.equal(calls.events.length, 0, "requesting an ad does not prove it loaded");
  page.onError({ detail: { errCode: 1004 } });
  assert.equal(page.data.visible, false);
  assert.equal(calls.events[0].name, "ad_error");
  page.onLoad();
  assert.equal(calls.events.filter((event) => event.name === "ad_load").length, 0);
  page.observers.unitId.call(page, "adunit-offlinefixture"); page.onLoad(); page.onLoad();
  assert.equal(calls.events.filter((event) => event.name === "ad_load").length, 1);
  assert.equal(calls.events.some((event) => /pay|fulfilled|income/.test(event.name)), false);
});

test("an ended group price cannot silently become an active promotion or a higher-price renewal", () => {
  const { page } = fixture("../miniprogram/pages/community/index.js", { now: Date.parse("2026-12-01T00:00:01+08:00") });
  page.onLoad();
  assert.equal(page.data.priceLabel, "本期价格已结束");
  assert.equal(community.checkoutEnabled, false);
  assert.ok(community.serviceTerms && community.refundTerms && community.deliveryTerms);
  assert.equal(community.priceCny, 298, "no automatic return to an unverified reference price");
});
