/**
 * 小程序内节点待办：嵌入 member_workspaces.reviewTasks。
 * 仅在公开资料有明确日期时由系统生成；不猜测。
 */

const TASK_LIMIT = 120;

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

function addDaysLabel(baseLabel, days) {
  const match = String(baseLabel || todayLabelShanghai()).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return todayLabelShanghai();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + Number(days || 0));
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ensureTasks(workspace) {
  workspace.reviewTasks = Array.isArray(workspace.reviewTasks) ? workspace.reviewTasks : [];
  return workspace.reviewTasks;
}

function pushTask(workspace, task, recordId) {
  const tasks = ensureTasks(workspace);
  const dedupeKey = task.dedupeKey || `${task.sourceType}|${task.market}|${task.targetId}|${task.dueAt}|${task.title}`;
  const existing = tasks.find((item) => item.dedupeKey === dedupeKey && item.status !== "deleted");
  if (existing) {
    if (existing.status === "done") return false;
    return false;
  }
  tasks.unshift({
    taskId: task.taskId || recordId("task"),
    dedupeKey,
    sourceType: task.sourceType || "system",
    market: task.market || "",
    targetId: task.targetId || "",
    targetName: task.targetName || "",
    title: task.title || "复核节点",
    description: task.description || "",
    dueAt: task.dueAt || "",
    status: "open",
    priority: task.priority || "medium",
    createdAt: new Date(),
    completedAt: null,
    relatedSnapshotId: task.relatedSnapshotId || "",
    relatedWatchId: task.relatedWatchId || "",
    relatedDecisionId: task.relatedDecisionId || "",
    generatedBy: task.generatedBy || "system",
    reminderChannel: task.reminderChannel || "in_app",
    subscriptionAuthorized: Boolean(task.subscriptionAuthorized),
  });
  if (tasks.length > TASK_LIMIT) {
    workspace.reviewTasks = tasks
      .filter((item) => item.status !== "deleted")
      .slice(0, TASK_LIMIT);
  }
  return true;
}

function syncSystemTasksFromWatches(workspace, recordId) {
  let added = 0;
  const watches = Array.isArray(workspace.watchItems) ? workspace.watchItems : [];
  for (const watch of watches) {
    if (watch.nextReviewAt) {
      if (pushTask(workspace, {
        sourceType: "user_review",
        market: watch.market || "",
        targetId: watch.code || watch.id,
        targetName: watch.name || "",
        title: `指定日期重新评估：${watch.name || watch.code}`,
        description: watch.invalidation
          ? `失效条件：${watch.invalidation}`
          : (watch.thesis || "按你设定的日期重新查看当前资料"),
        dueAt: watch.nextReviewAt,
        priority: "high",
        relatedWatchId: watch.id,
        relatedSnapshotId: watch.id,
        generatedBy: "user",
        dedupeKey: `user_review|watch|${watch.id}|${watch.nextReviewAt}`,
      }, recordId)) added += 1;
    }

    const fact = watch.baselineFact || {};
    const metric = String(fact.metricLabel || "");
    const offerMatch = metric.match(/截止\s*(\d{4}-\d{2}-\d{2})/);
    const listMatch = metric.match(/上市\s*(\d{4}-\d{2}-\d{2})/);
    if (watch.market === "hk" && offerMatch) {
      if (pushTask(workspace, {
        sourceType: "hk_offer_deadline",
        market: "hk",
        targetId: watch.code || watch.id,
        targetName: watch.name || "",
        title: `${watch.name || watch.code} 招股截止`,
        description: "公开资料中的招股截止日期；请重新评估申购观察结论",
        dueAt: offerMatch[1],
        priority: "high",
        relatedWatchId: watch.id,
        generatedBy: "system",
        dedupeKey: `hk_offer_deadline|${watch.id}|${offerMatch[1]}`,
      }, recordId)) added += 1;
    }
    if (watch.market === "hk" && listMatch) {
      if (pushTask(workspace, {
        sourceType: "hk_listing",
        market: "hk",
        targetId: watch.code || watch.id,
        targetName: watch.name || "",
        title: `${watch.name || watch.code} 上市日`,
        description: "上市后重新查看公开表现与原判断依据",
        dueAt: listMatch[1],
        priority: "medium",
        relatedWatchId: watch.id,
        generatedBy: "system",
        dedupeKey: `hk_listing|${watch.id}|${listMatch[1]}`,
      }, recordId)) added += 1;
    }
  }

  const decisions = Array.isArray(workspace.decisions) ? workspace.decisions : [];
  for (const decision of decisions) {
    if (decision.closedAt || !decision.nextReviewAt) continue;
    if (pushTask(workspace, {
      sourceType: "user_review",
      market: decision.market || "",
      targetId: decision.code || decision.id,
      targetName: decision.name || decision.title || "",
      title: `决策复盘：${decision.title}`,
      description: decision.invalidation || "对照当时快照与当前公开资料",
      dueAt: decision.nextReviewAt,
      priority: "high",
      relatedDecisionId: decision.id,
      relatedSnapshotId: decision.id,
      generatedBy: "user",
      dedupeKey: `user_review|decision|${decision.id}|${decision.nextReviewAt}`,
    }, recordId)) added += 1;
  }

  const marks = Array.isArray(workspace.eventMarks) ? workspace.eventMarks : [];
  for (const mark of marks) {
    if (!mark.dateLabel) continue;
    if (pushTask(workspace, {
      sourceType: "event_mark",
      market: mark.marketLabel || "",
      targetId: mark.code || mark.id,
      targetName: mark.title || "",
      title: mark.title || "事件节点",
      description: mark.detail || "来自你标记的研究事件",
      dueAt: mark.dateLabel,
      priority: "medium",
      relatedSnapshotId: mark.id,
      generatedBy: "user",
      reminderChannel: mark.notifyAccepted ? "wechat" : "in_app",
      subscriptionAuthorized: Boolean(mark.notifyAccepted),
      dedupeKey: `event_mark|${mark.id}|${mark.dateLabel}`,
    }, recordId)) added += 1;
  }

  return added;
}

