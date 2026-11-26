const { activeSponsorFor, activeFamilyBrand } = require("../../config/monetization");

Component({
  properties: {
    market: { type: String, value: "" },
  },
  data: {
    sponsor: null,
    familyBrand: null,
  },
  lifetimes: {
    attached() {
      this.syncEntries();
    },
  },
  observers: {
    market() {
      this.syncEntries();
    },
  },
  methods: {
    syncEntries() {
      this.setData({
        sponsor: activeSponsorFor(this.properties.market),
        familyBrand: activeFamilyBrand(),
      });
    },
    openMiniProgram(event) {
      const { appid, path } = event.currentTarget.dataset;
      if (!appid || typeof wx.navigateToMiniProgram !== "function") return;
      // 仅唤起已核验的独立小程序（如自有家庭消费品牌小店），跳转不计作收入。
      wx.navigateToMiniProgram({
        appId: appid,
        path: path || "",
        fail() {},
      });
    },
  },
});
