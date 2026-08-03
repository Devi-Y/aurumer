/**
 * 把公开快照压成可保存、可对照的事实卡片；用于变化雷达与决策留档。
 */
const { allItems, shortCompanyName } = require("./answers");

const GROUP_OPTIONS = [
  { id: "default", label: "默认" },
  { id: "ipo", label: "打新" },
  { id: "dividend", label: "收息" },
  { id: "long", label: "长期" },
  { id: "watch", label: "观察" },
];

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.HK$/i, "")
    .replace(/\.(SH|SZ)$/i, "");
}

function matchCatalogItem(watch, snapshot) {
  if (!snapshot || !watch) return null;
  const market = watch.market || "other";
  if (market === "other" || !allItems) return null;
  const list = allItems(snapshot, market) || [];
  const code = normalizeCode(watch.code);
  const name = String(watch.name || "").trim();
  return list.find((entry) => {
    if (code && normalizeCode(entry.code) === code) return true;
    if (code && normalizeCode(entry.id) === code) return true;
    if (name && entry.name && entry.name.includes(name)) return true;
    if (name && entry.name && name.includes(shortCompanyName(entry.name, "", 6))) return true;
    return false;
  }) || null;
}

function buildFactFromMatch(market, matched, snapshotUpdatedAt) {
  if (!matched) return null;
  const raw = matched.raw || {};
  const fact = {
    market,
    code: matched.code || matched.id || "",
    name: matched.name || "",
    oneLiner: matched.one || matched.badge || "",
    badge: matched.badge || "",
    risk: matched.risk || "",
    priceLabel: "",
    metricLabel: "",
    asOf: raw.asOf || raw.priceAsOf || raw.filingDate || raw.offerDeadline || snapshotUpdatedAt || "",
    source: raw.source || raw.priceSource || "",
    snapshotUpdatedAt: snapshotUpdatedAt || "",
  };

  if (market === "us" && raw.price != null) {
    const change = Number(raw.changePercent);
    fact.priceLabel = `$${Number(raw.price).toFixed(2)}`;
    fact.metricLabel = Number.isFinite(change)
      ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`
      : "";
  } else if (market === "a" && raw.currentPrice != null) {
    fact.priceLabel = `¥${Number(raw.currentPrice).toFixed(2)}`;
    fact.metricLabel = Number.isFinite(Number(raw.currentDividendYield))
      ? `息 ${Number(raw.currentDividendYield).toFixed(1)}%`
      : "";
  } else if (market === "hk") {
    if (raw.entryFee != null) fact.priceLabel = `一手约 ${Math.round(Number(raw.entryFee))} 港元`;
    fact.metricLabel = raw.offerDeadline
      ? `截止 ${raw.offerDeadline}`
      : (matched.badge || "");
  } else if (market === "gold") {
    const price = raw.quotes?.international?.price ?? raw.price;
    if (price != null) fact.priceLabel = `${Math.round(Number(price))} USD/oz`;
    fact.metricLabel = matched.badge || matched.one || "";
  } else if (market === "investors" || raw.filingDate) {
    fact.priceLabel = raw.filingDate ? `披露 ${raw.filingDate}` : "";
    fact.metricLabel = matched.badge || "";
  }

  if (!fact.source) fact.source = "公开资料";
  return fact;
}

function captureFact(watch, snapshot) {
  const matched = matchCatalogItem(watch, snapshot);
  if (!matched) {
    return {
      market: watch.market || "other",
      code: watch.code || "",
      name: watch.name || "",
      oneLiner: "尚未匹配到公开资料",
      badge: "",
      risk: "",
      priceLabel: "",
      metricLabel: "",
      asOf: snapshot && snapshot.updatedAt || "",
      source: "用户关注",
      snapshotUpdatedAt: snapshot && snapshot.updatedAt || "",
      unmatched: true,
    };
  }
  return buildFactFromMatch(watch.market, matched, snapshot && snapshot.updatedAt);
}

function captureDecisionEvidence(form, snapshot) {
  const probe = {
    market: form.market || "other",
    code: form.code || "",
    name: form.name || form.title || "",
  };
  const fact = captureFact(probe, snapshot);
  return {
    ...fact,
    title: form.title || "",
    capturedAt: new Date().toISOString(),
  };
}

function factFingerprint(fact) {
  if (!fact) return "";
  return [
    fact.oneLiner,
    fact.badge,
    fact.priceLabel,
    fact.metricLabel,
    fact.asOf,
    fact.snapshotUpdatedAt,
  ].join("|");
}

function diffFacts(baseline, current) {
  if (!current) return null;
  if (!baseline || baseline.unmatched) {
    return {
      changed: Boolean(current && !current.unmatched),
      summary: current.unmatched ? "暂无公开对照" : "首次建立对照基线",
      fields: [],
    };
  }
  const fields = [];
  const pairs = [
    ["oneLiner", "结论"],
    ["badge", "标签"],
    ["priceLabel", "价格/费用"],
    ["metricLabel", "关键指标"],
    ["risk", "风险提示"],
  ];
  pairs.forEach(([key, label]) => {
    const before = String(baseline[key] || "").trim();
    const after = String(current[key] || "").trim();
    if (before !== after && (before || after)) {
      fields.push({ key, label, before: before || "—", after: after || "—" });
    }
  });
  const snapshotMoved = baseline.snapshotUpdatedAt !== current.snapshotUpdatedAt
    && baseline.snapshotUpdatedAt
    && current.snapshotUpdatedAt;
  return {
    changed: fields.length > 0,
    summary: fields.length
      ? fields.map((item) => item.label).slice(0, 3).join("、") + "有变化"
      : (snapshotMoved ? "数据已刷新，关键结论未变" : "相对上次无实质变化"),
    fields,
    snapshotMoved: Boolean(snapshotMoved),
  };
}

function buildChangeFeed(watchItems, snapshot) {
  return (watchItems || []).map((item) => {
    const current = captureFact(item, snapshot);
    const baseline = item.baselineFact || null;
    const diff = diffFacts(baseline, current);
    return {
      id: item.id,
      name: item.name,
      code: item.code || "",
      marketLabel: item.marketLabel || "",
      groupLabel: item.groupLabel || "默认",
      current,
      baseline,
      diff,
      changed: Boolean(diff && diff.changed),
      summary: (diff && diff.summary) || "",
    };
  }).sort((a, b) => Number(b.changed) - Number(a.changed));
}

function buildWeeklyReview(decisions, snapshot, watchItems = []) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const today = new Date();
  const todayLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const { compareOutcome } = require("./change-center");

  const rows = [];
  (decisions || []).forEach((item) => {
    const time = Date.parse(item.createdAt || item.updatedAt || "");
    const recent = Number.isFinite(time) && now - time <= weekMs;
    const evidence = item.evidence || null;
    const probe = {
      market: evidence && evidence.market || item.market || "other",
      code: evidence && evidence.code || item.code || "",
      name: evidence && evidence.name || item.title || "",
    };
    const current = captureFact(probe, snapshot);
    const diff = evidence ? diffFacts(evidence, current) : null;
    const outcomeInfo = compareOutcome(evidence, current, item.invalidation);
    const reviewDue = item.nextReviewAt && String(item.nextReviewAt) <= todayLabel;
    const invalidationHit = Boolean(item.invalidation && diff && diff.changed);
    const openLong = !recent && Boolean(evidence || item.invalidation || item.nextReviewAt);

    if (!recent && !openLong && !reviewDue && !invalidationHit) return;

    let bucket = "week-new";
    let outcome = outcomeInfo.label;
    if (invalidationHit || outcomeInfo.needReassess) {
      bucket = "invalidation";
      outcome = outcomeInfo.label;
    } else if (reviewDue) {
      bucket = "due";
      outcome = "已到复核日 · 建议重新查看当前资料";
    } else if (openLong) {
      bucket = "open";
      outcome = outcomeInfo.label;
    } else if (!evidence) {
      outcome = "未自动留存当时证据（旧记录）";
    }

    rows.push({
      id: item.id,
      title: item.title,
      dateLabel: item.dateLabel || "",
      outcome,
      outcomeHint: outcomeInfo.hint,
      bucket,
      tag: bucket === "invalidation"
        ? "需要重新评估"
        : (bucket === "due" ? "复核到期" : (bucket === "open" ? "长期跟踪" : "本周新记")),
      changed: Boolean(diff && diff.changed) || invalidationHit,
      summary: (diff && diff.summary) || "",
      evidenceAsOf: evidence && (evidence.asOf || evidence.snapshotUpdatedAt) || "",
      invalidation: item.invalidation || "",
      thenLabel: evidence
        ? [evidence.priceLabel, evidence.oneLiner].filter(Boolean).join(" · ")
        : "",
      nowLabel: current
        ? [current.priceLabel, current.oneLiner].filter(Boolean).join(" · ")
        : "",
    });
  });

  (watchItems || []).forEach((item) => {
    if (!item.nextReviewAt || String(item.nextReviewAt) > todayLabel) return;
    rows.push({
      id: `watch-review-${item.id}`,
      title: `关注复核：${item.name}`,
      dateLabel: item.nextReviewAt,
      outcome: "已到复核日 · 建议重新查看当前资料",
      outcomeHint: item.invalidation || item.thesis || "",
      bucket: "due",
      tag: "关注复核",
      changed: true,
      summary: item.thesis || item.note || "",
      evidenceAsOf: "",
      invalidation: item.invalidation || "",
      thenLabel: "",
      nowLabel: "",
    });
  });

  const weekNew = rows.filter((row) => row.bucket === "week-new").length;
  const openCount = rows.filter((row) => row.bucket === "open").length;
  const dueCount = rows.filter((row) => row.bucket === "due" || row.bucket === "invalidation").length;
  return {
    count: rows.length,
    changedCount: rows.filter((row) => row.changed).length,
    weekNew,
    openCount,
    dueCount,
    rows,
    headline: rows.length
      ? `复盘 ${rows.length} 条：本周新记 ${weekNew}，长期跟踪 ${openCount}，需复核/重评 ${dueCount}`
      : "还没有需要复盘的判断",
  };
}

module.exports = {
  GROUP_OPTIONS,
  buildChangeFeed,
  buildWeeklyReview,
  captureDecisionEvidence,
  captureFact,
  diffFacts,
  factFingerprint,
  matchCatalogItem,
  normalizeCode,
};
