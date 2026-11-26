import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCommunityAdmin } = require("../cloudfunctions/aurum-member/community-admin.js");
const { createCommunityFulfillment, ledgerId } = require("../cloudfunctions/aurum-member/community-fulfillment.js");
const ORDER_ID = "AC1234567890ABCDEF";
const ADMIN = "real-platform-admin-openid";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const validOrder = () => ({ _id: ORDER_ID, openid: "buyer-id", planId: "community-365d", priceFen: 29800, days: 365,
  status: "paid", wechatTradeState: "SUCCESS", wxTransactionId: "transaction-secret", paidAt: "2026-11-02T08:00:00.000Z" });
const input = { orderId: ORDER_ID, joinedAt: "2026-11-03T08:00:00.000Z" };

function fixture(values = { WANGCHAO_COMMUNITY_ADMIN_OPENID_HASHES: hash(ADMIN) }) {
  const docs = new Map([[`community_orders/${ORDER_ID}`, validOrder()]]);
  let checks = 0;
  let verifiedOrder = { ...validOrder(), verified: true };
  const db = { runTransaction: async (fn) => {
    const draft = new Map([...docs].map(([k, v]) => [k, structuredClone(v)]));
    const collection = (name) => ({ doc: (id) => ({
      get: async () => { if (!draft.has(`${name}/${id}`)) throw new Error("document not exist"); return { data: structuredClone(draft.get(`${name}/${id}`)) }; },
      set: async ({ data }) => draft.set(`${name}/${id}`, structuredClone(data)),
      update: async ({ data }) => draft.set(`${name}/${id}`, { ...draft.get(`${name}/${id}`), ...structuredClone(data) }),
    }) });
    const result = await fn({ collection });
    docs.clear(); for (const [k, v] of draft) docs.set(k, v);
    return result;
  } };
  const api = createCommunityAdmin({ values,
    verifyOrder: async () => { checks++; if (verifiedOrder instanceof Error) throw verifiedOrder; return verifiedOrder; },
    createFulfillment: ({ authorizeOperator }) => createCommunityFulfillment({ db, authorizeOperator, now: () => new Date("2026-11-04T08:00:00.000Z") }),
  });
  return { api, docs, checks: () => checks, setVerified: (value) => { verifiedOrder = value; } };
}

test("admin actions fail closed for absent or invalid allowlists and spoofed event identity", async () => {
  for (const values of [{}, { WANGCHAO_COMMUNITY_ADMIN_OPENID_HASHES: "malformed" }]) {
    const f = fixture(values);
    await assert.rejects(f.api.recordJoin({ ...input, OPENID: ADMIN }, {}), { code: "COMMUNITY_ADMIN_FORBIDDEN" });
    assert.equal(f.checks(), 0);
  }
  const f = fixture();
  for (const context of [{}, { OPENID: "attacker" }, { openid: ADMIN }]) {
    assert.equal(f.api.access(context).allowed, false);
    await assert.rejects(f.api.lookup({ ...input, OPENID: ADMIN }, context), { code: "COMMUNITY_ADMIN_FORBIDDEN" });
  }
  assert.equal(f.checks(), 0);
  assert.equal(f.api.access({ OPENID: ADMIN }).allowed, true);
});

test("fresh independently verified matching payment is mandatory for lookup and recording", async () => {
  const f = fixture(); const context = { OPENID: ADMIN };
  await assert.rejects(f.api.lookup({ orderId: "bad" }, context), { code: "COMMUNITY_ADMIN_INVALID_ORDER" });
  for (const change of [{ verified: false }, { status: "review" }, { wechatTradeState: "REFUND" },
    { wxTransactionId: "" }, { priceFen: 128800 }, { _id: "AC9999999999999999" }]) {
    f.setVerified({ ...validOrder(), verified: true, ...change });
    await assert.rejects(f.api.recordJoin(input, context), { code: "COMMUNITY_ADMIN_PAYMENT_UNCONFIRMED" });
  }
  f.setVerified(new Error("wechat unavailable"));
  await assert.rejects(f.api.recordJoin(input, context), /wechat unavailable/);
  assert.equal(f.docs.has(`community_fulfillments/${ledgerId("buyer-id")}`), false);
});

test("operator result omits identity and payment data; actual join is idempotent", async () => {
  const f = fixture(); const context = { OPENID: ADMIN };
  const view = await f.api.lookup(input, context);
  assert.equal(view.orderId, ORDER_ID);
  assert.equal(JSON.stringify(view).includes("buyer-id"), false);
  assert.equal(JSON.stringify(view).includes("transaction-secret"), false);
  const first = await f.api.recordJoin(input, context);
  const repeated = await f.api.recordJoin(input, context);
  assert.equal(first.endsAt, "2027-11-03T08:00:00.000Z");
  assert.equal(repeated.alreadyRecorded, true);
  assert.equal(JSON.stringify(first).includes(hash(ADMIN)), false);
  assert.equal(f.docs.get(`community_fulfillments/${ledgerId("buyer-id")}`).credits.length, 1);
});

test("refund or review racing with verification prevents recording in the transaction", async () => {
  const f = fixture();
  f.docs.set(`community_orders/${ORDER_ID}`, { ...validOrder(), status: "review", wechatTradeState: "REFUND" });
  await assert.rejects(f.api.recordJoin(input, { OPENID: ADMIN }), { code: "PAYMENT_NOT_VERIFIED" });
  assert.equal(f.docs.has(`community_fulfillments/${ledgerId("buyer-id")}`), false);
});
