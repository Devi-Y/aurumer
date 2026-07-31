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

// 刚下单的几分钟内用户正盯着屏幕等开通，15 秒的通用节流会把客户端
// 0.8/1.6/2.6/4/6 秒的几次重试全部挡掉，导致明明已经付款成功，页面却只能显示
// "权益正在同步"。对新订单用更短的节流，既能立刻确认，也不会长期加压上游查单接口。
const FRESH_ORDER_WINDOW_MS = 5 * 60 * 1000;
const FRESH_ORDER_INTERVAL_MS = 2 * 1000;

function shouldReconcileOrder(order, now = Date.now(), options = {}) {
  if (!order || !order.openid || !order._id) return false;
  const settledIntervalMs = Number(options.settledIntervalMs) || 6 * 60 * 60 * 1000;
  const attemptedAt = dateValue(order.lastReconcileAttemptAt || order.lastReconciledAt);
  const elapsed = attemptedAt ? Number(now) - attemptedAt.getTime() : Infinity;

  if (PENDING_STATUSES.includes(order.status)) {
    const createdAt = dateValue(order.createdAt);
    const age = createdAt ? Number(now) - createdAt.getTime() : Infinity;
    const pendingIntervalMs = age <= FRESH_ORDER_WINDOW_MS
      ? Math.min(
        Number(options.freshIntervalMs) || FRESH_ORDER_INTERVAL_MS,
        Number(options.pendingIntervalMs) || 15 * 1000,
      )
      : Number(options.pendingIntervalMs) || 15 * 1000;
    return elapsed >= pendingIntervalMs;
  }
  if (SETTLED_STATUSES.includes(order.status)) return elapsed >= settledIntervalMs;
  return false;
}

module.exports = {
  PENDING_STATUSES,
  SETTLED_STATUSES,
  shouldReconcileOrder,
};
