const { classifyFactDiff } = require("./change-detect");
const { syncSystemTasksFromWatches } = require("./review-tasks");

const { FACT_LATEST } = (() => {
  try {
    // 同环境集合名约定；不跨包 require aurum-data。
    return { FACT_LATEST: "data_fact_latest" };
  } catch (error) {
    return { FACT_LATEST: "data_fact_latest" };
  }
})();

const INBOX_LIMIT = 80;

function fingerprint(fact) {
  if (!fact) return "";
  return [fact.oneLiner, fact.badge, fact.priceLabel, fact.metricLabel, fact.risk, fact.asOf]
    .map((part) => String(part || "").trim())
    .join("|");
}

function docId(market, code) {
  return `${String(market || "x")}_${String(code || "x")}`.replace(/[^\w.\-一-龥]/g, "_").slice(0, 64);
}

function todayLabelShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function diffSummary(fromFact, toFact, market) {
  const classified = classifyFactDiff(fromFact, toFact, market);
  return classified.summary || "公开数据已刷新";
}

async function readLatestFact(db, market, code) {
  if (!db || !code) return null;
  try {
    const result = await db.collection(FACT_LATEST).doc(docId(market, code)).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    return null;
  }
}

function ensureInbox(workspace) {
  workspace.inbox = Array.isArray(workspace.inbox) ? workspace.inbox : [];
  return workspace.inbox;
}

function pushInbox(workspace, message) {
  const inbox = ensureInbox(workspace);
  const dedupeKey = message.dedupeKey || `${message.kind}|${message.code}|${message.snapshotUpdatedAt || message.dateLabel || ""}`;
  if (inbox.some((item) => item.dedupeKey === dedupeKey)) return false;
  inbox.unshift({
    id: message.id,
    dedupeKey,
    kind: message.kind,
    title: message.title,
    body: message.body,
    market: message.market || "",
    code: message.code || "",
    watchId: message.watchId || "",
    decisionId: message.decisionId || "",
    snapshotUpdatedAt: message.snapshotUpdatedAt || "",
    dateLabel: message.dateLabel || "",
    fromFact: message.fromFact || null,
    toFact: message.toFact || null,
    changeTypes: Array.isArray(message.changeTypes) ? message.changeTypes.slice(0, 12) : [],
    importance: message.importance || "",
    changeKey: message.changeKey || "",
    readAt: null,
    createdAt: new Date(),
  });
  if (inbox.length > INBOX_LIMIT) workspace.inbox = inbox.slice(0, INBOX_LIMIT);
  return true;
}

