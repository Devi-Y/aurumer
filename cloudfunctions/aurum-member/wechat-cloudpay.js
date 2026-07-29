const crypto = require("node:crypto");

// 商户号是公开业务标识，不是密钥。可在云函数环境变量中覆盖，密钥和证书由 cloudPay 代管。
const DEFAULT_SUB_MCH_ID = "1745865229";

function firstField(source, names) {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    if (source[name] != null) return source[name];
  }
  return undefined;
}

function field(source, camelName, snakeName) {
  return firstField(source, [camelName, snakeName]);
}

function cloudPaySubMchId(values = process.env) {
  return String(values.WANGCHAO_CLOUDPAY_SUB_MCH_ID || DEFAULT_SUB_MCH_ID).trim();
}

function cloudPayNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function parseWechatTime(value) {
  const text = String(value || "");
  if (!/^\d{14}$/.test(text)) return null;
  const date = new Date(
    `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    + `T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+08:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function cloudPayTradeState(result) {
  return String(field(result, "tradeState", "trade_state") || "").toUpperCase();
}

function isCloudPayCallback(event, context = {}) {
  return Boolean(
    event
    && !context.OPENID
    && !event.action
    && /^AU[A-Z0-9]{16,30}$/.test(String(firstField(event, ["outTradeNo", "out_trade_no"]) || ""))
    && firstField(event, ["resultCode", "result_code"])
    && firstField(event, ["returnCode", "return_code"]),
  );
}

function validateCloudPayOrder(orderId, order, result, options = {}) {
  if (!result || String(field(result, "outTradeNo", "out_trade_no") || "") !== orderId) {
    const error = new Error("微信订单号与本地订单不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }
  if (String(field(result, "returnCode", "return_code") || "").toUpperCase() !== "SUCCESS") {
    const error = new Error(String(field(result, "returnMsg", "return_msg") || "微信支付通信失败"));
    error.code = "CLOUDPAY_QUERY_FAILED";
    throw error;
  }
  if (String(field(result, "resultCode", "result_code") || "").toUpperCase() !== "SUCCESS") {
    const error = new Error(String(field(result, "errCodeDes", "err_code_des") || "微信支付业务校验失败"));
    error.code = "CLOUDPAY_QUERY_FAILED";
    throw error;
  }

  const expectedFee = Number(order && order.priceFen);
  const totalFee = Number(field(result, "totalFee", "total_fee"));
  if (!Number.isInteger(expectedFee) || expectedFee < 100 || totalFee !== expectedFee) {
    const error = new Error("微信订单金额与服务端价格不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }

  const expectedMerchant = String(options.subMchId || cloudPaySubMchId());
  const actualMerchant = String(firstField(result, ["subMchId", "sub_mch_id", "mchId", "mch_id"]) || "");
  if (!actualMerchant || actualMerchant !== expectedMerchant) {
    const error = new Error("微信商户与望潮支付配置不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }

  const actualAppId = String(firstField(result, ["subAppid", "sub_appid", "appid", "appId"]) || "");
  if (!actualAppId || !order.appId || actualAppId !== order.appId) {
    const error = new Error("微信支付 AppID 与望潮小程序不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }

  const actualOpenid = String(firstField(result, ["subOpenid", "sub_openid", "openid"]) || "");
  if (!actualOpenid || !order.openid || actualOpenid !== order.openid) {
    const error = new Error("微信支付用户与本地订单不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }

  const attach = String(result.attach || "");
  if (!attach || !order.planId || attach !== order.planId) {
    const error = new Error("微信支付商品与本地订单不一致，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }

  if (options.requirePaidState && cloudPayTradeState(result) !== "SUCCESS") {
    const error = new Error("微信查单结果尚未支付成功");
    error.code = "CLOUDPAY_NOT_PAID";
    throw error;
  }
  if (options.requirePaidState && !String(field(result, "transactionId", "transaction_id") || "")) {
    const error = new Error("微信查单结果缺少交易号，未发放权益");
    error.code = "CLOUDPAY_ORDER_MISMATCH";
    throw error;
  }
}

function cloudPaySnapshot(result, now = new Date()) {
  const snapshot = {
    paymentProvider: "wechat-jsapi",
    lastReconciledAt: now,
    lastReconcileAttemptAt: now,
    updatedAt: now,
    wxTransactionId: String(field(result, "transactionId", "transaction_id") || ""),
    wechatTradeState: cloudPayTradeState(result),
    wechatReturnCode: String(field(result, "returnCode", "return_code") || ""),
    wechatResultCode: String(field(result, "resultCode", "result_code") || ""),
  };
  for (const [camelName, snakeName, target] of [
    ["totalFee", "total_fee", "wechatTotalFeeFen"],
    ["cashFee", "cash_fee", "wechatCashFeeFen"],
    ["settlementTotalFee", "settlement_total_fee", "wechatSettlementFeeFen"],
  ]) {
    const value = Number(field(result, camelName, snakeName));
    if (Number.isFinite(value)) snapshot[target] = value;
  }
  return snapshot;
}

module.exports = {
  cloudPayNonce,
  cloudPaySnapshot,
  cloudPaySubMchId,
  cloudPayTradeState,
  isCloudPayCallback,
  parseWechatTime,
  validateCloudPayOrder,
};
