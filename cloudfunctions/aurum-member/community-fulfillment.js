// Server-only community delivery ledger. This module is deliberately not exposed
// as a cloud-function action. A real operator authentication adapter is required.
const crypto = require('node:crypto');
const ORDER_COLLECTION = 'community_orders';
const LEDGER_COLLECTION = 'community_fulfillments';
const PLAN = 'community-365d';
const TERM_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CREDITS = 100;

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function ledgerId(openid) { return `member_${crypto.createHash('sha256').update(openid).digest('hex')}`; }
function missingDocument(error) {
  return /(?:document|doc).*?(?:not exist|does not exist)|(?:not exist|does not exist).*?(?:document|doc)|文档不存在/i.test(String(error && (error.errMsg || error.message) || ''));
}
async function optional(ref) {
  try { return (await ref.get()).data || null; }
  catch (error) { if (missingDocument(error)) return null; throw error; }
}
function actualDate(value, now) {
  // Exact ISO UTC timestamps avoid interpreting a date in the server's timezone.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw failure('INVALID_JOIN_DATE', '入群时间必须是 UTC ISO 时间');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getTime() > now.getTime())
    throw failure('INVALID_JOIN_DATE', '入群时间无效或晚于当前时间');
  return date;
}
function createCommunityFulfillment({ db, authorizeOperator, now = () => new Date() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new TypeError('db.runTransaction is required');
  async function recordJoin(input = {}, context = {}) {
    // A client OpenID can never be treated as an operator identity, even if the
    // authentication adapter is accidentally permissive.
    if (context.OPENID || context.openid) throw failure('OPERATOR_REQUIRED', '仅受信任的运营操作可确认入群');
    if (typeof authorizeOperator !== 'function') throw failure('OPERATOR_REQUIRED', '尚未配置运营身份验证');
    const operator = await authorizeOperator(context);
    if (!operator || typeof operator.operatorId !== 'string' || !/^[A-Za-z0-9._:@-]{1,100}$/.test(operator.operatorId))
      throw failure('OPERATOR_REQUIRED', '运营身份验证未通过');
    const orderId = String(input.orderId || '');
    if (!/^AC[A-Z0-9]{16,30}$/.test(orderId)) throw failure('INVALID_ORDER', '订单编号无效');
    const currentTime = now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) throw failure('INVALID_CLOCK', '服务器时间无效');
    const joinedAt = actualDate(input.joinedAt, currentTime);
    let result;
    await db.runTransaction(async transaction => {
      const orderRef = transaction.collection(ORDER_COLLECTION).doc(orderId);
      const order = await optional(orderRef);
      if (!order || !order.openid || order.planId !== PLAN || order.priceFen !== 29800 || order.days !== 365 ||
          order.status !== 'paid' || order.wechatTradeState !== 'SUCCESS' || !order.wxTransactionId)
        throw failure('PAYMENT_NOT_VERIFIED', '订单付款未核验或需要退款复核');
      const memberRef = transaction.collection(LEDGER_COLLECTION).doc(ledgerId(order.openid));
      const ledger = await optional(memberRef);
      const credits = ledger && ledger.credits;
      if (ledger && (!Array.isArray(credits) || ledger.ownerHash !== ledgerId(order.openid)))
        throw failure('LEDGER_REVIEW', '入群记录需人工核对');
      const rows = credits || [];
      const existing = rows.find(row => row.orderId === orderId);
      if (existing) {
        if (existing.joinedAt !== joinedAt.toISOString()) throw failure('JOIN_DATE_CONFLICT', '该订单已有不同的入群记录，需人工核对');
        result = { ...existing, alreadyRecorded: true };
        return;
      }
      if (rows.length >= MAX_CREDITS) throw failure('LEDGER_FULL', '入群记录已达上限，请人工核对');
      let startMs = joinedAt.getTime();
      if (rows.length) {
        const last = rows[rows.length - 1];
        const lastJoined = Date.parse(last.joinedAt);
        const priorEnd = Date.parse(last.endsAt);
        if (!Number.isFinite(lastJoined) || !Number.isFinite(priorEnd) || joinedAt.getTime() < lastJoined)
          throw failure('LEDGER_REVIEW', '入群记录顺序或期限异常');
        // A previously refunded/reviewing credit cannot be silently extended.
        for (const row of rows) {
          const previous = await optional(transaction.collection(ORDER_COLLECTION).doc(row.orderId));
          if (!previous || previous.openid !== order.openid || previous.status !== 'paid')
            throw failure('LEDGER_REVIEW', '历史订单需先完成退款与权益核对');
        }
        startMs = Math.max(startMs, priorEnd);
      }
      const credit = { orderId, joinedAt: joinedAt.toISOString(), startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(startMs + TERM_MS).toISOString(), recordedAt: currentTime.toISOString(), operatorId: operator.operatorId };
      await memberRef.set({ data: { ownerHash: ledgerId(order.openid), credits: [...rows, credit], updatedAt: currentTime.toISOString() } });
      await orderRef.update({ data: { deliveryFulfillment: { joinedAt: credit.joinedAt, startsAt: credit.startsAt, endsAt: credit.endsAt, recordedAt: credit.recordedAt } } });
      result = { ...credit, alreadyRecorded: false };
    });
    return result;
  }
  return { recordJoin };
}
module.exports = { createCommunityFulfillment, ledgerId, TERM_MS };
