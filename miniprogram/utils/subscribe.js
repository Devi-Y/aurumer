/**
 * 微信订阅消息：事件提醒。模板 ID 由云函数 status/subscribe 下发。
 */
function requestEventSubscribe(templateId) {
  if (!templateId || typeof wx.requestSubscribeMessage !== "function") {
    return Promise.resolve({ ok: false, reason: "NO_TEMPLATE" });
  }
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success(res) {
        const status = res && res[templateId];
        resolve({
          ok: status === "accept",
          status: status || "unknown",
          reason: status === "accept" ? "" : "USER_REJECTED_OR_BANNER",
        });
      },
      fail(error) {
        resolve({
          ok: false,
          status: "fail",
          reason: (error && error.errMsg) || "SUBSCRIBE_FAIL",
        });
      },
    });
  });
}

module.exports = { requestEventSubscribe };
