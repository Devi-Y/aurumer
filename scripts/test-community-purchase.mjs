import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCommunityPurchase, groupReady, isCommunityCallback, isCommunityTimer, validateCommunityQuery, PLAN, TERMS } = require("../cloudfunctions/aurum-member/community-purchase.js");

const flags = { WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "true", WANGCHAO_PAYMENT_RELEASE_APPROVED: "true", WANGCHAO_COMMUNITY_CHECKOUT_ENABLED: "true", WANGCHAO_COMMUNITY_DELIVERY_READY: "true", WANGCHAO_COMMUNITY_RELEASE_APPROVED: "true" };
const during = Date.parse("2026-11-04T12:00:00+08:00");
function fixture({ closeEnabled = false } = {}) {
  const docs = new Map(); let state = "NOTPAY"; let mismatch = false; let calls = 0; let closeCalls = 0; let closeBehavior = "close"; let failCreate = false; let failRead = false; let queryGate = null; let duringCreate = null; let failingOrder = ""; let now = during;
  const collection = (name) => ({ where: (condition) => ({ orderBy: () => ({ limit: (n) => ({ get: async () => ({ data: [...docs.entries()].filter(([key]) => key.startsWith(`${name}/`) && key.slice(name.length + 1) > condition._id.gt).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, n).map(([key, value]) => ({ ...value, _id: key.slice(name.length + 1) })) }) }) }) }), doc: (id) => ({
    get: async () => { if (failRead) { const e = new Error("database temporarily unavailable"); e.errCode = -1; throw e; } if (!docs.has(`${name}/${id}`)) { const e = new Error("document does not exist"); e.errCode = -1; throw e; } return { data: { ...docs.get(`${name}/${id}`) } }; },
    set: async ({ data }) => { docs.set(`${name}/${id}`, { ...data }); },
    update: async ({ data }) => { const key = `${name}/${id}`; if (!docs.has(key)) throw new Error("missing"); docs.set(key, { ...docs.get(key), ...data }); },
  }) });
  // Serialize test transactions to represent an atomic commit boundary.
  let transactionTail = Promise.resolve();
  const db = { collection, command: { gt: (value) => ({ gt: value }) }, runTransaction: async (fn) => {
    const before = transactionTail; let release; transactionTail = new Promise((resolve) => { release = resolve; });
    await before; try { return await fn({ collection }); } finally { release(); }
  } };
  const getDocument = async (name, id) => docs.get(`${name}/${id}`) || null;
  const cloud = { cloudPay: { unifiedOrder: async (request) => { calls++; assert.equal(request.totalFee, 29800); assert.equal(request.attach, PLAN.id); if (failCreate) throw new Error("connection lost"); if (duringCreate) await duringCreate(request); return { errCode: 0, returnCode: "SUCCESS", resultCode: "SUCCESS", payment: { kind: "wechat-jsapi" } }; }, closeOrder: async (request) => {
    closeCalls++; assert.ok(request.outTradeNo); assert.equal(request.subMchId, "1745865229");
    if (closeBehavior === "fail") throw new Error("temporary failure");
    if (closeBehavior === "paid") { state = "SUCCESS"; throw new Error("ORDERPAID"); }
    if (state === "NOTPAY" && closeBehavior !== "falsepositive") state = "CLOSED";
    if (closeBehavior === "timeout") throw new Error("connection lost after close");
    return { returnCode: "SUCCESS", resultCode: "SUCCESS", errCode: 0 };
  } } };
  const queryOrder = async (id) => {
    if (id === failingOrder) throw Object.assign(new Error("temporary query failure"), { code: "UPSTREAM_FAILED" });
    const order = await getDocument("community_orders", id);
    const result = { returnCode: "SUCCESS", resultCode: "SUCCESS", outTradeNo: id, totalFee: mismatch ? 1 : 29800, subMchId: "1745865229", subAppid: order.appId, subOpenid: order.openid, attach: PLAN.id, tradeState: state, transactionId: "wx-test" };
    if (queryGate) { const gate = queryGate; queryGate = null; gate.started(); await gate.wait; }
    return result;
  };
  return { api: createCommunityPurchase({ cloud, db, queryOrder, paymentParams: (p) => p, values: { ...flags, WANGCHAO_COMMUNITY_CLOSE_ORDER_ENABLED: String(closeEnabled) }, clock: () => now }), docs,
    setState: (s) => { state = s; }, setCloseBehavior: (v) => { closeBehavior = v; }, setMismatch: (v) => { mismatch = v; }, setFailCreate: (v) => { failCreate = v; }, setFailRead: (v) => { failRead = v; }, setFailingOrder: (v) => { failingOrder = v; }, setNow: (v) => { now = v; }, gateQuery: (v) => { queryGate = v; }, onCreate: (v) => { duringCreate = v; }, calls: () => calls, closeCalls: () => closeCalls };
}
const context = { OPENID: "user-one", APPID: "wx-test", ENV: "env-test" };
const consent = { legalConsent: { accepted: true, adultConfirmed: true, termsVersion: TERMS } };

