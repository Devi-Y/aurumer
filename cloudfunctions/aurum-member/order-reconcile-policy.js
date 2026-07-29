const PENDING_STATUSES = Object.freeze(["prepared", "pending"]);
const SETTLED_STATUSES = Object.freeze([
  "fulfilled",
  "partially_refunded",
  "refund_failed",
  "fulfillment_review",
]);

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldReconcileOrder(order, now = Date.now(), options = {}) {
  if (!order || !order.openid || !order._id) return false;
  const pendingIntervalMs = Number(options.pendingIntervalMs) || 15 * 1000;
  const settledIntervalMs = Number(options.settledIntervalMs) || 6 * 60 * 60 * 1000;
  const attemptedAt = dateValue(order.lastReconcileAttemptAt || order.lastReconciledAt);
  const elapsed = attemptedAt ? Number(now) - attemptedAt.getTime() : Infinity;
  if (PENDING_STATUSES.includes(order.status)) return elapsed >= pendingIntervalMs;
  if (SETTLED_STATUSES.includes(order.status)) return elapsed >= settledIntervalMs;
  return false;
}

module.exports = {
  PENDING_STATUSES,
  SETTLED_STATUSES,
  shouldReconcileOrder,
};
