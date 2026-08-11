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
    // 上游故障需要让用户知道，但不把“暂时回退”渲染成数据损坏。
    cached: "warn",
    offline: "warn",
  }[safeKind] || "warn";
  const tip = {
    fresh: "",
    aging: "",
    stale: "已偏旧，建议下拉刷新",
    cached: "已保留上一版数据，后台自动重试；可下拉刷新",
    offline: "未连云端，使用随包备用",
  }[safeKind] || "";
  return {
    kind: safeKind,
    tone,
    label: safeKind === "cached"
      ? label.replace("缓存回退（上游暂不可用）·", "数据源暂时不可用 ·")
        .replace("缓存回退（上游暂不可用）", "数据源暂时不可用")
      : label,
    tip,
    showRetry: ["cached", "offline", "stale"].includes(safeKind),
    // 正常自动更新不占版面；异常才显示橙/红条，避免被误认成「旧版」。
    show: tone !== "ok",
  };
}

module.exports = { freshnessBanner };