test("unpaid and closed queries accept missing optional fields but never grant payment", () => {
  const id = "AC1234567890ABCDEF";
  const order = { appId: "wx-test", openid: "user-one", priceFen: 29800, planId: PLAN.id };
  const base = { returnCode: "SUCCESS", resultCode: "SUCCESS", outTradeNo: id, subMchId: "1745865229" };
  for (const state of ["NOTPAY", "CLOSED", "REFUND"]) {
    assert.equal(validateCommunityQuery(id, order, { ...base, tradeState: state }, {}), state);
  }
  for (const change of [{ outTradeNo: undefined }, { subMchId: undefined }, { subMchId: "other" },
    { subOpenid: "other" }, { subAppid: "other" }, { totalFee: 1 }, { attach: "other" },
    { resultCode: "FAIL" }, { tradeState: "UNKNOWN" }]) {
    assert.throws(() => validateCommunityQuery(id, order, { ...base, tradeState: "NOTPAY", ...change }, {}), /核验/);
  }
  assert.throws(() => validateCommunityQuery(id, order, { ...base, tradeState: "SUCCESS" }, {}), /金额|AppID|用户|商品|交易号/);
});

test("payment requires all separate gates and expires with the stated promotion", () => {
  assert.equal(groupReady(flags, context.OPENID, during), true);
  for (const flag of Object.keys(flags)) assert.equal(groupReady({ ...flags, [flag]: "false" }, context.OPENID, during), false, flag);
  assert.equal(groupReady(flags, context.OPENID, Date.parse("2027-01-01T00:00:00+08:00")), false);
  assert.equal(groupReady({}, context.OPENID, during), false);
});

test("controlled group testing stays restricted even when legacy public payment is enabled", () => {
  const hash = createHash("sha256").update(context.OPENID).digest("hex");
  const testFlags = { ...flags, WANGCHAO_COMMUNITY_RELEASE_APPROVED: "false", WANGCHAO_COMMUNITY_TEST_MODE: "true", WANGCHAO_COMMUNITY_TEST_OPENID_HASHES: hash };
  assert.equal(groupReady(testFlags, context.OPENID, during), true);
  assert.equal(groupReady(testFlags, "another-user", during), false);
  assert.equal(groupReady({ ...testFlags, WANGCHAO_COMMUNITY_RELEASE_APPROVED: "true" }, "another-user", during), false);
});

test("creating and uncertain orders recover only by independently verified SUCCESS", async () => {
  const f = fixture(); f.setFailCreate(true);
  await assert.rejects(f.api.prepare(consent, context), /connection lost/);
  const orderEntry = [...f.docs.entries()].find(([key]) => /community_orders\/AC/.test(key));
  assert.equal(orderEntry[1].status, "create_uncertain");
  f.setState("SUCCESS");
  assert.equal((await f.api.status(context.OPENID)).order.paid, true);
  assert.equal(f.calls(), 1);
  orderEntry[1].status = "creating";
  f.docs.set(orderEntry[0], orderEntry[1]);
  assert.equal((await f.api.status(context.OPENID)).order.paid, true);
});

test("delayed NOTPAY cannot overwrite a paid order or refund review", async () => {
  for (const nextState of ["SUCCESS", "REFUND"]) {
    const f = fixture(); await f.api.prepare(consent, context);
    let release, started;
    const wait = new Promise((r) => { release = r; });
    const arrived = new Promise((r) => { started = r; });
    f.gateQuery({ wait, started });
    const stale = f.api.status(context.OPENID);
    await arrived;
    f.setState(nextState); await f.api.status(context.OPENID);
    release(); const result = await stale;
    assert.equal(result.order.status, nextState === "SUCCESS" ? "paid" : "review");
    assert.equal(result.order.paid, false, "stale result never grants access");
    f.setState("SUCCESS");
    assert.equal((await f.api.status(context.OPENID)).order.paid, nextState === "SUCCESS");
  }
});

test("ambiguous database errors block creating an order", async () => {
  const f = fixture(); f.setFailRead(true);
  await assert.rejects(f.api.prepare(consent, context), /database temporarily unavailable/);
  assert.equal(f.calls(), 0); assert.equal(f.docs.size, 0);
});

test("a callback before unifiedOrder returns cannot reset paid status or request payment again", async () => {
  const f = fixture(); f.setState("SUCCESS");
  f.onCreate(async (request) => f.api.callback({ outTradeNo: request.outTradeNo }));
  const result = await f.api.prepare(consent, context);
  assert.equal(result.alreadyPaid, true); assert.equal(result.payment, undefined);
  assert.equal((await f.api.status(context.OPENID)).order.paid, true);
});

