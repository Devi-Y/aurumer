const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");
const {
  entitlementData,
  entitlementReviewRequired,
  entitlementSchedule,
  normalizeEntitlementCredits,
} = require("./entitlement-ledger");
const {
  PENDING_STATUSES,
  SETTLED_STATUSES,
  shouldReconcileOrder,
} = require("./order-reconcile-policy");
const {
  REQUIRED_LEGAL_VERSIONS,
  validateLegalConsent,
} = require("./legal-policy");
const {
  paymentReadiness,
  paymentTestAccountId,
  paymentTestHashes,
} = require("./payment-readiness");
const {
  FREE_TEST_DAYS,
  prepareFreeTestGrant,
} = require("./free-test-entitlement");
const {
  cloudPayNonce,
  cloudPaySnapshot,
  cloudPaySubMchId,
  cloudPayTradeState,
  isCloudPayCallback,
  parseWechatTime,
  validateCloudPayOrder,
} = require("./wechat-cloudpay");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ORDERS = "member_orders";
const ENTITLEMENTS = "member_entitlements";
const WORKSPACES = "member_workspaces";
const PENDING_RECONCILE_INTERVAL = 15 * 1000;
const ACCESS_RECONCILE_INTERVAL = 60 * 1000;
const SETTLED_RECONCILE_INTERVAL = 6 * 60 * 60 * 1000;
const RECONCILE_BATCH_LIMIT = 3;
const GLOBAL_RECONCILE_STATE_ID = "__member_order_reconcile_state__";
const GLOBAL_RECONCILE_PAGE_SIZE = 25;
const GLOBAL_RECONCILE_BUDGET_MS = 15 * 1000;
const GLOBAL_RECONCILE_REQUEST_RESERVE_MS = 11 * 1000;
const ENTITLEMENT_CREDIT_LIMIT = 200;
const FREE_TEST_TRIGGER_NAME = "member-free-test-grant";
const FREE_TEST_TARGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const NEW_PURCHASE_PROVIDER = "wechat-jsapi";
const WORKSPACE_LIMITS = {
  watchItems: 50,
  decisions: 100,
};
const MARKET_LABELS = {
  hk: "港股",
  us: "美股",
  a: "A股",
  gold: "黄金",
  other: "其他",
};
const PLAN_DEFINITIONS = [
  {
    id: "research-365d",
    name: "望潮年度研究会员",
    term: "365 天使用跨设备清单、决策档案与个人记录导出",
    days: 365,
    priceFen: 128800,
    priceLabel: "¥1,288 / 年",
    recommended: true,
  },
];

class MemberError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function ok(data) {
  return { ok: true, data };
}

function fail(code, message) {
  return { ok: false, code, message };
}

function planCatalog() {
  return PLAN_DEFINITIONS.map((plan) => {
    return {
      ...plan,
      configured: true,
    };
  });
}

function readiness(openid = "") {
  return paymentReadiness({
    values: process.env,
    openid,
  });
}

function publicPlans() {
  return planCatalog().map((plan) => ({
    id: plan.id,
    name: plan.name,
    term: plan.term,
    recommended: Boolean(plan.recommended),
    enabled: plan.configured,
    priceLabel: plan.priceLabel,
  }));
}

function entitlementId(openid) {
  return crypto.createHash("sha256").update(openid).digest("hex").slice(0, 40);
}

function workspaceId(openid) {
  return entitlementId(openid);
}

function cleanText(value, maximum, field, required = false) {
  if (value != null && typeof value !== "string") {
    throw new MemberError("INVALID_WORKSPACE_INPUT", `${field}格式无效`);
  }
  const text = String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (required && !text) throw new MemberError("INVALID_WORKSPACE_INPUT", `请填写${field}`);
  if (text.length > maximum) {
    throw new MemberError("INVALID_WORKSPACE_INPUT", `${field}最多 ${maximum} 个字`);
  }
  return text;
}

function recordId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function validRecordId(value, prefix) {
  const id = String(value || "");
  if (!new RegExp(`^${prefix}_[a-z0-9_]{8,48}$`).test(id)) {
    throw new MemberError("INVALID_WORKSPACE_INPUT", "记录标识无效");
  }
  return id;
}

