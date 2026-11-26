// The caller must pass ONLY cloud.getWXContext() as context. Event fields are
// never trusted as identity. The allowlist is empty by default.
const crypto = require("node:crypto");

function adminError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function adminIdentity(context, values = process.env) {
  const openid = context && context.OPENID;
  if (typeof openid !== "string" || !openid.trim()) return null;
  const ids = String(values.WANGCHAO_COMMUNITY_ADMIN_OPENID_HASHES || "")
    .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) return null;
  const hash = crypto.createHash("sha256").update(openid).digest("hex");
  const digest = Buffer.from(hash, "hex");
  const allowed = ids.some((id) => crypto.timingSafeEqual(digest, Buffer.from(id, "hex")));
  return allowed ? { operatorId: `wechat_${hash}` } : null;
}

function validOrderId(value) {
  return typeof value === "string" && /^AC[A-Z0-9]{16,30}$/.test(value);
}

function createCommunityAdmin({ values = process.env, verifyOrder, createFulfillment } = {}) {
  if (typeof verifyOrder !== "function" || typeof createFulfillment !== "function") {
    throw new TypeError("A live order verifier and server-side fulfillment factory are required");
  }
  function access(context) { return { allowed: Boolean(adminIdentity(context, values)) }; }
  async function authenticatedOrder(event, context) {
    const operator = adminIdentity(context, values);
    if (!operator) throw adminError("COMMUNITY_ADMIN_FORBIDDEN", "无会员群管理权限");
    if (!validOrderId(event && event.orderId)) throw adminError("COMMUNITY_ADMIN_INVALID_ORDER", "订单编号无效");
    // This dependency must re-query WeChat, validate order, amount, merchant,
    // app and buyer, and atomically persist the resulting status before return.
    const order = await verifyOrder(event.orderId);
    if (!order || order._id !== event.orderId || order.planId !== "community-365d"
        || order.priceFen !== 29800 || order.days !== 365 || order.status !== "paid"
        || order.wechatTradeState !== "SUCCESS" || order.verified !== true || !order.wxTransactionId) {
      throw adminError("COMMUNITY_ADMIN_PAYMENT_UNCONFIRMED", "订单未确认付款或需要人工复核");
    }
    return { operator, order };
  }
  async function lookup(event, context) {
    const { order } = await authenticatedOrder(event, context);
    // Never send OpenID, payment credentials, or transaction ID to the client.
    return { orderId: order._id, status: order.status, amountFen: order.priceFen,
      paidAt: order.paidAt || null, fulfillment: order.deliveryFulfillment || null };
  }
  async function recordJoin(event, context) {
    const { operator, order } = await authenticatedOrder(event, context);
    // The internal fulfillment module rejects a client OpenID. The trusted
    // adapter below is created only after the cloud-context check above.
    const fulfillment = createFulfillment({ authorizeOperator: async () => operator });
    const result = await fulfillment.recordJoin({ orderId: order._id, joinedAt: event.joinedAt }, {});
    return { orderId: result.orderId, joinedAt: result.joinedAt, startsAt: result.startsAt,
      endsAt: result.endsAt, alreadyRecorded: result.alreadyRecorded };
  }
  return { access, lookup, recordJoin };
}

module.exports = { adminIdentity, validOrderId, createCommunityAdmin };
