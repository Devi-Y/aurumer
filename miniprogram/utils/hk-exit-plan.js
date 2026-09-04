/**
 * 港股打新：免费看「是否申购 + 中签 + 打中后观察分位」。
 * 不输出精确到分的港元卖出价——样本分位映射只保留整数对照，并标明不是本股预测。
 */
const { percentile, parseOfferPrice, hasNumber } = require("./market-lenses");

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
  const amount = Number(value);
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(1)}%`;
}

function collectChanges(history, key) {
  return (history || [])
    .map((item) => Number(item?.historicalReview?.[key] ?? item?.[key]))
    .filter((value) => Number.isFinite(value));
}

function bandFromValues(values) {
  if (!values.length) return { n: 0, p25: null, p50: null, p75: null };
  return {
    n: values.length,
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
  };
}

function buildHkExitBands(snapshot) {
  const recent = Array.isArray(snapshot?.hk?.history) ? snapshot.hk.history : [];
  return {
    sampleCount: recent.length,
    grey: bandFromValues(collectChanges(recent, "greyMarketChange")),
    firstDay: bandFromValues(collectChanges(recent, "firstDayChange")),
    fiveDay: bandFromValues(collectChanges(recent, "fiveDayChange")),
  };
}

function formatExitBand(band) {
  if (!band || !band.n || band.p25 == null || band.p75 == null) return "样本不足";
  return `${percentText(band.p25)}～${percentText(band.p75)}（n=${band.n}）`;
}

function mapOfferBand(offer, band) {
  if (!hasNumber(offer) || !band || band.p25 == null || band.p75 == null) return null;
  const low = Math.round(Number(offer) * (1 + Number(band.p25) / 100));
  const high = Math.round(Number(offer) * (1 + Number(band.p75) / 100));
  // 这是招股价映射出来的价格区间，页面上一直只写「约 19–31」，没有单位。
  // 上游 offerPrice 本身就是「19.55 港元」，口径明确，照实带上。
  return `${low}–${high} 港元`;
}

function impliedDisclosed(offer, change) {
  if (!hasNumber(offer) || !hasNumber(change)) return null;
  return Math.round(Number(offer) * (1 + Number(change) / 100));
}

/**
 * @param {object} item answers item
 * @param {object} options
 * @param {object} [options.evidence] strategy-evidence
 * @param {object} [options.snapshot]
 */
function buildHkExitPlan(item, options = {}) {
  if (item?.market !== "hk" || item?.group === "cancelled") {
    return { show: false };
  }

  const raw = item?.raw || {};
  const review = raw.historicalReview || {};
  const ended = item?.group === "ended";
  const cohort = cohortAverages(options.evidence);
  const bands = buildHkExitBands(options.snapshot);
  const offer = parseOfferPrice(raw.offerPrice || raw.priceHigh || raw.priceLow);

  const rows = ended
    ? [
        {
          label: "已披露暗盘涨跌",
          value: [
            percentText(review.greyMarketChange),
            impliedDisclosed(offer, review.greyMarketChange) != null
              ? `对照约 ${impliedDisclosed(offer, review.greyMarketChange)}`
              : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "已披露首日涨跌",
          value: [
            percentText(review.firstDayChange),
            impliedDisclosed(offer, review.firstDayChange) != null
              ? `对照约 ${impliedDisclosed(offer, review.firstDayChange)}`
              : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "已披露五日涨跌",
          value: [
            percentText(review.fiveDayChange),
            impliedDisclosed(offer, review.fiveDayChange) != null
              ? `对照约 ${impliedDisclosed(offer, review.fiveDayChange)}`
              : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
      ]
    : [
        {
          label: "暗盘观察分位",
          value: [
            formatExitBand(bands.grey),
            mapOfferBand(offer, bands.grey) ? `对照约 ${mapOfferBand(offer, bands.grey)}` : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "首日观察分位",
          value: [
            formatExitBand(bands.firstDay),
            mapOfferBand(offer, bands.firstDay) ? `对照约 ${mapOfferBand(offer, bands.firstDay)}` : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "首周观察分位",
          value: [
            formatExitBand(bands.fiveDay),
            mapOfferBand(offer, bands.fiveDay) ? `对照约 ${mapOfferBand(offer, bands.fiveDay)}` : null,
          ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "历史样本首日胜率",
          value: hasNumber(cohort.winRate) ? `${Number(cohort.winRate).toFixed(1)}%` : "样本不足",
          locked: false,
        },
      ].filter((row) => row.value && row.value !== "样本不足");

  const ready = rows.some((row) => row.value && row.value !== "样本不足");

  return {
    show: ready,
    memberActive: true,
    locked: false,
    title: ended ? "上市结果对照" : "打中后观察分位",
    rows,
    ready,
    basis: ended
      ? "已披露涨跌与招股价对照，不是下一只新股的卖出价。"
      : (bands.sampleCount
        ? `历史样本 ${bands.sampleCount} 只的 25%–75% 分位；整数对照价不是本股保证卖出价。`
        : "历史样本不足"),
    disclaimer: "",
  };
}

module.exports = {
  buildHkExitPlan,
  buildHkExitBands,
  formatExitBand,
  mapOfferBand,
};
