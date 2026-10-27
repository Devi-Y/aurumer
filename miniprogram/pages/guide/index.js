const GUIDES = require("../../config/guides");
const OFFERS = require("../../config/offers");
const VERIFICATION = require("../../config/service-verification");
const { OFFICIAL_SOURCES } = require("../../utils/sources");
const { track } = require("../../utils/analytics");
const { goHome, openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");

function buildSections(guide) {
  return (guide.sections || []).map((section, index) => ({
    key: `s${index}`,
    title: section.title,
    rows: (section.rows || []).map(([label, value], row) => ({ key: `r${row}`, label, value })),
    points: (section.points || []).map((text, point) => ({ key: `p${point}`, text })),
    links: (section.links || [])
      .map((id) => (OFFICIAL_SOURCES[id] && OFFICIAL_SOURCES[id].url ? { id, name: OFFICIAL_SOURCES[id].name, url: OFFICIAL_SOURCES[id].url } : null))
      .filter(Boolean),
  }));
}

// pending 的物料借用另一项里真实存在的微信号；那一项下架（没有 copy）就返回 null。
function pendingContact(offer) {
  if (!offer || !offer.pendingContact) return null;
  const contact = OFFERS.find((item) => item && item.id === offer.pendingContact);
  return contact && contact.copy ? contact : null;
}

// 末尾那张卡：有真实物料就给复制按钮（或二维码按钮）并写明推广关系；还在等物料（pending）就写一句
// 现状，再给一个复制真实微信号的按钮承接用户意向（微信号只从 config/offers.js 取），不让这一步走到死胡同；
// 物料被下架了整张卡不出。
function buildOffer(guide) {
  if (!guide.offer) return null;
  const offer = OFFERS.find((item) => item && item.id === guide.offer.id);
  if (!offer) return null;
  const base = { id: offer.id, head: guide.offer.head, body: guide.offer.body };
  if (!canUseOffer(offer)) return { ...base, mode: "unavailable", head: "暂未开放", body: "", note: "渠道核验完成后开放办理。" };
  if (offer.copy) {
    return { ...base, mode: "copy", label: offer.label || "复制", disclosure: offer.disclosure || "" };
  }
  if (offer.image) {
    return { ...base, mode: "image", label: offer.label || "打开二维码", disclosure: offer.disclosure || "" };
  }
  if (offer.pending) {
    const contact = pendingContact(offer);
    return {
      ...base,
      mode: "pending",
      note: offer.pendingNote || "还在准备中。",
      canCopy: Boolean(contact),
      label: offer.pendingLabel || "复制微信号",
      disclosure: contact ? offer.pendingDisclosure || "" : "",
    };
  }
  return null;
}

function canUseOffer(offer) {
  if (!offer) return false;
  const record = VERIFICATION[offer.id];
  return Boolean(record && record.status === "verified" && record.provider && record.qualification && record.authorization);
}

Page({
  data: {
    topic: "",
    title: "",
    lead: "",
    sections: [],
    choices: [],
    offer: null,
    sharePath: "",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad(options = {}) {
    const topic = GUIDES[options.topic] ? options.topic : "info";
    const guide = GUIDES[topic];
    wx.setNavigationBarTitle({ title: guide.title });
    this.setData({
      topic,
      title: guide.title,
      lead: guide.lead || "",
      sections: buildSections(guide),
      choices: (guide.choices || []).filter((item) => GUIDES[item.topic]),
      offer: buildOffer(guide),
      sharePath: `/pages/guide/index?topic=${topic}`,
    });
    track("guide_open", { topic, from: String(options.from || "direct") });
  },
  copyLink(event) {
    const url = String(event.currentTarget.dataset.url || "");
    if (!url) return;
    track("guide_link_copy", { topic: this.data.topic, id: String(event.currentTarget.dataset.id || "") });
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "已复制，去浏览器打开", icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  openChoice(event) {
    const choice = this.data.choices.find((item) => item.topic === event.currentTarget.dataset.topic);
    if (choice) openPage(`/pages/guide/index?topic=${choice.topic}`);
  },
  copyOffer() {
    const offer = this.data.offer;
    const source = offer && OFFERS.find((item) => item && item.id === offer.id);
    if (!canUseOffer(source) || !source.copy) return;
    wx.setClipboardData({
      data: source.copy,
      success: () => {
        track("service_copy", { id: source.id, from: `guide_${this.data.topic}` });
        wx.showToast({ title: source.toast || "已复制", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  // 开户链接还没到：复制 pendingContact 指向的真实微信号，用户加好友后发「我想开户」。
  copyPendingContact() {
    const offer = this.data.offer;
    const source = offer && OFFERS.find((item) => item && item.id === offer.id);
    const contact = pendingContact(source);
    if (!canUseOffer(source) || !contact) return;
    wx.setClipboardData({
      data: contact.copy,
      success: () => {
        track("service_copy", { id: source.id, via: contact.id, from: `guide_${this.data.topic}` });
        wx.showToast({ title: source.pendingToast || "已复制", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  // 二维码物料：全屏打开原图，用户长按识别。图片就放在包里，不依赖网络。
  previewOffer() {
    const offer = this.data.offer;
    const source = offer && OFFERS.find((item) => item && item.id === offer.id);
    if (!canUseOffer(source) || !source.image) return;
    wx.previewImage({
      urls: [source.image],
      current: source.image,
      success: () => track("offer_qr_open", { id: source.id, from: `guide_${this.data.topic}` }),
      fail: () => wx.showToast({ title: "打开失败，请重试", icon: "none" }),
    });
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "guide", topic: this.data.topic });
    return { title: `${this.data.title}｜望潮`, path: this.data.sharePath };
  },
  onShareTimeline() {
    return { title: `${this.data.title}｜望潮`, query: `topic=${this.data.topic}` };
  },
  onAddToFavorites() {
    return { title: `${this.data.title}｜望潮`, query: `topic=${this.data.topic}` };
  },
});
