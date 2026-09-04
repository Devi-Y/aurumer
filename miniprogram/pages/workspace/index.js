const {
  ackWatchBaselines,
  deleteWorkspace,
  loadWorkspace,
  markInboxRead,
  refreshSentinel,
  removeDecision,
  removeDividendLot,
  removeEventMark,
  removeIpoRecord,
  removeWatchItem,
  saveDecision,
  saveDividendLot,
  saveEventMark,
  saveIpoRecord,
  saveSettings,
  saveWatchItem,
  updateReviewTask,
} = require("../../services/member");
const { openPage, goHome, consumeTabQuery } = require("../../utils/nav");
const { listHoldings, removeHolding } = require("../../utils/local-holdings");
const { track } = require("../../utils/analytics");
const { loadSnapshot } = require("../../data/store");
const { allItems, shortCompanyName } = require("../../utils/answers");
const { WORKSPACE_DISCLAIMER } = require("../../utils/disclaimer");
const {
  GROUP_OPTIONS,
  buildChangeFeed,
  buildWeeklyReview,
  captureDecisionEvidence,
  captureFact,
} = require("../../utils/fact-snapshot");
const {
  buildChangeCenter,
  buildTaskBoard,
  REASON_OPTIONS,
  REVIEW_CONDITION_OPTIONS,
} = require("../../utils/change-center");
const { buildResearchEvents } = require("../../utils/research-events");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { memberGate } = require("../../utils/member-gate");
const { buildGuruChanges } = require("../../utils/guru-changes");
const { yearCashflow } = require("../../utils/dividend-math");
const { requestEventSubscribe } = require("../../utils/subscribe");

const MARKET_OPTIONS = [
  { id: "hk", label: "港股" },
  { id: "us", label: "美股" },
  { id: "a", label: "A股" },
  { id: "gold", label: "黄金" },
  { id: "other", label: "其他" },
];

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.HK$/i, "")
    .replace(/\.(SH|SZ)$/i, "");
}

