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
  return { score: null, label: "研究分", basis: "资料不足" };
}

// 资料排序：盈利质量 50 + 估值 30 + 热度 15 + 近周变动 5（经验权重，非回测策略）。
// 每一项自己的 0–100 分和权重；缺哪项就少哪项，总分按剩下的权重折回 100。
function usParts(item) {
  const raw = item?.raw || {};
  const fund = raw.fund || {};
  const heat = hasNumber(raw.heatScore) ? Number(raw.heatScore) : null;
  const pe = hasNumber(fund.pe) ? Number(fund.pe) : null;
  const roe = hasNumber(fund.roe) ? Number(fund.roe) : null;
  const margin = hasNumber(fund.profitMargin) ? Number(fund.profitMargin) : null;
  const growth = hasNumber(fund.revenueGrowth) ? Number(fund.revenueGrowth) : null;
  const weekly = hasNumber(raw.weeklyChange) ? Number(raw.weeklyChange) : null;

  const parts = [];
  const quality = [];
  if (roe != null) quality.push(Math.max(0, Math.min(100, roe)));
  if (margin != null) quality.push(Math.max(0, Math.min(100, margin)));
  if (growth != null) quality.push(Math.max(0, Math.min(100, 50 + growth / 2)));
  if (quality.length) {
    parts.push({ label: "盈利质量", value: quality.reduce((sum, value) => sum + value, 0) / quality.length, weight: 0.5 });
  }
  if (pe != null && pe > 0) {
    parts.push({ label: "估值", value: pe >= 80 ? 18 : pe <= 15 ? 92 : clamp(100 - pe), weight: 0.3 });
  }
  if (heat != null) parts.push({ label: "热度", value: Math.min(100, heat), weight: 0.15 });
  if (weekly != null) parts.push({ label: "近一周涨跌", value: clamp(50 + weekly * 2), weight: 0.05 });
  return parts;
}

function usScore(item) {
  const parts = usParts(item);
  let weight = 0;
  let total = 0;
  parts.forEach((part) => {
    total += part.value * part.weight;
    weight += part.weight;
  });
  if (!weight) return { score: null, label: "研究观察分", basis: "公开行情/财务不足" };
  return {
    score: clamp(total / weight),
    label: "研究观察分",
    basis: "公开字段资料排序，不是收益预测",
  };
}

// 把一组小数凑成整数，且加起来正好等于 target（最大余数法），
// 这样「得分/满分」每行加起来就是总分，读的人不会觉得算错了。
function apportion(values, target) {
  const base = values.map((value) => Math.floor(value));
  let rest = target - base.reduce((sum, value) => sum + value, 0);
  values
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((left, right) => right.frac - left.frac)
    .forEach((entry) => {
      if (rest > 0) {
        base[entry.index] += 1;
        rest -= 1;
      }
    });
  return base;
}

// 研究观察分拆成每一项的「得分/满分」：满分就是这一项的权重，各项得分相加等于总分。
function usScoreRows(item) {
  const parts = usParts(item);
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  const { score } = usScore(item);
  if (!weight || score == null) return null;
  const points = apportion(parts.map((part) => (part.value * part.weight) / weight), score);
  const caps = apportion(parts.map((part) => (100 * part.weight) / weight), 100);
  return {
    score,
    rows: parts.map((part, index) => ({ label: part.label, points: points[index], max: caps[index] })),
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
  if (score == null) return { score: null, label: "综合观察分", basis: "综合观察分暂缺" };
  return {
    score,
    label: "综合观察分",
    basis: "国际金与人民币金双维度综合，不是买卖指令",
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
  usScoreRows,
  aScore,
  goldScore,
};
