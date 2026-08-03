/**
 * 轻量漏斗埋点。优先走微信自定义分析 reportEvent；不可用时静默跳过。
 * 不上传完整备注、金额或其他敏感字段。
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
  "workspace_ack_changes",
  "workspace_event_mark",
  "workspace_settings",
  "workspace_export",
  "member_open",
  "list_open",
  "migrate_local",
  "share_tap",
  "change_center_open",
  "change_item_open",
  "change_acknowledge",
  "snapshot_preview",
  "snapshot_create",
  "snapshot_open",
  "snapshot_compare",
  "review_task_create",
  "review_task_complete",
  "review_task_snooze",
  "review_task_delete",
  "member_value_view",
  "member_purchase_from_snapshot",
  "member_purchase_from_change_center",
  "subscription_reminder_request",
  "subscription_reminder_authorized",
  "subscription_reminder_denied",
]);

function track(event, payload = {}) {
  const name = String(event || "");
  if (!ALLOWED.has(name)) return;
  const safe = {};
  Object.keys(payload || {}).forEach((key) => {
    if (/note|remark|amount|openid|password|token/i.test(key)) return;
    const value = payload[key];
    if (value == null) return;
    if (typeof value === "string") safe[key] = value.slice(0, 40);
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  });
  try {
    if (typeof wx.reportEvent === "function") {
      wx.reportEvent(name, safe);
      return;
    }
    if (typeof wx.reportAnalytics === "function") {
      wx.reportAnalytics(name, safe);
    }
  } catch (error) {
    // 埋点失败不影响主流程。
  }
}

module.exports = { track };