function buildWatchPreview(watchItems, snapshot) {
  if (!snapshot || !Array.isArray(watchItems) || !watchItems.length) return [];
  const catalogs = {
    hk: allItems(snapshot, "hk"),
    us: allItems(snapshot, "us"),
    a: allItems(snapshot, "a"),
    gold: allItems(snapshot, "gold"),
  };
  return watchItems.slice(0, 8).map((item) => {
    const market = item.market || "other";
    const list = catalogs[market] || [];
    const code = normalizeCode(item.code);
    const name = String(item.name || "").trim();
    const matched = list.find((entry) => {
      if (code && normalizeCode(entry.code) === code) return true;
      if (code && normalizeCode(entry.id) === code) return true;
      if (name && entry.name && entry.name.includes(name)) return true;
      if (name && entry.name && name.includes(shortCompanyName(entry.name, "", 6))) return true;
      return false;
    });
    const raw = matched?.raw || {};
    let metric = matched?.badge || matched?.one || "已保存";
    let deadline = "";
    if (market === "us" && raw.price != null) {
      metric = `$${Number(raw.price).toFixed(2)}${Number.isFinite(Number(raw.changePercent)) ? ` · ${Number(raw.changePercent) >= 0 ? "+" : ""}${Number(raw.changePercent).toFixed(1)}%` : ""}`;
    } else if (market === "a" && raw.currentPrice != null) {
      metric = `¥${Number(raw.currentPrice).toFixed(2)}${Number.isFinite(Number(raw.currentDividendYield)) ? ` · 息 ${Number(raw.currentDividendYield).toFixed(1)}%` : ""}`;
    } else if (market === "hk") {
      if (raw.offerDeadline) deadline = `截止 ${raw.offerDeadline}`;
      if (raw.entryFee != null) metric = `一手 ${Math.round(Number(raw.entryFee))} 港元`;
      else if (matched?.badge) metric = matched.badge;
    } else if (market === "gold") {
      const price = raw.quotes?.international?.price;
      if (price != null) metric = `${Math.round(Number(price))} USD/oz`;
    }
    return {
      id: item.id,
      title: shortCompanyName(item.name || matched?.name || "关注标的", "关注", 8),
      marketLabel: item.marketLabel || MARKET_OPTIONS.find((entry) => entry.id === market)?.label || "其他",
      metric,
      deadline,
      matched: Boolean(matched),
    };
  });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (error) {
    return String(value || "");
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatExpire(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  const days = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (days < 0) return `已于 ${stamp} 到期 · 记录仍可只读导出`;
  if (days <= 30) return `有效至 ${stamp} · 还剩 ${days} 天`;
  return `有效至 ${stamp}`;
}

function viewWorkspace(workspace) {
  const backendReady = Boolean(workspace.backendReady);
  const active = Boolean(workspace.active);
  const memberFeatures = Boolean(workspace.memberFeatures || active);
  const writable = Boolean(workspace.writable);
  const verificationPending = Boolean(workspace.verificationPending);
  const freeRemaining = workspace.freeRemaining || { watchItems: 0, decisions: 0 };
  const freeLimits = workspace.freeLimits || { watchItems: 5, decisions: 5 };
  return {
    ...workspace,
    backendReady,
    active,
    memberFeatures,
    writable,
    verificationPending,
    freeRemaining,
    freeLimits,
    expireLabel: formatExpire(workspace.expiresAt),
    freeLabel: active
      ? ""
      : `免费额度：关注 ${freeRemaining.watchItems}/${freeLimits.watchItems}，想法 ${freeRemaining.decisions}/${freeLimits.decisions}`,
    inbox: (workspace.inbox || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.createdAt),
      unread: !item.readAt,
    })),
    todayBrief: workspace.todayBrief || {
      headline: "今日简报加载中",
      lines: [],
      unreadCount: 0,
      allClear: false,
      factChangeCount: 0,
      eventCount: 0,
      thesisCount: 0,
      calmCount: 0,
      watchCount: 0,
    },
    statusTitle: !backendReady
      ? "记录服务暂不可用"
      : (verificationPending ? "权益核验中（只读）" : (active ? "哨兵已开启" : "免费研究可用")),
    statusDetail: !backendReady
      ? "当前仍可浏览公开资料，请稍后再试。"
      : (verificationPending
        ? (workspace.verificationMessage || "权益状态暂时无法核验，当前保留只读与导出。")
        : (active
          ? "事实没变不打扰；变了进今日简报。"
          : "免费可保存少量关注与理由；完整追踪为会员能力。")),
    watchItems: (workspace.watchItems || []).map((item) => ({
      ...item,
      groupLabel: item.groupLabel || "默认",
      dateLabel: formatDate(item.updatedAt || item.createdAt),
      hasBaseline: Boolean(item.baselineFact),
      thresholdLabel: item.thresholdPrice != null
        ? `${item.thresholdDirection === "below" ? "低于" : "高于"} ${item.thresholdPrice}`
        : "",
    })),
    decisions: (workspace.decisions || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.updatedAt || item.createdAt),
      evidenceLabel: item.evidence
        ? [item.evidence.priceLabel, item.evidence.oneLiner, item.evidence.asOf || item.evidence.snapshotUpdatedAt]
          .filter(Boolean)
          .join(" · ")
        : "",
    })),
    reviewTasks: workspace.reviewTasks || [],
    homeSummary: workspace.homeSummary || { changeCount: 0, taskCount: 0, unreadCount: 0, allClear: false },
    eventMarks: (workspace.eventMarks || []).map((item) => ({
      ...item,
      dateLabel: item.dateLabel || formatDate(item.createdAt),
      notifyLabel: item.notifyAccepted
        ? "微信提醒已开启"
        : ((workspace.subscribe && workspace.subscribe.channelLabel) || "小程序内提醒"),
    })),
    ipoRecords: (workspace.ipoRecords || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.updatedAt || item.createdAt),
    })),
    dividendLots: (workspace.dividendLots || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.updatedAt || item.createdAt),
    })),
    settings: workspace.settings || { taxRatePct: 10, hkdCny: 0.92, usdCny: 7.2 },
    subscribe: workspace.subscribe || { enabled: false, eventTemplateId: "", hint: "" },
  };
}

