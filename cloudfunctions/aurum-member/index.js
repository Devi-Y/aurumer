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
const {
  FREE_LIMITS,
  MEMBER_LIMITS,
  freeRemaining,
  cleanNumber,
} = require("./workspace-features");
const {
  buildTodayBrief,
  publicInbox,
  scanWorkspaceInbox,
} = require("./sentinel-inbox");
const {
  buildHomeSummary,
  mutateTask,
  publicTasks,
  syncSystemTasksFromWatches,
} = require("./review-tasks");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ORDERS = "member_orders";
const ENTITLEMENTS = "member_entitlements";
const WORKSPACES = "member_workspaces";
const FACT_LATEST = "data_fact_latest";
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
const WORKSPACE_LIMITS = MEMBER_LIMITS;
const MARKET_LABELS = {
  hk: "港股",
  us: "美股",
  a: "A股",
  gold: "黄金",
  other: "其他",
};
const GROUP_LABELS = {
  default: "默认",
  ipo: "打新",
  dividend: "收息",
  long: "长期",
  watch: "观察",
};
const IPO_RESULTS = {
  pending: "待公布",
  won: "已中签",
  lost: "未中签",
  skipped: "未申购",
};
const PLAN_DEFINITIONS = [
  {
    id: "research-365d",
    name: "望潮年度研究会员",
    term: "365 天：个人投资逻辑哨兵——事实变化提醒、失效条件核对、周复盘与台账保全",
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

function cleanFact(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new MemberError("INVALID_WORKSPACE_INPUT", "事实快照格式无效");
  }
  const text = (input, max) => cleanText(input == null ? "" : String(input), max, "事实字段");
  return {
    market: text(value.market, 20),
    code: text(value.code, 30),
    name: text(value.name, 80),
    oneLiner: text(value.oneLiner, 200),
    badge: text(value.badge, 40),
    risk: text(value.risk, 300),
    priceLabel: text(value.priceLabel, 60),
    metricLabel: text(value.metricLabel, 80),
    asOf: text(value.asOf, 40),
    source: text(value.source, 80),
    snapshotUpdatedAt: text(value.snapshotUpdatedAt, 40),
    unmatched: Boolean(value.unmatched),
    capturedAt: text(value.capturedAt, 40),
    title: text(value.title, 80),
    stampedBy: text(value.stampedBy, 20),
  };
}

function factDocId(market, code) {
  return `${String(market || "x")}_${String(code || "x")}`.replace(/[^\w.\-一-龥]/g, "_").slice(0, 64);
}

async function stampOfficialFact(market, code, name, fallback) {
  if (!code && !name) return fallback ? cleanFact(fallback) : null;
  try {
    const result = await db.collection(FACT_LATEST).doc(factDocId(market, code || name)).get();
    const row = result && result.data;
    if (row && row.fact) {
      return cleanFact({
        ...row.fact,
        name: row.fact.name || name || "",
        stampedBy: "server",
        capturedAt: new Date().toISOString(),
        snapshotUpdatedAt: row.snapshotUpdatedAt || row.fact.snapshotUpdatedAt || "",
      });
    }
  } catch (error) {
    // 无正式事实时回退客户端预览，并标记未盖章。
  }
  if (!fallback) return null;
  const cleaned = cleanFact(fallback);
  if (!cleaned) return null;
  return { ...cleaned, stampedBy: cleaned.stampedBy || "client", unmatched: cleaned.unmatched || !cleaned.oneLiner };
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
    baselineAt: dateValue(record.baselineAt)?.toISOString() || null,
  };
}

