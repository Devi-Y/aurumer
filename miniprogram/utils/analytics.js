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
  "add_holding",
  "holding_detail_open",
  "holding_delete",
  "return_visit",
  "daily_card_copy",
  "news_source_copy",
  "list_group_switch",
  "service_copy",
  // 栏目页和详情页里的切换动作：早就在页面里调用，但漏登记，一直被静默丢弃（2026-10 补上）。
  "section_tab",
  "section_answer",
  "section_hk_exit_select",
  "section_guru_institution_select",
  "detail_module_switch",
  // 2026-10 二级页与交流群页的使用埋点（首页服务格、研究页底部入口进了哪一页）。
  "path_open",
  "guide_open",
  "guide_link_copy",
  "offer_qr_open",
  "community_open",
]);

const VISIT_KEY = "aurum_last_home_visit_day";

function beijingDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 记录首页打开；若相对上次打开跨了北京时间自然日，额外报次日回访。 */
function trackHomeVisit() {
  track("home_open");
  try {
    const today = beijingDayKey();
    const previous = String(wx.getStorageSync(VISIT_KEY) || "");
    if (previous && previous !== today) track("return_visit", { gap: "day" });
    wx.setStorageSync(VISIT_KEY, today);
  } catch (error) {
    // 回访埋点失败不影响主流程。
  }
}

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

module.exports = { track, trackHomeVisit };