function exportText(state, review, events) {
  const lines = [
    "望潮逻辑哨兵导出",
    `导出时间：${formatDate(new Date())}`,
    state.expireLabel ? `权益：${state.expireLabel}` : "",
    "",
    `一、跟踪清单（${state.watchItems.length}）`,
  ].filter((line, index, arr) => line !== "" || arr[index - 1] !== "");
  if (!state.watchItems.length) lines.push("暂无记录");
  state.watchItems.forEach((item, index) => {
    const identity = item.code ? `${item.name}（${item.code}）` : item.name;
    lines.push(`${index + 1}. [${item.marketLabel || "其他"}/${item.groupLabel || "默认"}] ${identity}`);
    if (item.note) lines.push(`   备注：${item.note}`);
    if (item.thesis) lines.push(`   为什么：${item.thesis}`);
    if (item.invalidation) lines.push(`   失效条件：${item.invalidation}`);
    if (item.riskNote) lines.push(`   风险：${item.riskNote}`);
    if (item.nextReviewAt) lines.push(`   复核日：${item.nextReviewAt}`);
    if (item.baselineFact) {
      const fact = item.baselineFact;
      lines.push(`   基线：${[fact.priceLabel, fact.oneLiner, fact.asOf].filter(Boolean).join(" · ")}`);
      if (fact.source) lines.push(`   来源：${fact.source}`);
    }
    if (item.dateLabel) lines.push(`   时间：${item.dateLabel}`);
  });
  lines.push("", `二、决策档案（${state.decisions.length}）`);
  if (!state.decisions.length) lines.push("暂无记录");
  state.decisions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   ${item.note}`);
    if (item.invalidation) lines.push(`   失效条件：${item.invalidation}`);
    if (item.nextReviewAt) lines.push(`   复核日：${item.nextReviewAt}`);
    if (item.evidence) {
      const fact = item.evidence;
      lines.push(`   当时证据：${[fact.priceLabel, fact.oneLiner, fact.asOf || fact.snapshotUpdatedAt].filter(Boolean).join(" · ")}`);
      if (fact.source) lines.push(`   来源：${fact.source}`);
    }
    if (item.dateLabel) lines.push(`   时间：${item.dateLabel}`);
  });
  if (review && review.rows && review.rows.length) {
    lines.push("", `三、持续复盘（${review.count}）`);
    review.rows.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} · ${item.outcome}`);
    });
  }
  if (events && events.upcoming && events.upcoming.length) {
    lines.push("", `四、即将到来的事件（${Math.min(events.upcoming.length, 20)}）`);
    events.upcoming.slice(0, 20).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.dateLabel} ${item.title}`);
    });
  }
  if (state.eventMarks && state.eventMarks.length) {
    lines.push("", `五、我标记的提醒（${state.eventMarks.length}）`);
    state.eventMarks.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.dateLabel} ${item.title}`);
    });
  }
  lines.push(
    "",
    "说明：以上是用户自行记录与公开事实对照材料，不构成投资建议或收益承诺。",
    "隐私：记录仅当前微信用户可见；可随时删除全部个人记录。订单与支付凭证不在此导出范围内。",
  );
  return lines.join("\n");
}

function applyPrefill(page, options = {}) {
  const market = safeDecode(options.market);
  const marketIndex = Math.max(0, MARKET_OPTIONS.findIndex((item) => item.id === market));
  const focus = safeDecode(options.focus);
  const addon = safeDecode(options.addon);
  const name = safeDecode(options.name);
  const code = safeDecode(options.code);
  const fromDetail = Boolean(name || code);
  const patch = {};
  // focus=decision 是「去写想法」的入口，想法表单在关注页里。原来只切了 tab，
  // 真正负责展开表单的那行判断写的是 activeTab === "decision"——这个值不存在
  // （只有 today/watch/review 三个），所以表单从来没被打开过。
  if (focus === "decision") {
    patch.activeTab = "watch";
    patch.showDecisionForm = true;
  }
  else if (focus === "watch") patch.activeTab = "watch";
  else if (focus === "changes" || focus === "calendar" || focus === "today") patch.activeTab = "today";
  else if (focus === "review") patch.activeTab = "review";
  else if (focus === "tools") patch.activeTab = "watch";

  if (addon === "calendar" || addon === "ipo-check" || addon === "remind") {
    patch.activeTab = "today";
    patch.addonHint = "看今日简报中的事件与变化";
  } else if (addon === "ipo-review") {
    patch.activeTab = "watch";
    patch.showDecisionForm = true;
    patch.addonHint = "写下判断与失效条件";
  } else if (addon === "gold-alert" || addon === "compare" || addon === "track" || addon === "preview") {
    patch.activeTab = "today";
    patch.addonHint = "看今日简报中的事实变化";
  } else if (addon === "dividend" || addon === "groups") {
    patch.activeTab = "watch";
    patch.showTools = true;
    patch.addonHint = "台账与分组在关注页下方";
  } else if (addon === "export") {
    patch.addonHint = "底部可复制导出全部记录";
  } else if (addon === "review" || addon === "evidence") {
    patch.activeTab = "review";
    patch.addonHint = "对照长期判断与到期复核";
  } else if (addon === "sync") {
    patch.addonHint = "记录已云端同步";
  }

  if (marketIndex >= 0 && market) patch.marketIndex = marketIndex;
  if (fromDetail) {
    patch.showWatchForm = true;
    if (!patch.activeTab || patch.activeTab === "changes") patch.activeTab = "watch";
    patch.watchForm = {
      name,
      code,
      note: "",
    };
  }
  if (Object.keys(patch).length) page.setData(patch);
}

