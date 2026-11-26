import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const file = new URL("../miniprogram/pages/community-admin/index.js", import.meta.url);
const require = createRequire(file);
const { joinedAtIso } = require("../../utils/community-admin");
const ORDER_ID = "AC1234567890ABCDEF";
function fixture({ allowed = false, failure = null } = {}) {
  let page; const calls = [];
  const api = {
    access: async () => { if (failure) throw failure; return { allowed }; },
    lookup: async (orderId) => { calls.push(["lookup", orderId]); return { orderId, status: "paid" }; },
    recordJoin: async (orderId, joinedAt) => { calls.push(["recordJoin", orderId, joinedAt]);
      return { orderId, joinedAt, startsAt: joinedAt, endsAt: "2027-11-03T08:00:00.000Z" }; },
  };
  vm.runInNewContext(readFileSync(file, "utf8"), {
    Page: (p) => { page = p; page.data = { ...p.data }; page.setData = (v) => Object.assign(page.data, v); },
    require: (id) => id === "../../services/community-admin" ? api : require(id),
    wx: { showModal: ({ success }) => success({ confirm: true }) }, Date,
  });
  return { page, calls };
}

test("date conversion uses actual Beijing time and rejects impossible dates", () => {
  assert.equal(joinedAtIso("2026-11-03", "16:00"), "2026-11-03T08:00:00.000Z");
  for (const [day, time] of [["2026-02-30", "12:00"], ["2026-11-03", "24:00"], ["", "12:00"]])
    assert.equal(joinedAtIso(day, time), "");
});
test("unverified users and failed authorization cannot query or record", async () => {
  for (const options of [{ allowed: false }, { failure: new Error("offline") }]) {
    const f = fixture(options); await f.page.onLoad();
    f.page.onOrderInput({ detail: { value: ORDER_ID } }); f.page.lookup(); f.page.recordJoin();
    assert.equal(f.page.data.allowed, false);
    assert.equal(f.calls.length, 0);
  }
});
test("authorized user verifies order before confirming actual entry time", async () => {
  const f = fixture({ allowed: true }); await f.page.onLoad();
  f.page.onOrderInput({ detail: { value: ORDER_ID.toLowerCase() } });
  await f.page.lookup();
  assert.deepEqual(f.calls[0], ["lookup", ORDER_ID]);
  f.page.onDateChange({ detail: { value: "2020-11-03" } });
  f.page.onTimeChange({ detail: { value: "16:00" } });
  f.page.recordJoin(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls[1], ["recordJoin", ORDER_ID, "2020-11-03T08:00:00.000Z"]);
  assert.match(f.page.data.result.endsText, /北京时间/);
  f.page.onOrderInput({ detail: { value: "ACABC" } }); f.page.recordJoin();
  assert.equal(f.calls.length, 2);
});