function newOrderId() {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `AU${time}${random}`.slice(0, 32);
}

async function cloudPayQueryOrder(orderId) {
  const result = await cloud.cloudPay.queryOrder({
    subMchId: cloudPaySubMchId(),
    outTradeNo: orderId,
    nonceStr: cloudPayNonce(),
  });
  if (!result || Number(result.errCode) !== 0) {
    throw new Error((result && result.errMsg) || "微信支付查单失败");
  }
  return result;
}

async function getDocument(collection, id) {
  try {
    const result = await db.collection(collection).doc(id).get();
    return result.data || null;
  } catch (error) {
    if (String(error.errCode) === "-1" || /not exist/i.test(error.message || "")) return null;
    throw error;
  }
}

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function publicEntitlement(openid) {
  const data = await getDocument(ENTITLEMENTS, entitlementId(openid));
  if (!data) return null;
  const expiresAt = dateValue(data.expiresAt);
  const reviewRequired = entitlementReviewRequired(data);
  return {
    active: Boolean(expiresAt && expiresAt.getTime() > Date.now() && !reviewRequired),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    updatedAt: dateValue(data.updatedAt)?.toISOString() || null,
    reviewRequired,
    reviewMessage: reviewRequired ? "历史退款与权益账本需要人工核对，请先联系微信客服" : "",
  };
}

function publicWorkspaceRecord(record) {
  return {
    ...record,
    createdAt: dateValue(record.createdAt)?.toISOString() || null,
    updatedAt: dateValue(record.updatedAt)?.toISOString() || null,
  };
}

async function publicWorkspace(openid) {
  const [entitlement, data] = await Promise.all([
    publicEntitlement(openid),
    getDocument(WORKSPACES, workspaceId(openid)),
  ]);
  const active = Boolean(entitlement && entitlement.active);
  return {
    active,
    writable: active,
    expiresAt: entitlement && entitlement.expiresAt,
    reviewRequired: Boolean(entitlement && entitlement.reviewRequired),
    verificationMessage: entitlement && entitlement.reviewMessage,
    watchItems: (data && Array.isArray(data.watchItems) ? data.watchItems : [])
      .map(publicWorkspaceRecord),
    decisions: (data && Array.isArray(data.decisions) ? data.decisions : [])
      .map(publicWorkspaceRecord),
    limits: WORKSPACE_LIMITS,
  };
}

async function workspaceStatus(openid) {
  try {
    await reconcileRecentOrders(openid, RECONCILE_BATCH_LIMIT, true);
  } catch (error) {
    const workspace = await publicWorkspace(openid);
    return {
      ...workspace,
      writable: false,
      verificationPending: true,
      verificationMessage: "权益状态暂时无法核验，当前保留查看、导出和删除",
    };
  }
  return publicWorkspace(openid);
}

async function requireActiveEntitlement(openid) {
  await reconcileRecentOrders(openid, RECONCILE_BATCH_LIMIT, true);
  const entitlement = await publicEntitlement(openid);
  if (!entitlement || !entitlement.active) {
    throw new MemberError(
      "ENTITLEMENT_REQUIRED",
      "新增或删除记录需要有效的研究工具权益；已有记录仍可只读和导出",
    );
  }
  return entitlement;
}

