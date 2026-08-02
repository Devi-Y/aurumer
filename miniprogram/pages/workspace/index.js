const {
  deleteWorkspace,
  loadWorkspace,
  removeDecision,
  removeWatchItem,
  saveDecision,
  saveWatchItem,
} = require("../../services/member");
const { openPage, goHome, consumeTabQuery } = require("../../utils/nav");
const { listHoldings, removeHolding } = require("../../utils/local-holdings");
const { track } = require("../../utils/analytics");
const { loadSnapshot } = require("../../data/store");
const { allItems, shortCompanyName } = require("../../utils/answers");
const { WORKSPACE_DISCLAIMER } = require("../../utils/disclaimer");

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

function viewWorkspace(workspace) {
  const backendReady = Boolean(workspace.backendReady);
  const active = Boolean(workspace.active);
  const writable = Boolean(workspace.writable);
  const verificationPending = Boolean(workspace.verificationPending);
  return {
    ...workspace,
    backendReady,
    active,
    writable,
    verificationPending,
    statusTitle: !backendReady
      ? "记录服务暂不可用"
      : (verificationPending ? "权益核验中（只读）" : (active ? "研究权益有效" : "个人记录只读")),
    statusDetail: !backendReady
      ? "当前仍可浏览公开资料，请稍后再试。"
      : (verificationPending
        ? (workspace.verificationMessage || "权益状态暂时无法核验，当前保留只读与导出。")
        : (active ? "可以新增、删除、同步和导出自己的记录。" : "开通权益后可新增；已有记录仍可查看、导出和删除。")),
    watchItems: (workspace.watchItems || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.updatedAt || item.createdAt),
    })),
    decisions: (workspace.decisions || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.updatedAt || item.createdAt),
    })),
  };
}

