const OFFERS = require("../../config/offers");
const { track } = require("../../utils/analytics");
const { goHome } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");

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
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad(options = {}) {
    const offer = OFFERS.find((item) => item && item.id === OFFER_ID);
    const join = offer && offer.copy ? { label: offer.label || "复制微信号", disclosure: offer.disclosure || "" } : null;
    this.setData({ join });
    track("community_open", { from: String(options.from || "direct") });
  },
  copyWechat() {
    const offer = OFFERS.find((item) => item && item.id === OFFER_ID);
    if (!offer || !offer.copy) return;
    track("service_copy", { id: offer.id, from: "community" });
    wx.setClipboardData({
      data: offer.copy,
      success: () => wx.showToast({ title: offer.toast || "已复制", icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
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
