// 独立社群商品：订单与旧研究会员完全隔离。支付不等于已经入群。
const crypto = require("node:crypto");
const { cloudPayNonce, cloudPaySubMchId, cloudPayTradeState, validateCloudPayOrder } = require("./wechat-cloudpay");
const { paymentReadiness } = require("./payment-readiness");
const { communityPaymentReadiness } = require("./community-payment-readiness");
const COLLECTION = "community_orders";
const PLAN = Object.freeze({ id: "community-365d", name: "望潮会员群", priceFen: 29800, days: 365 });
const TERMS = "2026-10-27-v1";
const PROMOTION_END = Date.parse("2026-12-31T23:59:59+08:00");
const RECONCILE_CURSOR = "__community_reconcile_state__";
const RECONCILE_PAGE_SIZE = 25;
const RECONCILE_MAX_ATTEMPTS = 5;
const RECONCILE_BUDGET_MS = 12000;
const RECONCILE_REQUEST_RESERVE_MS = 7000;

function groupError(code, message) { const error = new Error(message); error.code = code; return error; }
function enabled(value) { return String(value || "").trim().toLowerCase() === "true"; }
function groupReady(values, openid, now = Date.now()) {
  const base = paymentReadiness({ values, openid });
  return communityPaymentReadiness({ values, openid, baseReady: base.ready, now, promotionEnd: PROMOTION_END }).ready;
}
function ownerKey(openid) { return `owner_${crypto.createHash("sha256").update(openid).digest("hex")}`; }
function newId() { return `AC${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(6).toString("hex").toUpperCase()}`.slice(0, 32); }
function missingDocument(error) {
  // 错误码 -1 可能代表其他失败，只有明确的文档不存在消息才当作缺失。
  return /(?:document|doc).*?(?:not exist|does not exist)|(?:not exist|does not exist).*?(?:document|doc)|文档不存在/i.test(String(error && (error.errMsg || error.message) || ""));
}
function isCommunityCallback(event, context = {}) {
  return Boolean(event && !context.OPENID && !event.action
    && /^AC[A-Z0-9]{16,30}$/.test(String(event.outTradeNo || event.out_trade_no || ""))
    && (event.returnCode || event.return_code) && (event.resultCode || event.result_code));
}
function isCommunityTimer(event) {
  return Boolean(event && event.Type === "Timer" && event.TriggerName === "community-order-reconcile");
}

function validateCommunityQuery(orderId, order, result, values) {
  const state = cloudPayTradeState(result);
  // 成功交易始终执行完整金额、账户、用户、商品与交易号校验。
  if (state === "SUCCESS") {
    validateCloudPayOrder(orderId, order, result, { requirePaidState: true, subMchId: cloudPaySubMchId(values) });
    return state;
  }
  const first = (names) => names.map(name => result && result[name]).find(value => value != null);
  const matches = (names, expected, required = false) => {
    const actual = first(names);
    return actual == null ? !required : String(actual) === String(expected);
  };
  // 非成功响应部分付款字段不保证返回；仍须由服务器查单，并核对商户与订单号。
  if (!result || String(first(["returnCode", "return_code"]) || "").toUpperCase() !== "SUCCESS"
      || String(first(["resultCode", "result_code"]) || "").toUpperCase() !== "SUCCESS"
      || !["NOTPAY", "USERPAYING", "CLOSED", "REFUND", "REVOKED", "PAYERROR"].includes(state)
      || !matches(["outTradeNo", "out_trade_no"], orderId, true)
      || !matches(["subMchId", "sub_mch_id"], cloudPaySubMchId(values), true)
      || !matches(["subAppid", "sub_appid"], order.appId)
      || !matches(["subOpenid", "sub_openid", "openid"], order.openid)
      || !matches(["totalFee", "total_fee"], order.priceFen)
      || !matches(["attach"], order.planId)) {
    throw groupError("CLOUDPAY_ORDER_MISMATCH", "微信订单状态未能核验，请稍后再试");
  }
  return state;
}