Page({
  data: {
    loading: true,
    saving: false,
    migrating: false,
    activeTab: "today",
    showWatchForm: false,
    showDecisionForm: false,
    showIpoForm: false,
    showDivForm: false,
    localHoldingsCount: 0,
    marketOptions: MARKET_OPTIONS,
    groupOptions: GROUP_OPTIONS,
    ipoResultOptions: [
      { id: "pending", label: "待公布" },
      { id: "won", label: "已中签" },
      { id: "lost", label: "未中签" },
      { id: "skipped", label: "未申购" },
    ],
    thresholdOptions: [
      { id: "", label: "不设阈值" },
      { id: "above", label: "高于" },
      { id: "below", label: "低于" },
    ],
    marketIndex: 1,
    groupIndex: 0,
    ipoResultIndex: 0,
    thresholdIndex: 0,
    watchForm: { name: "", code: "", note: "", thesis: "", invalidation: "", riskNote: "", nextReviewAt: "", thresholdPrice: "" },
    decisionForm: { title: "", note: "", invalidation: "", nextReviewAt: "" },
    ipoForm: { name: "", code: "", applyDate: "", listingDate: "", lots: "", amount: "", note: "", reviewNote: "" },
    divForm: { name: "", code: "", shares: "", expectedPerShare: "", yieldPct: "", actualTotal: "", exDate: "", payDate: "", note: "" },
    settingsForm: { taxRatePct: "10", hkdCny: "0.92", usdCny: "7.2" },
    saveEvidence: true,
    watchPreview: [],
    changeFeed: [],
    changeCount: 0,
    changeCenter: {
      summary: { headline: "", unreadCount: 0, highCount: 0, mediumCount: 0, calmCount: 0, watchCount: 0 },
      needReassess: [],
      important: [],
      calm: [],
      all: [],
    },
    taskBoard: {
      today: [],
      week: [],
      month: [],
      overdue: [],
      later: [],
      done: [],
      openCount: 0,
      todayCount: 0,
    },
    calendarUpcoming: [],
    calendarPast: [],
    calendarNextCount: 0,
    weeklyReview: { count: 0, changedCount: 0, rows: [], headline: "" },
    guruChanges: [],
    dividendSummary: { expectedNetCny: 0, actualCny: null, count: 0, rows: [] },
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    addonHint: "",
    disclaimer: WORKSPACE_DISCLAIMER,
    reasonOptions: REASON_OPTIONS,
    reviewConditionOptions: REVIEW_CONDITION_OPTIONS,
    state: viewWorkspace({
      backendReady: false,
      active: false,
      writable: false,
      memberFeatures: false,
      watchItems: [],
      decisions: [],
      eventMarks: [],
      reviewTasks: [],
      ipoRecords: [],
      dividendLots: [],
      freeLimits: { watchItems: 5, decisions: 5 },
      freeRemaining: { watchItems: 5, decisions: 5 },
      limits: { watchItems: 80, decisions: 300, eventMarks: 80, ipoRecords: 40, dividendLots: 80 },
    }),
  },
  onLoad(options = {}) {
    track("workspace_open", { from: "direct" });
    track("change_center_open", { from: "workspace" });
    applyPrefill(this, options);
  },
  onShow() {
    const queued = consumeTabQuery("/pages/workspace/index");
    if (queued) applyPrefill(this, queued);
    this.refreshLocalHint();
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh());
  },
  retryFreshness() { this.refreshDerivations(this.data.state, true); },
  refreshLocalHint() {
    this.setData({ localHoldingsCount: listHoldings().length });
  },
  refresh(done) {
    this.setData({ loading: true });
    // 打开工作台时先扫当前用户 inbox/待办，再渲染；失败则回退普通读取。
    refreshSentinel()
      .catch(() => loadWorkspace())
      .then((workspace) => {
        const state = viewWorkspace(workspace);
        const patch = { state };
        if (!state.watchItems.length && this.data.activeTab === "watch") patch.showWatchForm = true;
        this.setData(patch);
        this.refreshDerivations(state);
      })
      .catch((error) => {
        wx.showModal({ title: "工作台暂不可用", content: error.message || "请稍后重试", showCancel: false });
      })
      .finally(() => {
        this.setData({ loading: false });
        if (done) done();
      });
  },
  refreshDerivations(state = this.data.state, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const events = buildResearchEvents(snapshot, state.watchItems || []);
      const feed = buildChangeFeed(state.watchItems, snapshot).map((item) => {
        const watch = (state.watchItems || []).find((row) => row.id === item.id);
        return { ...item, invalidation: watch && watch.invalidation };
      });
      const changeCenter = buildChangeCenter(feed, state.inbox || [], state.watchItems || []);
      // 「提醒我」存下来的标记原本在页面上完全看不见：日历行还是那颗「提醒我」按钮，
      // 底下也没有任何一处列出已标记的事件。这里按服务端去重用的同一组字段
      // （标题+日期+代码）对上号，标过的行改成「已标记提醒」。
      const markedKeys = new Set(
        (state.eventMarks || []).map((item) => `${item.title}|${item.dateLabel}|${item.code || ""}`),
      );
      const withMark = (rows) => (rows || []).map((row) => ({
        ...row,
        marked: markedKeys.has(`${row.title}|${row.dateLabel}|${row.code || ""}`),
      }));
      const taskBoard = buildTaskBoard(state.reviewTasks || []);
      const review = buildWeeklyReview(state.decisions, snapshot, state.watchItems);
      const dividendSummary = yearCashflow(state.dividendLots || [], state.settings || {});
      this._latestSnapshot = snapshot;
      this.setData({
        watchPreview: buildWatchPreview(state.watchItems, snapshot),
        changeFeed: feed,
        changeCount: feed.filter((item) => item.changed).length,
        changeCenter,
        taskBoard,
        calendarUpcoming: withMark(events.upcoming),
        calendarPast: withMark(events.past.slice(0, 12)),
        calendarNextCount: events.nextCount || 0,
        weeklyReview: review,
        guruChanges: buildGuruChanges(snapshot).slice(0, 9),
        dividendSummary,
        settingsForm: {
          taxRatePct: String((state.settings && state.settings.taxRatePct) != null ? state.settings.taxRatePct : 10),
          hkdCny: String((state.settings && state.settings.hkdCny) != null ? state.settings.hkdCny : 0.92),
          usdCny: String((state.settings && state.settings.usdCny) != null ? state.settings.usdCny : 7.2),
        },
        freshness: freshnessBanner(source, meta.kind),
      });
    }, null, { force });
  },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    const allowed = ["today", "watch", "review"];
    if (!allowed.includes(tab)) return;
    if (tab === "today") track("change_center_open", { from: "tab" });
    this.setData({ activeTab: tab });
  },
  openChangeItem(event) {
    const id = event.currentTarget.dataset.id;
    track("change_item_open", { id: String(id || "") });
  },
  openSnapshotCompare(event) {
    track("snapshot_compare", { id: String(event.currentTarget.dataset.id || "") });
    this.setData({ activeTab: "review" });
  },
  completeTask(event) {
    const taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    this.runMutation(
      updateReviewTask({ taskId, taskAction: "complete" }),
      "已完成",
      () => track("review_task_complete", { taskId }),
    );
  },
  snoozeTaskDay(event) {
    const taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    this.runMutation(
      updateReviewTask({ taskId, taskAction: "snooze", days: 1 }),
      "已延后一天",
      () => track("review_task_snooze", { taskId, days: 1 }),
    );
  },
  snoozeTaskWeek(event) {
    const taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    this.runMutation(
      updateReviewTask({ taskId, taskAction: "snooze", days: 7 }),
      "已延后一周",
      () => track("review_task_snooze", { taskId, days: 7 }),
    );
  },
  deleteTask(event) {
    const taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    wx.showModal({
      title: "删除待办",
      content: "删除后不再出现在待办列表。",
      confirmText: "删除",
      success: (result) => {
        if (!result.confirm) return;
        this.runMutation(
          updateReviewTask({ taskId, taskAction: "delete" }),
          "已删除",
          () => track("review_task_delete", { taskId }),
        );
      },
    });
  },
  openGate(feature) {
    const gate = memberGate(feature);
    wx.showModal({
      title: gate.title,
      content: gate.body,
      confirmText: "查看会员",
      cancelText: "先看看",
      success: (result) => {
        if (result.confirm) openPage("/pages/member/index");
      },
    });
  },
  toggleWatchForm() {
    this.setData({ showWatchForm: !this.data.showWatchForm });
  },
  toggleDecisionForm() {
    this.setData({ showDecisionForm: !this.data.showDecisionForm });
  },
  changeMarket(event) {
    this.setData({ marketIndex: Number(event.detail.value) || 0 });
  },
  changeGroup(event) {
    this.setData({ groupIndex: Number(event.detail.value) || 0 });
  },
  inputWatchName(event) {
    this.setData({ "watchForm.name": event.detail.value });
  },
  inputWatchCode(event) {
    this.setData({ "watchForm.code": event.detail.value });
  },
  inputWatchNote(event) {
    this.setData({ "watchForm.note": event.detail.value });
  },
  inputWatchThesis(event) {
    this.setData({ "watchForm.thesis": event.detail.value });
  },
  inputWatchInvalidation(event) {
    this.setData({ "watchForm.invalidation": event.detail.value });
  },
  inputWatchRisk(event) {
    this.setData({ "watchForm.riskNote": event.detail.value });
  },
  inputWatchReviewAt(event) {
    this.setData({ "watchForm.nextReviewAt": event.detail.value });
  },
  inputDecisionNextReview(event) {
    this.setData({ "decisionForm.nextReviewAt": event.detail.value });
  },
  markOneInboxRead(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.runMutation(markInboxRead({ itemId: id }), "已读", () => track("change_acknowledge", { id }));
  },
  markAllInboxRead() {
    this.runMutation(markInboxRead({ markAll: true }), "已全部标为已读", () => track("change_acknowledge", { all: true }));
  },
  inputDecisionTitle(event) {
    this.setData({ "decisionForm.title": event.detail.value });
  },
  inputDecisionNote(event) {
    this.setData({ "decisionForm.note": event.detail.value });
  },
  inputDecisionInvalidation(event) {
    this.setData({ "decisionForm.invalidation": event.detail.value });
  },
  toggleSaveEvidence(event) {
    this.setData({ saveEvidence: Boolean(event.detail.value) });
  },
  explainLocked() {
    const free = this.data.state.freeLabel;
    wx.showModal({
      title: this.data.state.writable ? "免费额度或会员" : "当前为只读模式",
      content: this.data.state.backendReady
        ? (this.data.state.verificationPending
          ? "权益状态暂时无法核验，请稍后刷新；已有记录仍可查看、导出或删除。"
          : (this.data.state.writable
            ? `${free || "仍有免费额度"}。变化雷达、事件微信提醒、打新/收息台账需开通会员。`
            : "免费额度已用完。开通会员后可继续新增，并解锁变化雷达等能力；已有记录仍可查看、导出或删除。"))
        : "记录服务暂时不可用，请稍后再试。",
      confirmText: "查看会员",
      success: (result) => {
        if (result.confirm) openPage("/pages/member/index");
      },
    });
  },
  submitWatch() {
    if (!this.data.state.writable) return this.explainLocked();
    if (this.data.saving) return;
    const market = MARKET_OPTIONS[this.data.marketIndex] || MARKET_OPTIONS[4];
    const group = GROUP_OPTIONS[this.data.groupIndex] || GROUP_OPTIONS[0];
    const threshold = this.data.thresholdOptions[this.data.thresholdIndex] || this.data.thresholdOptions[0];
    const payload = {
      ...this.data.watchForm,
      market: market.id,
      group: this.data.state.memberFeatures ? group.id : "default",
      thresholdDirection: this.data.state.memberFeatures ? threshold.id : "",
      thresholdPrice: this.data.state.memberFeatures ? this.data.watchForm.thresholdPrice : "",
      thresholdNote: "",
    };
    const snapshot = this._latestSnapshot;
    if (snapshot) payload.baselineFact = captureFact(payload, snapshot);
    this.runMutation(
      saveWatchItem(payload),
      "已加入跟踪清单",
      () => {
        track("workspace_save", { kind: "watch", free: !this.data.state.active });
        this.setData({
          watchForm: { name: "", code: "", note: "", thesis: "", invalidation: "", riskNote: "", nextReviewAt: "", thresholdPrice: "" },
          showWatchForm: false,
          activeTab: "today",
        });
      },
    );
  },
  submitDecision() {
    if (!this.data.state.writable) return this.explainLocked();
    if (this.data.saving) return;
    if (this.data.saveEvidence && !this.data.state.memberFeatures) {
      // 免费也可留证；不强制会员
    }
    const market = MARKET_OPTIONS[this.data.marketIndex] || MARKET_OPTIONS[4];
    const form = {
      ...this.data.decisionForm,
      market: market.id,
      name: this.data.watchForm.name || this.data.decisionForm.title,
      code: this.data.watchForm.code || "",
    };
    const payload = { ...form };
    if (this.data.saveEvidence) {
      payload.evidence = captureDecisionEvidence(form, this._latestSnapshot);
    }
    this.runMutation(
      saveDecision(payload),
      "决策档案已保存",
      () => {
        track("workspace_save", { kind: "decision", evidence: this.data.saveEvidence });
        this.setData({
          decisionForm: { title: "", note: "", invalidation: "", nextReviewAt: "" },
          showDecisionForm: false,
          activeTab: "review",
        });
      },
    );
  },
  markEvent(event) {
    if (!this.data.state.memberFeatures) return this.openGate("remind");
    const id = event.currentTarget.dataset.id;
    const row = (this.data.calendarUpcoming || []).concat(this.data.calendarPast || [])
      .find((item) => item.id === id);
    if (!row) return;
    const templateId = this.data.state.subscribe && this.data.state.subscribe.eventTemplateId;
    const persist = (notifyAccepted) => {
      track("subscription_reminder_request", { kind: row.kind });
      if (notifyAccepted) track("subscription_reminder_authorized", { kind: row.kind });
      else track("subscription_reminder_denied", { kind: row.kind });
      return this.runMutation(
        saveEventMark({
          title: row.title,
          detail: row.detail || "",
          dateLabel: row.dateLabel,
          kind: row.kind,
          marketLabel: row.marketLabel,
          code: row.code || "",
          source: row.source || "",
          notifyAccepted: Boolean(notifyAccepted),
        }),
        notifyAccepted ? "已标记；微信提醒已开启" : "已加入小程序内提醒",
        () => track("workspace_event_mark", { kind: row.kind, notify: Boolean(notifyAccepted) }),
      );
    };
    if (!templateId) {
      wx.showModal({
        title: "小程序内提醒",
        content: (this.data.state.subscribe && this.data.state.subscribe.hint)
          || "事件会记在今日页的「我标记的提醒」里。配置微信订阅消息模板并完成授权后，才可开通微信提醒。",
        confirmText: "先标记",
        success: (result) => {
          if (result.confirm) persist(false);
        },
      });
      return;
    }
    requestEventSubscribe(templateId).then((result) => persist(result.ok));
  },
  deleteEventMark(event) {
    this.confirmDelete("取消这个事件标记？", () => removeEventMark(event.currentTarget.dataset.id));
  },
  ackAllChanges() {
    if (!this.data.state.memberFeatures) return this.openGate("compare");
    const changed = (this.data.changeFeed || []).filter((item) => item.changed || !item.baseline);
    if (!changed.length) {
      wx.showToast({ title: "没有待确认变化", icon: "none" });
      return;
    }
    const itemIds = changed.map((item) => item.id);
    const facts = {};
    changed.forEach((item) => {
      facts[item.id] = item.current;
    });
    this.runMutation(
      ackWatchBaselines(itemIds, facts),
      "已更新对照基线",
      () => track("change_acknowledge", { count: itemIds.length }),
    );
  },
  changeThreshold(event) {
    this.setData({ thresholdIndex: Number(event.detail.value) || 0 });
  },
  changeIpoResult(event) {
    this.setData({ ipoResultIndex: Number(event.detail.value) || 0 });
  },
  inputWatchThreshold(event) {
    this.setData({ "watchForm.thresholdPrice": event.detail.value });
  },
  toggleIpoForm() {
    this.setData({ showIpoForm: !this.data.showIpoForm });
  },
  toggleDivForm() {
    this.setData({ showDivForm: !this.data.showDivForm });
  },
  inputIpoField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`ipoForm.${field}`]: event.detail.value });
  },
  inputDivField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`divForm.${field}`]: event.detail.value });
  },
  inputSettingsField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`settingsForm.${field}`]: event.detail.value });
  },
  submitIpo() {
    if (!this.data.state.memberFeatures) return this.openGate("calendar");
    const result = this.data.ipoResultOptions[this.data.ipoResultIndex] || this.data.ipoResultOptions[0];
    this.runMutation(
      saveIpoRecord({ ...this.data.ipoForm, result: result.id }),
      "申购记录已保存",
      () => {
        this.setData({
          ipoForm: { name: "", code: "", applyDate: "", listingDate: "", lots: "", amount: "", note: "", reviewNote: "" },
          showIpoForm: false,
        });
      },
    );
  },
  deleteIpo(event) {
    this.confirmDelete("删除这条申购记录？", () => removeIpoRecord(event.currentTarget.dataset.id));
  },
  submitDividend() {
    if (!this.data.state.memberFeatures) return this.openGate("calendar");
    const market = MARKET_OPTIONS[this.data.marketIndex] || MARKET_OPTIONS[2];
    this.runMutation(
      saveDividendLot({
        ...this.data.divForm,
        market: market.id === "other" ? "a" : market.id,
        currency: market.id === "hk" ? "HKD" : (market.id === "us" ? "USD" : "CNY"),
      }),
      "收息台账已保存",
      () => {
        this.setData({
          divForm: { name: "", code: "", shares: "", expectedPerShare: "", yieldPct: "", actualTotal: "", exDate: "", payDate: "", note: "" },
          showDivForm: false,
        });
      },
    );
  },
  deleteDividend(event) {
    this.confirmDelete("删除这条收息记录？", () => removeDividendLot(event.currentTarget.dataset.id));
  },
  submitSettings() {
    if (!this.data.state.memberFeatures) return this.openGate("calendar");
    this.runMutation(
      saveSettings(this.data.settingsForm),
      "税率与汇率已保存",
      () => track("workspace_settings", {}),
    );
  },
  runMutation(task, successTitle, afterSuccess) {
    this.setData({ saving: true });
    wx.showLoading({ title: "正在同步", mask: true });
    task
      .then((workspace) => {
        const state = viewWorkspace(workspace);
        this.setData({ state });
        this.refreshDerivations(state);
        if (afterSuccess) afterSuccess();
        wx.showToast({ title: successTitle, icon: "success" });
      })
      .catch((error) => {
        wx.showModal({ title: "未能保存", content: error.message || "请稍后重试", showCancel: false });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
  },
  migrateLocalHoldings() {
    if (!this.data.state.writable) return this.explainLocked();
    if (this.data.migrating || this.data.saving) return;
    const locals = listHoldings();
    if (!locals.length) {
      wx.showToast({ title: "没有本机速记", icon: "none" });
      return;
    }
    const existing = new Set(
      (this.data.state.watchItems || []).map((item) => `${String(item.code || "").toUpperCase()}|${item.name}`),
    );
    const pending = locals.filter((item) => {
      const key = `${String(item.code || "").toUpperCase()}|${item.name}`;
      return !existing.has(key);
    });
    if (!pending.length) {
      wx.showModal({
        title: "已全部在云端",
        content: "本机速记与云端跟踪清单没有新条目。是否清空本机速记？",
        confirmText: "清空本机",
        success: (result) => {
          if (!result.confirm) return;
          locals.forEach((item) => removeHolding(item.id));
          this.refreshLocalHint();
          wx.showToast({ title: "本机已清空", icon: "none" });
        },
      });
      return;
    }
    wx.showModal({
      title: "迁移本机速记",
      content: `将把 ${pending.length} 条本机速记写入云端跟踪清单。迁移成功后可选择清空本机。`,
      confirmText: "开始迁移",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ migrating: true });
        wx.showLoading({ title: "正在迁移", mask: true });
        let chain = Promise.resolve(null);
        pending.forEach((item) => {
          const payload = {
            name: item.name,
            code: item.code || "",
            market: item.market || "other",
            group: "default",
            note: [
              item.note || "",
              hasCostQty(item) ? `本机：成本 ${item.cost || "-"} / 数量 ${item.quantity || "-"}` : "",
            ].filter(Boolean).join("；").slice(0, 500),
          };
          if (this._latestSnapshot) payload.baselineFact = captureFact(payload, this._latestSnapshot);
          chain = chain.then(() => saveWatchItem(payload));
        });
        chain
          .then((workspace) => {
            track("migrate_local", { count: pending.length });
            const state = viewWorkspace(workspace);
            this.setData({ state, activeTab: "watch" });
            this.refreshDerivations(state);
            wx.hideLoading();
            wx.showModal({
              title: "迁移完成",
              content: `已写入 ${pending.length} 条。是否清空本机速记？云端记录会保留。`,
              confirmText: "清空本机",
              cancelText: "先留着",
              success: (choice) => {
                if (choice.confirm) {
                  locals.forEach((item) => removeHolding(item.id));
                }
                this.refreshLocalHint();
              },
            });
          })
          .catch((error) => {
            wx.hideLoading();
            wx.showModal({ title: "迁移中断", content: error.message || "请稍后重试", showCancel: false });
            this.refresh();
          })
          .finally(() => this.setData({ migrating: false }));
      },
    });
  },
  deleteWatch(event) {
    this.confirmDelete("从跟踪清单删除这条记录？", () => removeWatchItem(event.currentTarget.dataset.id));
  },
  deleteDecision(event) {
    this.confirmDelete("删除这份决策档案？删除后无法恢复。", () => removeDecision(event.currentTarget.dataset.id));
  },
  confirmDelete(content, createTask) {
    if (this.data.saving) return;
    wx.showModal({
      title: "确认删除",
      content,
      confirmText: "删除",
      confirmColor: "#b64c35",
      success: (result) => {
        if (result.confirm) this.runMutation(createTask(), "已删除");
      },
    });
  },
  exportRecords() {
    wx.showModal({
      title: "复制导出",
      content: "将复制关注、想法、复盘摘要与事件标记到剪贴板。记录仅当前微信可见；可随时删除全部个人数据。",
      confirmText: "复制",
      success: (result) => {
        if (!result.confirm) return;
        const events = {
          upcoming: this.data.calendarUpcoming,
        };
        wx.setClipboardData({
          data: exportText(this.data.state, this.data.weeklyReview, events),
          success: () => {
            track("workspace_export", {});
            wx.showToast({ title: "已复制，可粘贴保存", icon: "none" });
          },
          fail: () => wx.showModal({ title: "导出失败", content: "请检查剪贴板权限后重试", showCancel: false }),
        });
      },
    });
  },
  deleteAllRecords() {
    if (this.data.saving) return;
    wx.showModal({
      title: "删除全部个人记录",
      content: "跟踪清单、决策档案与事件标记会被永久删除且无法恢复；订单和支付凭证不会删除。是否继续？",
      confirmText: "永久删除",
      confirmColor: "#b64c35",
      success: (result) => {
        if (result.confirm) this.runMutation(deleteWorkspace(), "个人记录已删除");
      },
    });
  },
  openMember() {
    openPage("/pages/member/index");
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
});

function hasCostQty(item) {
  return (item.cost != null && item.cost !== "") || (item.quantity != null && item.quantity !== "");
}