test("expired cached prepay cannot trigger a second order", async () => {
  const f = fixture(); const first = await f.api.prepare(consent, context);
  const key = `community_orders/${first.orderId}`;
  f.docs.set(key, { ...f.docs.get(key), prepayCreatedAt: new Date(during - 31 * 60 * 1000) });
  await assert.rejects(f.api.prepare(consent, context), { code: "COMMUNITY_ORDER_EXISTS" });
  assert.equal(f.calls(), 1);
});

test("expired unpaid orders reopen only after independently verified CLOSED", async () => {
  for (const behavior of ["close", "timeout"]) {
    const f = fixture({ closeEnabled: true }); const first = await f.api.prepare(consent, context);
    f.setNow(during + 31 * 60 * 1000); f.setCloseBehavior(behavior);
    const next = await f.api.prepare(consent, context);
    assert.notEqual(next.orderId, first.orderId);
    assert.equal(f.docs.get(`community_orders/${first.orderId}`).status, "closed");
    assert.equal(f.docs.get(`community_orders/${first.orderId}`).wechatTradeState, "CLOSED");
    assert.equal(f.calls(), 2); assert.equal(f.closeCalls(), 1);
  }
});

test("close failures, payment races and non-CLOSED trade states cannot create a new order", async () => {
  for (const behavior of ["fail", "paid", "falsepositive"]) {
    const f = fixture({ closeEnabled: true }); const first = await f.api.prepare(consent, context);
    f.setNow(during + 31 * 60 * 1000); f.setCloseBehavior(behavior);
    await assert.rejects(f.api.prepare(consent, context), { code: "COMMUNITY_ORDER_EXISTS" });
    assert.equal(f.calls(), 1); assert.equal(f.closeCalls(), 1);
    assert.equal(f.docs.get(`community_orders/${first.orderId}`).status, behavior === "paid" ? "paid" : "pending");
  }
  for (const state of ["REVOKED", "PAYERROR"]) {
    const f = fixture({ closeEnabled: true }); await f.api.prepare(consent, context);
    f.setNow(during + 31 * 60 * 1000); f.setState(state);
    await assert.rejects(f.api.prepare(consent, context), { code: "COMMUNITY_ORDER_EXISTS" });
    assert.equal(f.calls(), 1); assert.equal(f.closeCalls(), 0);
  }
});

test("a stale stored CLOSED record cannot authorize a new order while WeChat says NOTPAY", async () => {
  const f = fixture({ closeEnabled: true }); const first = await f.api.prepare(consent, context);
  const key = `community_orders/${first.orderId}`;
  f.docs.set(key, { ...f.docs.get(key), status: "closed", wechatTradeState: "CLOSED" });
  await assert.rejects(f.api.prepare(consent, context), { code: "COMMUNITY_ORDER_EXISTS" });
  assert.equal(f.calls(), 1); assert.equal(f.closeCalls(), 0);
});

test("simultaneous retries after expiry create at most one replacement order", async () => {
  const f = fixture({ closeEnabled: true }); const first = await f.api.prepare(consent, context);
  f.setNow(during + 31 * 60 * 1000);
  const results = await Promise.allSettled([f.api.prepare(consent, context), f.api.prepare(consent, context)]);
  const accepted = results.filter((result) => result.status === "fulfilled");
  assert.equal(accepted.length, 1);
  assert.notEqual(accepted[0].value.orderId, first.orderId);
  assert.equal(f.calls(), 2);
  assert.equal(f.docs.get(`community_orders/${first.orderId}`).status, "closed");
});

test("operator verification needs a valid order and a fresh matching paid query", async () => {
  const f = fixture(); const first = await f.api.prepare(consent, context);
  assert.equal((await f.api.verifyForAdmin(first.orderId)).verified, false);
  f.setState("SUCCESS"); assert.equal((await f.api.verifyForAdmin(first.orderId)).verified, true);
  f.setMismatch(true); await assert.rejects(f.api.verifyForAdmin(first.orderId), { code: "CLOUDPAY_ORDER_MISMATCH" });
  await assert.rejects(f.api.verifyForAdmin("not-an-order"), { code: "COMMUNITY_ORDER_MISMATCH" });
});

