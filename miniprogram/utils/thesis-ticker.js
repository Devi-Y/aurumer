/**
 * 首页滚动思路条：只用已有公开结论与策略摘要，不灌假新闻/涨停情绪。
 */
const { allItems, shortCompanyName } = require("./answers");
const { scoreForItem } = require("./strategy-score");
const { playbookTickerLines } = require("./master-playbooks");

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function bestByScore(items) {
  return [...items]
    .map((item) => ({ item, scored: scoreForItem(item) }))
    .filter((entry) => entry.scored.score != null)
    .sort((left, right) => Number(right.scored.score) - Number(left.scored.score))[0]?.item
    || items[0]
    || null;
}

function buildThesisTicker(snapshot = {}) {
  const lines = [];

  const hkLive = allItems(snapshot, "hk").filter((item) => item.group !== "ended" && item.group !== "cancelled");
  const hkLead = bestByScore(hkLive.filter((item) => item.group === "worth").length
    ? hkLive.filter((item) => item.group === "worth")
    : hkLive);
  if (hkLead) {
    lines.push({
      id: `hk-${hkLead.id}`,
      kind: "market",
      title: "港股打新",
      text: `${shortCompanyName(hkLead.name, "新股", 6)} · ${hkLead.badge || hkLead.one || "对照申购结论"}`,
      market: "hk",
      targetId: String(hkLead.id || ""),
    });
  } else {
    lines.push({
      id: "hk-empty",
      kind: "market",
      title: "港股打新",
      text: "暂无可核验在售新股，保持空白不强行补位",
      market: "hk",
      targetId: "",
    });
  }

  const usLead = bestByScore(allItems(snapshot, "us"));
  if (usLead) {
    lines.push({
      id: `us-${usLead.id}`,
      kind: "market",
      title: "美股思路",
      text: `${usLead.code || usLead.id} · ${String(usLead.one || "对照价格与财报").slice(0, 28)}`,
      market: "us",
      targetId: String(usLead.id || usLead.code || ""),
    });
  }

  const aLead = bestByScore(allItems(snapshot, "a"));
  if (aLead) {
    lines.push({
      id: `a-${aLead.id}`,
      kind: "market",
      title: "收息思路",
      text: `${shortCompanyName(aLead.name, "收息", 6)} · ${String(aLead.one || aLead.badge || "股息与现金流").slice(0, 28)}`,
      market: "a",
      targetId: String(aLead.id || ""),
    });
  }

  const gold = snapshot.gold || {};
  const goldAction = gold.answer?.action || gold.answer?.researchLabel;
  const goldPrice = gold.quotes?.international?.price;
  lines.push({
    id: "gold-track",
    kind: "market",
    title: "黄金观察",
    text: [
      goldAction || "对照买卖观察区",
      hasNumber(goldPrice) ? `国际金 ${Math.round(Number(goldPrice))}` : null,
    ].filter(Boolean).join(" · "),
    market: "gold",
    targetId: "track",
  });

  const gurus = allItems(snapshot, "guru").slice(0, 3);
  gurus.forEach((item) => {
    const why = String(item.raw?.profile?.why || item.one || "").slice(0, 26);
    lines.push({
      id: `guru-${item.id}`,
      kind: "guru",
      title: shortCompanyName(item.name, "机构", 8),
      text: why || "先学 WHY/HOW，再对照公开持仓",
      market: "guru",
      targetId: String(item.id || ""),
    });
  });

  playbookTickerLines().slice(0, 4).forEach((item) => lines.push(item));

  return lines.slice(0, 12);
}

module.exports = { buildThesisTicker };
