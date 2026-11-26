import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const file = new URL("../cloudfunctions/aurum-member/index.js", import.meta.url);
const localRequire = createRequire(file);
const { createCommunityAdmin } = localRequire("./community-admin");
const { ledgerId } = localRequire("./community-fulfillment");
const ORDER_ID = "AC1234567890ABCDEF", ADMIN = "trusted-admin", BUYER = "buyer-openid";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function fixture() {
  let context = {}, tradeState = "SUCCESS", queries = 0;
  const docs = new Map([[`community_orders/${ORDER_ID}`, { openid: BUYER, appId: "wx-test", planId: "community-365d",
    priceFen: 29800, days: 365, status: "pending", createdAt: new Date("2026-10-25T00:00:00Z") }]]);
  const collection = (storage) => (name) => ({ doc: (id) => ({
    get: async () => { const doc = storage.get(`${name}/${id}`); if (!doc) throw new Error("document not exist"); return { data: structuredClone(doc) }; },
    set: async ({ data }) => storage.set(`${name}/${id}`, structuredClone(data)),
    update: async ({ data }) => storage.set(`${name}/${id}`, { ...storage.get(`${name}/${id}`), ...structuredClone(data) }),
  }) });
  const db = { collection: collection(docs), runTransaction: async (fn) => {
    const draft = new Map([...docs].map(([k, v]) => [k, structuredClone(v)]));
    const result = await fn({ collection: collection(draft) });
    docs.clear(); for (const [k, v] of draft) docs.set(k, v);
    return result;
  } };
  const cloud = { DYNAMIC_CURRENT_ENV: "test", init() {}, database: () => db, getWXContext: () => context,
    cloudPay: { queryOrder: async () => { queries++; return { errCode: 0, returnCode: "SUCCESS", resultCode: "SUCCESS",
      outTradeNo: ORDER_ID, subMchId: "1745865229", subAppid: "wx-test", subOpenid: BUYER,
      attach: "community-365d", totalFee: 29800, tradeState, transactionId: "private-trade" }; } } };
  const module = { exports: {} };
  const mocks = {
    "wx-server-sdk": cloud,
    "./community-admin": { createCommunityAdmin: (options) => createCommunityAdmin({ ...options,
      values: { WANGCHAO_COMMUNITY_ADMIN_OPENID_HASHES: hash(ADMIN) } }) },
  };
  vm.runInNewContext(readFileSync(file, "utf8"), { module, exports: module.exports,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    process, Buffer, Date, console: { error() {} } });
  return { main: module.exports.main, docs, setContext: (value) => { context = value; },
    setTradeState: (value) => { tradeState = value; }, queries: () => queries };
}

test("cloud route uses platform context, never event-supplied administrator identity", async () => {
  const f = fixture();
  const spoof = { action: "communityAdminLookup", orderId: ORDER_ID, OPENID: ADMIN };
  assert.equal((await f.main(spoof)).code, "NO_OPENID");
  f.setContext({ OPENID: "other-user" });
  assert.equal((await f.main({ action: "communityAdminAccess", OPENID: ADMIN })).data.allowed, false);
  assert.equal((await f.main(spoof)).code, "COMMUNITY_ADMIN_FORBIDDEN");
  assert.equal(f.queries(), 0);
  f.setContext({ OPENID: ADMIN });
  assert.equal((await f.main({ action: "communityAdminAccess" })).data.allowed, true);
});

test("cloud routes query WeChat, prevent refund fulfillment, and record entry exactly once", async () => {
  const f = fixture(); f.setContext({ OPENID: ADMIN });
  const lookup = await f.main({ action: "communityAdminLookup", orderId: ORDER_ID });
  assert.equal(lookup.ok, true); assert.equal(lookup.data.status, "paid");
  assert.equal(JSON.stringify(lookup.data).includes(BUYER), false);
  const event = { action: "communityAdminRecordJoin", orderId: ORDER_ID, joinedAt: "2026-10-30T08:00:00.000Z" };
  const first = await f.main(event), second = await f.main(event);
  assert.equal(first.ok, true); assert.equal(second.data.alreadyRecorded, true);
  assert.equal(f.docs.get(`community_fulfillments/${ledgerId(BUYER)}`).credits.length, 1);
  assert.equal(f.queries(), 3);
  f.setTradeState("REFUND");
  const refund = await f.main(event);
  assert.equal(refund.code, "COMMUNITY_ADMIN_PAYMENT_UNCONFIRMED");
  assert.equal(f.docs.get(`community_orders/${ORDER_ID}`).status, "review");
  assert.equal(f.docs.get(`community_fulfillments/${ledgerId(BUYER)}`).credits.length, 1);
});
