/**
 * 会员变化中心与待办看板：分类、重要性、当时/现在对照话术。
 * 不暴露内部权重或模型拆解。
 */

const IMPORTANCE = {
  high: { id: "high", label: "需要重新评估", rank: 3 },
  medium: { id: "medium", label: "值得关注", rank: 2 },
  low: { id: "low", label: "信息更新", rank: 1 },
};

const REASON_OPTIONS = [
  { id: "price_zone", label: "价格进入观察区" },
  { id: "fundamentals", label: "基本面值得继续研究" },
  { id: "dividend", label: "分红与现金流" },
  { id: "hk_ipo", label: "港股打新" },
  { id: "guru", label: "机构持仓变化" },
  { id: "gold_defense", label: "黄金防守配置" },
  { id: "other", label: "其他" },
];

const REVIEW_CONDITION_OPTIONS = [
  { id: "conclusion_change", label: "结论发生变化" },
  { id: "risk_up", label: "风险升高" },
  { id: "price_zone", label: "价格位置发生变化" },
  { id: "earnings", label: "财报发布" },
  { id: "dividend", label: "分红方案变化" },
  { id: "listing", label: "上市或暗盘" },
  { id: "filing", label: "机构持仓披露" },
  { id: "date", label: "指定日期" },
  { id: "other", label: "其他" },
];

