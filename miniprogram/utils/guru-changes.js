/**
 * 聪明人持仓：季度变化与披露滞后（公开资料，不构成跟仓信号）。
 */
// 「本期有几项仓位变化」以前是反向判断：只要 changeLabel 不是「不变/持平/待核」
// 就算一次变化。港股三只基金的持仓来自月报，标注是「月报持有」「半年报持有」，
// 于是三只都被算成「本期有 3 项仓位变化」——月报根本没说有变化。改成正向匹配
// 真正表示变动的标注（13F 侧是「新进 / 增持 +X% / 减持 -X%」）。
const POSITION_CHANGE_RE = /新进|新建|增持|加仓|减持|减仓|清仓|退出/u;

function isPositionChange(holding) {
  return POSITION_CHANGE_RE.test(String((holding && holding.changeLabel) || ""));
}

function lagDays(filingDate) {
  const time = Date.parse(filingDate);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function buildGuruChanges(snapshot) {
  const list = (snapshot && snapshot.investors) || [];
  return list.map((item) => {
    const holdings = Array.isArray(item.holdings) ? item.holdings : [];
    const sold = Array.isArray(item.sold) ? item.sold : [];
    const increased = holdings.filter((row) => /增|加|new|increase/i.test(String(row.changeType || row.changeLabel || "")));
    const decreased = holdings.filter((row) => /减|削|decrease/i.test(String(row.changeType || row.changeLabel || "")));
    const unchanged = holdings.filter((row) => {
      const label = String(row.changeType || row.changeLabel || "");
      return /same|不变|持平/i.test(label) || (!increased.includes(row) && !decreased.includes(row) && !sold.find((s) => s.ticker === row.ticker));
    });
    const lag = lagDays(item.filingDate);
    return {
      id: item.id || item.name,
      name: item.name || "机构",
      filingDate: item.filingDate || "",
      previousReportDate: item.previousReportDate || "",
      source: item.source || "SEC 13F / 公开披露",
      sourceUrl: item.sourceUrl || "",
      lagDays: lag,
      lagLabel: lag == null ? "披露日期待核验" : `披露已过去 ${lag} 天（滞后，不可当实时机会）`,
      increased: increased.slice(0, 8).map(simplifyHolding),
      decreased: decreased.slice(0, 8).map(simplifyHolding),
      sold: sold.slice(0, 8).map((row) => ({
        ticker: row.ticker || "",
        name: row.issuer || row.name || row.ticker || "",
        changeLabel: "退出",
      })),
      topHoldings: holdings.slice(0, 5).map(simplifyHolding),
      summary: [
        increased.length ? `增持/新建 ${increased.length}` : "",
        decreased.length ? `减持 ${decreased.length}` : "",
        sold.length ? `退出 ${sold.length}` : "",
        !increased.length && !decreased.length && !sold.length ? "本期未见显著标注变化" : "",
      ].filter(Boolean).join(" · "),
    };
  });
}

function simplifyHolding(row) {
  return {
    ticker: row.ticker || "",
    name: row.issuer || row.name || row.ticker || "",
    weight: row.weight != null ? Number(row.weight) : null,
    changeLabel: row.changeLabel || row.changeType || "",
  };
}

module.exports = { buildGuruChanges, isPositionChange, lagDays };
