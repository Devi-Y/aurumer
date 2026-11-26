// 群支付受控测试与公众发布彼此隔离。微信身份必须由云函数上下文传入。
const crypto = require("node:crypto");

function flag(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  return text === "true" ? true : (text === "false" || text === "" ? false : null);
}

function isTestAccount(openid, rawList) {
  if (typeof openid !== "string" || !openid.trim()) return false;
  const entries = String(rawList || "").split(/[\s,;]+/).filter(Boolean).map(value => value.toLowerCase());
  if (!entries.length || entries.some(value => !/^[a-f0-9]{64}$/.test(value))) return false;
  const hash = crypto.createHash("sha256").update(openid).digest();
  return entries.some(value => crypto.timingSafeEqual(hash, Buffer.from(value, "hex")));
}

function communityPaymentReadiness({ values = {}, openid = "", baseReady = false, now = Date.now(), promotionEnd } = {}) {
  const closed = { ready: false, mode: "closed" };
  if (baseReady !== true || typeof openid !== "string" || !openid.trim()
      || !Number.isFinite(now) || !Number.isFinite(promotionEnd) || now > promotionEnd
      || flag(values.WANGCHAO_COMMUNITY_CHECKOUT_ENABLED) !== true
      || flag(values.WANGCHAO_COMMUNITY_DELIVERY_READY) !== true) return closed;
  const testMode = flag(values.WANGCHAO_COMMUNITY_TEST_MODE);
  if (testMode === null) return closed;
  // 受控测试期间即使误开公众发布，也只能由白名单账号付款。
  if (testMode) {
    return isTestAccount(openid, values.WANGCHAO_COMMUNITY_TEST_OPENID_HASHES)
      ? { ready: true, mode: "test" } : closed;
  }
  return flag(values.WANGCHAO_COMMUNITY_RELEASE_APPROVED) === true
    ? { ready: true, mode: "public" } : closed;
}

module.exports = { communityPaymentReadiness, isTestAccount };
