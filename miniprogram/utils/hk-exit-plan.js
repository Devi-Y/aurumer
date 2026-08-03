/**
 * 港股打新：免费看「是否申购 + 中签」；会员看「暗盘/首周出价观察」。
 * 出价为研究观察价，不是买卖指令，也不承诺收益。
 */
function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function parseOfferPrice(raw = {}) {
  if (hasNumber(raw.priceHigh) && hasNumber(raw.priceLow)) {
    return (Number(raw.priceLow) + Number(raw.priceHigh)) / 2;
  }
  if (hasNumber(raw.priceHigh)) return Number(raw.priceHigh);
  if (hasNumber(raw.priceLow)) return Number(raw.priceLow);
  if (hasNumber(raw.offerPrice)) return Number(raw.offerPrice);
  const match = String(raw.offerPrice || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function moneyHkd(value) {
  if (!hasNumber(value)) return "待测算";
  return `${Number(value).toFixed(2)} 港元`;
}

function priceFromChange(base, changePercent) {
  if (!hasNumber(base) || !hasNumber(changePercent)) return null;
  return Number(base) * (1 + Number(changePercent) / 100);
}

function cohortAverages(evidence) {
  const hk = evidence?.markets?.hk || {};
  return {
    grey: hasNumber(hk.averageGreyMarket) ? Number(hk.averageGreyMarket) : null,
    week: hasNumber(hk.averageFirstDay) ? Number(hk.averageFirstDay) : null,
    sample: Number(hk.points || 0),
  };
}

/**
 * @param {object} item answers item
 * @param {object} options
 * @param {boolean} options.memberActive
 * @param {object} [options.evidence] strategy-evidence (backend-synced, not shown as panel)
 */
function buildHkExitPlan(item, options = {}) {
  const raw = item?.raw || {};
  const review = raw.historicalReview || {};
  const ended = item?.group === "ended";
  const base = parseOfferPrice(raw);
  const cohort = cohortAverages(options.evidence);
  const memberActive = Boolean(options.memberActive);

  let greyChange = hasNumber(review.greyMarketChange) ? Number(review.greyMarketChange) : null;
  let weekChange = hasNumber(review.fiveDayChange)
    ? Number(review.fiveDayChange)
    : (hasNumber(review.firstDayChange) ? Number(review.firstDayChange) : null);
  let basis = ended ? "按已披露暗盘/首周涨跌推算观察价" : "";

  if (!ended) {
    greyChange = cohort.grey;
    weekChange = cohort.week;
    basis = cohort.sample
      ? `按历史 IPO 样本均值推算观察价（样本 ${cohort.sample}）`
      : "历史样本不足，暂无法推算";
  }

  const greyExit = priceFromChange(base, greyChange);
  const weekExit = priceFromChange(base, weekChange);
  const ready = Boolean(base && (greyExit != null || weekExit != null));

  return {
    show: item?.market === "hk" && item?.group !== "cancelled",
    memberActive,
    locked: !memberActive,
    title: "会员出价观察",
    rows: [
      {
        label: "暗盘观察出价",
        value: memberActive ? moneyHkd(greyExit) : "开通后可见",
        locked: !memberActive,
      },
      {
        label: "首周观察出价",
        value: memberActive ? moneyHkd(weekExit) : "开通后可见",
        locked: !memberActive,
      },
    ],
    ready,
    basis: memberActive
      ? (ready ? basis : "招股价或样本不足，暂无法给出观察出价")
      : "免费看是否申购与中签；会员可查看暗盘/首周出价观察。",
    disclaimer: "研究观察价，供对照记录；不是买卖指令，不承诺收益。",
  };
}

module.exports = {
  buildHkExitPlan,
  parseOfferPrice,
};
