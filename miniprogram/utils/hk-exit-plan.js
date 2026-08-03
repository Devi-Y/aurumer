/**
 * 港股打新：免费看「是否申购 + 中签」。
 * 不再提供精确到分的「暗盘/首周出价」——样本均值 × 招股价属于假精确，也不作为会员商品。
 */
function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function cohortAverages(evidence) {
  const hk = evidence?.markets?.hk || {};
  return {
    grey: hasNumber(hk.averageGreyMarket) ? Number(hk.averageGreyMarket) : null,
    firstDay: hasNumber(hk.averageFirstDay) ? Number(hk.averageFirstDay) : null,
    winRate: hasNumber(hk.firstDayWinRate) ? Number(hk.firstDayWinRate) : null,
    sample: Number(hk.points || 0),
  };
}

function percentText(value) {
  if (!hasNumber(value)) return "样本不足";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

/**
 * @param {object} item answers item
 * @param {object} options
 * @param {object} [options.evidence] strategy-evidence
 */
function buildHkExitPlan(item, options = {}) {
  if (item?.market !== "hk" || item?.group === "cancelled") {
    return { show: false };
  }

  const raw = item?.raw || {};
  const review = raw.historicalReview || {};
  const ended = item?.group === "ended";
  const cohort = cohortAverages(options.evidence);

  const rows = ended
    ? [
        { label: "已披露暗盘涨跌", value: percentText(review.greyMarketChange), locked: false },
        { label: "已披露首日涨跌", value: percentText(review.firstDayChange), locked: false },
        { label: "已披露五日涨跌", value: percentText(review.fiveDayChange), locked: false },
      ]
    : [
        { label: "历史样本暗盘均值", value: percentText(cohort.grey), locked: false },
        { label: "历史样本首日均值", value: percentText(cohort.firstDay), locked: false },
        { label: "历史样本首日胜率", value: hasNumber(cohort.winRate) ? `${Number(cohort.winRate).toFixed(1)}%` : "样本不足", locked: false },
      ].filter((row) => row.value !== "样本不足" || cohort.sample > 0);

  const ready = rows.some((row) => row.value && row.value !== "样本不足");

  return {
    show: ready,
    memberActive: true,
    locked: false,
    title: ended ? "上市结果对照" : "历史样本对照",
    rows,
    ready,
    basis: ended
      ? "已披露涨跌对照，不作出价。"
      : (cohort.sample
        ? `历史样本 ${cohort.sample} 个均值/胜率，非本股预测价。`
        : "历史样本不足"),
    disclaimer: "",
  };
}

module.exports = {
  buildHkExitPlan,
};
