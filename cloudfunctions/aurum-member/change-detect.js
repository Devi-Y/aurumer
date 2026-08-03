/**
 * 服务端变化分类与去重键；与小程序 change-center 口径对齐，不暴露内部权重。
 */

function hashValue(value) {
  const text = String(value == null ? "" : value);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function changeKey(market, targetId, changeType, currentValue) {
  return [
    String(market || "x"),
    String(targetId || "x"),
    String(changeType || "x"),
    hashValue(currentValue),
  ].join("|");
}

function classifyFactDiff(baseline, current, market) {
  if (!current) {
    return {
      changeTypes: [],
      importance: "low",
      summary: "暂无最新公开事实",
      changeKey: "",
    };
  }
  if (!baseline) {
    const key = changeKey(market || current.market, current.code || current.name, "status", current.oneLiner);
    return {
      changeTypes: ["status"],
      importance: "medium",
      summary: "首次建立对照",
      changeKey: key,
    };
  }

  const types = [];
  const push = (type, before, after) => {
    if (String(before || "").trim() === String(after || "").trim()) return;
    if (!String(before || "").trim() && !String(after || "").trim()) return;
    if (!types.includes(type)) types.push(type);
  };

  push("conclusion", baseline.oneLiner, current.oneLiner);
  push("score_proxy", baseline.badge, current.badge);
  push("risk", baseline.risk, current.risk);
  if (!String(baseline.risk || "").trim() && String(current.risk || "").trim()) types.push("risk_added");
  if (String(baseline.risk || "").trim() && !String(current.risk || "").trim()) types.push("risk_cleared");
  push("price", baseline.priceLabel, current.priceLabel);
  push("metric", baseline.metricLabel, current.metricLabel);
  if (!types.length
    && baseline.snapshotUpdatedAt !== current.snapshotUpdatedAt
    && baseline.snapshotUpdatedAt
    && current.snapshotUpdatedAt) {
    types.push("updated_at");
  }

  const m = market || current.market || "";
  if (m === "hk" && types.includes("conclusion")) types.push("hk_verdict");
  if (m === "us" && types.includes("price")) types.push("us_zone");
  if (m === "a" && types.includes("metric")) types.push("a_yield");
  if (m === "gold" && types.includes("conclusion")) types.push("gold_verdict");

  let importance = "low";
  if (types.some((type) => ["conclusion", "risk", "risk_added", "hk_verdict", "gold_verdict", "us_zone"].includes(type))) {
    importance = "high";
  } else if (types.some((type) => ["price", "metric", "score_proxy"].includes(type))) {
    importance = "medium";
  }

  if (!types.length) {
    return { changeTypes: [], importance: "low", summary: "相对基线无实质变化", changeKey: "" };
  }

  const labels = {
    conclusion: "研究结论",
    score_proxy: "观察标签",
    risk: "风险",
    risk_added: "新增风险",
    risk_cleared: "风险解除",
    price: "价格位置",
    metric: "关键数据",
    updated_at: "数据时间",
    hk_verdict: "申购观察结论",
    us_zone: "价格观察区",
    a_yield: "股息率",
    gold_verdict: "黄金研究结论",
  };
  const primary = types[0];
  const currentHash = [current.oneLiner, current.badge, current.risk, current.priceLabel, current.metricLabel].join("|");
  return {
    changeTypes: types,
    importance,
    summary: types.map((type) => labels[type] || type).slice(0, 3).join("、") + "有变化",
    changeKey: changeKey(m, current.code || current.name, primary, currentHash),
  };
}

module.exports = {
  changeKey,
  classifyFactDiff,
  hashValue,
};