const CHANGE_TYPE_LABELS = {
  conclusion: "研究结论变化",
  score_proxy: "研究观察分变化",
  risk: "风险等级变化",
  price: "价格位置变化",
  metric: "关键数据变化",
  updated_at: "数据更新时间变化",
  status: "标的状态变化",
  risk_added: "新增风险提示",
  risk_cleared: "风险提示解除",
  hk_offer_start: "招股开始",
  hk_offer_near: "招股即将截止",
  hk_offer_end: "招股截止",
  hk_grey_near: "暗盘日期临近",
  hk_list_near: "上市日期临近",
  hk_verdict: "申购观察结论变化",
  hk_issue_data: "发行数据发生重要变化",
  us_earnings_near: "财报日期临近",
  us_earnings_out: "财报已披露",
  us_zone: "价格进入或离开观察区",
  us_fundamentals: "基本面关键数据变化",
  us_heat: "热度显著变化",
  a_dividend_plan: "分红方案披露",
  a_record_near: "股权登记日临近",
  a_ex_near: "除息日临近",
  a_yield: "股息率明显变化",
  a_cashflow: "经营现金流变化",
  a_fcf: "自由现金流变化",
  a_quality: "分红质量变化",
  a_verdict: "收息观察结论变化",
  gold_intl: "国际金价位置变化",
  gold_sh: "上海金位置变化",
  gold_spread: "国内外价差变化",
  gold_rate: "实际利率方向变化",
  gold_usd: "美元方向变化",
  gold_cftc: "CFTC持仓拥挤度变化",
  gold_verdict: "黄金研究结论变化",
  guru_filing: "机构持仓披露变化",
};

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
  if (!current || current.unmatched) {
    return {
      changeTypes: [],
      changeLabels: [],
      importance: IMPORTANCE.low.id,
      importanceLabel: IMPORTANCE.low.label,
      summary: "暂无公开对照",
      changeKey: "",
    };
  }
  if (!baseline || baseline.unmatched) {
    return {
      changeTypes: ["status"],
      changeLabels: [CHANGE_TYPE_LABELS.status],
      importance: IMPORTANCE.medium.id,
      importanceLabel: IMPORTANCE.medium.label,
      summary: "首次建立对照基线",
      changeKey: changeKey(market || current.market, current.code || current.name, "status", current.oneLiner),
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
  if (!String(baseline.risk || "").trim() && String(current.risk || "").trim()) {
    if (!types.includes("risk_added")) types.push("risk_added");
  }
  if (String(baseline.risk || "").trim() && !String(current.risk || "").trim()) {
    if (!types.includes("risk_cleared")) types.push("risk_cleared");
  }
  push("price", baseline.priceLabel, current.priceLabel);
  push("metric", baseline.metricLabel, current.metricLabel);
  if (baseline.snapshotUpdatedAt !== current.snapshotUpdatedAt
    && baseline.snapshotUpdatedAt
    && current.snapshotUpdatedAt
    && !types.length) {
    types.push("updated_at");
  }

  const m = market || current.market || baseline.market || "";
  if (m === "hk") {
    if (types.includes("conclusion")) types.push("hk_verdict");
    if (types.includes("price") || types.includes("metric")) types.push("hk_issue_data");
  } else if (m === "us") {
    if (types.includes("metric")) types.push("us_fundamentals");
    if (types.includes("score_proxy")) types.push("us_heat");
    if (types.includes("price")) types.push("us_zone");
  } else if (m === "a") {
    if (types.includes("conclusion")) types.push("a_verdict");
    if (types.includes("metric")) types.push("a_yield");
  } else if (m === "gold") {
    if (types.includes("conclusion")) types.push("gold_verdict");
    if (types.includes("price")) types.push("gold_intl");
    if (types.includes("metric")) types.push("gold_spread");
  } else if (m === "investors" || m === "guru") {
    if (types.length) types.push("guru_filing");
  }

  let importance = IMPORTANCE.low.id;
  if (types.some((type) => ["conclusion", "risk", "risk_added", "hk_verdict", "a_verdict", "gold_verdict", "us_zone"].includes(type))) {
    importance = IMPORTANCE.high.id;
  } else if (types.some((type) => ["price", "metric", "score_proxy", "hk_issue_data", "us_fundamentals", "a_yield"].includes(type))) {
    importance = IMPORTANCE.medium.id;
  } else if (!types.length) {
    return {
      changeTypes: [],
      changeLabels: [],
      importance: IMPORTANCE.low.id,
      importanceLabel: IMPORTANCE.low.label,
      summary: "相对上次无实质变化",
      changeKey: "",
    };
  }

  const labels = types.map((type) => CHANGE_TYPE_LABELS[type] || type);
  const primary = types[0] || "status";
  const currentHash = [current.oneLiner, current.badge, current.risk, current.priceLabel, current.metricLabel].join("|");
  return {
    changeTypes: types,
    changeLabels: labels,
    importance,
    importanceLabel: IMPORTANCE[importance].label,
    summary: labels.slice(0, 3).join("、") || "公开资料有更新",
    changeKey: changeKey(m, current.code || current.name, primary, currentHash),
  };
}

function compareOutcome(baseline, current, invalidation) {
  const classified = classifyFactDiff(baseline, current, current && current.market);
  if (!classified.changeTypes.length) {
    return {
      status: "stable",
      label: "尚未出现明显变化",
      hint: "建议按计划日期再查看当前资料",
      needReassess: false,
    };
  }
  if (classified.importance === "high" || invalidation) {
    return {
      status: "changed",
      label: "关键条件已经变化",
      hint: invalidation
        ? `请核对你设定的条件：${invalidation}`
        : "建议重新查看当前资料",
      needReassess: true,
    };
  }
  return {
    status: "partial",
    label: "原判断仍有数据支持",
    hint: "部分信息已更新，可继续观察",
    needReassess: false,
  };
}

function enrichChangeFeed(feed) {
  return (feed || []).map((item) => {
    const classified = classifyFactDiff(item.baseline, item.current, item.current && item.current.market);
    const outcome = compareOutcome(item.baseline, item.current, item.invalidation);
    return {
      ...item,
      ...classified,
      outcome,
      needReassess: outcome.needReassess || classified.importance === "high",
      unread: Boolean(item.changed && classified.changeTypes.length),
    };
  });
}

function buildChangeCenter(feed, inbox = [], watchItems = []) {
  const enriched = enrichChangeFeed(feed);
  const high = enriched.filter((item) => item.needReassess || item.importance === "high");
  const important = enriched.filter((item) => item.changed && item.importance === "medium" && !item.needReassess);
  const calm = enriched.filter((item) => !item.changed || item.importance === "low");
  const unreadInbox = (inbox || []).filter((item) => item.unread || !item.readAt);
  const latestAt = unreadInbox[0] && unreadInbox[0].dateLabel
    ? unreadInbox[0].dateLabel
    : "";

  return {
    summary: {
      headline: high.length
        ? `今日有 ${high.length} 项需要重新评估`
        : (important.length
          ? `有 ${important.length} 项值得关注的变化`
          : (watchItems.length ? "暂无重要变化" : "先保存关注，才能开始跟踪变化")),
      unreadCount: unreadInbox.length || high.length,
      highCount: high.length,
      mediumCount: important.length,
      calmCount: calm.length,
      watchCount: watchItems.length,
      latestAt,
    },
    needReassess: high,
    important,
    calm,
    all: enriched,
  };
}

function dayOffset(dateLabel, todayLabel) {
  if (!dateLabel) return null;
  const parse = (value) => {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const due = parse(dateLabel);
  const today = parse(todayLabel);
  if (due == null || today == null) return null;
  return Math.round((due - today) / (24 * 60 * 60 * 1000));
}

function todayLabelLocal() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDaysLabel(baseLabel, days) {
  const match = String(baseLabel || todayLabelLocal()).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  base.setDate(base.getDate() + Number(days || 0));
  const pad = (part) => String(part).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

function buildTaskBoard(tasks = [], today = todayLabelLocal()) {
  const open = (tasks || []).filter((item) => item.status !== "done" && item.status !== "deleted");
  const done = (tasks || []).filter((item) => item.status === "done");
  const bucketOf = (item) => {
    const offset = dayOffset(item.dueAt, today);
    if (item.status === "done") return "done";
    if (offset == null) return "later";
    if (offset < 0) return "overdue";
    if (offset === 0) return "today";
    if (offset <= 7) return "week";
    if (offset <= 30) return "month";
    return "later";
  };
  const decorate = (item) => ({
    ...item,
    bucket: bucketOf(item),
    priorityLabel: item.priority === "high" ? "高" : (item.priority === "low" ? "低" : "中"),
    channelLabel: item.subscriptionAuthorized
      ? "微信提醒已开启"
      : (item.reminderChannel === "wechat" ? "订阅微信提醒" : "小程序内提醒"),
  });
  const rows = open.map(decorate).sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
  return {
    today: rows.filter((item) => item.bucket === "today"),
    week: rows.filter((item) => item.bucket === "week"),
    month: rows.filter((item) => item.bucket === "month"),
    overdue: rows.filter((item) => item.bucket === "overdue"),
    later: rows.filter((item) => item.bucket === "later"),
    done: done.map(decorate).slice(0, 20),
    openCount: rows.length,
    todayCount: rows.filter((item) => item.bucket === "today" || item.bucket === "overdue").length,
  };
}

function homeMemberSummary(workspace) {
  if (!workspace || !workspace.active) {
    return {
      active: false,
      help: "关注·变化·复盘",
      detail: "365天 · ¥1288",
    };
  }
  const brief = workspace.todayBrief || {};
  const tasks = workspace.reviewTasks || [];
  const board = buildTaskBoard(tasks);
  const changes = Number(brief.factChangeCount || 0) + Number(brief.thesisCount || 0);
  const todos = board.todayCount || Number(brief.eventCount || 0);
  if (!changes && !todos) {
    return {
      active: true,
      help: "暂无重要变化",
      detail: "记录正常同步",
    };
  }
  const parts = [];
  if (changes) parts.push(`${changes}项新变化`);
  if (todos) parts.push(`${todos}个待办`);
  return {
    active: true,
    help: parts.join(" · ") || "记录正常同步",
    detail: board.todayCount ? "今日需要重新评估" : "打开我的记录查看",
  };
}

module.exports = {
  CHANGE_TYPE_LABELS,
  IMPORTANCE,
  REASON_OPTIONS,
  REVIEW_CONDITION_OPTIONS,
  addDaysLabel,
  buildChangeCenter,
  buildTaskBoard,
  changeKey,
  classifyFactDiff,
  compareOutcome,
  enrichChangeFeed,
  homeMemberSummary,
  todayLabelLocal,
};
