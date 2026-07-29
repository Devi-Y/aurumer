const crypto = require("node:crypto");

const CONFIG_LABELS = {
  WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "正式收款合规审查",
  WANGCHAO_PAYMENT_RELEASE_APPROVED: "正式收款交付验收",
};

const MANUAL_REFUND_MODE = "merchant-manual";

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function paymentTestAccountId(openid) {
  const value = String(openid || "");
  return value ? crypto.createHash("sha256").update(value).digest("hex") : "";
}

function paymentTestHashes(values) {
  return String(values.WANGCHAO_PAYMENT_TEST_OPENID_HASHES || "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((value) => /^[a-f0-9]{64}$/.test(value));
}

function paymentTestAccountAllowed(openid, values = {}) {
  if (!enabled(values.WANGCHAO_PAYMENT_TEST_MODE)) return false;
  const accountId = paymentTestAccountId(openid);
  return Boolean(accountId && paymentTestHashes(values).includes(accountId));
}

function paymentReadiness({ values = {}, openid = "" }) {
  const testModeEnabled = enabled(values.WANGCHAO_PAYMENT_TEST_MODE);
  // 只返回当前用户自己的不可逆摘要，便于开发版先复制编号；是否能付款仍由测试模式和服务端白名单共同决定。
  const testAccountId = paymentTestAccountId(openid);
  const testAccountAllowed = paymentTestAccountAllowed(openid, values);
  const missing = [];
  if (values.WANGCHAO_PAYMENT_COMPLIANCE_APPROVED !== "true") missing.push(CONFIG_LABELS.WANGCHAO_PAYMENT_COMPLIANCE_APPROVED);
  const publicReady = enabled(values.WANGCHAO_PAYMENT_RELEASE_APPROVED);
  if (!publicReady && !testAccountAllowed) missing.push(CONFIG_LABELS.WANGCHAO_PAYMENT_RELEASE_APPROVED);
  const ready = missing.length === 0;
  const mode = ready ? (publicReady ? "public" : "test") : "closed";
  return {
    ready,
    mode,
    publicReady: ready && publicReady,
    refundMode: MANUAL_REFUND_MODE,
    testModeEnabled,
    testAccountAllowed,
    testAccountId,
    missing,
    reason: mode === "public"
      ? "普通微信支付已配置"
      : (mode === "test"
        ? "仅限指定验收账号进行真实付款测试，正式购买尚未开放"
        : (testModeEnabled
          ? "合规审查或当前账号验收资格尚未完成，当前不能付款"
          : "合规审查或上线验收尚未完成，当前不能付款")),
  };
}

module.exports = {
  paymentReadiness,
  paymentTestAccountAllowed,
  paymentTestAccountId,
  paymentTestHashes,
};
