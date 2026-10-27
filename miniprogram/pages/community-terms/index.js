const community = require("../../config/community");
const legal = require("../../config/legal");
const { goHome } = require("../../utils/nav");

Page({
  data: {
    priceLabel: `${community.priceCny} 元 / ${community.termLabel}`,
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
