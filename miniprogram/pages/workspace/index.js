const {
  deleteWorkspace,
  loadWorkspace,
  removeDecision,
  removeWatchItem,
  saveDecision,
  saveWatchItem,
} = require("../../services/member");
const { openPage } = require("../../utils/nav");

const MARKET_OPTIONS = [
  { id: "hk", label: "港股" },
  { id: "us", label: "美股" },
  { id: "a", label: "A股" },
  { id: "gold", label: "黄金" },
  { id: "other", label: "其他" },
];

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

Page({
  data: {
    loading: true,
    saving: false,
    activeTab: "watch",
    showWatchForm: false,
    showDecisionForm: false,
    marketOptions: MARKET_OPTIONS,
    marketIndex: 1,
    watchForm: { name: "", code: "", note: "" },
    decisionForm: { title: "", note: "" },
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
    const market = safeDecode(options.market);
    const marketIndex = Math.max(0, MARKET_OPTIONS.findIndex((item) => item.id === market));
    const focus = safeDecode(options.focus);
    const name = safeDecode(options.name);
    const code = safeDecode(options.code);
    // 从详情页带入名称/代码时直接展开表单；平时有记录则默认先看列表。
    const fromDetail = Boolean(name || code);
    this.setData({
      activeTab: focus === "decision" ? "decision" : "watch",
      marketIndex: marketIndex < 0 ? 1 : marketIndex,
      showWatchForm: fromDetail,
      showDecisionForm: focus === "decision",
      watchForm: {
        name,
        code,
        note: "",
      },
    });
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh());
  },
  refresh(done) {
    this.setData({ loading: true });
    loadWorkspace()
      .then((workspace) => {
        const state = viewWorkspace(workspace);
        const patch = { state };
        // 空列表时表单必须可见，否则用户找不到录入入口。
        if (!state.watchItems.length) patch.showWatchForm = true;
        if (!state.decisions.length) patch.showDecisionForm = true;
        this.setData(patch);
      })
      .catch((error) => {
        wx.showModal({ title: "工作台暂不可用", content: error.message || "请稍后重试", showCancel: false });
      })
      .finally(() => {
        this.setData({ loading: false });
        if (done) done();
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
      () => this.setData({ watchForm: { name: "", code: "", note: "" }, showWatchForm: false }),
    );
  },
  submitDecision() {
    if (!this.data.state.writable) return this.explainLocked();
    if (this.data.saving) return;
    this.runMutation(
      saveDecision(this.data.decisionForm),
      "决策档案已保存",
      () => this.setData({ decisionForm: { title: "", note: "" }, showDecisionForm: false }),
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
    wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) });
  },
  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
