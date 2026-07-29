const crypto = require("node:crypto");
const {
  entitlementData,
  entitlementSchedule,
  normalizeEntitlementCredits,
} = require("./entitlement-ledger");

const FREE_TEST_CAMPAIGN_ID = "wangchao-free-test-20260728";
const FREE_TEST_DAYS = 365;

function freeTestGrantId(openid) {
  const value = String(openid || "");
  if (!value) throw new Error("免费测试授权缺少用户标识");
  const accountDigest = crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `free-test-20260728-${accountDigest}`;
}

function prepareFreeTestGrant(current, openid, now = new Date(), creditLimit = 200) {
  const grantedAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(grantedAt.getTime())) throw new Error("免费测试授权时间无效");

  const grantId = freeTestGrantId(openid);
  const credits = normalizeEntitlementCredits(current);
  const existingCredit = credits.find((credit) => credit.orderId === grantId);
  if (existingCredit) {
    const schedule = entitlementSchedule(credits);
    return {
      alreadyGranted: true,
      grantId,
      data: null,
      expiresAt: schedule.expiresAt,
    };
  }
  if (credits.length >= Number(creditLimit)) {
    const error = new Error("权益订单记录已达上限，请联系客服处理");
    error.code = "ENTITLEMENT_LEDGER_LIMIT";
    throw error;
  }

  credits.push({
    orderId: grantId,
    days: FREE_TEST_DAYS,
    remainingDays: FREE_TEST_DAYS,
    grantedAt,
    refundedAt: null,
    source: "manual-free-test",
    campaignId: FREE_TEST_CAMPAIGN_ID,
  });
  const data = entitlementData(openid, credits, grantedAt, current || {});
  return {
    alreadyGranted: false,
    grantId,
    data,
    expiresAt: data.expiresAt,
  };
}

module.exports = {
  FREE_TEST_CAMPAIGN_ID,
  FREE_TEST_DAYS,
  freeTestGrantId,
  prepareFreeTestGrant,
};
