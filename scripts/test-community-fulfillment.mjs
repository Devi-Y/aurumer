import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCommunityFulfillment, ledgerId } = require('../cloudfunctions/aurum-member/community-fulfillment.js');
const FIRST = 'AC1234567890ABCDEF', SECOND = 'AC1234567890ABCDF0';
const JOIN = '2026-10-30T08:00:00.000Z', NOW = '2026-11-04T08:00:00.000Z';
const order = (openid = 'user-a') => ({ openid, planId: 'community-365d', priceFen: 29800, days: 365,
  status: 'paid', wechatTradeState: 'SUCCESS', wxTransactionId: 'verified-wechat-transaction' });
function fixture(auth = async () => ({ operatorId: 'operator-1' })) {
  let docs = new Map([[`community_orders/${FIRST}`, order()], [`community_orders/${SECOND}`, order()]]);
  let tail = Promise.resolve();
  const db = { runTransaction: fn => {
    const task = tail.then(async () => {
      const draft = new Map([...docs].map(([k, v]) => [k, structuredClone(v)]));
      const collection = name => ({ doc: id => ({
        get: async () => { if (!draft.has(`${name}/${id}`)) throw new Error('document not exist'); return { data: structuredClone(draft.get(`${name}/${id}`)) }; },
        set: async ({ data }) => draft.set(`${name}/${id}`, structuredClone(data)),
        update: async ({ data }) => draft.set(`${name}/${id}`, { ...draft.get(`${name}/${id}`), ...structuredClone(data) }),
      }) });
      const value = await fn({ collection }); docs = draft; return value;
    });
    tail = task.catch(() => {}); return task;
  } };
  return { api: createCommunityFulfillment({ db, authorizeOperator: auth, now: () => new Date(NOW) }),
    get: key => docs.get(key), set: (key, value) => docs.set(key, value), db };
}
const input = (id = FIRST, joinedAt = JOIN) => ({ orderId: id, joinedAt });

test('default deny, client identities and rejected operators cannot record a delivery', async () => {
  const f = fixture();
  const noAuth = createCommunityFulfillment({ db: f.db });
  await assert.rejects(noAuth.recordJoin(input()), { code: 'OPERATOR_REQUIRED' });
  await assert.rejects(f.api.recordJoin(input(), { OPENID: 'client-openid' }), { code: 'OPERATOR_REQUIRED' });
  await assert.rejects(fixture(async () => null).api.recordJoin(input()), { code: 'OPERATOR_REQUIRED' });
  assert.equal(f.get(`community_fulfillments/${ledgerId('user-a')}`), undefined);
});

test('only verified paid orders and actual non-future join dates are accepted', async () => {
  const f = fixture();
  for (const change of [{ status: 'pending' }, { status: 'review' }, { wechatTradeState: 'NOTPAY' }, { wxTransactionId: '' }, { priceFen: 128800 }]) {
    f.set(`community_orders/${FIRST}`, { ...order(), ...change });
    await assert.rejects(f.api.recordJoin(input()), { code: 'PAYMENT_NOT_VERIFIED' });
  }
  f.set(`community_orders/${FIRST}`, order());
  for (const invalid of ['2026-11-05T08:00:00.000Z', '2026-10-30', '2026-02-30T08:00:00.000Z'])
    await assert.rejects(f.api.recordJoin(input(FIRST, invalid)), { code: 'INVALID_JOIN_DATE' });
});

test('recording is atomic and idempotent; a second paid order extends the existing term', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.api.recordJoin(input()), f.api.recordJoin(input())]);
  assert.equal([a.alreadyRecorded, b.alreadyRecorded].filter(Boolean).length, 1);
  assert.equal(a.endsAt, '2027-10-30T08:00:00.000Z');
  await assert.rejects(f.api.recordJoin(input(FIRST, '2026-10-31T08:00:00.000Z')), { code: 'JOIN_DATE_CONFLICT' });
  const renewed = await f.api.recordJoin(input(SECOND, '2026-11-01T08:00:00.000Z'));
  assert.equal(renewed.startsAt, a.endsAt);
  assert.equal(renewed.endsAt, '2028-10-29T08:00:00.000Z');
  assert.equal(f.get(`community_fulfillments/${ledgerId('user-a')}`).credits.length, 2);
  assert.equal(f.get(`community_orders/${SECOND}`).deliveryFulfillment.endsAt, renewed.endsAt);
});

test('refund review prevents a renewal; separate customers have isolated ledgers', async () => {
  const f = fixture();
  await f.api.recordJoin(input());
  f.set(`community_orders/${FIRST}`, { ...f.get(`community_orders/${FIRST}`), status: 'review' });
  await assert.rejects(f.api.recordJoin(input(SECOND, '2026-11-01T08:00:00.000Z')), { code: 'LEDGER_REVIEW' });
  f.set(`community_orders/${SECOND}`, order('user-b'));
  const result = await f.api.recordJoin(input(SECOND, '2026-11-01T08:00:00.000Z'));
  assert.equal(result.startsAt, '2026-11-01T08:00:00.000Z');
  assert.equal(f.get(`community_fulfillments/${ledgerId('user-a')}`).credits.length, 1);
  assert.equal(f.get(`community_fulfillments/${ledgerId('user-b')}`).credits.length, 1);
});