async function publicWorkspace(openid) {
  const [entitlement, data] = await Promise.all([
    publicEntitlement(openid),
    getDocument(WORKSPACES, workspaceId(openid)),
  ]);
  const active = Boolean(entitlement && entitlement.active);
  const remaining = freeRemaining(data || {});
  const freeWritable = !active && (remaining.watchItems > 0 || remaining.decisions > 0);
  const inbox = publicInbox(data && data.inbox);
  const todayBrief = buildTodayBrief(data || {}, inbox);
  const reviewTasks = publicTasks(data && data.reviewTasks);
  return {
    active,
    writable: active || freeWritable,
    memberFeatures: active,
    freeLimits: FREE_LIMITS,
    freeRemaining: remaining,
    expiresAt: entitlement && entitlement.expiresAt,
    reviewRequired: Boolean(entitlement && entitlement.reviewRequired),
    verificationMessage: entitlement && entitlement.reviewMessage,
    watchItems: (data && Array.isArray(data.watchItems) ? data.watchItems : [])
      .map(publicWorkspaceRecord),
    decisions: (data && Array.isArray(data.decisions) ? data.decisions : [])
      .map(publicWorkspaceRecord),
    eventMarks: (data && Array.isArray(data.eventMarks) ? data.eventMarks : [])
      .map(publicWorkspaceRecord),
    ipoRecords: (data && Array.isArray(data.ipoRecords) ? data.ipoRecords : [])
      .map(publicWorkspaceRecord),
    dividendLots: (data && Array.isArray(data.dividendLots) ? data.dividendLots : [])
      .map(publicWorkspaceRecord),
    reviewTasks,
    inbox,
    todayBrief,
    homeSummary: buildHomeSummary(data || { watchItems: [] }, inbox, todayBrief),
    settings: (data && data.settings) || {
      taxRatePct: 10,
      hkdCny: 0.92,
      usdCny: 7.2,
    },
    limits: WORKSPACE_LIMITS,
    subscribe: subscribeConfig(),
  };
}

function subscribeConfig() {
  const templateId = String(process.env.WANGCHAO_SUBSCRIBE_EVENT_TMPL || "").trim();
  return {
    enabled: Boolean(templateId),
    eventTemplateId: templateId,
    channelLabel: templateId ? "订阅微信提醒" : "小程序内提醒",
    authorizedLabel: templateId ? "可申请订阅微信提醒" : "当前仅小程序内提醒",
    hint: templateId
      ? "可申请订阅微信提醒；授权成功后才会显示微信提醒已开启"
      // 标记既不会进 reviewTasks（待办），也不会进日历（日历是快照算出来的），
      // 它只会进 eventMarks。话术按实际落点写。
      : "事件会记在今日页的「我标记的提醒」里。配置订阅消息模板并完成用户授权后，才可开通微信提醒",
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
      "此项为会员能力：变化确认、事件微信提醒、打新/收息台账与阈值等；免费仍可保存少量关注与想法",
    );
  }
  return entitlement;
}

async function requireBasicWrite(openid, kind) {
  await reconcileRecentOrders(openid, RECONCILE_BATCH_LIMIT, true);
  const entitlement = await publicEntitlement(openid);
  if (entitlement && entitlement.active) return { active: true, entitlement };
  const data = await getDocument(WORKSPACES, workspaceId(openid));
  const remaining = freeRemaining(data || {});
  if (kind === "watch" && remaining.watchItems <= 0) {
    throw new MemberError(
      "FREE_LIMIT",
      `免费可保存 ${FREE_LIMITS.watchItems} 条关注，已用完。开通会员可扩展到 ${MEMBER_LIMITS.watchItems} 条并解锁变化雷达等能力`,
    );
  }
  if (kind === "decision" && remaining.decisions <= 0) {
    throw new MemberError(
      "FREE_LIMIT",
      `免费可保存 ${FREE_LIMITS.decisions} 条想法，已用完。开通会员可扩展并解锁每周复盘`,
    );
  }
  return { active: false, entitlement };
}

