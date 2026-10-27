const { track } = require("../../utils/analytics");

Component({
  properties: {
    unitId: { type: String, value: "" },
  },
  data: { visible: false, loaded: false },
  observers: {
    unitId(value) {
      this.setData({ visible: Boolean(String(value || "").trim()), loaded: false });
    },
  },
  methods: {
    onLoad() {
      if (!this.data.visible || this.data.loaded) return;
      this.setData({ loaded: true });
      track("ad_load", { placement: "section_footer" });
    },
    onError(event) {
      if (!this.data.visible) return;
      this.setData({ visible: false, loaded: false });
      const code = event && event.detail && event.detail.errCode;
      track("ad_error", { placement: "section_footer", code: String(code || "unknown") });
    },
  },
});