test("independent timer paginates, resumes, and recovers payments without user returning", async () => {
  const f = fixture();
  for (let n = 0; n < 7; n++) await f.api.prepare(consent, { ...context, OPENID: `user-${n}` });
  const orders = [...f.docs.keys()].filter((key) => /community_orders\/AC/.test(key)).sort();
  f.setFailingOrder(orders[1].split("/")[1]); f.setState("SUCCESS");
  assert.deepEqual(await f.api.reconcileBatch(), { scanned: 5, attempted: 5, failed: 1, wrapped: false });
  assert.equal(f.docs.get(orders[1]).status, "prepared");
  assert.equal(f.docs.get(orders[1]).lastReconcileErrorCode, "UPSTREAM_FAILED");
  assert.equal(f.docs.get(orders[0]).status, "paid");
  assert.deepEqual(await f.api.reconcileBatch(), { scanned: 2, attempted: 2, failed: 0, wrapped: true });
  assert.equal(f.docs.get("community_orders/__community_reconcile_state__").cursor, "");
  assert.equal(f.docs.get(orders[6]).status, "paid");
  f.setFailingOrder(""); f.setNow(during + 16000);
  assert.deepEqual(await f.api.reconcileBatch(), { scanned: 7, attempted: 1, failed: 0, wrapped: true });
  assert.equal(f.docs.get(orders[1]).status, "paid");
  assert.equal(f.docs.get(orders[1]).lastReconcileErrorCode, "");
  assert.equal([...f.docs.keys()].some((key) => key.startsWith("member_orders/") || key.startsWith("member_entitlements/")), false);
  assert.equal(isCommunityTimer({ Type: "Timer", TriggerName: "community-order-reconcile" }), true);
  assert.equal(isCommunityTimer({ Type: "Timer", TriggerName: "member-order-reconcile" }), false);
});

test("cursor continues after a full page even when all entries are throttled", async () => {
  const f = fixture();
  for (let n = 0; n < 30; n++) await f.api.prepare(consent, { ...context, OPENID: `page-user-${n}` });
  for (const [key, value] of f.docs.entries()) {
    if (/community_orders\/AC/.test(key)) f.docs.set(key, { ...value, status: "paid", lastVerifiedAt: new Date(during) });
  }
  assert.deepEqual(await f.api.reconcileBatch(), { scanned: 25, attempted: 0, failed: 0, wrapped: false });
  assert.deepEqual(await f.api.reconcileBatch(), { scanned: 5, attempted: 0, failed: 0, wrapped: true });
  assert.equal(f.docs.get("community_orders/__community_reconcile_state__").cursor, "");
});

test("independent order is confirmed only by matching paid query; retries reuse it and refunds hide delivery", async () => {
  const f = fixture();
  await assert.rejects(f.api.prepare({}, context), { code: "COMMUNITY_CONSENT_REQUIRED" });
  const first = await f.api.prepare(consent, context);
  assert.equal(f.calls(), 1);
  assert.equal((await f.api.status(context.OPENID)).order.paid, false);
  const retry = await f.api.prepare(consent, context);
  assert.equal(retry.orderId, first.orderId); assert.equal(f.calls(), 1);
  f.setState("SUCCESS"); f.setMismatch(true);
  const unverifiable = await f.api.status(context.OPENID);
  assert.equal(unverifiable.verificationPending, true); assert.equal(unverifiable.order.paid, false);
  await assert.rejects(f.api.callback({ outTradeNo: first.orderId }), { code: "CLOUDPAY_ORDER_MISMATCH" });
  f.setMismatch(false);
  const callback = { outTradeNo: first.orderId, returnCode: "SUCCESS", resultCode: "SUCCESS" };
  assert.equal(isCommunityCallback(callback, {}), true);
  assert.equal(isCommunityCallback(callback, { OPENID: context.OPENID }), false);
  await f.api.callback(callback);
  const paid = await f.api.status(context.OPENID);
  assert.equal(paid.order.paid, true); assert.match(paid.order.delivery, /待添加微信/);
  const saved = f.docs.get(`community_orders/${first.orderId}`);
  saved.deliveryFulfillment = { joinedAt: "2026-11-04T00:00:00.000Z", startsAt: "2026-11-04T00:00:00.000Z", endsAt: "2027-11-04T00:00:00.000Z", operatorId: "private" };
  f.docs.set(`community_orders/${first.orderId}`, saved);
  const delivered = await f.api.status(context.OPENID);
  assert.equal(delivered.order.fulfillment.endsAt, "2027-11-04T00:00:00.000Z");
  assert.equal("operatorId" in delivered.order.fulfillment, false);
  assert.equal("entitlementExpiresAt" in paid.order, false);
  await assert.rejects(f.api.prepare(consent, context), { code: "COMMUNITY_ORDER_EXISTS" });
  assert.equal((await f.api.status("other-user")).order, null);
  assert.equal([...f.docs.keys()].some((key) => key.startsWith("member_orders/") || key.startsWith("member_entitlements/")), false);
  f.setState("REFUND"); const refunded = await f.api.status(context.OPENID);
  assert.equal(refunded.order.paid, false); assert.equal(refunded.order.fulfillment, null);
  f.setState("SUCCESS"); assert.equal((await f.api.status(context.OPENID)).order.paid, false, "review requires manual resolution");
});