function blankWorkspace() {
  return {
    watchItems: [],
    decisions: [],
    eventMarks: [],
    ipoRecords: [],
    dividendLots: [],
    inbox: [],
    reviewTasks: [],
    settings: {
      taxRatePct: 10,
      hkdCny: 0.92,
      usdCny: 7.2,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function updateWorkspace(openid, mutate, requireEntitlement = true) {
  if (requireEntitlement === true) await requireActiveEntitlement(openid);
  else if (requireEntitlement && typeof requireEntitlement === "object" && requireEntitlement.basic) {
    await requireBasicWrite(openid, requireEntitlement.kind);
  }
  const id = workspaceId(openid);
  await db.runTransaction(async (transaction) => {
    const reference = transaction.collection(WORKSPACES).doc(id);
    let current = null;
    try {
      current = (await reference.get()).data;
    } catch (error) {
      if (!(String(error.errCode) === "-1" || /not exist/i.test(error.message || ""))) throw error;
    }
    if (!current && requireEntitlement === false) return;
    const { _id, _openid, ...workspace } = current || blankWorkspace();
    delete workspace.openid;
    workspace.watchItems = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
    workspace.decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
    workspace.eventMarks = Array.isArray(workspace.eventMarks) ? workspace.eventMarks : [];
    workspace.ipoRecords = Array.isArray(workspace.ipoRecords) ? workspace.ipoRecords : [];
    workspace.dividendLots = Array.isArray(workspace.dividendLots) ? workspace.dividendLots : [];
    workspace.inbox = Array.isArray(workspace.inbox) ? workspace.inbox : [];
    workspace.reviewTasks = Array.isArray(workspace.reviewTasks) ? workspace.reviewTasks : [];
    workspace.settings = workspace.settings || blankWorkspace().settings;
    mutate(workspace);
    workspace.ownerOpenid = openid;
    workspace.updatedAt = new Date();
    await reference.set({ data: workspace });
  });
  return publicWorkspace(openid);
}

async function saveWatchItem(openid, event) {
  const entitlement = await requireBasicWrite(openid, "watch");
  const market = Object.prototype.hasOwnProperty.call(MARKET_LABELS, event.market) ? event.market : "other";
  let group = Object.prototype.hasOwnProperty.call(GROUP_LABELS, event.group) ? event.group : "default";
  if (!entitlement.active) group = "default";
  const name = cleanText(event.name, 60, "标的名称", true);
  const code = cleanText(event.code, 30, "代码");
  const note = cleanText(event.note, 500, "跟踪备注");
  const thesis = cleanText(event.thesis, 300, "为什么关注");
  const invalidation = cleanText(event.invalidation, 200, "失效条件");
  const riskNote = cleanText(event.riskNote, 200, "风险");
  const nextReviewAt = cleanText(event.nextReviewAt, 20, "下次复核日");
  const reasonId = cleanText(event.reasonId, 40, "关注原因");
  const reasonLabel = cleanText(event.reasonLabel, 40, "关注原因");
  const reviewConditionId = cleanText(event.reviewConditionId, 40, "复评条件");
  const reviewConditionLabel = cleanText(event.reviewConditionLabel, 40, "复评条件");
  const pageSource = cleanText(event.pageSource, 40, "来源页面");
  const baselineFact = await stampOfficialFact(market, code, name, event.baselineFact || null);
  let thresholdPrice = null;
  let thresholdDirection = "";
  let thresholdNote = "";
  if (entitlement.active) {
    thresholdPrice = cleanNumber(event.thresholdPrice, "阈值价格", { min: 0, max: 1e9 });
    thresholdDirection = ["above", "below"].includes(event.thresholdDirection) ? event.thresholdDirection : "";
    thresholdNote = cleanText(event.thresholdNote, 120, "阈值说明");
  }
  return updateWorkspace(openid, (workspace) => {
    const limit = entitlement.active ? WORKSPACE_LIMITS.watchItems : FREE_LIMITS.watchItems;
    if (workspace.watchItems.length >= limit) {
      throw new MemberError("WORKSPACE_LIMIT", `跟踪清单最多保存 ${limit} 条`);
    }
    const now = new Date();
    const watchId = recordId("watch");
    workspace.watchItems.unshift({
      id: watchId,
      market,
      marketLabel: MARKET_LABELS[market],
      group,
      groupLabel: GROUP_LABELS[group],
      name,
      code,
      note,
      thesis: thesis || reasonLabel,
      invalidation: invalidation || reviewConditionLabel,
      riskNote,
      nextReviewAt,
      reasonId,
      reasonLabel,
      reviewConditionId,
      reviewConditionLabel,
      pageSource: pageSource || "workspace",
      baselineFact,
      baselineAt: baselineFact ? now : null,
      thresholdPrice,
      thresholdDirection,
      thresholdNote,
      createdAt: now,
      updatedAt: now,
    });
    syncSystemTasksFromWatches(workspace, recordId);
  }, { basic: true, kind: "watch" });
}

async function removeWatchItem(openid, event) {
  const id = validRecordId(event.itemId, "watch");
  return updateWorkspace(openid, (workspace) => {
    workspace.watchItems = workspace.watchItems.filter((item) => item.id !== id);
  }, false);
}

async function saveDecision(openid, event) {
  await requireBasicWrite(openid, "decision");
  const title = cleanText(event.title, 80, "档案标题", true);
  const market = Object.prototype.hasOwnProperty.call(MARKET_LABELS, event.market) ? event.market : "";
  const code = cleanText(event.code, 30, "代码");
  const name = cleanText(event.name, 60, "标的名称");
  const invalidation = cleanText(event.invalidation, 200, "失效条件");
  const nextReviewAt = cleanText(event.nextReviewAt, 20, "下次复核日");
  const reasonId = cleanText(event.reasonId, 40, "关注原因");
  const reasonLabel = cleanText(event.reasonLabel, 40, "关注原因");
  const reviewConditionId = cleanText(event.reviewConditionId, 40, "复评条件");
  const reviewConditionLabel = cleanText(event.reviewConditionLabel, 40, "复评条件");
  const pageSource = cleanText(event.pageSource, 40, "来源页面");
  const evidence = await stampOfficialFact(market || "other", code, name || title, event.evidence || null);
  const noteRaw = cleanText(event.note, 1200, "决策记录");
  const note = noteRaw || [
    reasonLabel ? `关注原因：${reasonLabel}` : "",
    reviewConditionLabel ? `复评条件：${reviewConditionLabel}` : "",
    evidence ? `当时结论：${evidence.oneLiner || ""}` : "已保存决策快照",
  ].filter(Boolean).join("；").slice(0, 1200) || "已保存决策快照";
  const entitlement = await publicEntitlement(openid);
  const active = Boolean(entitlement && entitlement.active);
  return updateWorkspace(openid, (workspace) => {
    const limit = active ? WORKSPACE_LIMITS.decisions : FREE_LIMITS.decisions;
    if (workspace.decisions.length >= limit) {
      throw new MemberError("WORKSPACE_LIMIT", `决策档案最多保存 ${limit} 条`);
    }
    const now = new Date();
    workspace.decisions.unshift({
      id: recordId("decision"),
      title,
      note,
      market: market || null,
      marketLabel: market ? MARKET_LABELS[market] : "",
      code,
      name,
      invalidation: invalidation || reviewConditionLabel,
      nextReviewAt,
      reasonId,
      reasonLabel,
      reviewConditionId,
      reviewConditionLabel,
      pageSource: pageSource || "workspace",
      evidence,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    syncSystemTasksFromWatches(workspace, recordId);
  }, { basic: true, kind: "decision" });
}

async function updateReviewTask(openid, event) {
  const taskId = validRecordId(event.taskId, "task");
  const action = String(event.taskAction || event.actionName || "").trim();
  if (!["complete", "snooze", "delete"].includes(action)) {
    throw new MemberError("INVALID_WORKSPACE_INPUT", "待办操作无效");
  }
  const days = action === "snooze" ? (Number(event.days) === 7 ? 7 : 1) : 0;
  // 到期会员仍可完成/删除/延后已有待办；不可新增需会员权益的内容。
  return updateWorkspace(openid, (workspace) => {
    const touched = mutateTask(workspace, taskId, action, days);
    if (!touched) throw new MemberError("INVALID_WORKSPACE_INPUT", "待办不存在");
  }, false);
}

async function ackWatchBaselines(openid, event) {
  const ids = Array.isArray(event.itemIds) ? event.itemIds.map((id) => String(id || "")).filter(Boolean) : [];
  if (!ids.length) throw new MemberError("INVALID_WORKSPACE_INPUT", "请选择要确认的关注项");
  if (ids.length > WORKSPACE_LIMITS.watchItems) {
    throw new MemberError("INVALID_WORKSPACE_INPUT", "一次确认的关注项过多");
  }
  const facts = event.facts && typeof event.facts === "object" && !Array.isArray(event.facts)
    ? event.facts
    : {};
  return updateWorkspace(openid, (workspace) => {
    const now = new Date();
    const wanted = new Set(ids);
    workspace.watchItems = workspace.watchItems.map((item) => {
      if (!wanted.has(item.id)) return item;
      const nextFact = facts[item.id] ? cleanFact(facts[item.id]) : item.baselineFact || null;
      return {
        ...item,
        baselineFact: nextFact,
        baselineAt: now,
        updatedAt: now,
      };
    });
  });
}

async function markInboxRead(openid, event) {
  const ids = Array.isArray(event.itemIds)
    ? event.itemIds.map((id) => String(id || "")).filter(Boolean)
    : (event.itemId ? [String(event.itemId)] : []);
  const markAll = Boolean(event.markAll);
  return updateWorkspace(openid, (workspace) => {
    const now = new Date();
    workspace.inbox = (workspace.inbox || []).map((item) => {
      if (markAll || ids.includes(item.id)) {
        return { ...item, readAt: item.readAt || now };
      }
      return item;
    });
  }, false);
}

async function scanAllWorkspacesInbox() {
  const pageSize = 40;
  let offset = 0;
  let scanned = 0;
  let added = 0;
  for (;;) {
    const result = await db.collection(WORKSPACES).skip(offset).limit(pageSize).get();
    const rows = result.data || [];
    if (!rows.length) break;
    for (const doc of rows) {
      scanned += 1;
      const { _id, _openid, ...workspace } = doc;
      workspace.watchItems = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
      workspace.decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
      workspace.eventMarks = Array.isArray(workspace.eventMarks) ? workspace.eventMarks : [];
      workspace.inbox = Array.isArray(workspace.inbox) ? workspace.inbox : [];
      workspace.reviewTasks = Array.isArray(workspace.reviewTasks) ? workspace.reviewTasks : [];
      const count = await scanWorkspaceInbox(db, workspace, recordId);
      if (count > 0) {
        added += count;
        workspace.updatedAt = new Date();
        await db.collection(WORKSPACES).doc(_id).set({ data: workspace });
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 2000) break;
  }
  return { scanned, added };
}

async function saveEventMark(openid, event) {
  const title = cleanText(event.title, 80, "事件标题", true);
  const detail = cleanText(event.detail, 200, "事件说明");
  const dateLabel = cleanText(event.dateLabel, 20, "事件日期", true);
  const kind = cleanText(event.kind, 30, "事件类型");
  const marketLabel = cleanText(event.marketLabel, 20, "市场");
  const code = cleanText(event.code, 30, "代码");
  const source = cleanText(event.source, 80, "来源");
  const notifyAccepted = Boolean(event.notifyAccepted);
  return updateWorkspace(openid, (workspace) => {
    if (workspace.eventMarks.length >= WORKSPACE_LIMITS.eventMarks) {
      throw new MemberError("WORKSPACE_LIMIT", `事件标记最多保存 ${WORKSPACE_LIMITS.eventMarks} 条`);
    }
    const duplicate = workspace.eventMarks.some((item) => (
      item.title === title && item.dateLabel === dateLabel && item.code === code
    ));
    if (duplicate) {
      workspace.eventMarks = workspace.eventMarks.map((item) => {
        if (item.title === title && item.dateLabel === dateLabel && item.code === code) {
          return {
            ...item,
            notifyAccepted: item.notifyAccepted || notifyAccepted,
            updatedAt: new Date(),
          };
        }
        return item;
      });
      return;
    }
    const now = new Date();
    workspace.eventMarks.unshift({
      id: recordId("event"),
      title,
      detail,
      dateLabel,
      kind,
      marketLabel,
      code,
      source,
      notifyAccepted,
      notifiedAt: null,
      deliveryStatus: notifyAccepted ? "pending" : "skipped",
      retryCount: 0,
      lastError: "",
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function saveIpoRecord(openid, event) {
  const name = cleanText(event.name, 60, "新股名称", true);
  const code = cleanText(event.code, 30, "代码");
  const applyDate = cleanText(event.applyDate, 20, "申购日");
  const listingDate = cleanText(event.listingDate, 20, "上市日");
  const lots = cleanNumber(event.lots, "申购手数", { min: 0, max: 100000 });
  const amount = cleanNumber(event.amount, "申购金额", { min: 0, max: 1e9 });
  const result = Object.prototype.hasOwnProperty.call(IPO_RESULTS, event.result) ? event.result : "pending";
  const note = cleanText(event.note, 300, "备注");
  const reviewNote = cleanText(event.reviewNote, 500, "上市后复盘");
  return updateWorkspace(openid, (workspace) => {
    if (workspace.ipoRecords.length >= WORKSPACE_LIMITS.ipoRecords) {
      throw new MemberError("WORKSPACE_LIMIT", `申购记录最多 ${WORKSPACE_LIMITS.ipoRecords} 条`);
    }
    const now = new Date();
    workspace.ipoRecords.unshift({
      id: recordId("ipo"),
      name,
      code,
      applyDate,
      listingDate,
      lots,
      amount,
      result,
      resultLabel: IPO_RESULTS[result],
      note,
      reviewNote,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function removeIpoRecord(openid, event) {
  const id = validRecordId(event.itemId, "ipo");
  return updateWorkspace(openid, (workspace) => {
    workspace.ipoRecords = workspace.ipoRecords.filter((item) => item.id !== id);
  }, false);
}

async function saveDividendLot(openid, event) {
  const name = cleanText(event.name, 60, "标的名称", true);
  const code = cleanText(event.code, 30, "代码");
  const market = Object.prototype.hasOwnProperty.call(MARKET_LABELS, event.market) ? event.market : "a";
  const currency = ["CNY", "HKD", "USD"].includes(event.currency) ? event.currency : "CNY";
  const shares = cleanNumber(event.shares, "持股数量", { min: 0, max: 1e12, required: true });
  const expectedPerShare = cleanNumber(event.expectedPerShare, "预计每股股息", { min: 0, max: 1e6 });
  const yieldPct = cleanNumber(event.yieldPct, "股息率", { min: 0, max: 100 });
  const price = cleanNumber(event.price, "现价", { min: 0, max: 1e9 });
  const actualTotal = cleanNumber(event.actualTotal, "实际到账", { min: 0, max: 1e12 });
  const exDate = cleanText(event.exDate, 20, "除权日");
  const payDate = cleanText(event.payDate, 20, "到账日");
  const note = cleanText(event.note, 300, "备注");
  return updateWorkspace(openid, (workspace) => {
    if (workspace.dividendLots.length >= WORKSPACE_LIMITS.dividendLots) {
      throw new MemberError("WORKSPACE_LIMIT", `收息台账最多 ${WORKSPACE_LIMITS.dividendLots} 条`);
    }
    const now = new Date();
    workspace.dividendLots.unshift({
      id: recordId("div"),
      name,
      code,
      market,
      marketLabel: MARKET_LABELS[market],
      currency,
      shares,
      expectedPerShare,
      yieldPct,
      price,
      actualTotal,
      exDate,
      payDate,
      note,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function removeDividendLot(openid, event) {
  const id = validRecordId(event.itemId, "div");
  return updateWorkspace(openid, (workspace) => {
    workspace.dividendLots = workspace.dividendLots.filter((item) => item.id !== id);
  }, false);
}

async function saveSettings(openid, event) {
  const taxRatePct = cleanNumber(event.taxRatePct, "税率", { min: 0, max: 60, required: true });
  const hkdCny = cleanNumber(event.hkdCny, "港币汇率", { min: 0.01, max: 20, required: true });
  const usdCny = cleanNumber(event.usdCny, "美元汇率", { min: 0.01, max: 20, required: true });
  return updateWorkspace(openid, (workspace) => {
    workspace.settings = {
      taxRatePct,
      hkdCny,
      usdCny,
      updatedAt: new Date(),
    };
  });
}

function todayLabelShanghai() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function sendEventReminders() {
  const templateId = String(process.env.WANGCHAO_SUBSCRIBE_EVENT_TMPL || "").trim();
  const today = todayLabelShanghai();
  const MAX_RETRY = 3;
  if (!templateId) {
    return {
      ok: true,
      skipped: true,
      reason: "NO_TEMPLATE",
      today,
      sent: 0,
      retried: 0,
      failed: 0,
    };
  }
  const pageSize = 50;
  let offset = 0;
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let compensated = 0;
  let scanned = 0;
  const errors = [];
  for (;;) {
    const result = await db.collection(WORKSPACES).skip(offset).limit(pageSize).get();
    const rows = result.data || [];
    if (!rows.length) break;
    for (const doc of rows) {
      scanned += 1;
      const openid = doc.ownerOpenid || doc._openid || doc.openid;
      const marks = Array.isArray(doc.eventMarks) ? doc.eventMarks : [];
      let dirty = false;
      const due = marks.filter((item) => {
        if (!item.notifyAccepted || !openid) return false;
        const status = item.deliveryStatus || (item.notifiedAt ? "sent" : "pending");
        if (status === "sent" || status === "skipped") return false;
        const retryCount = Number(item.retryCount || 0);
        if (retryCount >= MAX_RETRY && status === "failed") return false;
        // 当日事件，或失败后进入每日补偿（日期已到且未超重试）。
        if (item.dateLabel === today) return true;
        if (status === "failed" && String(item.dateLabel || "") <= today) {
          compensated += 1;
          return true;
        }
        return false;
      });
      if (!due.length) continue;
      for (const mark of due) {
        const retryCount = Number(mark.retryCount || 0);
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: openid,
            templateId,
            page: "pages/workspace/index?focus=calendar&addon=remind",
            data: {
              thing1: { value: String(mark.title || "投资事件").slice(0, 20) },
              time2: { value: String(mark.dateLabel || today) },
              thing3: { value: String(mark.detail || mark.marketLabel || "打开望潮查看").slice(0, 20) },
            },
            miniprogramState: "formal",
          });
          sent += 1;
          if (retryCount > 0) retried += 1;
          mark.notifiedAt = new Date();
          mark.deliveryStatus = "sent";
          mark.lastError = "";
          mark.nextRetryAt = null;
          mark.updatedAt = new Date();
          dirty = true;
        } catch (error) {
          failed += 1;
          const message = String(error.errMsg || error.message || error).slice(0, 120);
          errors.push(message);
          mark.deliveryStatus = "failed";
          mark.retryCount = retryCount + 1;
          mark.lastError = message;
          mark.nextRetryAt = today;
          mark.updatedAt = new Date();
          dirty = true;
        }
      }
      if (dirty) {
        await db.collection(WORKSPACES).doc(doc._id).update({
          data: {
            eventMarks: marks,
            updatedAt: new Date(),
          },
        });
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 2000) break;
  }
  return {
    ok: true,
    today,
    scanned,
    sent,
    retried,
    failed,
    compensated,
    errors: errors.slice(0, 5),
  };
}

function isEventRemindTimer(event) {
  const name = String(event.TriggerName || event.triggerName || "");
  return name === "member-event-remind" || name.includes("event-remind");
}

/** 云开发同函数通常只保留一个 timer；事件提醒挂在 15 分钟对账触发器的 09:00（上海）窗口。 */
function shouldPiggybackEventRemind(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number((parts.find((part) => part.type === "hour") || {}).value);
  const minute = Number((parts.find((part) => part.type === "minute") || {}).value);
  return hour === 9 && minute < 15;
}

async function removeEventMark(openid, event) {
  const id = validRecordId(event.itemId, "event");
  return updateWorkspace(openid, (workspace) => {
    workspace.eventMarks = workspace.eventMarks.filter((item) => item.id !== id);
  }, false);
}

async function removeDecision(openid, event) {
  const id = validRecordId(event.itemId, "decision");
  return updateWorkspace(openid, (workspace) => {
    workspace.decisions = workspace.decisions.filter((item) => item.id !== id);
  }, false);
}

async function refreshSentinel(openid) {
  try {
    await reconcileRecentOrders(openid, RECONCILE_BATCH_LIMIT, true);
  } catch (error) {
    // 核验失败仍尽量返回工作台，保持只读可用。
  }
  const id = workspaceId(openid);
  const data = await getDocument(WORKSPACES, id);
  let added = 0;
  if (data) {
    const { _id, _openid, ...workspace } = data;
    delete workspace.openid;
    workspace.watchItems = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
    workspace.decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
    workspace.eventMarks = Array.isArray(workspace.eventMarks) ? workspace.eventMarks : [];
    workspace.inbox = Array.isArray(workspace.inbox) ? workspace.inbox : [];
    workspace.reviewTasks = Array.isArray(workspace.reviewTasks) ? workspace.reviewTasks : [];
    added = await scanWorkspaceInbox(db, workspace, recordId);
    if (added > 0) {
      workspace.ownerOpenid = openid;
      workspace.updatedAt = new Date();
      await db.collection(WORKSPACES).doc(id).set({ data: workspace });
    }
  }
  const publicData = await publicWorkspace(openid);
  return { ...publicData, sentinelAdded: added };
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
    subscribe: subscribeConfig(),
    freeLimits: FREE_LIMITS,
    sellGate: {
      paymentChannelOpen: Boolean(config.ready && config.publicReady && !reviewRequired),
      codeReady: true,
      humanPending: [
        "微信公众平台类目确认",
        "公众平台隐私保护指引填写",
        "Android/iOS 真机支付留证",
        "商户平台人工退款留证",
      ],
    },
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
      const summary = await reconcileGlobalOrders();
      if (!shouldPiggybackEventRemind()) return ok(summary);
      const inbox = await scanAllWorkspacesInbox();
      const push = await sendEventReminders();
      return ok({ ...summary, remind: { inbox, push } });
    }
    if (isFreeTestGrantTimer(event)) {
      if (context.OPENID) return fail("FREE_TEST_FORBIDDEN", "客户端不能触发免费测试授权");
      return ok(await grantFreeTestEntitlement());
    }
    if (isEventRemindTimer(event)) {
      if (context.OPENID) return fail("TIMER_FORBIDDEN", "客户端不能触发事件提醒任务");
      const inbox = await scanAllWorkspacesInbox();
      const push = await sendEventReminders();
      return ok({ inbox, push });
    }
    if (!context.OPENID) return fail("NO_OPENID", "请从望潮小程序内打开会员页");
    if (event.action === "status") return ok(await memberStatus(context.OPENID));
    if (event.action === "workspace") return ok(await workspaceStatus(context.OPENID));
    if (event.action === "refreshSentinel") return ok(await refreshSentinel(context.OPENID));
    if (event.action === "saveWatchItem") return ok(await saveWatchItem(context.OPENID, event));
    if (event.action === "removeWatchItem") return ok(await removeWatchItem(context.OPENID, event));
    if (event.action === "saveDecision") return ok(await saveDecision(context.OPENID, event));
    if (event.action === "removeDecision") return ok(await removeDecision(context.OPENID, event));
    if (event.action === "ackWatchBaselines") return ok(await ackWatchBaselines(context.OPENID, event));
    if (event.action === "saveEventMark") return ok(await saveEventMark(context.OPENID, event));
    if (event.action === "removeEventMark") return ok(await removeEventMark(context.OPENID, event));
    if (event.action === "markInboxRead") return ok(await markInboxRead(context.OPENID, event));
    if (event.action === "updateReviewTask") return ok(await updateReviewTask(context.OPENID, event));
    if (event.action === "saveIpoRecord") return ok(await saveIpoRecord(context.OPENID, event));
    if (event.action === "removeIpoRecord") return ok(await removeIpoRecord(context.OPENID, event));
    if (event.action === "saveDividendLot") return ok(await saveDividendLot(context.OPENID, event));
    if (event.action === "removeDividendLot") return ok(await removeDividendLot(context.OPENID, event));
    if (event.action === "saveSettings") return ok(await saveSettings(context.OPENID, event));
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
