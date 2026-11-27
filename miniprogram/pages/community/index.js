const OFFERS = require("../../config/offers");
const COMMUNITY = require("../../config/community");
const { track } = require("../../utils/analytics");
const { goHome, openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const communityService = require("../../services/community");
const communityAdmin = require("../../services/community-admin");
const { displayBeijing } = require("../../utils/community-admin");

// 交流群页只写三件事：群里聊什么、适合谁、怎么加入；不写没有发生过的活动、名额、价格或权益。
// 微信号从 config/offers.js 的 paid-group 读，下架那一项这里只显示「加入方式整理中」。
const OFFER_ID = "paid-group";

const TOPICS = [
  { key: "info", label: "公开资料", value: "交流一手信息和阅读方法" },
  { key: "tool", label: "工具使用", value: "交流望潮使用方法和反馈" },
  { key: "story", label: "自主经验", value: "分享各自的研究和使用经验" },
];

const FIT = ["想长期配置全球资产", "愿意分享真实经验", "自己做决定、自己负责"];
const UNFIT = "不适合：想找人荐股喊单、想要保证收益的人。";

Page({
  data: {
    topics: TOPICS,
    fit: FIT,
    unfit: UNFIT,
    join: null,
    priceCny: COMMUNITY.priceCny,
    termLabel: COMMUNITY.termLabel,
    canPayConfig: Boolean(COMMUNITY.checkoutEnabled && COMMUNITY.wechatQrImage),
    priceLabel: `${COMMUNITY.priceCny} 元 / ${COMMUNITY.termLabel}`,
    purchaseNote: COMMUNITY.checkoutEnabled ? "正在核对支付状态，请稍候；也可先复制微信号咨询。" : "暂未开放付款，可先了解服务与退款约定。",
    promotionNote: COMMUNITY.promotionNote,
    footerDisclaimer: FOOTER_DISCLAIMER,
    checkoutReady: false,
    paying: false,
    checking: false,
    order: null,
    verificationPending: false,
    qrReady: Boolean(COMMUNITY.wechatQrImage),
    qrImage: COMMUNITY.wechatQrImage || "",
    showQr: false,
    copiedWechatSuccess: false,
    adminAllowed: false,
  },
  onLoad(options = {}) {
    const offer = OFFERS.find((item) => item && item.id === OFFER_ID);
    const join = offer && offer.copy ? { label: offer.label || "复制微信号", disclosure: offer.disclosure || "" } : null;
    const expired = Date.now() > Date.parse(COMMUNITY.promotionEndsAt);
    this.setData({
      join,
      ...(expired
        ? { priceLabel: "本期价格已结束", purchaseNote: "后续安排确认后公布，可先咨询。", checkoutReady: false, canPayConfig: false }
        : {}),
    });
    track("community_open", { from: String(options.from || "direct") });
    if (wx.cloud) this.refreshStatus(false);
    if (wx.cloud && typeof wx.cloud.callFunction === "function") this.checkAdminAccess();
  },
  onShow() {
    if (this.hasShown && wx.cloud && !this.data.paying) this.refreshStatus(false);
    this.hasShown = true;
  },
  onUnload() { if (this.refreshTimer) clearTimeout(this.refreshTimer); },
  refreshStatus(openAfterPaid = false, attempt = 0) {
    this.setData({ checking: true });
    const req = communityService.status().then((state) => {
      const expired = Date.now() > Date.parse(COMMUNITY.promotionEndsAt);
      const rawOrder = state.order || null;
      const order = rawOrder && rawOrder.paid && !state.verificationPending && rawOrder.fulfillment
        ? { ...rawOrder, endsText: displayBeijing(rawOrder.fulfillment.endsAt) } : rawOrder;
      const checkoutReady = Boolean(!expired && COMMUNITY.checkoutEnabled && COMMUNITY.wechatQrImage && state.checkoutReady);
      const nextNote = expired
        ? "后续安排确认后公布，可先咨询。"
        : (checkoutReady ? "" : (COMMUNITY.checkoutEnabled ? "当前暂未开放付款，可先了解服务约定或添加微信咨询。" : "暂未开放付款，可先了解服务与退款约定。"));
      this.setData({ checkoutReady, order, verificationPending: Boolean(state.verificationPending), checking: false, purchaseNote: nextNote,
        ...(!order || !order.paid || state.verificationPending ? { showQr: false } : {}) });
      if (order && order.paid && !state.verificationPending && openAfterPaid) {
        this.openPaidQr();
      } else if (openAfterPaid && attempt < 5 && (!order || ["creating", "prepared", "pending"].includes(order.status) || state.verificationPending)) {
        this.refreshTimer = setTimeout(() => this.refreshStatus(true, attempt + 1), [800, 1600, 2600, 4000, 6000][attempt]);
      } else if (openAfterPaid && (!order || !order.paid)) {
        wx.showToast({ title: "支付结果待核对，请刷新订单", icon: "none" });
      }
    }).catch((error) => {
      // 开发版可能先于群支付云函数部署；旧函数没有群订单，关闭收款时不应提示订单异常。
      const notDeployed = !COMMUNITY.checkoutEnabled && error && error.code === "UNKNOWN_ACTION";
      this.setData({ checkoutReady: false, checking: false, verificationPending: !notDeployed, showQr: false });
      if (openAfterPaid) wx.showToast({ title: "暂无法核对，请刷新订单", icon: "none" });
    });
    this._statusPromise = req;
    return req;
  },
  async buy() {
    if (this.data.paying || this.data.verificationPending) return;
    if (!this.data.checkoutReady) {
      if (this.data.checking && this._statusPromise) {
        if (typeof wx.showLoading === "function") wx.showLoading({ title: "正在打开微信支付", mask: true });
        try {
          await this._statusPromise;
        } finally {
          if (typeof wx.hideLoading === "function") {
            try { wx.hideLoading(); } catch (e) {}
          }
        }
      }
      if (!this.data.checkoutReady || (this.data.order && this.data.order.paid) || this.data.verificationPending) return;
    }
    this.setData({ paying: true });
    communityService.purchase(COMMUNITY.termsVersion).then(() => this.refreshStatus(true)).catch((error) => {
      const msg = String((error && (error.errMsg || error.message)) || "");
      const cancelled = /cancel/i.test(msg);
      if (cancelled) {
        if (typeof wx.showToast === "function") wx.showToast({ title: "已取消支付", icon: "none" });
      } else if (typeof wx.showModal === "function") {
        const iosBlocked = /banned|virtual|iOS|不可用/i.test(msg);
        wx.showModal({
          title: iosBlocked ? "苹果端暂不支持直付" : "微信支付未完成",
          content: iosBlocked
            ? "受微信苹果端规范限制，钱未扣除，可点下方复制微信号由群主协助开通。"
            : "钱未扣除，请稍后重试；如已付款请点刷新订单状态或联系客服。",
          showCancel: false,
        });
      }
      this.refreshStatus(false);
    }).finally(() => this.setData({ paying: false }));
  },
  openPaidQr() {
    if (!this.data.order || !this.data.order.paid || this.data.verificationPending || !COMMUNITY.wechatQrImage) return;
    this.setData({ showQr: true });
  },
  closePaidQr() { this.setData({ showQr: false }); },
  keepPaidQrOpen() {},
  refreshOrder() { return this.refreshStatus(false); },
  checkAdminAccess() {
    return communityAdmin.access().then((result) => this.setData({ adminAllowed: Boolean(result && result.allowed === true) }))
      .catch(() => this.setData({ adminAllowed: false }));
  },
  openAdmin() {
    if (this.data.adminAllowed) openPage("/pages/community-admin/index");
  },
  copyOrderId() {
    const orderId = this.data.order && this.data.order.orderId;
    if (typeof orderId !== "string" || !/^AC[A-Z0-9]{16,30}$/.test(orderId)) return;
    wx.setClipboardData({ data: orderId,
      success: () => wx.showToast({ title: "订单号已复制", icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  copyWechat() {
    const offer = OFFERS.find((item) => item && item.id === OFFER_ID);
    if (!offer || !offer.copy) return;
    wx.setClipboardData({
      data: offer.copy,
      success: () => {
        this.setData({ copiedWechatSuccess: true });
        track("service_copy", { id: offer.id, from: "community" });
        wx.showToast({ title: offer.toast || "已复制", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  openTerms() {
    openPage("/pages/community-terms/index");
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "community" });
    return { title: "会员群｜望潮", path: "/pages/community/index" };
  },
  onShareTimeline() {
    return { title: "会员群｜望潮" };
  },
  onAddToFavorites() {
    return { title: "会员群｜望潮" };
  },
});
