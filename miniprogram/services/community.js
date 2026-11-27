const runtime = require("../config/runtime");

function call(action, data = {}) {
  if (!runtime.cloudEnv || !wx.cloud) return Promise.reject(new Error("会员群服务暂不可用"));
  return wx.cloud.callFunction({ name: runtime.memberFunction, data: { action, ...data } }).then((response) => {
    const result = response && response.result;
    if (!result || result.ok !== true) {
      const error = new Error((result && result.message) || "会员群服务暂不可用");
      error.code = result && result.code;
      throw error;
    }
    return result.data;
  });
}
function status() { return call("communityStatus"); }
async function purchase(termsVersion) {
  const canLoad = typeof wx !== "undefined" && typeof wx.showLoading === "function";
  if (canLoad) wx.showLoading({ title: "正在打开微信支付", mask: true });
  let prepared;
  try {
    prepared = await call("prepareCommunityPurchase", { legalConsent: { accepted: true, adultConfirmed: true, termsVersion } });
  } finally {
    if (canLoad && typeof wx.hideLoading === "function") {
      try { wx.hideLoading(); } catch (e) {}
    }
  }
  if (prepared.alreadyPaid) return prepared.orderId;
  const payment = prepared.payment || {};
  if (payment.kind !== "wechat-jsapi" || typeof wx.requestPayment !== "function") throw new Error("微信支付暂不可用");
  await new Promise((resolve, reject) => wx.requestPayment({ timeStamp: payment.timeStamp, nonceStr: payment.nonceStr,
    package: payment.package, signType: payment.signType, paySign: payment.paySign, success: resolve, fail: reject }));
  return prepared.orderId;
}
module.exports = { status, purchase };
