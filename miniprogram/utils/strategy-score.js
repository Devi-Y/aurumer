/**
 * 四品类公开「研究观察分」：用公开字段做资料排序，不是已验证收益策略。
 * 不承诺收益，不作为买卖指令。
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
  // 港股只采用公开招股研究分，避免前端再叠一套加减分。
  if (hasNumber(answer.score)) {
    return {
      score: clamp(Number(answer.score)),
      label: "研究分",
      basis: "公开招股研究分（单一口径）",
    };
  }
  if (item?.badge === "建议申购") return { score: 82, label: "研究分", basis: "按结论档位" };
  if (item?.badge === "暂缓观察") return { score: 55, label: "研究分", basis: "按结论档位" };
  if (item?.badge === "暂不建议" || item?.badge === "资料不够") {
    return { score: 28, label: "研究分", basis: "按结论档位" };
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

  // 资料排序：盈利质量 50 + 估值 30 + 热度 15 + 近周变动 5（经验权重，非回测策略）
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
  if (!weight) return { score: null, label: "研究观察分", basis: "公开行情/财务不足" };
  return {
    score: clamp(total / weight),
    label: "研究观察分",
    basis: "公开字段资料排序，不是收益预测",
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
  const ocf = hasNumber(financials.operatingCashFlow) ? Number(financials.operatingCashFlow) : null;
  const conversion = hasNumber(financials.cashConversion) ? Number(financials.cashConversion) : null;
  const roe = hasNumber(financials.roe) ? Number(financials.roe) : null;
  const change = hasNumber(raw.changePercent) ? Number(raw.changePercent) : null;

  let total = 0;
  let weight = 0;

  // 可持续股息：现金支撑能力，不只看账面股息率
  if (yieldSustain != null) {
    total += Math.min(100, yieldSustain * 11) * 0.22;
    weight += 0.22;
  }
  if (yieldNow != null) {
    total += Math.min(100, yieldNow * 10) * 0.16;
    weight += 0.16;
  }
  // 可持续 vs 当前：差距过大说明高息难持续
  if (yieldNow != null && yieldSustain != null && yieldNow > 0) {
    const cover = Math.min(1.2, Math.max(0, yieldSustain / yieldNow));
    total += cover * 85 * 0.14;
    weight += 0.14;
  }
  if (fcf != null) {
    total += (fcf > 0 ? 82 : 18) * 0.18;
    weight += 0.18;
  } else if (ocf != null) {
    total += (ocf > 0 ? 70 : 25) * 0.12;
    weight += 0.12;
  }
  if (conversion != null) {
    total += Math.min(100, Math.max(15, conversion * 38)) * 0.14;
    weight += 0.14;
  }
  if (roe != null) {
    total += Math.min(100, Math.max(20, roe * 4)) * 0.1;
    weight += 0.1;
  }
  if (change != null && change <= -6 && weight) {
    total = Math.max(0, total - 5 * weight);
  }
  if (!weight) return { score: null, label: "收息观察分", basis: "公开股息/现金流不足" };
  return {
    score: clamp(total / weight),
    label: "收息观察分",
    basis: "股息+可持续性+现金流+ROE 综合排序",
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
    basis: "公开金价观察分与半年位置，不是买卖指令",
  };
}

function scoreForItem(item) {
  if (!item) return { score: null, label: "观察分", basis: "无标的" };
  if (item.market === "hk") return hkScore(item);
  if (item.market === "us") return usScore(item);
  if (item.market === "a") return aScore(item);
  if (item.market === "gold") return goldScore(item);
  return { score: null, label: "观察分", basis: "本页不打分" };
}

module.exports = {
  scoreForItem,
  hkScore,
  usScore,
  aScore,
  goldScore,
};
