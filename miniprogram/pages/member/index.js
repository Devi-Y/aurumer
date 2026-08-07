const { loadMemberState, purchase, queryOrder } = require("../../services/member");
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

/** 会员只回答三问：买后得到什么、每天怎么用、为什么免费版替代不了。 */
const MEMBER_FAQ = [
  {
    id: "get",
    title: "买后得到什么",
    body: "写理由 → 盯变化 → 复盘。含今日简报、站内收件箱、决策快照与节点提醒。不含买卖建议。",
  },
  {
    id: "daily",
    title: "每天怎么用",
    body: "打开「今日」看我的变化与待办；无变化就确认今天没事。",
  },
  {
    id: "why",
    title: "为什么免费版不够",
    body: "公开答案仍免费。会员买的是个人跟踪与复盘工具：免费 5+5，会员 80+300、跨设备同步与历史保全。",
  },
];

const COMPARE_BARS = [
  { id: "watch", label: "关注条数", free: 5, member: 80, freePct: 6, memberPct: 100 },
  { id: "idea", label: "想法条数", free: 5, member: 300, freePct: 2, memberPct: 100 },
  { id: "days", label: "有效天数", free: 0, member: 365, freePct: 0, memberPct: 100 },
];

const CORE_BENEFITS = [
  {
    id: "change",
    title: "重要变化",
    body: "只提醒结论变化、结论跨档、风险新增与失效条件，不打扰普通价格波动。",
  },
  {
    id: "snapshot",
    title: "决策快照",
    body: "保存当时的价格、结论、依据和风险，方便事后对照。",
  },
  {
    id: "task",
    title: "节点提醒",
    body: "管理财报、分红、招股、上市和复盘日期（小程序内提醒）。",
  },
];

const EXTRA_BENEFITS = [];

const PAYMENT_REFRESH_DELAYS = [800, 1600, 2600, 4000, 6000];

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
    statusTitle: active
      ? "会员已开通"
      : (purchaseAllowed ? "微信支付可用" : "支付通道准备中"),
    statusDetail: active
      ? `有效期至 ${formatDate(entitlement.expiresAt)} · 持续跟踪你的关注对象`
      : (purchaseAllowed
        ? "付款成功并核对订单后，会员会自动生效。公开答案仍免费。"
        : "暂时不能付款，请稍后再试或联系微信客服。"),
    heroTitle: "持续跟踪你的关注对象",
    coreBenefits: CORE_BENEFITS,
    extraBenefits: EXTRA_BENEFITS,
    sellGate: state.sellGate
      ? {
        ...state.sellGate,
        humanPendingLabel: (state.sellGate.humanPending || []).join("、"),
      }
      : null,
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
    orders: (state.orders || []).map((order) => ({
      ...order,
      createdLabel: formatDate(order.createdAt),
      paidLabel: formatDate(order.paidAt),
      expiresLabel: formatDate(order.entitlementExpiresAt),
      canQuery: ["prepared", "pending", "creating", "fulfillment_review"].includes(order.status)
        || (!active && Boolean(order.orderId)),
    })),
  };
}

Page({
  data: {
    loading: true,
    paying: false,
    settling: false,
    querying: false,
    showOrders: false,
    showNotice: false,
    legalInfo,
    disclaimer: MEMBER_DISCLAIMER,
    lastOrderId: "",
    faq: MEMBER_FAQ,
    compareBars: COMPARE_BARS,
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
      .then((state) => this.setData({ state: viewState(state) }))
      .finally(() => {
        this.setData({ loading: false });
        if (done) done();
      });
  },
  buy(event) {
    if (this.data.paying) return;
    if (!this.data.state.purchaseAllowed) {
      wx.showModal({
        title: "支付通道准备中",
        content: "当前还不能发起付款。你可以稍后再试，或联系微信客服。",
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
          showOrders: true,
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
        this.setData({ settling: false, showOrders: true });
        wx.showToast({ title: "可点「刷新权益」", icon: "none" });
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
        if (result && result.fulfilled) {
          wx.showToast({ title: "会员已开通", icon: "success" });
        } else {
          wx.showToast({
            title: (result && result.statusLabel) || "仍在核对",
            icon: "none",
          });
        }
        return loadMemberState();
      })
      .then((state) => {
        if (state) this.setData({ state: viewState(state), settling: false });
      })
      .catch((error) => {
        wx.showModal({
          title: "查单暂不可用",
          content: error.message || "请稍后重试或联系微信客服",
          showCancel: false,
        });
      })
      .finally(() => this.setData({ querying: false }));
  },
  openWorkspace() {
    openPage("/pages/workspace/index");
  },
  openLegal() {
    wx.navigateTo({
      url: "/pages/legal/index",
      fail: () => wx.redirectTo({ url: "/pages/legal/index" }),
    });
  },
  copyOrder(event) {
    const orderId = String(event.currentTarget.dataset.order || "");
    if (!orderId) return;
    wx.setClipboardData({ data: orderId });
  },
  toggleOrders() {
    this.setData({ showOrders: !this.data.showOrders });
  },
  toggleNotice() {
    this.setData({ showNotice: !this.data.showNotice });
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
