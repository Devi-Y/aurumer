const DAY = 24 * 60 * 60 * 1000;

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEntitlementCredits(data) {
  const source = data && Array.isArray(data.credits) ? data.credits : [];
  const credits = source.map((credit) => {
    const grantedAt = dateValue(credit && credit.grantedAt);
    const refundedAt = dateValue(credit && credit.refundedAt);
    const days = finiteNumber(credit && credit.days);
    const configuredRemainingDays = credit && credit.remainingDays == null
      ? days
      : finiteNumber(credit && credit.remainingDays);
    if (!credit || !credit.orderId || !grantedAt || days == null || days <= 0) return null;
    return {
      ...credit,
      orderId: String(credit.orderId),
      days,
      remainingDays: Math.max(0, configuredRemainingDays == null ? days : configuredRemainingDays),
      grantedAt,
      refundedAt,
    };
  }).filter(Boolean);
  if (credits.length || !data) return credits;

  // 兼容旧版单一 expiresAt 记录。真实支付启用前会统一进入 credits 账本。
  const expiresAt = dateValue(data.expiresAt);
  const grantedAt = dateValue(data.updatedAt);
  if (!expiresAt || !grantedAt || expiresAt.getTime() <= grantedAt.getTime() || data.revoked) {
    return [];
  }
  const days = (expiresAt.getTime() - grantedAt.getTime()) / DAY;
  return [{
    orderId: String(data.latestOrderId || "legacy-entitlement"),
    days,
    remainingDays: days,
    grantedAt,
    refundedAt: null,
    migrated: true,
  }];
}

function entitlementSchedule(credits) {
  const activeCredits = credits
    .filter((credit) => !credit.refundedAt && Number(credit.remainingDays) > 0)
    .sort((left, right) => {
      const timeDifference = left.grantedAt.getTime() - right.grantedAt.getTime();
      return timeDifference || left.orderId.localeCompare(right.orderId);
    });
  const windows = new Map();
  let expiresAt = null;
  for (const credit of activeCredits) {
    const startsAt = expiresAt && expiresAt.getTime() > credit.grantedAt.getTime()
      ? expiresAt
      : credit.grantedAt;
    expiresAt = new Date(startsAt.getTime() + Number(credit.remainingDays) * DAY);
    windows.set(credit.orderId, { startsAt, expiresAt });
  }
  return {
    activeCredits,
    expiresAt,
    latestOrderId: activeCredits.length ? activeCredits[activeCredits.length - 1].orderId : "",
    windows,
  };
}

function entitlementData(_openid, credits, now, current = {}) {
  const schedule = entitlementSchedule(credits);
  return {
    credits,
    expiresAt: schedule.expiresAt,
    updatedAt: now,
    revoked: Boolean(current.revoked),
    refundRecoveryRequired: Boolean(current.refundRecoveryRequired),
    refundRecoveryOrderId: String(current.refundRecoveryOrderId || ""),
    latestOrderId: schedule.latestOrderId,
  };
}

function entitlementReviewRequired(data) {
  return Boolean(data && (data.revoked || data.refundRecoveryRequired));
}

module.exports = {
  entitlementData,
  entitlementReviewRequired,
  entitlementSchedule,
  normalizeEntitlementCredits,
};
