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
  if (!values.length) return { n: 0, p25: null, p50: null, p75: null, positive: 0 };
  return {
    n: values.length,
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    // 只有区间说明不了问题：-1.2%～+57.0% 看着很诱人，可中位数其实是 0。
    // 收正只数是同一件事的另一种说法，两个一起给，读的人才知道该期待什么。
    positive: values.filter((value) => value > 0).length,
  };
}

// 公开超购倍数是这批样本里唯一把结果劈成两半的字段，而且是断层式的、不是渐变：
// 过千倍的四只暗盘全部收涨（中位 +137%），不到千倍的六只只有两只收涨（中位 -0.8%）。
// 把两档混进一个中位数会得到 "+0.6%"——它既不像热的那档也不像冷的那档，
// 等于对谁都没用。所以分档给，并且把每档的只数摆在明面上。
const HK_HOT_OVERSUBSCRIPTION = 1000;

function oversubscriptionOf(item) {
  const value = Number(item?.publicOversubscription);
  return Number.isFinite(value) && item?.publicOversubscription !== null ? value : null;
}

function tierIdOf(value) {
  if (value == null) return "unknown";
  return value >= HK_HOT_OVERSUBSCRIPTION ? "hot" : "cool";
}

function tierBands(recent, id) {
  const rows = (recent || []).filter((item) => tierIdOf(oversubscriptionOf(item)) === id);
  return {
    id,
    n: rows.length,
    names: rows.map((item) => item?.name).filter(Boolean),
    grey: bandFromValues(collectChanges(rows, "greyMarketChange")),
    firstDay: bandFromValues(collectChanges(rows, "firstDayChange")),
    fiveDay: bandFromValues(collectChanges(rows, "fiveDayChange")),
  };
}

function buildHkExitBands(snapshot) {
  const recent = Array.isArray(snapshot?.hk?.history) ? snapshot.hk.history : [];
  return {
    sampleCount: recent.length,
    grey: bandFromValues(collectChanges(recent, "greyMarketChange")),
    firstDay: bandFromValues(collectChanges(recent, "firstDayChange")),
    fiveDay: bandFromValues(collectChanges(recent, "fiveDayChange")),
    hot: tierBands(recent, "hot"),
    cool: tierBands(recent, "cool"),
    unknown: tierBands(recent, "unknown"),
  };
}

// 一句话把两档摆在一起。谁都不改谁，读的人自己看落在哪边。
function formatTierSplit(bands, key) {
  const hot = bands?.hot?.[key];
  const cool = bands?.cool?.[key];
  if (!hot?.n || !cool?.n) return "";
  return [
    `超购 ${HK_HOT_OVERSUBSCRIPTION} 倍以上 ${hot.n} 只：${formatExitMedian(hot)}、${formatExitPositive(hot)}`,
    `不到 ${HK_HOT_OVERSUBSCRIPTION} 倍 ${cool.n} 只：${formatExitMedian(cool)}、${formatExitPositive(cool)}`,
  ].join("；");
}

// 详情页一行摆两档：中位 + 映射到招股价的对照价 + 收正只数。混算的那个中位
// 两边都不像，所以只要分得开就不再把它摆在主位。
function tierRow(bands, key, offer) {
  const hot = bands?.hot?.[key];
  const cool = bands?.cool?.[key];
  if (!hot?.n || !cool?.n) return "";
  const price = (band) => {
    const mapped = mapOfferMedian(offer, band);
    return mapped ? `约 ${mapped}` : "";
  };
  return [
    `超购 ${HK_HOT_OVERSUBSCRIPTION} 倍以上 ${hot.n} 只 ${formatExitMedian(hot)}${price(hot) ? ` ${price(hot)}` : ""}（${hot.positive}/${hot.n} 收正）`,
    `不到 ${HK_HOT_OVERSUBSCRIPTION} 倍 ${cool.n} 只 ${formatExitMedian(cool)}${price(cool) ? ` ${price(cool)}` : ""}（${cool.positive}/${cool.n} 收正）`,
  ].join(" · ");
}

// 招股期内超购还没公布，只能给「到时候看哪一档」；已公布就直接落到那一档。
function tierForListing(bands, item) {
  const value = oversubscriptionOf(item);
  if (value == null) return null;
  const picked = bands?.[tierIdOf(value)];
  return picked && picked.n ? { ...picked, oversubscription: value } : null;
}

function formatExitBand(band) {
  if (!band || !band.n || band.p25 == null || band.p75 == null) return "样本不足";
  return `${percentText(band.p25)}～${percentText(band.p75)}（n=${band.n}）`;
}

// p50 一直算了却从来没露过面。区间不告诉人中间在哪儿，而中间那个数才是
// 「多少钱卖合适」真正要看的——首日中位是 0.0%，意思是一半样本首日根本不赚钱。
function formatExitMedian(band) {
  if (!band || !band.n || band.p50 == null) return "";
  return `中位 ${percentText(band.p50)}`;
}

// 「12 只中 6 只收正」比胜率百分比更好读，也不会被四舍五入糊掉分母。
function formatExitPositive(band) {
  if (!band || !band.n || band.positive == null) return "";
  return `${band.n} 只中 ${band.positive} 只收正`;
}

// 中位数映射到招股价上的整数对照价，和 mapOfferBand 用同一套取整口径。
function mapOfferMedian(offer, band) {
  if (!hasNumber(offer) || !band || band.p50 == null) return null;
  return `${Math.round(Number(offer) * (1 + Number(band.p50) / 100))} 港元`;
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
          value: tierRow(bands, "grey", offer)
            || [
              formatExitMedian(bands.grey),
              mapOfferMedian(offer, bands.grey) ? `约 ${mapOfferMedian(offer, bands.grey)}` : null,
              formatExitPositive(bands.grey),
              `区间 ${formatExitBand(bands.grey)}`,
            ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "首日观察分位",
          value: tierRow(bands, "firstDay", offer)
            || [
              formatExitMedian(bands.firstDay),
              mapOfferMedian(offer, bands.firstDay) ? `约 ${mapOfferMedian(offer, bands.firstDay)}` : null,
              formatExitPositive(bands.firstDay),
              `区间 ${formatExitBand(bands.firstDay)}`,
            ].filter(Boolean).join(" · "),
          locked: false,
        },
        {
          label: "首周观察分位",
          value: [
            formatExitMedian(bands.fiveDay),
            mapOfferMedian(offer, bands.fiveDay) ? `约 ${mapOfferMedian(offer, bands.fiveDay)}` : null,
            formatExitPositive(bands.fiveDay),
            `区间 ${formatExitBand(bands.fiveDay)}`,
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
        ? `历史样本 ${bands.sampleCount} 只，按公开超购倍数分档取中位；整数对照价不是本股保证卖出价。`
        : "历史样本不足"),
    disclaimer: "",
  };
}

module.exports = {
  buildHkExitPlan,
  buildHkExitBands,
  formatTierSplit,
  tierForListing,
  HK_HOT_OVERSUBSCRIPTION,
  formatExitBand,
  formatExitMedian,
  formatExitPositive,
  mapOfferBand,
  mapOfferMedian,
};
