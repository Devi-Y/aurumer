const { loadMemberState, loadWorkspace, purchase, queryOrder } = require("../../services/member");
const { buildTaskBoard } = require("../../utils/change-center");
const { openPage, goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { MEMBER_DISCLAIMER } = require("../../utils/disclaimer");
const legalInfo = require("../../config/legal");

const ANNUAL_PLAN = {
  id: "research-365d",
  name: "望潮年费会员",
  term: "一次购买，使用 365 天，不自动续费",
  priceLabel: "¥1,288 / 年",
  priceMain: "¥1,288",
  priceUnit: "/ 年",
};

const PAYMENT_REFRESH_DELAYS = [800, 1600, 2600, 4000, 6000];

// 三个快捷入口原来只有「写／理由」这种两行拆词，既不成词也不告诉会员里面
// 现在有什么。第二行改成真实计数，数字全部来自 workspace 已有字段，取不到
// 就直说取不到，不写占位数字。
const SHORTCUT_TABS = [
  { tab: "watch", title: "写理由" },
  { tab: "today", title: "盯变化" },
  { tab: "review", title: "看复盘" },
];

function shortcutsOf(workspace) {
  if (!workspace) {
    return SHORTCUT_TABS.map((item) => ({ ...item, help: "读取中" }));
  }
  const brief = workspace.todayBrief || {};
  const board = buildTaskBoard(workspace.reviewTasks || []);
  const watchCount = (workspace.watchItems || []).length;
  const decisionCount = (workspace.decisions || []).length;
  const changes = Number(brief.factChangeCount || 0) + Number(brief.thesisCount || 0);
  // 每一行数的必须是点进去那一屏能看到的东西。待办（reviewTasks）在「今日」里，
  // 原来却挂在「看复盘」下面——写着待办 3 项，点开的复盘页一条待办也没有。
  const helps = {
    watch: watchCount ? `已关注 ${watchCount} 只` : "还没有关注",
    today: changes
      ? `${changes} 项新变化`
      : (board.openCount ? `待办 ${board.openCount} 项` : "今天没有新变化"),
    review: decisionCount ? `已记 ${decisionCount} 条想法` : "还没有想法记录",
  };
  return SHORTCUT_TABS.map((item) => ({ ...item, help: helps[item.tab] }));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function viewState(state) {
  const entitlement = state.entitlement;
  const active = Boolean(entitlement && entitlement.active);
  const legalVersions = state.legalVersions || {};
  const serverLegalReady = Boolean(
    legalVersions.termsVersion === legalInfo.termsVersion
    && legalVersions.privacyVersion === legalInfo.privacyVersion,
  );
  const operatorReady = state.environment !== "production" || legalInfo.operatorReady;
  const purchaseAllowed = Boolean(state.paymentReady && serverLegalReady && operatorReady);
  return {
    ...state,
    active,
    operatorReady,
    purchaseAllowed,
    serverLegalReady,
    statusDetail: active
      ? `有效期至 ${formatDate(entitlement.expiresAt)}`
      : "",
    paymentPubliclyReleased: Boolean(state.paymentPubliclyReleased),
    plans: (state.plans || [])
      .filter((plan) => plan.id === ANNUAL_PLAN.id)
      .map((plan) => ({
        ...plan,
        ...ANNUAL_PLAN,
        recommended: true,
        buttonText: purchaseAllowed && plan.enabled
          ? (active ? "微信支付续费 1288 元" : "微信支付 1288 元开通")
          : "支付通道准备中",
      })),
    orders: (state.orders || []).map((order) => {
      // 「prepared」是下了单没付款，对已开通的人来说就是一笔被放弃的旧单，
      // 不该在它下面挂一个「刷新这笔权益」。真正在途的只有下面这三种。
      const inFlight = ["pending", "creating", "fulfillment_review"].includes(order.status);
      return {
        ...order,
        inFlight,
        createdLabel: formatDate(order.createdAt),
        paidLabel: formatDate(order.paidAt),
        expiresLabel: formatDate(order.entitlementExpiresAt),
        canQuery: inFlight || (!active && Boolean(order.orderId)),
      };
    }),
  };
}

Page({
  data: {
    loading: true,
    paying: false,
    settling: false,
    querying: false,
    legalInfo,
    disclaimer: MEMBER_DISCLAIMER,
    lastOrderId: "",
    shortcuts: shortcutsOf(null),
    state: viewState({
      paymentReady: false,
      paymentReason: "正在检查会员服务",
      plans: [],
      orders: [],
      entitlement: null,
    }),
  },
  onLoad() {
    track("member_value_view", { from: "member" });
    this.refresh();
  },
  onShow() {
    if (!this.data.loading && !this.data.paying) this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh());
  },
  onUnload() {
    if (this.paymentRefreshTimer) clearTimeout(this.paymentRefreshTimer);
  },
  refresh(done) {
    this.setData({ loading: true });
    loadMemberState()
      .then((state) => {
        const next = viewState(state);
        this.setData({ state: next });
        // 已开通才去读记录区计数；没开通时那三个入口本来就不渲染。
        if (!next.active) return null;
        return loadWorkspace()
          .then((workspace) => this.setData({ shortcuts: shortcutsOf(workspace) }))
          .catch(() => this.setData({
            shortcuts: SHORTCUT_TABS.map((item) => ({ ...item, help: "计数暂不可用" })),
          }));
      })
      .finally(() => {
        this.setData({ loading: false });
        if (done) done();
      });
  },
  buy(event) {
    if (this.data.paying || this.data.settling) return;
    if (!this.data.state.purchaseAllowed) {
      wx.showModal({
        title: "支付通道准备中",
        content: "当前还不能发起付款，请稍后再试或联系微信客服。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }
    const planId = event.currentTarget.dataset.plan;
    const plan = this.data.state.plans.find((item) => item.id === planId);
    if (!plan || !plan.enabled) return;
    track("pay_click", { plan: String(planId) });
    this.setData({ paying: true });
    purchase(planId, {
      accepted: true,
      adultConfirmed: true,
      termsVersion: legalInfo.termsVersion,
      privacyVersion: legalInfo.privacyVersion,
    })
      .then((result) => {
        track("pay_ok");
        this.setData({
          paying: false,
          settling: true,
          lastOrderId: (result && result.orderId) || "",
        });
        wx.showToast({ title: "支付成功", icon: "success" });
        this.refreshAfterPayment(0);
      })
      .catch((error) => {
        if (error.code === "PAYMENT_CANCELLED") {
          track("pay_cancel");
          wx.showToast({ title: "已取消支付", icon: "none" });
          return;
        }
        wx.showModal({
          title: "暂未完成",
          content: "没有完成付款，也不会开通会员。请稍后重试或联系微信客服。",
          showCancel: false,
        });
      })
      .finally(() => {
        if (!this.data.settling) this.setData({ paying: false });
      });
  },
  refreshAfterPayment(attempt) {
    if (!this.data.settling) return;
    loadMemberState().then((state) => {
      const nextState = viewState(state);
      this.setData({ state: nextState });
      if (nextState.active) {
        this.setData({ settling: false });
        wx.showToast({ title: "会员已开通", icon: "success" });
        return;
      }
      const delay = PAYMENT_REFRESH_DELAYS[attempt];
      if (delay == null) {
        wx.showToast({ title: "可点“刷新权益”", icon: "none" });
        return;
      }
      this.paymentRefreshTimer = setTimeout(() => this.refreshAfterPayment(attempt + 1), delay);
    });
  },
  manualQuery(event) {
    if (this.data.querying) return;
    const orderId = String(event.currentTarget.dataset.order || this.data.lastOrderId || "");
    if (!orderId) {
      this.refresh();
      wx.showToast({ title: "正在刷新会员状态", icon: "none" });
      return;
    }
    this.setData({ querying: true });
    queryOrder(orderId)
      .then((result) => {
        wx.showToast({
          title: result && result.fulfilled ? "会员已开通" : ((result && result.statusLabel) || "仍在核对"),
          icon: result && result.fulfilled ? "success" : "none",
        });
        return loadMemberState();
      })
      .then((state) => {
        if (state) this.setData({ state: viewState(state), settling: false });
      })
      .catch((error) => wx.showModal({
        title: "查单暂不可用",
        content: error.message || "请稍后重试或联系微信客服",
        showCancel: false,
      }))
      .finally(() => this.setData({ querying: false }));
  },
  openWorkspace(event) {
    const tab = (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.tab) || "";
    openPage(`/pages/workspace/index${tab ? `?focus=${encodeURIComponent(tab)}` : ""}`);
  },
  openLegal() {
    wx.navigateTo({
      url: "/pages/legal/index",
      fail: () => wx.redirectTo({ url: "/pages/legal/index" }),
    });
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "member" });
    return { title: "望潮年费会员｜365 天，不自动续费", path: "/pages/member/index" };
  },
});
