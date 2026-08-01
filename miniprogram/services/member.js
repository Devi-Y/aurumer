const runtime = require("../config/runtime");

const PREVIEW_PLANS = [
  {
    id: "research-365d",
    name: "望潮年度研究会员",
    term: "365 天使用跨设备清单、决策档案与个人记录导出",
    priceLabel: "¥1,288 / 年",
    recommended: true,
  },
];

function callBackend(action, data = {}) {
  if (!runtime.cloudEnv || !wx.cloud) {
    return Promise.reject(new Error("MEMBER_BACKEND_DISABLED"));
  }
  return wx.cloud.callFunction({
    name: runtime.memberFunction,
    data: { action, ...data },
  }).then((response) => {
    const result = response && response.result;
    if (!result || result.ok !== true) {
      const error = new Error((result && result.message) || "会员服务暂时不可用");
      error.code = (result && result.code) || "MEMBER_BACKEND_ERROR";
      throw error;
    }
    return result.data;
  });
}

function previewState() {
  return {
    backendReady: false,
    paymentReady: false,
    paymentReason: "会员服务暂不可用，请检查网络或云函数配置",
    plans: PREVIEW_PLANS,
    entitlement: null,
    orders: [],
  };
}

function previewWorkspace() {
  return {
    backendReady: false,
    active: false,
    writable: false,
    expiresAt: null,
    watchItems: [],
    decisions: [],
    limits: { watchItems: 50, decisions: 100 },
  };
}

function loadMemberState() {
  if (!runtime.cloudEnv || !wx.cloud) return Promise.resolve(previewState());
  return callBackend("status").catch((error) => ({
    ...previewState(),
    backendReady: true,
    paymentReason: error.message || "会员服务连接失败",
  }));
}

function invokeWechatPayment(payment) {
  if (!payment || payment.kind !== "wechat-jsapi") {
    return Promise.reject(new Error("付款参数类型无效，请刷新会员页后重试"));
  }
  if (typeof wx.requestPayment !== "function") {
    return Promise.reject(new Error("当前微信版本不支持小程序支付，请升级微信后重试"));
  }
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: payment.timeStamp,
      nonceStr: payment.nonceStr,
      package: payment.package,
      signType: payment.signType,
      paySign: payment.paySign,
      success: resolve,
      fail(error) {
        const cancelled = /cancel/i.test(String(error && error.errMsg));
        const paymentError = new Error(
          cancelled ? "已取消支付" : ((error && error.errMsg) || "支付未完成"),
        );
        paymentError.code = cancelled ? "PAYMENT_CANCELLED" : ((error && error.errCode) || "PAYMENT_FAILED");
        reject(paymentError);
      },
    });
  });
}

async function purchase(planId, legalConsent) {
  const prepared = await callBackend("preparePurchase", { planId, legalConsent });
  await invokeWechatPayment(prepared.payment);
  // 与问岳保持同一条最短用户链路：一次下单后立即拉起微信收银台。
  // 权益仍只由服务端支付回调、严格查单和幂等账本确认；客户端成功回调不直接发放权益。
  return {
    orderId: prepared.orderId,
    paymentAccepted: true,
  };
}

function loadWorkspace() {
  if (!runtime.cloudEnv || !wx.cloud) return Promise.resolve(previewWorkspace());
  return callBackend("workspace").then((workspace) => ({
    ...workspace,
    backendReady: true,
  }));
}

function workspaceAction(action, data) {
  return callBackend(action, data).then((workspace) => ({
    ...workspace,
    backendReady: true,
  }));
}

function saveWatchItem(data) {
  return workspaceAction("saveWatchItem", data);
}

function removeWatchItem(itemId) {
  return workspaceAction("removeWatchItem", { itemId });
}

function saveDecision(data) {
  return workspaceAction("saveDecision", data);
}

function removeDecision(itemId) {
  return workspaceAction("removeDecision", { itemId });
}

function deleteWorkspace() {
  return workspaceAction("deleteWorkspace", {});
}

function queryOrder(orderId) {
  return callBackend("queryOrder", { orderId });
}

module.exports = {
  deleteWorkspace,
  loadMemberState,
  loadWorkspace,
  purchase,
  queryOrder,
  removeDecision,
  removeWatchItem,
  saveDecision,
  saveWatchItem,
};
