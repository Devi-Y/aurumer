/**
 * 四品类公开「研究评分」：偏向更高预期研究收益的透明公式。
 * 只使用已同步公开字段，不是内部模型荐股分，也不承诺收益。
 */
function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function clamp(value, low = 0, high = 100) {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function hkScore(item) {
  const raw = item?.raw || {};
  const answer = raw.publicAnswer || {};
  // 打新收益优先：研究分高 + 建议申购档，尽量避开资料不够。
  if (hasNumber(answer.score)) {
    let score = clamp(Number(answer.score));
    if (item?.badge === "建议申购") score = clamp(score + 6);
    if (item?.badge === "暂不建议" || item?.badge === "资料不够") score = clamp(score - 12);
    return {
      score,
      label: "研究分",
      basis: "公开招股研究分（偏向建议申购档）",
    };
  }
  if (item?.badge === "建议申购") return { score: 82, label: "研究分", basis: "结论档位映射" };
  if (item?.badge === "暂缓观察") return { score: 55, label: "研究分", basis: "结论档位映射" };
  if (item?.badge === "暂不建议" || item?.badge === "资料不够") {
    return { score: 28, label: "研究分", basis: "结论档位映射" };
  }
  return { score: null, label: "研究分", basis: "资料不足" };
}

function usScore(item) {
  const raw = item?.raw || {};
  const fund = raw.fund || {};
  const heat = hasNumber(raw.heatScore) ? Number(raw.heatScore) : null;
  const pe = hasNumber(fund.pe) ? Number(fund.pe) : null;
  const roe = hasNumber(fund.roe) ? Number(fund.roe) : null;
  const margin = hasNumber(fund.profitMargin) ? Number(fund.profitMargin) : null;
  const growth = hasNumber(fund.revenueGrowth) ? Number(fund.revenueGrowth) : null;
  const weekly = hasNumber(raw.weeklyChange) ? Number(raw.weeklyChange) : null;

  // 收益导向：盈利质量 50 + 估值克制 30 + 热度 15 + 近周动能 5
  let weight = 0;
  let total = 0;
  const quality = [];
  if (roe != null) quality.push(Math.max(0, Math.min(100, roe)));
  if (margin != null) quality.push(Math.max(0, Math.min(100, margin)));
  if (growth != null) quality.push(Math.max(0, Math.min(100, 50 + growth / 2)));
  if (quality.length) {
    total += (quality.reduce((sum, value) => sum + value, 0) / quality.length) * 0.5;
    weight += 0.5;
  }
  if (pe != null && pe > 0) {
    const valuation = pe >= 80 ? 18 : pe <= 15 ? 92 : clamp(100 - pe);
    total += valuation * 0.3;
    weight += 0.3;
  }
  if (heat != null) {
    total += Math.min(100, heat) * 0.15;
    weight += 0.15;
  }
  if (weekly != null) {
    total += clamp(50 + weekly * 2) * 0.05;
    weight += 0.05;
  }
  if (!weight) return { score: null, label: "综合分", basis: "公开行情/财务不足" };
  return {
    score: clamp(total / weight),
    label: "综合分",
    basis: "盈利质量+估值克制为主（公开字段）",
  };
}

function aScore(item) {
  const raw = item?.raw || {};
  const financials = raw.financials || {};
  const yieldNow = hasNumber(raw.currentDividendYield) ? Number(raw.currentDividendYield) : null;
  const yieldSustain = hasNumber(raw.sustainableDividendYield)
    ? Number(raw.sustainableDividendYield)
    : null;
  const fcf = hasNumber(financials.freeCashFlow) ? Number(financials.freeCashFlow) : null;
  const conversion = hasNumber(financials.cashConversion) ? Number(financials.cashConversion) : null;
  const change = hasNumber(raw.changePercent) ? Number(raw.changePercent) : null;

  // 收息收益：可持续股息权重大于瞬时高股息，避免追不可持续分红。
  let total = 0;
  let weight = 0;
  if (yieldSustain != null) {
    total += Math.min(100, yieldSustain * 13) * 0.4;
    weight += 0.4;
  }
  if (yieldNow != null) {
    total += Math.min(100, yieldNow * 12) * 0.3;
    weight += 0.3;
  }
  if (fcf != null) {
    total += (fcf > 0 ? 80 : 20) * 0.2;
    weight += 0.2;
  }
  if (conversion != null) {
    total += Math.min(100, Math.max(20, conversion * 40)) * 0.1;
    weight += 0.1;
  }
  // 轻微惩罚当日大跌（可能含风险事件），不追涨杀跌。
  if (change != null && change <= -5 && weight) {
    total = Math.max(0, total - 4 * weight);
  }
  if (!weight) return { score: null, label: "收息分", basis: "公开股息/现金流不足" };
  return {
    score: clamp(total / weight),
    label: "收息分",
    basis: "可持续股息+当前股息+现金流（公开字段）",
  };
}

function goldScore(item) {
  const gold = item?.raw || {};
  const answer = gold.answer || {};
  const international = gold.quotes?.international || {};
  let score = hasNumber(answer.score) ? Number(answer.score) : null;
  const percentile = hasNumber(international.percentile180)
    ? Number(international.percentile180)
    : null;
  // 位置偏低更利于观察买入收益空间；过高则降分。
  if (score != null && percentile != null) {
    if (percentile <= 35) score += 8;
    else if (percentile >= 80) score -= 8;
    score = clamp(score);
  } else if (score != null) {
    score = clamp(score);
  }
  if (score == null) return { score: null, label: "观察分", basis: "观察分暂缺" };
  return {
    score,
    label: "观察分",
    basis: "金价观察分+半年位置（公开字段）",
  };
}

function scoreForItem(item) {
  if (!item) return { score: null, label: "评分", basis: "无标的" };
  if (item.market === "hk") return hkScore(item);
  if (item.market === "us") return usScore(item);
  if (item.market === "a") return aScore(item);
  if (item.market === "gold") return goldScore(item);
  return { score: null, label: "评分", basis: "本页不打分" };
}

module.exports = {
  scoreForItem,
  hkScore,
  usScore,
  aScore,
  goldScore,
};
