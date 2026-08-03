/**
 * 全站统一的数据新鲜度文案。
 * 正常已发布快照不弹条；仅缓存回退 / 离线且陈旧 / 超服务窗口时提示。
 */
function freshnessBanner(source, kind) {
  const safeKind = kind || "fresh";
  const label = source || "数据状态待核验";
  const tone = {
    fresh: "ok",
    aging: "ok",
    stale: "bad",
    cached: "bad",
    offline: "warn",
  }[safeKind] || "warn";
  const tip = {
    fresh: "",
    aging: "",
    stale: "已偏旧，建议下拉刷新",
    cached: "上游暂不可用，当前为缓存",
    offline: "未连云端，使用随包备用",
  }[safeKind] || "";
  return {
    kind: safeKind,
    tone,
    label,
    tip,
    // 正常自动更新不占版面；异常才显示橙/红条，避免被误认成「旧版」。
    show: tone !== "ok",
  };
}

module.exports = { freshnessBanner };
