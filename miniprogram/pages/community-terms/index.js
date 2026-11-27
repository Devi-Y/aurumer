const community = require("../../config/community");
const legal = require("../../config/legal");
const { goHome } = require("../../utils/nav");

Page({
  data: {
    priceLabel: `现价 ${community.priceCny} 元 / ${community.termLabel}（原价 ${community.originalPriceText || "¥29,800"} / ${community.termLabel}）`,
    checkoutStatus: community.checkoutEnabled ? "支持小程序内微信支付一键开通，到期不自动续费。" : "当前尚未开放付款。",
    operator: legal.operatorName,
    version: community.termsVersion,
    services: community.serviceItems,
    scope: community.serviceTerms,
    delivery: community.deliveryTerms,
    refund: community.refundTerms,
    handling: community.refundHandling,
    promotion: community.promotionNote,
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
});