function blankWorkspace() {
  return {
    watchItems: [],
    decisions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function updateWorkspace(openid, mutate, requireEntitlement = true) {
  if (requireEntitlement) await requireActiveEntitlement(openid);
  const id = workspaceId(openid);
  await db.runTransaction(async (transaction) => {
    const reference = transaction.collection(WORKSPACES).doc(id);
    let current = null;
    try {
      current = (await reference.get()).data;
    } catch (error) {
      if (!(String(error.errCode) === "-1" || /not exist/i.test(error.message || ""))) throw error;
    }
    if (!current && !requireEntitlement) return;
    const { _id, _openid, ...workspace } = current || blankWorkspace();
    delete workspace.openid;
    workspace.watchItems = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
    workspace.decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
    mutate(workspace);
    workspace.updatedAt = new Date();
    await reference.set({ data: workspace });
  });
  return publicWorkspace(openid);
}

async function saveWatchItem(openid, event) {
  const market = Object.prototype.hasOwnProperty.call(MARKET_LABELS, event.market) ? event.market : "other";
  const name = cleanText(event.name, 60, "标的名称", true);
  const code = cleanText(event.code, 30, "代码");
  const note = cleanText(event.note, 500, "跟踪备注");
  return updateWorkspace(openid, (workspace) => {
    if (workspace.watchItems.length >= WORKSPACE_LIMITS.watchItems) {
      throw new MemberError("WORKSPACE_LIMIT", `跟踪清单最多保存 ${WORKSPACE_LIMITS.watchItems} 条`);
    }
    const now = new Date();
    workspace.watchItems.unshift({
      id: recordId("watch"),
      market,
      marketLabel: MARKET_LABELS[market],
      name,
      code,
      note,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function removeWatchItem(openid, event) {
  const id = validRecordId(event.itemId, "watch");
  return updateWorkspace(openid, (workspace) => {
    workspace.watchItems = workspace.watchItems.filter((item) => item.id !== id);
  }, false);
}

async function saveDecision(openid, event) {
  const title = cleanText(event.title, 80, "档案标题", true);
  const note = cleanText(event.note, 1200, "决策记录", true);
  return updateWorkspace(openid, (workspace) => {
    if (workspace.decisions.length >= WORKSPACE_LIMITS.decisions) {
      throw new MemberError("WORKSPACE_LIMIT", `决策档案最多保存 ${WORKSPACE_LIMITS.decisions} 条`);
    }
    const now = new Date();
    workspace.decisions.unshift({
      id: recordId("decision"),
      title,
      note,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function removeDecision(openid, event) {
  const id = validRecordId(event.itemId, "decision");
  return updateWorkspace(openid, (workspace) => {
    workspace.decisions = workspace.decisions.filter((item) => item.id !== id);
  }, false);
}

async function deleteWorkspace(openid) {
  try {
    await db.collection(WORKSPACES).doc(workspaceId(openid)).remove();
  } catch (error) {
    if (!(String(error.errCode) === "-1" || /not exist/i.test(error.message || ""))) throw error;
  }
  return publicWorkspace(openid);
}

function orderStatusLabel(order) {
  const labels = {
    creating: "正在下单",
    create_failed: "下单失败",
    prepared: "待付款",
    pending: "确认中",
    fulfilled: "已发放",
    partially_refunded: "部分退款",
    refund_failed: "退款失败",
    closed: "已关闭",
    refunded: "已退款",
    fulfillment_review: "待人工核对",
  };
  return labels[order.status] || "处理中";
}

function fenLabel(value) {
  const fen = Number(value);
  if (!Number.isFinite(fen) || fen < 0) return "";
  const yuan = (fen / 100).toFixed(2).replace(/\.00$/, "");
  return `¥${yuan.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

async function publicOrders(openid) {
  const result = await db.collection(ORDERS)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  return result.data.map((order) => ({
    orderId: order._id,
    planName: order.planName,
    status: order.status,
    statusLabel: orderStatusLabel(order),
    orderCode: `${String(order._id).slice(0, 2)}…${String(order._id).slice(-10)}`,
    amountLabel: fenLabel(order.priceFen),
    refundLabel: Number(order.refundFeeFen) > 0 ? `已退 ${fenLabel(order.refundFeeFen)}` : "",
    createdAt: dateValue(order.createdAt)?.toISOString() || null,
    paidAt: dateValue(order.paidAt)?.toISOString() || null,
    entitlementExpiresAt: dateValue(order.entitlementExpiresAt)?.toISOString() || null,
  }));
}

async function grantOrderEntitlement(orderId, options = {}) {
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(ORDERS).doc(orderId);
    const order = (await orderRef.get()).data;
    if (order.refundedAt || order.status === "refunded") return;

    const entitlementRef = transaction.collection(ENTITLEMENTS).doc(entitlementId(order.openid));
    let current = null;
    try {
      current = (await entitlementRef.get()).data;
    } catch (error) {
      if (!(String(error.errCode) === "-1" || /not exist/i.test(error.message || ""))) throw error;
    }
    const credits = normalizeEntitlementCredits(current);
    const existingCredit = credits.find((credit) => credit.orderId === orderId);
    if (order.fulfilledAt && existingCredit) {
      if (options.snapshot && Object.keys(options.snapshot).length) {
        await orderRef.update({ data: options.snapshot });
      }
      return;
    }
    if (order.fulfilledAt && !existingCredit) {
      throw new MemberError("ENTITLEMENT_LEDGER_MISMATCH", "历史权益账本不完整，订单需人工核对");
    }
    if (credits.length >= ENTITLEMENT_CREDIT_LIMIT) {
      throw new MemberError("ENTITLEMENT_LEDGER_LIMIT", "权益订单记录已达上限，请联系客服处理");
    }

    const now = new Date();
    credits.push({
      orderId,
      days: Number(order.days),
      remainingDays: Number(order.days),
      grantedAt: now,
      refundedAt: null,
    });
    const schedule = entitlementSchedule(credits);
    const window = schedule.windows.get(orderId);
    await entitlementRef.set({ data: entitlementData(order.openid, credits, now, current || {}) });
    await orderRef.update({
      data: {
        status: "fulfilled",
        fulfilledAt: now,
        entitlementStartsAt: window.startsAt,
        entitlementExpiresAt: window.expiresAt,
        paidAt: options.paidAt || now,
        ...(options.snapshot || {}),
      },
    });
  });
}

async function archiveLegacyOrder(order) {
  const now = new Date();
  const fulfilled = Boolean(order.fulfilledAt);
  await db.collection(ORDERS).doc(order._id).update({
    data: {
      paymentProvider: "legacy-virtual-archived",
      status: fulfilled ? "fulfillment_review" : "closed",
      reconciliationWarning: fulfilled
        ? "历史虚拟支付已经停用；该订单与权益需要人工核对"
        : "历史虚拟支付已经停用；未付款订单已关闭",
      lastReconcileAttemptAt: now,
      lastReconcileError: "",
      updatedAt: now,
    },
  });
}

async function reconcileCloudPayOrder(order) {
  const orderId = order._id;
  const result = await cloudPayQueryOrder(orderId);
  const state = cloudPayTradeState(result);
  const now = new Date();
  const snapshot = cloudPaySnapshot(result, now);
  validateCloudPayOrder(orderId, order, result, { subMchId: cloudPaySubMchId() });

  if (state === "SUCCESS") {
    validateCloudPayOrder(orderId, order, result, {
      requirePaidState: true,
      subMchId: cloudPaySubMchId(),
    });
    await grantOrderEntitlement(orderId, {
      paidAt: parseWechatTime(result.timeEnd) || now,
      snapshot,
    });
    return;
  }

  if (state === "REFUND") {
    await db.collection(ORDERS).doc(orderId).update({
      data: {
        status: "fulfillment_review",
        reconciliationWarning: "微信订单已进入退款；当前查单结果不含可核验退款金额，待商户退款记录人工核对",
        ...snapshot,
      },
    });
    return;
  }

  if (["CLOSED", "REVOKED"].includes(state)) {
    await db.collection(ORDERS).doc(orderId).update({
      data: {
        status: order.fulfilledAt ? "fulfillment_review" : "closed",
        reconciliationWarning: order.fulfilledAt ? "微信订单关闭状态与已发放权益冲突" : "",
        ...snapshot,
      },
    });
    return;
  }

  await db.collection(ORDERS).doc(orderId).update({
    data: {
      status: order.fulfilledAt ? order.status : "pending",
      ...snapshot,
    },
  });
}

async function reconcileOrder(openid, orderId) {
  if (!/^AU[A-Z0-9]{16,30}$/.test(String(orderId || ""))) {
    throw new MemberError("INVALID_ORDER_ID", "订单标识无效");
  }
  const order = await getDocument(ORDERS, orderId);
  if (!order || order.openid !== openid) throw new Error("订单不存在或不属于当前用户");
  if (["refunded", "closed", "create_failed"].includes(order.status)) {
    return {
      fulfilled: false,
      orderId,
      status: order.status,
      statusLabel: orderStatusLabel(order),
      entitlement: await publicEntitlement(openid),
    };
  }

  if (order.paymentProvider === "wechat-jsapi") {
    await reconcileCloudPayOrder(order);
  } else {
    await archiveLegacyOrder(order);
  }
  const updated = await getDocument(ORDERS, orderId);
  return {
    fulfilled: Boolean(updated.fulfilledAt && ["fulfilled", "partially_refunded"].includes(updated.status)),
    orderId,
    status: updated.status,
    statusLabel: orderStatusLabel(updated),
    entitlement: await publicEntitlement(openid),
  };
}

async function reconcileRecentOrders(openid, limit = RECONCILE_BATCH_LIMIT, accessGuard = false) {
  const settledRequest = db.collection(ORDERS)
    .where({ openid, status: db.command.in(SETTLED_STATUSES) })
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  const pendingRequest = accessGuard
    ? Promise.resolve({ data: [] })
    : db.collection(ORDERS)
      .where({ openid, status: db.command.in(PENDING_STATUSES) })
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
  const [settled, pending] = await Promise.all([settledRequest, pendingRequest]);
  const now = Date.now();
  const candidates = [...settled.data, ...pending.data]
    .filter((order) => shouldReconcileOrder(order, now, {
      pendingIntervalMs: PENDING_RECONCILE_INTERVAL,
      settledIntervalMs: accessGuard ? ACCESS_RECONCILE_INTERVAL : SETTLED_RECONCILE_INTERVAL,
    }))
    .slice(0, limit);
  let accessVerificationError = null;
  for (const order of candidates) {
    try {
      await reconcileOrder(openid, order._id);
    } catch (error) {
      if (accessGuard) accessVerificationError = error;
      await recordReconciliationFailure(order._id, error);
      // 下一次打开会员页或写入工作台时继续恢复，不让单笔上游失败拖垮整个页面。
    }
  }
  if (accessVerificationError) {
    throw new MemberError(
      "ENTITLEMENT_VERIFICATION_PENDING",
      "权益状态暂时无法核验，请稍后重试；已有记录仍可查看、导出和删除",
    );
  }
}

async function recordReconciliationFailure(orderId, error) {
  try {
    await db.collection(ORDERS).doc(orderId).update({
      data: {
        lastReconcileAttemptAt: new Date(),
        lastReconcileError: String(error.message || error).slice(0, 200),
        updatedAt: new Date(),
      },
    });
  } catch (recordError) {
    console.error("record reconciliation error", orderId, recordError);
  }
}

async function saveGlobalReconcileState(cursor, summary = {}) {
  await db.collection(ORDERS).doc(GLOBAL_RECONCILE_STATE_ID).set({
    data: {
      internalType: "global_reconcile_state",
      cursor: String(cursor || ""),
      lastRunAt: new Date(),
      lastSummary: summary,
      updatedAt: new Date(),
    },
  });
}

async function reconcileGlobalOrders() {
  const state = await getDocument(ORDERS, GLOBAL_RECONCILE_STATE_ID);
  const startCursor = String((state && state.cursor) || "");
  let query = db.collection(ORDERS);
  if (startCursor) query = query.where({ _id: db.command.gt(startCursor) });
  query = query.orderBy("_id", "asc").limit(GLOBAL_RECONCILE_PAGE_SIZE);
  const page = (await query.get()).data || [];
  if (!page.length) {
    const summary = { wrapped: true, scanned: 0, attempted: 0, failed: 0 };
    await saveGlobalReconcileState("", summary);
    return summary;
  }

  const deadline = Date.now() + GLOBAL_RECONCILE_BUDGET_MS;
  let cursor = startCursor;
  let scanned = 0;
  let attempted = 0;
  let failed = 0;
  let stoppedForBudget = false;

  for (const order of page) {
    if (!order || !order._id) continue;
    if (order._id === GLOBAL_RECONCILE_STATE_ID || order.internalType === "global_reconcile_state") {
      cursor = order._id;
      scanned += 1;
      continue;
    }
    const due = shouldReconcileOrder(order, Date.now(), {
      pendingIntervalMs: PENDING_RECONCILE_INTERVAL,
      settledIntervalMs: SETTLED_RECONCILE_INTERVAL,
    });
    if (!due) {
      cursor = order._id;
      scanned += 1;
      continue;
    }
    if (attempted > 0 && deadline - Date.now() < GLOBAL_RECONCILE_REQUEST_RESERVE_MS) {
      stoppedForBudget = true;
      break;
    }
    attempted += 1;
    try {
      await reconcileOrder(order.openid, order._id);
    } catch (error) {
      failed += 1;
      await recordReconciliationFailure(order._id, error);
    }
    cursor = order._id;
    scanned += 1;
  }

  const wrapped = !stoppedForBudget && page.length < GLOBAL_RECONCILE_PAGE_SIZE;
  const nextCursor = wrapped ? "" : cursor;
  const summary = { wrapped, stoppedForBudget, scanned, attempted, failed };
  await saveGlobalReconcileState(nextCursor, summary);
  return summary;
}

function isGlobalReconcileTimer(event) {
  return Boolean(
    event
    && event.Type === "Timer"
    && event.TriggerName === "member-order-reconcile",
  );
}

function isFreeTestGrantTimer(event) {
  return Boolean(
    event
    && event.Type === "Timer"
    && event.TriggerName === FREE_TEST_TRIGGER_NAME,
  );
}

async function findFreeTestTarget() {
  const configuredHashes = new Set(paymentTestHashes(process.env));
  if (!configuredHashes.size) {
    throw new MemberError("FREE_TEST_ACCOUNT_NOT_CONFIGURED", "后台尚未登记免费测试账号编号");
  }

  const pages = await Promise.all(PENDING_STATUSES.map((status) => {
    return db.collection(ORDERS).where({ status }).limit(20).get();
  }));
  const cutoff = Date.now() - FREE_TEST_TARGET_WINDOW_MS;
  const matches = pages
    .flatMap((page) => page.data || [])
    .filter((order) => {
      const createdAt = dateValue(order && order.createdAt);
      return order
        && order.paymentProvider === NEW_PURCHASE_PROVIDER
        && createdAt
        && createdAt.getTime() >= cutoff
        && configuredHashes.has(paymentTestAccountId(order.openid));
    })
    .sort((left, right) => dateValue(right.createdAt).getTime() - dateValue(left.createdAt).getTime());

  const accounts = new Map();
  for (const order of matches) {
    const accountId = paymentTestAccountId(order.openid);
    if (accountId && !accounts.has(accountId)) accounts.set(accountId, order);
  }
  if (!accounts.size) {
    throw new MemberError(
      "FREE_TEST_TARGET_NOT_FOUND",
      "最近 24 小时没有找到已登记测试账号创建的待支付订单",
    );
  }
  if (accounts.size !== 1) {
    throw new MemberError("FREE_TEST_TARGET_AMBIGUOUS", "找到多个测试账号，已停止免费授权");
  }
  return accounts.values().next().value;
}

async function grantFreeTestEntitlement() {
  const targetOrder = await findFreeTestTarget();
  const openid = targetOrder.openid;
  const id = entitlementId(openid);
  let transactionResult = null;
  await db.runTransaction(async (transaction) => {
    const entitlementRef = transaction.collection(ENTITLEMENTS).doc(id);
    let current = null;
    try {
      current = (await entitlementRef.get()).data;
    } catch (error) {
      if (!(String(error.errCode) === "-1" || /not exist/i.test(error.message || ""))) throw error;
    }
    if (entitlementReviewRequired(current)) {
      throw new MemberError("ENTITLEMENT_REVIEW_REQUIRED", "该测试账号的历史权益账本需要先人工核对");
    }
    transactionResult = prepareFreeTestGrant(
      current,
      openid,
      new Date(),
      ENTITLEMENT_CREDIT_LIMIT,
    );
    if (!transactionResult.alreadyGranted) {
      await entitlementRef.set({ data: transactionResult.data });
    }
  });

  const entitlement = await publicEntitlement(openid);
  return {
    granted: !transactionResult.alreadyGranted,
    alreadyGranted: transactionResult.alreadyGranted,
    days: FREE_TEST_DAYS,
    entitlement,
    paidOrderChanged: false,
  };
}

async function handleCloudPayCallback(event) {
  const orderId = String(event.outTradeNo || event.out_trade_no || "");
  const order = await getDocument(ORDERS, orderId);
  if (!order || order.paymentProvider !== "wechat-jsapi") {
    throw new MemberError("CLOUDPAY_ORDER_MISMATCH", "支付回调没有对应的望潮订单");
  }
  const result = await cloudPayQueryOrder(orderId);
  validateCloudPayOrder(orderId, order, result, {
    requirePaidState: true,
    subMchId: cloudPaySubMchId(),
  });
  const now = new Date();
  await grantOrderEntitlement(orderId, {
    paidAt: parseWechatTime(result.timeEnd || result.time_end) || now,
    snapshot: {
      ...cloudPaySnapshot(result, now),
      paymentNotifiedAt: now,
    },
  });
  return { errcode: 0, errmsg: "" };
}

async function hasPendingOrders(openid) {
  const result = await db.collection(ORDERS)
    .where({ openid, status: db.command.in(PENDING_STATUSES) })
    .limit(1)
    .get();
  return (result.data || []).length > 0;
}

async function memberStatus(openid) {
  const config = readiness(openid);
  // 无待支付/待确认订单时跳过查单：会员页冷启动更快可点「立即微信支付」。
  // 付款后客户端轮询 status 时一定有 pending，仍会走 reconcileRecentOrders；
  // 已结算单的退款复核继续由 15 分钟全局对账覆盖。
  if (await hasPendingOrders(openid)) {
    await reconcileRecentOrders(openid);
  }
  const entitlement = await publicEntitlement(openid);
  const reviewRequired = Boolean(entitlement && entitlement.reviewRequired);
  return {
    backendReady: true,
    paymentReady: config.ready && !reviewRequired,
    paymentMode: reviewRequired ? "closed" : config.mode,
    paymentPubliclyReleased: config.publicReady && !reviewRequired,
    paymentTestModeEnabled: config.testModeEnabled,
    paymentTestAccountAllowed: config.testAccountAllowed,
    paymentTestAccountId: config.testAccountId,
    refundMode: config.refundMode,
    paymentReason: reviewRequired ? entitlement.reviewMessage : config.reason,
    environment: "production",
    legalVersions: REQUIRED_LEGAL_VERSIONS,
    plans: publicPlans(),
    entitlement,
    orders: await publicOrders(openid),
  };
}

function clientPaymentParams(payment) {
  const result = {
    kind: "wechat-jsapi",
    timeStamp: String((payment && payment.timeStamp) || ""),
    nonceStr: String((payment && payment.nonceStr) || ""),
    package: String((payment && payment.package) || ""),
    signType: String((payment && payment.signType) || ""),
    paySign: String((payment && payment.paySign) || ""),
  };
  if (!result.timeStamp || !result.nonceStr || !result.package || !result.signType || !result.paySign) {
    throw new MemberError("CLOUDPAY_INVALID_RESPONSE", "微信支付下单没有返回完整的付款参数");
  }
  return result;
}

async function prepareCloudPayPurchase(context, plan, legalConsent) {
  const orderId = newOrderId();
  const appId = String(context.APPID || process.env.WANGCHAO_MINI_APP_ID || "");
  const envId = String(process.env.TCB_ENV || context.ENV || process.env.WANGCHAO_CLOUD_ENV_ID || "");
  if (!appId || !envId) throw new Error("当前云环境无法确认小程序或回调环境");

  const now = new Date();
  await db.collection(ORDERS).doc(orderId).set({
    data: {
      openid: context.OPENID,
      appId,
      planId: plan.id,
      planName: plan.name,
      days: plan.days,
      priceFen: plan.priceFen,
      paymentProvider: NEW_PURCHASE_PROVIDER,
      legalConsent,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    },
  });

  try {
    const result = await cloud.cloudPay.unifiedOrder({
      body: "望潮Aurum-年度研究会员",
      outTradeNo: orderId,
      spbillCreateIp: "127.0.0.1",
      subMchId: cloudPaySubMchId(),
      subAppid: appId,
      totalFee: plan.priceFen,
      tradeType: "JSAPI",
      nonceStr: cloudPayNonce(),
      attach: plan.id,
      envId,
      functionName: "aurum-member",
    });
    const communicationOk = result && String(result.returnCode || "").toUpperCase() === "SUCCESS";
    const businessOk = result && String(result.resultCode || "").toUpperCase() === "SUCCESS";
    if (Number(result && result.errCode) !== 0 || !communicationOk || !businessOk) {
      throw new MemberError(
        "CLOUDPAY_CREATE_FAILED",
        String((result && (result.errCodeDes || result.returnMsg)) || "微信支付下单失败"),
      );
    }
    const payment = clientPaymentParams(result.payment);
    await db.collection(ORDERS).doc(orderId).update({
      data: {
        status: "prepared",
        prepayCreatedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { orderId, payment };
  } catch (error) {
    await db.collection(ORDERS).doc(orderId).update({
      data: {
        status: "create_failed",
        createError: String(error.message || error).slice(0, 200),
        updatedAt: new Date(),
      },
    });
    throw error;
  }
}

async function preparePurchase(event, context) {
  const config = readiness(context.OPENID);
  if (!config.ready) {
    console.warn("payment configuration incomplete", config.missing);
    throw new Error(config.reason);
  }
  const entitlement = await getDocument(ENTITLEMENTS, entitlementId(context.OPENID));
  if (entitlementReviewRequired(entitlement)) {
    throw new MemberError(
      "ENTITLEMENT_REVIEW_REQUIRED",
      "历史退款与权益账本需要人工核对，请先联系微信客服，当前不会创建新的付款订单",
    );
  }
  const plan = planCatalog().find((item) => item.id === event.planId && item.configured);
  if (!plan) throw new Error("所选研究周期尚未在服务端配置");
  const legalConsent = validateLegalConsent(event.legalConsent);

  return prepareCloudPayPurchase(context, plan, legalConsent);
}

exports.main = async (event = {}) => {
  const context = cloud.getWXContext();
  const callbackRequest = isCloudPayCallback(event, context);
  try {
    if (callbackRequest) return await handleCloudPayCallback(event);
    if (isGlobalReconcileTimer(event)) {
      if (context.OPENID) return fail("TIMER_FORBIDDEN", "客户端不能触发全局订单复核");
      return ok(await reconcileGlobalOrders());
    }
    if (isFreeTestGrantTimer(event)) {
      if (context.OPENID) return fail("FREE_TEST_FORBIDDEN", "客户端不能触发免费测试授权");
      return ok(await grantFreeTestEntitlement());
    }
    if (!context.OPENID) return fail("NO_OPENID", "请从望潮小程序内打开会员页");
    if (event.action === "status") return ok(await memberStatus(context.OPENID));
    if (event.action === "workspace") return ok(await workspaceStatus(context.OPENID));
    if (event.action === "saveWatchItem") return ok(await saveWatchItem(context.OPENID, event));
    if (event.action === "removeWatchItem") return ok(await removeWatchItem(context.OPENID, event));
    if (event.action === "saveDecision") return ok(await saveDecision(context.OPENID, event));
    if (event.action === "removeDecision") return ok(await removeDecision(context.OPENID, event));
    if (event.action === "deleteWorkspace") return ok(await deleteWorkspace(context.OPENID));
    if (event.action === "preparePurchase") return ok(await preparePurchase(event, context));
    if (event.action === "queryOrder") return ok(await reconcileOrder(context.OPENID, event.orderId));
    return fail("UNKNOWN_ACTION", "未知的会员服务操作");
  } catch (error) {
    if (callbackRequest) {
      console.error("aurum-member cloudPay callback", error);
      return { errcode: -1, errmsg: "支付结果暂未处理，请重试" };
    }
    console.error("aurum-member", event.action, error);
    return fail(error.code || "MEMBER_SERVICE_ERROR", error.message || "会员服务暂时不可用");
  }
};
