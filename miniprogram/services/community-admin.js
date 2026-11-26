const runtime = require("../config/runtime");

function call(action, data = {}) {
  if (!runtime.cloudEnv || !wx.cloud) return Promise.reject(new Error("会员群管理暂不可用"));
  return wx.cloud.callFunction({ name: runtime.memberFunction, data: { action, ...data } }).then((response) => {
    const result = response && response.result;
    if (!result || result.ok !== true) {
      const error = new Error((result && result.message) || "会员群管理暂不可用");
      error.code = result && result.code;
      throw error;
    }
    return result.data;
  });
}
const access = () => call("communityAdminAccess");
const lookup = (orderId) => call("communityAdminLookup", { orderId });
const recordJoin = (orderId, joinedAt) => call("communityAdminRecordJoin", { orderId, joinedAt });
module.exports = { access, lookup, recordJoin };