async function scanWorkspaceInbox(db, workspace, recordId) {
  let added = 0;
  added += syncSystemTasksFromWatches(workspace, recordId);
  const watches = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
  for (const watch of watches) {
    const latest = await readLatestFact(db, watch.market, watch.code || watch.name);
    if (!latest || !latest.fact) continue;
    const baseline = watch.baselineFact || null;
    const changed = fingerprint(baseline) !== fingerprint(latest.fact)
      && fingerprint(latest.fact);
    if (!changed && !latest.changed) continue;
    if (baseline && fingerprint(baseline) === fingerprint(latest.fact)) continue;
    const classified = classifyFactDiff(baseline || latest.previousFact, latest.fact, watch.market);
    if (!classified.changeTypes.length && !latest.changed) continue;
    const summary = classified.summary || diffSummary(baseline || latest.previousFact, latest.fact, watch.market);
    const dedupeKey = classified.changeKey
      || `fact-change|${watch.id}|${latest.snapshotUpdatedAt || latest.fact.snapshotUpdatedAt || ""}`;
    if (pushInbox(workspace, {
      id: recordId("inbox"),
      kind: "fact-change",
      title: `${watch.name || watch.code} 事实变化`,
      body: summary + (watch.invalidation ? `；请核对：${watch.invalidation}` : ""),
      market: watch.market,
      code: watch.code || "",
      watchId: watch.id,
      snapshotUpdatedAt: latest.snapshotUpdatedAt || latest.fact.snapshotUpdatedAt,
      fromFact: baseline || latest.previousFact,
      toFact: latest.fact,
      changeTypes: classified.changeTypes,
      importance: classified.importance || "medium",
      changeKey: classified.changeKey || "",
      dedupeKey,
    })) added += 1;
  }

  const today = todayLabelShanghai();
  for (const watch of watches) {
    if (!watch.nextReviewAt || String(watch.nextReviewAt) > today) continue;
    if (pushInbox(workspace, {
      id: recordId("inbox"),
      kind: "review-due",
      title: `关注复核到期：${watch.name || watch.code}`,
      body: watch.invalidation
        ? `到期复核。失效条件：${watch.invalidation}`
        : (watch.thesis ? `到期复核。原始理由：${watch.thesis}` : "已到你设定的下次复核日。"),
      market: watch.market,
      code: watch.code || "",
      watchId: watch.id,
      dateLabel: watch.nextReviewAt,
      dedupeKey: `review-due|watch|${watch.id}|${watch.nextReviewAt}`,
    })) added += 1;
  }

  const decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
  for (const decision of decisions) {
    if (decision.closedAt) continue;
    if (decision.nextReviewAt && String(decision.nextReviewAt) <= today) {
      if (pushInbox(workspace, {
        id: recordId("inbox"),
        kind: "review-due",
        title: `复核到期：${decision.title}`,
        body: decision.invalidation
          ? `到期复核。失效条件：${decision.invalidation}`
          : "已到你设定的下次复核日，请对照当前事实。",
        market: decision.market || "",
        code: decision.code || "",
        decisionId: decision.id,
        dateLabel: decision.nextReviewAt,
        dedupeKey: `review-due|decision|${decision.id}|${decision.nextReviewAt}`,
      })) added += 1;
    }
    if (!decision.invalidation || !decision.evidence) continue;
    const latest = await readLatestFact(db, decision.market || "other", decision.code || decision.name || "");
    if (!latest || !latest.fact) continue;
    if (fingerprint(decision.evidence) === fingerprint(latest.fact)) continue;
    if (pushInbox(workspace, {
      id: recordId("inbox"),
      kind: "thesis-risk",
      title: `判断可能受影响：${decision.title}`,
      body: `相关公开事实已变（${diffSummary(decision.evidence, latest.fact, decision.market)}）。请核对：${decision.invalidation}`,
      market: decision.market || "",
      code: decision.code || "",
      decisionId: decision.id,
      snapshotUpdatedAt: latest.snapshotUpdatedAt || latest.fact.snapshotUpdatedAt,
      fromFact: decision.evidence,
      toFact: latest.fact,
    })) added += 1;
  }

  const marks = Array.isArray(workspace.eventMarks) ? workspace.eventMarks : [];
  for (const mark of marks) {
    if (mark.dateLabel !== today) continue;
    if (pushInbox(workspace, {
      id: recordId("inbox"),
      kind: "event-today",
      title: mark.title || "今日事件",
      body: mark.detail || "打开日历查看详情",
      market: mark.marketLabel || "",
      code: mark.code || "",
      dateLabel: mark.dateLabel,
    })) added += 1;
  }

  return added;
}

function publicInbox(inbox = []) {
  return (inbox || []).map((item) => ({
    ...item,
    createdAt: item.createdAt && item.createdAt.toISOString
      ? item.createdAt.toISOString()
      : item.createdAt || null,
    readAt: item.readAt && item.readAt.toISOString
      ? item.readAt.toISOString()
      : item.readAt || null,
  }));
}

function buildTodayBrief(workspace, inbox) {
  const unread = (inbox || []).filter((item) => !item.readAt);
  const factChanges = unread.filter((item) => item.kind === "fact-change");
  const events = unread.filter((item) => item.kind === "event-today" || item.kind === "review-due");
  const thesis = unread.filter((item) => item.kind === "thesis-risk");
  const watchCount = (workspace.watchItems || []).length;
  const calmCount = Math.max(0, watchCount - factChanges.length);
  const lines = [];
  if (factChanges.length) lines.push(`今天有 ${factChanges.length} 项事实变化，需要重新看。`);
  else lines.push("今天关注对象暂无新的实质变化。");
  if (events.length) lines.push(`有 ${events.length} 个到期事件或复核。`);
  if (thesis.length) lines.push(`有 ${thesis.length} 项原始判断可能被事实触及。`);
  if (calmCount > 0 && watchCount > 0) lines.push(`${calmCount} 个关注对象相对基线暂无需处理。`);
  if (!watchCount) lines.push("先保存关注与原始理由，哨兵才能开始核对。");
  return {
    headline: lines[0] || "今日简报",
    lines,
    factChangeCount: factChanges.length,
    eventCount: events.length,
    thesisCount: thesis.length,
    calmCount,
    watchCount,
    unreadCount: unread.length,
    allClear: unread.length === 0 && watchCount > 0,
  };
}

module.exports = {
  FACT_LATEST,
  INBOX_LIMIT,
  buildTodayBrief,
  fingerprint,
  publicInbox,
  pushInbox,
  scanWorkspaceInbox,
  todayLabelShanghai,
};
