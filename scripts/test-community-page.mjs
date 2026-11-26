import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const file = new URL("../miniprogram/pages/community/index.js", import.meta.url);
const localRequire = createRequire(file);
const community = localRequire("../../config/community");
function pageFixture({ qr = community.wechatQrImage, enabled = true } = {}) {
  let page; let result = { checkoutReady: true, order: null, verificationPending: false }; let adminResult = { allowed: false }; let calls = 0; const images = []; const copies = []; const routes = [];
  const config = { ...localRequire("../../config/community"), checkoutEnabled: enabled, wechatQrImage: qr };
  const service = { status: async () => { calls++; if (result instanceof Error) throw result; return result; }, purchase: async () => "test" };
  vm.runInNewContext(readFileSync(file, "utf8"), {
    Page: (p) => { page = p; page.data = { ...p.data }; page.setData = (v) => Object.assign(page.data, v); },
    require: (id) => id === "../../config/community" ? config : id === "../../services/community" ? service
      : id === "../../services/community-admin" ? { access: async () => { if (adminResult instanceof Error) throw adminResult; return adminResult; } }
      : id === "../../utils/nav" ? { goHome() {}, openPage: (url) => routes.push(url) } : localRequire(id),
    wx: { cloud: {}, previewImage: (params) => images.push(params), setClipboardData: (params) => copies.push(params.data), showToast() {} }, setTimeout() {}, clearTimeout() {},
  });
  return { page, images, copies, routes, setAdminResult: (v) => { adminResult = v; }, setResult: (v) => { result = v; }, calls: () => calls };
}
test("configured personal QR is a bundled JPEG and checkout remains closed", () => {
  assert.match(community.wechatQrImage, /^\/assets\/offers\/[a-z0-9-]+\.jpg$/);
  const bytes = readFileSync(new URL(`../miniprogram${community.wechatQrImage}`, import.meta.url));
  assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.equal(community.checkoutEnabled, false);
});
test("checkout stays closed when no personal QR image is configured", async () => {
  const f = pageFixture({ qr: "" });
  await f.page.refreshStatus(); assert.equal(f.page.data.checkoutReady, false);
  f.setResult({ checkoutReady: true, order: { paid: true }, verificationPending: false });
  await f.page.refreshStatus(true); assert.equal(f.page.data.showQr, false);
});
test("only verified paid state automatically opens QR; errors hide it and returning refreshes", async () => {
  const template = readFileSync(new URL("../miniprogram/pages/community/index.wxml", import.meta.url), "utf8");
  assert.match(template, /showQr && order\.paid && !verificationPending/);
  assert.match(template, /src="\{\{qrImage\}\}"[^>]*show-menu-by-longpress/);
  const f = pageFixture();
  f.setResult({ checkoutReady: true, order: { paid: true }, verificationPending: false });
  await f.page.refreshStatus(true); assert.equal(f.page.data.showQr, true);
  assert.equal(f.page.data.qrImage, community.wechatQrImage);
  f.page.closePaidQr(); assert.equal(f.page.data.showQr, false);
  f.page.openPaidQr(); assert.equal(f.page.data.showQr, true);
  f.setResult(new Error("temporary failure")); await f.page.refreshStatus();
  assert.equal(f.page.data.verificationPending, true); f.page.openPaidQr(); assert.equal(f.page.data.showQr, false);
  f.setResult({ checkoutReady: true, order: { paid: true }, verificationPending: false });
  f.page.onShow(); f.page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.page.data.verificationPending, false); assert.equal(f.calls(), 3);
  f.page.openPaidQr(); assert.equal(f.page.data.showQr, true);
});
test("old cloud function without the group action does not show a false order error while checkout is closed", async () => {
  const f = pageFixture({ enabled: false });
  const oldBackend = new Error("未知的会员服务操作"); oldBackend.code = "UNKNOWN_ACTION";
  f.setResult(oldBackend); await f.page.refreshStatus();
  assert.equal(f.page.data.checkoutReady, false);
  assert.equal(f.page.data.verificationPending, false);
  f.setResult(new Error("network unavailable")); await f.page.refreshStatus();
  assert.equal(f.page.data.verificationPending, true);
});
test("user can copy only their own valid group order number", async () => {
  const f = pageFixture();
  f.page.copyOrderId(); assert.equal(f.copies.length, 0);
  f.setResult({ checkoutReady: true, order: { paid: true, orderId: "AC1234567890ABCDEF" }, verificationPending: false });
  await f.page.refreshStatus(); f.page.copyOrderId();
  assert.deepEqual(f.copies, ["AC1234567890ABCDEF"]);
  f.page.data.order.orderId = "owner_private"; f.page.copyOrderId();
  assert.equal(f.copies.length, 1);
});
test("verified members can see their recorded expiry date", async () => {
  const f = pageFixture();
  f.setResult({ checkoutReady: true, order: { paid: true, fulfillment: { endsAt: "2027-11-04T00:00:00.000Z" } }, verificationPending: false });
  await f.page.refreshStatus();
  assert.match(f.page.data.order.endsText, /2027-11-04 08:00/);
  const template = readFileSync(new URL("../miniprogram/pages/community/index.wxml", import.meta.url), "utf8");
  assert.match(template, /order\.paid && !verificationPending && order\.endsText/);
});
test("management entry stays hidden on denial or error and appears only after server authorization", async () => {
  const f = pageFixture();
  for (const state of [{ allowed: false }, new Error("network unavailable")]) {
    f.setAdminResult(state); await f.page.checkAdminAccess(); f.page.openAdmin();
    assert.equal(f.page.data.adminAllowed, false);
    assert.equal(f.routes.length, 0);
  }
  f.setAdminResult({ allowed: true }); await f.page.checkAdminAccess(); f.page.openAdmin();
  assert.equal(f.routes[0], "/pages/community-admin/index");
});