function exportText(state) {
  const lines = [
    "望潮研究工作台导出",
    `导出时间：${formatDate(new Date())}`,
    "",
    `一、跟踪清单（${state.watchItems.length}）`,
  ];
  if (!state.watchItems.length) lines.push("暂无记录");
  state.watchItems.forEach((item, index) => {
    const identity = item.code ? `${item.name}（${item.code}）` : item.name;
    lines.push(`${index + 1}. [${item.marketLabel || "其他"}] ${identity}`);
    if (item.note) lines.push(`   备注：${item.note}`);
    if (item.dateLabel) lines.push(`   时间：${item.dateLabel}`);
  });
  lines.push("", `二、决策档案（${state.decisions.length}）`);
  if (!state.decisions.length) lines.push("暂无记录");
  state.decisions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   ${item.note}`);
    if (item.dateLabel) lines.push(`   时间：${item.dateLabel}`);
  });
  lines.push("", "说明：以上是用户自行记录的研究材料，不构成投资建议或收益承诺。");
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
  if (focus === "decision" || focus === "watch") patch.activeTab = focus === "decision" ? "decision" : "watch";
  if (addon === "calendar" || addon === "ipo-check") patch.addonHint = "打新备忘：关注后可在备注里写截止日，自行查看；系统不推送提醒。";
  else if (addon === "ipo-review") patch.addonHint = "用「想法」记下这次申购判断，上市后再对照结果。";
  else if (addon === "gold-alert") patch.addonHint = "黄金观察：可关注「国际金价」，对照公开买卖观察区；不做到价推送。";
  else if (addon === "dividend") patch.addonHint = "收息常问：关注后可对照股息率与现金流公开资料。";
  else if (addon === "preview") patch.addonHint = "会员速览：关注标的对照最新公开数据。";
  else if (addon === "export") patch.addonHint = "可在页面底部一键复制导出全部记录。";
  else if (addon === "review") patch.addonHint = "切换到「想法」记录复盘。";
  else if (addon === "sync") patch.addonHint = "关注与想法已云端同步，换机登录同一微信即可继续。";
  if (marketIndex >= 0 && market) patch.marketIndex = marketIndex;
  if (fromDetail) {
    patch.showWatchForm = true;
    patch.activeTab = "watch";
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
    activeTab: "watch",
    showWatchForm: false,
    showDecisionForm: false,
    localHoldingsCount: 0,
    marketOptions: MARKET_OPTIONS,
    marketIndex: 1,
    watchForm: { name: "", code: "", note: "" },
    decisionForm: { title: "", note: "" },
    watchPreview: [],
    addonHint: "",
    disclaimer: WORKSPACE_DISCLAIMER,
    state: viewWorkspace({
      backendReady: false,
      active: false,
      writable: false,
      watchItems: [],
      decisions: [],
      limits: { watchItems: 50, decisions: 100 },
    }),
  },
  onLoad(options = {}) {
    track("workspace_open", { from: "direct" });
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
  refreshLocalHint() {
    this.setData({ localHoldingsCount: listHoldings().length });
  },
  refresh(done) {
    this.setData({ loading: true });
    loadWorkspace()
      .then((workspace) => {
        const state = viewWorkspace(workspace);
        const patch = { state };
        if (!state.watchItems.length) patch.showWatchForm = true;
        if (!state.decisions.length) patch.showDecisionForm = true;
        this.setData(patch);
        this.refreshPreview(state);
      })
      .catch((error) => {
        wx.showModal({ title: "工作台暂不可用", content: error.message || "请稍后重试", showCancel: false });
      })
      .finally(() => {
        this.setData({ loading: false });
        if (done) done();
      });
  },
  refreshPreview(state = this.data.state) {
    if (!state || !state.active || !state.watchItems.length) {
      this.setData({ watchPreview: [] });
      return;
    }
    loadSnapshot((snapshot) => {
      this.setData({ watchPreview: buildWatchPreview(state.watchItems, snapshot) });
    });
  },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab !== "watch" && tab !== "decision") return;
    this.setData({ activeTab: tab });
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
  inputWatchName(event) {
    this.setData({ "watchForm.name": event.detail.value });
  },
  inputWatchCode(event) {
    this.setData({ "watchForm.code": event.detail.value });
  },
  inputWatchNote(event) {
    this.setData({ "watchForm.note": event.detail.value });
  },
  inputDecisionTitle(event) {
    this.setData({ "decisionForm.title": event.detail.value });
  },
  inputDecisionNote(event) {
    this.setData({ "decisionForm.note": event.detail.value });
  },
  explainLocked() {
    wx.showModal({
      title: "当前为只读模式",
      content: this.data.state.backendReady
        ? (this.data.state.verificationPending
          ? "权益状态暂时无法核验，请稍后刷新；已有记录仍可查看、导出或删除。"
          : "开通有效研究权益后可以新增记录；已有记录不会因到期而无法查看、导出或删除。")
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
    this.runMutation(
      saveWatchItem({ ...this.data.watchForm, market: market.id }),
      "已加入跟踪清单",
      () => {
        track("workspace_save", { kind: "watch" });
        this.setData({ watchForm: { name: "", code: "", note: "" }, showWatchForm: false });
      },
    );
  },
  submitDecision() {
    if (!this.data.state.writable) return this.explainLocked();
    if (this.data.saving) return;
    this.runMutation(
      saveDecision(this.data.decisionForm),
      "决策档案已保存",
      () => {
        track("workspace_save", { kind: "decision" });
        this.setData({ decisionForm: { title: "", note: "" }, showDecisionForm: false });
      },
    );
  },
  runMutation(task, successTitle, afterSuccess) {
    this.setData({ saving: true });
    wx.showLoading({ title: "正在同步", mask: true });
    task
      .then((workspace) => {
        this.setData({ state: viewWorkspace(workspace) });
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
      content: `将把 ${pending.length} 条本机速记写入云端跟踪清单（不同步到其他设备以外的账号）。迁移成功后可选择清空本机。`,
      confirmText: "开始迁移",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ migrating: true });
        wx.showLoading({ title: "正在迁移", mask: true });
        let chain = Promise.resolve(null);
        pending.forEach((item) => {
          chain = chain.then(() => saveWatchItem({
            name: item.name,
            code: item.code || "",
            market: item.market || "other",
            note: [
              item.note || "",
              hasCostQty(item) ? `本机：成本 ${item.cost || "-"} / 数量 ${item.quantity || "-"}` : "",
            ].filter(Boolean).join("；").slice(0, 500),
          }));
        });
        chain
          .then((workspace) => {
            track("migrate_local", { count: pending.length });
            this.setData({ state: viewWorkspace(workspace), activeTab: "watch" });
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
    wx.setClipboardData({
      data: exportText(this.data.state),
      success: () => wx.showToast({ title: "已复制，可粘贴保存", icon: "none" }),
      fail: () => wx.showModal({ title: "导出失败", content: "请检查剪贴板权限后重试", showCancel: false }),
    });
  },
  deleteAllRecords() {
    if (this.data.saving) return;
    wx.showModal({
      title: "删除全部个人记录",
      content: "跟踪清单与决策档案会被永久删除且无法恢复；订单和支付凭证不会删除。是否继续？",
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
