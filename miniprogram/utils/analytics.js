/**
 * 轻量漏斗埋点。优先走微信自定义分析 reportEvent；不可用时静默跳过。
 */
const ALLOWED = new Set([
  "home_open",
  "today_expand",
  "section_open",
  "detail_open",
  "pay_click",
  "pay_ok",
  "pay_cancel",
  "workspace_save",
  "workspace_open",
  "migrate_local",
  "share_tap",
]);

function track(event, payload = {}) {
  const name = String(event || "");
  if (!ALLOWED.has(name)) return;
  try {
    if (typeof wx.reportEvent === "function") {
      wx.reportEvent(name, payload);
      return;
    }
    if (typeof wx.reportAnalytics === "function") {
      wx.reportAnalytics(name, payload);
    }
  } catch (error) {
    // 埋点失败不影响主流程。
  }
}

module.exports = { track };
