/**
 * 服务端变化分类与去重键；与小程序 change-center 口径对齐，不暴露内部权重。
 *
 * 提醒只关心：结论变化、结论跨档、风险新增、触及用户失效条件。
 * 普通价格波动 / 纯价格位置变化不进入高优先级，也不应推送。
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

/** 观察分档：用于判定结论跨档（不只是文案微调）。 */
function observationBand(badge, oneLiner) {
  const text = `${badge || ""} ${oneLiner || ""}`;
  if (/值得打|买入|重点|优先|可分批|积极/.test(text)) return "prime";
  if (/谨慎|等待|观察|持有|中性/.test(text)) return "steady";
  if (/不建议|回避|结束|过期|风险|降级/.test(text)) return "watch";
  if (/A|B|C|D|优|良|中|差/.test(String(badge || ""))) {
    const grade = String(badge || "").trim().charAt(0).toUpperCase();
    if ("ABCD".includes(grade)) return `grade-${grade}`;
  }
  return String(badge || oneLiner || "").trim().slice(0, 24) || "none";
}

function isPriceOnlyTypes(types) {
  const meaningful = types.filter((type) => type !== "updated_at");
  if (!meaningful.length) return true;
  return meaningful.every((type) => ["price", "us_zone", "gold_intl", "metric", "a_yield", "score_proxy"].includes(type));
}

function isNotifyWorthy(types, importance) {
  if (importance === "high") return true;
  return types.some((type) => [
    "conclusion",
    "band_cross",
    "risk",
    "risk_added",
    "invalidation",
    "hk_verdict",
    "a_verdict",
    "gold_verdict",
  ].includes(type));
}

function classifyFactDiff(baseline, current, market, options = {}) {
  if (!current) {
    return {
      changeTypes: [],
      importance: "low",
      summary: "暂无最新公开事实",
      changeKey: "",
      notifyWorthy: false,
    };
  }
  if (!baseline) {
    const key = changeKey(market || current.market, current.code || current.name, "status", current.oneLiner);
    return {
      changeTypes: ["status"],
      importance: "medium",
      summary: "首次建立对照",
      changeKey: key,
      notifyWorthy: false,
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

  const beforeBand = observationBand(baseline.badge, baseline.oneLiner);
  const afterBand = observationBand(current.badge, current.oneLiner);
  if (beforeBand !== afterBand) {
    if (!types.includes("band_cross")) types.push("band_cross");
  }

  if (options.invalidationHit) {
    if (!types.includes("invalidation")) types.push("invalidation");
  }

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
  if (m === "a" && (types.includes("conclusion") || types.includes("band_cross"))) types.push("a_verdict");
  if (m === "gold" && types.includes("conclusion")) types.push("gold_verdict");

  let importance = "low";
  if (types.some((type) => [
    "conclusion",
    "band_cross",
    "risk",
    "risk_added",
    "invalidation",
    "hk_verdict",
    "a_verdict",
    "gold_verdict",
  ].includes(type))) {
    importance = "high";
  } else if (types.some((type) => ["price", "metric", "score_proxy", "us_zone"].includes(type))) {
    // 普通价格/指标波动：保留分类供工作台静默展示，不升为提醒。
    importance = "low";
  }

  if (isPriceOnlyTypes(types) && !types.includes("band_cross") && !types.includes("invalidation")) {
    importance = "low";
  }

  if (!types.length) {
    return {
      changeTypes: [],
      importance: "low",
      summary: "相对基线无实质变化",
      changeKey: "",
      notifyWorthy: false,
    };
  }

  const labels = {
    conclusion: "研究结论",
    band_cross: "结论跨档",
    score_proxy: "观察标签",
    risk: "风险",
    risk_added: "新增风险",
    risk_cleared: "风险解除",
    invalidation: "触及失效条件",
    price: "价格位置",
    metric: "关键数据",
    updated_at: "数据时间",
    hk_verdict: "申购观察结论",
    us_zone: "价格观察区",
    a_yield: "股息率",
    a_verdict: "收息观察结论",
    gold_verdict: "黄金研究结论",
  };
  const primary = types.includes("band_cross")
    ? "band_cross"
    : (types.includes("invalidation") ? "invalidation" : types[0]);
  const currentHash = [current.oneLiner, current.badge, current.risk, current.priceLabel, current.metricLabel, afterBand].join("|");
  const notifyWorthy = isNotifyWorthy(types, importance);
  return {
    changeTypes: types,
    importance,
    summary: types.map((type) => labels[type] || type).slice(0, 3).join("、") + "有变化",
    changeKey: changeKey(m || current.market, current.code || current.name, primary, currentHash),
    notifyWorthy,
  };
}

module.exports = {
  classifyFactDiff,
  changeKey,
  observationBand,
  isNotifyWorthy,
  isPriceOnlyTypes,
};
