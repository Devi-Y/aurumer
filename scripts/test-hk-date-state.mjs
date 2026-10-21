import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
