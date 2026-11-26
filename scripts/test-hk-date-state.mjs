import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const { guardHKDates } = require("../miniprogram/utils/hk-date-state.js");
const { allItems } = require("../miniprogram/utils/answers.js");
const item = { id: "hk-02384", rawCode: "02384", code: "02384.HK", name: "东山精密", offerStart: "2026-10-20", offerDeadline: "2026-10-23", listingDate: "2026-10-20", publicAnswer: { verdict: "谨慎打", action: "先观察", score: 65 } };

test("conflicting old source dates cannot reach a countdown or application signal", () => {
  const row = allItems({ status: "live", updatedAt: new Date().toISOString(), hk: { listings: [item] } }, "hk")[0];
  assert.equal(row.badge, "日期待核");
  assert.equal(row.raw.offerDeadline, null);
  assert.equal(row.raw.listingDate, null);
  assert.equal(row.raw.publicAnswer.verdict, "待核验");
  assert.equal(row.lenses.includes("live"), false);
  assert.equal(row.lenses.includes("leverage"), false);
  assert.equal(item.listingDate, "2026-10-20", "input evidence must remain unchanged");
});

test("corrected official dates remain available and missing dates stay pending", () => {
  const corrected = { ...item, listingDate: "2026-10-28", dateValidation: { status: "verified" } };
  assert.equal(guardHKDates(corrected).offerDeadline, "2026-10-23");
  const missing = guardHKDates({ ...corrected, offerStart: null });
  assert.equal(missing.dateValidation.status, "unverified");
  assert.equal(missing.offerDeadline, null);
});

test("historical IPO page labels pending and ended dates without implying a current offer", () => {
  const pageUrl = new URL("../miniprogram/pages/section/index.js", import.meta.url);
  const context = { require: createRequire(pageUrl), Page() {}, console, wx: {}, getApp() { return {}; } };
  vm.runInNewContext(`${readFileSync(pageUrl, "utf8")}\nglobalThis.testApi = { buildHkModule, buildOverview };`, context);
  const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
  const view = context.testApi.buildHkModule(snapshot);
  const pending = view.applyList.find((entry) => entry.id === "03275");
  assert.equal(pending.badgeText, "日期待核");
  assert.equal(pending.deadlineLabel, "截止日期待核");
  const ended = view.applyList.find((entry) => entry.id === "06157");
  assert.equal(ended.badgeText, "已截止");
  assert.match(ended.deadlineLabel, /^截止 \d{4}-\d{2}-\d{2}$/);
  assert.equal(ended.score, undefined);
  assert.equal(view.applyTiles.length, 0);
  const dates = snapshot.hk.history.filter((row) => row.listingDate && row.historicalReview?.firstDayChange != null).map((row) => row.listingDate).sort();
  assert.equal(view.firstDayChart.lastDate, dates.at(-1));
  assert.equal(context.testApi.buildOverview(snapshot, "hk").targetId, "");
  const template = readFileSync(new URL("../miniprogram/pages/section/index.wxml", import.meta.url), "utf8");
  const hk = template.split("<!-- A股收息")[0];
  assert.match(hk, />招股资料<\/view>/);
  assert.match(hk, /hkFirstDayChart\.lastDate/);
  assert.doesNotMatch(hk, /当前没有在售新股|class="hk-score"/);
});
