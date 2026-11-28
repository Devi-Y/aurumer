const GUIDES = require("../../config/guides");
const OFFERS = require("../../config/offers");
const { OFFICIAL_SOURCES } = require("../../utils/sources");
const { track } = require("../../utils/analytics");
const { goHome, openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");

const GUIDE_PILLS = {
  accounts: ["① 备齐证件与境外卡", "② 复制机构网址", "③ 浏览器自主核验"],
  "hk-open": ["① 备齐证件与香港卡", "② 复制机构网址", "③ 浏览器自主核验"],
  "us-start": ["① 备齐证件与境外卡", "② 复制机构网址", "③ 浏览器自主核验"],
  info: ["① 复制下方网址", "② 手机浏览器打开", "③ 合规查阅公开财报"],
};

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

function pendingContact(offer) {
  if (!offer || !offer.pendingContact) return null;
  const contact = OFFERS.find((item) => item && item.id === offer.pendingContact);
  return contact && contact.copy ? contact : null;
}

function buildChoices(guide) {
  return (guide.choices || [])
    .filter((item) => GUIDES[item.topic])
    .map((item) => {
      const target = GUIDES[item.topic];
      const offerCfg = target && target.offer ? OFFERS.find((entry) => entry && entry.id === target.offer.id) : null;
      return {
        topic: item.topic,
        title: item.title,
        broker: target && target.offer ? target.offer.head : item.title,
        way: target && target.offer ? target.offer.body : "指引：复制机构网址 → 手机浏览器自主核验",
        offerId: offerCfg && offerCfg.copy ? offerCfg.id : "",
        actionLabel: (offerCfg && offerCfg.label) || `复制${item.title}网址`,
        disclosure: (offerCfg && offerCfg.disclosure) || "",
      };
    });
}

function buildOffer(guide) {
  if (!guide.offer) return null;
  const offer = OFFERS.find((item) => item && item.id === guide.offer.id);
  if (!offer) return null;
  const base = { id: offer.id, badge: guide.title || "", head: guide.offer.head, body: guide.offer.body };
  if (offer.copy) {
    return { ...base, mode: "copy", label: offer.label || "复制渠道网址", disclosure: offer.disclosure || "" };
  }
  if (offer.image) {
    return { ...base, mode: "image", image: offer.image, disclosure: offer.disclosure || "" };
  }
  if (offer.pending) {
    const contact = pendingContact(offer);
    return {
      ...base,
      mode: "pending",
      note: offer.pendingNote || "整理中。",
      canCopy: Boolean(contact),
      label: offer.pendingLabel || "复制微信号",
      disclosure: contact ? offer.pendingDisclosure || "" : "",
    };
  }
  return null;
}

Page({
  data: {
    topic: "",
    title: "",
    lead: "",
    guidePills: [],
    sections: [],
    choices: [],
    offer: null,
    offerImageError: false,
    copiedSuccess: false,
    copiedChoiceId: "",
    sharePath: "",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad(options = {}) {
    const topic = GUIDES[options.topic] ? options.topic : "info";
    const guide = GUIDES[topic];
    const offer = buildOffer(guide);
    wx.setNavigationBarTitle({ title: guide.title });
    this.setData({
      topic,
      title: guide.title,
      lead: guide.lead || "",
      guidePills: GUIDE_PILLS[topic] || [],
      sections: buildSections(guide),
      choices: buildChoices(guide),
      offer,
      copiedSuccess: false,
      copiedChoiceId: "",
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
  copyChoiceOffer(event) {
    const offerId = String(event.currentTarget.dataset.offerId || "");
    const source = offerId && OFFERS.find((item) => item && item.id === offerId);
    if (!source || !source.copy) {
      this.openChoice(event);
      return;
    }
    wx.setClipboardData({
      data: source.copy,
      success: () => {
        this.setData({ copiedChoiceId: source.id, copiedSuccess: true });
        track("service_copy", { id: source.id, from: `guide_${this.data.topic}` });
        wx.showToast({ title: source.toast || "已复制，去浏览器查看", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  copyOffer() {
    const offer = this.data.offer;
    const source = offer && OFFERS.find((item) => item && item.id === offer.id);
    if (!source || !source.copy) return;
    wx.setClipboardData({
      data: source.copy,
      success: () => {
        this.setData({ copiedSuccess: true });
        track("service_copy", { id: source.id, from: `guide_${this.data.topic}` });
        wx.showToast({ title: source.toast || "已复制，去浏览器查看", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  copyPendingContact() {
    const offer = this.data.offer;
    const source = offer && OFFERS.find((item) => item && item.id === offer.id);
    const contact = pendingContact(source);
    if (!source || !contact) return;
    wx.setClipboardData({
      data: contact.copy,
      success: () => {
        track("service_copy", { id: source.id, via: contact.id, from: `guide_${this.data.topic}` });
        wx.showToast({ title: source.pendingToast || "已复制", icon: "none" });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  onOfferImageLoad() {
    if (!this.data.offer || this.data.offer.mode !== "image") return;
    this.setData({ offerImageError: false });
    track("offer_qr_open", { id: this.data.offer.id, from: `guide_${this.data.topic}` });
  },
  onOfferImageError() {
    this.setData({ offerImageError: true });
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  openLegal() {
    openPage("/pages/legal/index");
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
