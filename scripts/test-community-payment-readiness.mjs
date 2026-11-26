import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { communityPaymentReadiness } = require("../cloudfunctions/aurum-member/community-payment-readiness.js");
const owner = "fixture-owner-openid";
const stranger = "fixture-other-openid";
const ownerHash = createHash("sha256").update(owner).digest("hex");
const end = Date.parse("2026-12-31T23:59:59+08:00");
const now = Date.parse("2026-11-04T12:00:00+08:00");
const gates = { WANGCHAO_COMMUNITY_CHECKOUT_ENABLED: "true", WANGCHAO_COMMUNITY_DELIVERY_READY: "true" };
const check = (values, openid = owner, overrides = {}) => communityPaymentReadiness({ values, openid, baseReady: true, now, promotionEnd: end, ...overrides });

test("without a specifically approved mode no account can purchase", () => {
  assert.deepEqual(check({}), { ready: false, mode: "closed" });
  assert.deepEqual(check(gates), { ready: false, mode: "closed" });
  assert.deepEqual(check({ ...gates, WANGCHAO_COMMUNITY_TEST_MODE: "not-a-bool", WANGCHAO_COMMUNITY_RELEASE_APPROVED: "true" }), { ready: false, mode: "closed" });
});

test("controlled testing admits only the configured platform identity", () => {
  const values = { ...gates, WANGCHAO_COMMUNITY_TEST_MODE: "true", WANGCHAO_COMMUNITY_TEST_OPENID_HASHES: ownerHash };
  assert.deepEqual(check(values), { ready: true, mode: "test" });
  assert.deepEqual(check(values, stranger), { ready: false, mode: "closed" });
  assert.deepEqual(check({ ...values, WANGCHAO_COMMUNITY_RELEASE_APPROVED: "true" }, stranger), { ready: false, mode: "closed" });
  assert.deepEqual(check({ ...values, WANGCHAO_COMMUNITY_TEST_OPENID_HASHES: `${ownerHash},bad` }), { ready: false, mode: "closed" });
  assert.deepEqual(check({ ...values, WANGCHAO_COMMUNITY_TEST_OPENID_HASHES: "" }), { ready: false, mode: "closed" });
});

test("release, delivery, upstream payment readiness and expiration are independent gates", () => {
  const values = { ...gates, WANGCHAO_COMMUNITY_RELEASE_APPROVED: "true" };
  assert.deepEqual(check(values, stranger), { ready: true, mode: "public" });
  assert.equal(check({ ...values, WANGCHAO_COMMUNITY_DELIVERY_READY: "false" }).ready, false);
  assert.equal(check({ ...values, WANGCHAO_COMMUNITY_CHECKOUT_ENABLED: "false" }).ready, false);
  assert.equal(check(values, owner, { baseReady: false }).ready, false);
  assert.equal(check(values, "").ready, false);
  assert.equal(check(values, owner, { now: end + 1 }).ready, false);
});
