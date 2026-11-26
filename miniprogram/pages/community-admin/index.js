const admin = require("../../services/community-admin");
const { joinedAtIso, displayBeijing } = require("../../utils/community-admin");
const { goHome } = require("../../utils/nav");

Page({
  data: { checking: true, allowed: false, error: "", orderId: "", order: null,
    joinedDate: "", joinedTime: "", saving: false, result: null },
  onLoad() {
    return admin.access().then((state) => {
      this.setData({ checking: false, allowed: Boolean(state && state.allowed === true) });
    }).catch(() => this.setData({ checking: false, allowed: false, error: "管理服务暂不可用，请稍后再试。" }));
  },
  onOrderInput(event) {
    this.setData({ orderId: String(event.detail.value || "").trim().toUpperCase(), order: null, result: null, error: "" });
  },
  onDateChange(event) { this.setData({ joinedDate: event.detail.value, result: null }); },
  onTimeChange(event) { this.setData({ joinedTime: event.detail.value, result: null }); },
  lookup() {
    if (!this.data.allowed || this.data.checking || this.data.saving) return;
    const orderId = this.data.orderId;
    if (!/^AC[A-Z0-9]{16,30}$/.test(orderId)) return this.setData({ error: "请填写完整的会员群订单号。" });
    this.setData({ checking: true, order: null, result: null, error: "" });
    return admin.lookup(orderId).then((order) => this.setData({ order, checking: false }))
      .catch((error) => this.setData({ order: null, checking: false, error: error.message || "查询失败，请稍后重试。" }));
  },
  recordJoin() {
    if (!this.data.allowed || !this.data.order || this.data.checking || this.data.saving) return;
    const joinedAt = joinedAtIso(this.data.joinedDate, this.data.joinedTime);
    if (!joinedAt || Date.parse(joinedAt) > Date.now()) return this.setData({ error: "请选择实际入群的日期和时间，不能晚于现在。" });
    const orderId = this.data.order.orderId;
    wx.showModal({ title: "确认实际入群", content: `订单 ${orderId} 的入群时间为 ${this.data.joinedDate} ${this.data.joinedTime}（北京时间）吗？`,
      success: ({ confirm }) => { if (confirm) this.saveJoin(orderId, joinedAt); },
    });
  },
  saveJoin(orderId, joinedAt) {
    if (!this.data.allowed || !this.data.order || this.data.order.orderId !== orderId || this.data.saving) return;
    this.setData({ saving: true, error: "" });
    return admin.recordJoin(orderId, joinedAt).then((result) => this.setData({ saving: false,
      result: { ...result, startsText: displayBeijing(result.startsAt), endsText: displayBeijing(result.endsAt) } }))
      .catch((error) => this.setData({ saving: false, error: error.message || "登记失败，请重新核对订单。" }));
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
});
