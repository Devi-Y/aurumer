/**
 * 由 hk.history 现场汇总历史样本（小程序离线包不含 backtest 字段）。
 * 只展示已发生结果，不宣称预测准确率。
 */
function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function signedPercent(value, digits = 1) {
  if (!hasNumber(value)) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function rateText(wins, total, digits = 1) {
  if (!total) return "—";
  return `${((wins / total) * 100).toFixed(digits)}%`;
}

function buildHkHistoryStats(snapshot) {
  const recent = Array.isArray(snapshot?.hk?.history) ? snapshot.hk.history : [];
  const greySamples = recent.filter((item) => hasNumber(item.historicalReview?.greyMarketChange));
  const firstDaySamples = recent.filter((item) => hasNumber(item.historicalReview?.firstDayChange));
  const fiveDaySamples = recent.filter((item) => hasNumber(item.historicalReview?.fiveDayChange));
  const greyWins = greySamples.filter((item) => Number(item.historicalReview.greyMarketChange) > 0).length;
  const firstDayWins = firstDaySamples.filter((item) => Number(item.historicalReview.firstDayChange) > 0).length;
  const fiveDayWins = fiveDaySamples.filter((item) => Number(item.historicalReview.fiveDayChange) > 0).length;

  const greyAvg = greySamples.length
    ? greySamples.reduce((sum, item) => sum + Number(item.historicalReview.greyMarketChange), 0) / greySamples.length
    : null;
  const firstDayAvg = firstDaySamples.length
    ? firstDaySamples.reduce((sum, item) => sum + Number(item.historicalReview.firstDayChange), 0) / firstDaySamples.length
    : null;

  const directionMatch = recent.filter((item) => {
    const grey = Number(item.historicalReview?.greyMarketChange);
    const first = Number(item.historicalReview?.firstDayChange);
    if (!Number.isFinite(grey) || !Number.isFinite(first)) return false;
    return (grey >= 0 && first >= 0) || (grey < 0 && first < 0);
  }).length;
  const directionTotal = recent.filter((item) => (
    hasNumber(item.historicalReview?.greyMarketChange)
    && hasNumber(item.historicalReview?.firstDayChange)
  )).length;

  return {
    sampleCount: recent.length,
    greyWinRate: rateText(greyWins, greySamples.length),
    firstDayWinRate: rateText(firstDayWins, firstDaySamples.length),
    fiveDayWinRate: rateText(fiveDayWins, fiveDaySamples.length),
    averageGrey: signedPercent(greyAvg),
    averageFirstDay: signedPercent(firstDayAvg),
    greyToFirstDirection: rateText(directionMatch, directionTotal),
    directionSamples: directionTotal,
    summary: recent.length
      ? `样本 ${recent.length} · 首日上涨 ${rateText(firstDayWins, firstDaySamples.length)} · 暗盘→首日同向 ${rateText(directionMatch, directionTotal)}（n=${directionTotal}）`
      : "暂无已收录历史样本",
    disclaimer: "以上为已发生历史结果，不是下一只新股的预测准确率。",
  };
}

function extractSponsorNames(row) {
  if (Array.isArray(row?.sponsorNames) && row.sponsorNames.length) {
    return row.sponsorNames.map((name) => String(name).trim()).filter(Boolean);
  }
  const text = String(row?.sponsor || row?.sponsors || "").trim();
  if (!text || /见历史|见招股|待/.test(text)) return [];
  return text.split(/[、,，/]/).map((name) => name.trim()).filter(Boolean);
}

function buildGroupedHistoryStats(recent, namePicker) {
  const groups = new Map();
  for (const row of recent) {
    const names = namePicker(row);
    const firstDay = Number(row.historicalReview?.firstDayChange ?? row.firstDayChange);
    const grey = Number(row.historicalReview?.greyMarketChange ?? row.greyMarketChange);
    for (const name of names) {
      if (!name) continue;
      if (!groups.has(name)) {
        groups.set(name, {
          name,
          sampleCount: 0,
          firstDayWins: 0,
          firstDayValues: [],
          greyValues: [],
        });
      }
      const group = groups.get(name);
      group.sampleCount += 1;
      if (Number.isFinite(firstDay)) {
        group.firstDayValues.push(firstDay);
        if (firstDay > 0) group.firstDayWins += 1;
      }
      if (Number.isFinite(grey)) group.greyValues.push(grey);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      sampleCount: group.sampleCount,
      winRate: group.firstDayValues.length
        ? (group.firstDayWins / group.firstDayValues.length) * 100
        : null,
      averageFirstDay: group.firstDayValues.length
        ? group.firstDayValues.reduce((sum, value) => sum + value, 0) / group.firstDayValues.length
        : null,
      averageGrey: group.greyValues.length
        ? group.greyValues.reduce((sum, value) => sum + value, 0) / group.greyValues.length
        : null,
    }))
    .filter((group) => group.sampleCount > 0)
    .sort((left, right) => right.sampleCount - left.sampleCount || (right.winRate || 0) - (left.winRate || 0));
}

function buildHkIndustryStats(snapshot) {
  const recent = Array.isArray(snapshot?.hk?.history) ? snapshot.hk.history : [];
  return buildGroupedHistoryStats(recent, (row) => {
    const industry = String(row.industry || "").split("/")[0].trim();
    return industry && industry !== "待整理" ? [industry] : [];
  });
}

function buildHkSponsorStats(snapshot) {
  const recent = Array.isArray(snapshot?.hk?.history) ? snapshot.hk.history : [];
  return buildGroupedHistoryStats(recent, extractSponsorNames);
}

module.exports = {
  buildHkHistoryStats,
  buildHkIndustryStats,
  buildHkSponsorStats,
};