function createCommunityPurchase({ cloud, db, queryOrder, paymentParams, values = process.env, clock = Date.now }) {
  async function read(id) {
    try { return (await db.collection(COLLECTION).doc(id).get()).data || null; }
    catch (error) { if (missingDocument(error)) return null; throw error; }
  }
  async function current(openid) {
    const owner = await read(ownerKey(openid));
    if (!owner || !owner.orderId) return null;
    const order = await read(owner.orderId);
    if (!order || order.openid !== openid) throw groupError("COMMUNITY_ORDER_REVIEW", "订单状态需人工核对，请联系客服");
    return { ...order, _id: owner.orderId };
  }
  async function reconcile(order) {
    if (!["creating", "create_uncertain", "prepared", "pending", "paid", "review", "closed"].includes(order.status)) return { ...order, verified: false };
    if (order.planId !== PLAN.id || order.priceFen !== PLAN.priceFen || order.days !== PLAN.days) throw groupError("COMMUNITY_ORDER_MISMATCH", "会员群订单不匹配");
    const result = await queryOrder(order._id);
    const state = validateCommunityQuery(order._id, order, result, values);
    let updated;
    await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTION).doc(order._id);
      const latest = (await ref.get()).data;
      // 基于事务中最新状态转移：迟到的 NOTPAY 永不能覆盖付款或退款复核。
      let status = latest.status;
      if (status !== "review") {
        if (state === "REFUND") status = "review";
        else if (state === "SUCCESS") status = status === "closed" ? "review" : "paid";
        else if (state === "CLOSED") status = status === "paid" ? "review" : "closed";
        // 只把微信明确的 CLOSED 当作可新建订单的终态。
        else if (["REVOKED", "PAYERROR"].includes(state)) status = "review";
        else if (!["paid", "closed"].includes(status)) status = "pending";
      }
      const update = { status, wechatTradeState: state, updatedAt: new Date(), lastVerifiedAt: new Date(clock()), lastReconcileAttemptAt: new Date(clock()), lastReconcileErrorCode: "" };
      if (status === "paid" && state === "SUCCESS") { update.paidAt = latest.paidAt || new Date(); update.wxTransactionId = String(result.transactionId || result.transaction_id); }
      await ref.update({ data: update });
      updated = { ...latest, ...update, _id: order._id, verified: status === "paid" && state === "SUCCESS" };
    });
    return updated;
  }
  function visible(order) {
    if (!order) return null;
    const delivery = order.status === "paid" && order.verified && order.deliveryFulfillment;
    const times = delivery && [delivery.joinedAt, delivery.startsAt, delivery.endsAt];
    const fulfillment = times && times.every((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
      && Date.parse(delivery.endsAt) > Date.parse(delivery.startsAt)
      ? { joinedAt: delivery.joinedAt, startsAt: delivery.startsAt, endsAt: delivery.endsAt } : null;
    return { orderId: order._id, status: order.status, paid: order.status === "paid", amountFen: order.priceFen,
      paidAt: order.paidAt || null, delivery: order.status === "paid" ? "待添加微信，由工作人员安排入群" : "", fulfillment };
  }
  async function status(openid) {
    let order = await current(openid);
    let verificationPending = false;
    if (order) {
      try { order = await reconcile(order); verificationPending = order.status === "paid" && !order.verified; } catch (error) { verificationPending = true; }
    }
    const view = visible(order);
    if (verificationPending && view) view.paid = false;
    return { checkoutReady: groupReady(values, openid, clock()), verificationPending, order: view };
  }
  async function verifyForAdmin(orderId) {
    const id = String(orderId || "");
    if (!/^AC[A-Z0-9]{16,30}$/.test(id)) throw groupError("COMMUNITY_ORDER_MISMATCH", "会员群订单不匹配");
    const order = await read(id);
    if (!order) throw groupError("COMMUNITY_ORDER_MISMATCH", "会员群订单不匹配");
    return reconcile({ ...order, _id: id });
  }
  async function closeExpiredUnpaid(order) {
    // 关单可恢复过期收银台，但仅在显式启用和微信查单确认未支付后执行。
    if (!enabled(values.WANGCHAO_COMMUNITY_CLOSE_ORDER_ENABLED) || order.status !== "pending" || order.wechatTradeState !== "NOTPAY") return order;
    const created = new Date(order.createdAt || 0).getTime();
    const age = clock() - created;
    if (!Number.isFinite(created) || created <= 0 || age < 30 * 60 * 1000) return order;
    try {
      await cloud.cloudPay.closeOrder({ subMchId: cloudPaySubMchId(values), outTradeNo: order._id, nonceStr: cloudPayNonce() });
    } catch (_) {
      // 请求超时可能已经关单；后续查单是唯一判定依据。
    }
    return reconcile(order);
  }
  async function prepare(event, context) {
    if (!groupReady(values, context.OPENID, clock())) throw groupError("COMMUNITY_CHECKOUT_CLOSED", "会员群付款暂未开放");
    if (!event.legalConsent || event.legalConsent.accepted !== true || event.legalConsent.adultConfirmed !== true || event.legalConsent.termsVersion !== TERMS)
      throw groupError("COMMUNITY_CONSENT_REQUIRED", "请确认已成年并同意当前会员群服务与退款约定");
    const appId = String(context.APPID || values.WANGCHAO_MINI_APP_ID || "");
    const envId = String(values.TCB_ENV || context.ENV || values.WANGCHAO_CLOUD_ENV_ID || "");
    if (!appId || !envId) throw groupError("COMMUNITY_CONFIG_MISSING", "小程序支付环境尚未配置");
    const existing = await current(context.OPENID);
    if (existing) {
      let checked = await reconcile(existing);
      const prepayAge = clock() - new Date(checked.prepayCreatedAt || 0).getTime();
      if (["prepared", "pending"].includes(checked.status) && checked.payment && prepayAge >= 0 && prepayAge < 30 * 60 * 1000) return { orderId: checked._id, payment: checked.payment };
      checked = await closeExpiredUnpaid(checked);
      if (checked.status !== "closed" || checked.wechatTradeState !== "CLOSED") throw groupError("COMMUNITY_ORDER_EXISTS", "已有会员群订单，请查看订单状态或联系客服");
    }
    const orderId = newId();
    const now = new Date(clock());
    // 用户锁与订单在同一事务内建立，避免连续点击产生多笔待付款订单。
    await db.runTransaction(async (transaction) => {
      const ownerRef = transaction.collection(COLLECTION).doc(ownerKey(context.OPENID));
      let owner = null;
      try { owner = (await ownerRef.get()).data; } catch (error) { if (!missingDocument(error)) throw error; }
      if (owner && owner.orderId) {
        const old = (await transaction.collection(COLLECTION).doc(owner.orderId).get()).data;
        if (!old || old.status !== "closed" || old.wechatTradeState !== "CLOSED") throw groupError("COMMUNITY_ORDER_EXISTS", "已有会员群订单，请查看订单状态或联系客服");
      }
      await transaction.collection(COLLECTION).doc(orderId).set({ data: { openid: context.OPENID, appId, planId: PLAN.id, planName: PLAN.name, priceFen: PLAN.priceFen, days: PLAN.days,
        legalConsent: { accepted: true, adultConfirmed: true, termsVersion: TERMS, acceptedAt: now }, status: "creating", createdAt: now, updatedAt: now } });
      await ownerRef.set({ data: { orderId, updatedAt: now } });
    });
    try {
      const result = await cloud.cloudPay.unifiedOrder({ body: "望潮会员群年费", outTradeNo: orderId, spbillCreateIp: "127.0.0.1", subMchId: cloudPaySubMchId(values), subAppid: appId,
        totalFee: PLAN.priceFen, tradeType: "JSAPI", nonceStr: cloudPayNonce(), attach: PLAN.id, envId, functionName: "aurum-member" });
      if (!result || Number(result.errCode) !== 0 || String(result.returnCode).toUpperCase() !== "SUCCESS" || String(result.resultCode).toUpperCase() !== "SUCCESS")
        throw groupError("COMMUNITY_CREATE_FAILED", "微信支付下单未确认，请查看订单状态或联系客服");
      const payment = paymentParams(result.payment);
      let alreadyPaid = false;
      await db.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTION).doc(orderId);
        const latest = (await ref.get()).data;
        if (["creating", "pending"].includes(latest.status)) await ref.update({ data: { status: "prepared", payment, prepayCreatedAt: new Date(clock()), updatedAt: new Date() } });
        else if (latest.status === "paid") alreadyPaid = true;
        else throw groupError("COMMUNITY_ORDER_REVIEW", "订单状态需人工核对，请联系客服");
      });
      return alreadyPaid ? { orderId, alreadyPaid: true } : { orderId, payment };
    } catch (error) {
      // 下单请求结果不确定时不能新建第二笔订单；人工核对后处理。
      await db.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTION).doc(orderId);
        const latest = (await ref.get()).data;
        if (latest.status === "creating") await ref.update({ data: { status: "create_uncertain", createError: String(error.message || error).slice(0, 200), updatedAt: new Date() } });
      });
      throw error;
    }
  }
  async function callback(event) {
    const id = String(event.outTradeNo || event.out_trade_no || "");
    const order = await read(id);
    if (!order || order.planId !== PLAN.id || order.priceFen !== PLAN.priceFen) throw groupError("COMMUNITY_ORDER_MISMATCH", "会员群订单不匹配");
    // 通知本身不用于确认付款，必须重新查单。
    const checked = await reconcile({ ...order, _id: id });
    if (checked.status !== "paid") throw groupError("COMMUNITY_PAYMENT_PENDING", "支付结果未确认");
    return { errcode: 0, errmsg: "" };
  }
  async function reconcileBatch() {
    const state = await read(RECONCILE_CURSOR);
    const start = String((state && state.cursor) || "AC");
    const page = await db.collection(COLLECTION).where({ _id: db.command.gt(start) }).orderBy("_id", "asc").limit(RECONCILE_PAGE_SIZE).get();
    const rows = page.data || [];
    const summary = { scanned: 0, attempted: 0, failed: 0, wrapped: false };
    const deadline = clock() + RECONCILE_BUDGET_MS;
    let cursor = start;
    async function saveCursor(value) {
      await db.collection(COLLECTION).doc(RECONCILE_CURSOR).set({ data: { cursor: value, updatedAt: new Date(), lastSummary: summary } });
    }
    for (const row of rows) {
      const id = String(row && row._id || "");
      if (id >= "AD") { summary.wrapped = true; break; }
      if (!/^AC[A-Z0-9]{16,30}$/.test(id)) { cursor = id; summary.scanned += 1; await saveCursor(cursor); continue; }
      const lastAttempt = Math.max(new Date(row.lastReconcileAttemptAt || 0).getTime() || 0, new Date(row.lastVerifiedAt || 0).getTime() || 0);
      const interval = ["paid", "review"].includes(row.status) ? 6 * 60 * 60 * 1000 : 15 * 1000;
      const due = ["creating", "create_uncertain", "prepared", "pending", "paid", "review"].includes(row.status)
        && (!Number.isFinite(lastAttempt) || clock() - lastAttempt >= interval);
      if (due && (summary.attempted >= RECONCILE_MAX_ATTEMPTS || (summary.attempted && deadline - clock() < RECONCILE_REQUEST_RESERVE_MS))) break;
      if (due) {
        summary.attempted += 1;
        try { await reconcile(row); }
        catch (error) {
          summary.failed += 1;
          // 仅标记尝试，不覆盖订单状态；下一个扫描周期重新核对。
          await db.collection(COLLECTION).doc(id).update({ data: { lastReconcileAttemptAt: new Date(clock()), lastReconcileErrorCode: String(error.code || "QUERY_FAILED").slice(0, 60) } });
        }
      }
      cursor = id; summary.scanned += 1;
      await saveCursor(cursor);
    }
    if (!rows.length || (summary.scanned === rows.length && rows.length < RECONCILE_PAGE_SIZE)) summary.wrapped = true;
    if (summary.wrapped) await saveCursor("");
    return summary;
  }
  return { status, prepare, callback, reconcileBatch, verifyForAdmin };
}
module.exports = { COLLECTION, PLAN, TERMS, groupReady, isCommunityCallback, isCommunityTimer, validateCommunityQuery, createCommunityPurchase };