function mutateTask(workspace, taskId, action, days) {
  const tasks = ensureTasks(workspace);
  const now = new Date();
  let touched = false;
  workspace.reviewTasks = tasks.map((item) => {
    if (item.taskId !== taskId) return item;
    touched = true;
    if (action === "complete") {
      return { ...item, status: "done", completedAt: now, updatedAt: now };
    }
    if (action === "delete") {
      return { ...item, status: "deleted", updatedAt: now };
    }
    if (action === "snooze") {
      const dueAt = addDaysLabel(item.dueAt || todayLabelShanghai(), days || 1);
      return { ...item, dueAt, status: "open", updatedAt: now, completedAt: null };
    }
    return item;
  });
  return touched;
}

function publicTasks(tasks = []) {
  return (tasks || [])
    .filter((item) => item.status !== "deleted")
    .map((item) => ({
      ...item,
      createdAt: item.createdAt && item.createdAt.toISOString
        ? item.createdAt.toISOString()
        : item.createdAt || null,
      completedAt: item.completedAt && item.completedAt.toISOString
        ? item.completedAt.toISOString()
        : item.completedAt || null,
      updatedAt: item.updatedAt && item.updatedAt.toISOString
        ? item.updatedAt.toISOString()
        : item.updatedAt || null,
    }));
}

function buildHomeSummary(workspace, inbox, brief) {
  const tasks = publicTasks(workspace && workspace.reviewTasks);
  const today = todayLabelShanghai();
  const openTasks = tasks.filter((item) => item.status !== "done");
  const dueToday = openTasks.filter((item) => {
    if (!item.dueAt) return false;
    return String(item.dueAt) <= today;
  }).length;
  const unread = (inbox || []).filter((item) => !item.readAt);
  const changes = unread.filter((item) => item.kind === "fact-change" || item.kind === "thesis-risk").length;
  return {
    changeCount: changes || Number(brief && brief.factChangeCount || 0),
    taskCount: dueToday,
    unreadCount: unread.length,
    allClear: changes === 0 && dueToday === 0 && (workspace.watchItems || []).length > 0,
  };
}

module.exports = {
  TASK_LIMIT,
  addDaysLabel,
  buildHomeSummary,
  ensureTasks,
  mutateTask,
  publicTasks,
  pushTask,
  syncSystemTasksFromWatches,
  todayLabelShanghai,
};
