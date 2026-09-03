/**
 * 五个栏目共用的「策略信号」层。
 *
 * 这里不预测确定收益，而是把公开数据翻译成三件用户真正能用的事：
 * 当前状态、为什么这样判断、什么变化会触发重新评估。
 */

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNumber(value) {
  return number(value) !== null;
}

function clamp(value, low = 0, high = 100) {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function formatPercent(value, digits = 1) {
  const parsed = number(value);
  if (parsed === null) return "待核";
  return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(digits)}%`;
}

function historyPosition(history, current) {
  const values = (history || [])
    .map((entry) => number(entry?.close ?? entry))
    .filter((value) => value !== null);
  const price = number(current);
  if (values.length < 2 || price === null) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high === low ? 50 : clamp(((price - low) / (high - low)) * 100);
}

function toneFor(label) {
  if (/回避|风险升高|高息待核|资料不足|披露滞后|过热/u.test(label)) return "bad";
  if (/等待|分歧|先核|观察|复核/u.test(label)) return "warn";
  return "good";
}

function hkSignal(item, evidence = {}) {
  const raw = item?.raw || {};
  const answer = raw.publicAnswer || {};
  const verdict = String(answer.verdict || "");
  const ended = item?.group === "ended";
  const required = [
    raw.offerPrice || raw.priceLow || raw.priceHigh,
    raw.entryFee,
    raw.offerDeadline || raw.offerEnd,
    answer.score,
  ];
  const missing = required.filter((value) => !hasNumber(value) && !String(value || "").trim()).length;
  const crowd = number(raw.publicOversubscription);
  const lotRate = number(raw.oneLotRate);
  const historical = evidence?.markets?.hk || {};
  const riskReasons = [];
  if (missing > 0) riskReasons.push(`关键字段缺 ${missing} 项`);
  if (crowd !== null && crowd >= 500) riskReasons.push(`公开认购 ${crowd.toFixed(0)} 倍，拥挤度高`);
  if (lotRate !== null && lotRate < 1) riskReasons.push(`一手中签率 ${lotRate.toFixed(1)}%`);

  if (ended) {
    return {
      label: "只做复盘",
      tone: "muted",
      action: "历史结果只能检验当时的判断，不反推下一只新股。",
      trigger: "下一只 IPO 补齐招股价、一手金额、截止日和风险字段后再评估。",
      basis: "事件样本，不是持续收益策略",
    };
  }
  if (raw.withdrawn || raw.researchView?.state === "withdrawn") {
    return {
      label: "不再申购",
      tone: "bad",
      action: "发行已取消，资金不应继续占用在这次发行上。",
      trigger: "只有出现新的正式发行公告才重新建立样本。",
      basis: "以港交所/公司公告为准",
    };
  }
  if (missing > 0 || verdict === "待核验") {
    return {
      label: "等待补齐",
      tone: "warn",
      action: "资料门禁未通过，先不把不完整资料当成申购机会。",
      trigger: `补齐${riskReasons.length ? `：${riskReasons.join("、")}` : "关键招股字段"}后再评估。`,
      basis: "资料完整度优先于分数",
    };
  }
  if (verdict === "不建议" || riskReasons.length >= 2) {
    return {
      label: "风险偏高",
      tone: "bad",
      action: "先回避；高热度或低中签率不能抵消破发风险。",
      trigger: `风险线索：${riskReasons.join("、") || "公开结论为不建议"}。`,
      basis: "研究结论 + 认购拥挤度 + 中签率",
    };
  }
  if (verdict === "值得打") {
    const winRate = number(historical.firstDayWinRate);
    return {
      label: "可研究申购",
      tone: "good",
      action: "只在一手资金可承受、公告字段无冲突时考虑一手，不因历史胜率加杠杆。",
      trigger: riskReasons.length
        ? `出现${riskReasons.join("、")}时降级为等待。`
        : `若截止前结论、招股价或市场热度变化，重新核验${winRate !== null ? `；历史样本首日胜率约 ${winRate.toFixed(1)}% 仅作背景` : ""}。`,
      basis: "公开结论 + 一手风险门禁",
    };
  }
  return {
    label: "继续观察",
    tone: "warn",
    action: "结论没有形成优势，先等关键字段和市场热度稳定。",
    trigger: "结论转为值得打且资料完整，才进入研究申购；否则不追。",
    basis: "不确定性优先",
  };
}

function usSignal(item) {
  const raw = item?.raw || {};
  const fund = raw.fund || {};
  const pe = number(fund.pe);
  const growth = number(fund.revenueGrowth);
  const margin = number(fund.profitMargin);
  const roe = number(fund.roe);
  const ocf = number(fund.operatingCashFlow);
  const capex = number(fund.capitalExpenditures);
  const weekly = number(raw.weeklyChange);
  const position = historyPosition(raw.history, raw.price);
  const risks = [];
  if (pe !== null && pe >= 55) risks.push(`PE ${pe.toFixed(1)} 倍偏高`);
  if (position !== null && position >= 85) risks.push(`近60日位置 ${position}%`);
  if (weekly !== null && weekly <= -8) risks.push(`7日跌幅 ${formatPercent(weekly)}`);
  if (growth !== null && growth < 0) risks.push(`营收增长 ${formatPercent(growth)}`);
  if (ocf !== null && capex !== null && ocf + capex <= 0) risks.push("经营现金流覆盖不了资本开支");
  const quality = [growth !== null ? growth >= 0 : null, margin !== null ? margin >= 10 : null, roe !== null ? roe >= 12 : null, ocf !== null ? ocf > 0 : null]
    .filter((value) => value !== null);
  const qualityPass = quality.length >= 2 && quality.filter(Boolean).length >= Math.ceil(quality.length * 0.6);

  if (!quality.length || pe === null || position === null) {
    return {
      label: "资料不足",
      tone: "warn",
      action: "财报、估值或价格位置缺一项，不给出追涨判断。",
      trigger: "补齐 PE、盈利质量和近60日位置后再评估。",
      basis: "质量 + 估值 + 趋势三道门",
    };
  }
  if (risks.length >= 2 || (risks.length && !qualityPass)) {
    return {
      label: "风险升高",
      tone: "bad",
      action: "先停追，优先查财报和估值；价格下跌时不把热度当支撑。",
      trigger: `${risks.join("、")}；任一经营信号继续恶化时降低风险敞口。`,
      basis: "经营质量优先于热度",
    };
  }
  if (risks.length || position >= 72 || pe >= 40) {
    return {
      label: "等回撤",
      tone: "warn",
      action: "公司质量尚可但价格/估值不便宜，等位置回落或财报继续验证。",
      trigger: `回到近60日位置 72% 以下且盈利未恶化，再重新观察${pe >= 40 ? "；PE 下降也更重要" : ""}。`,
      basis: "质量通过，估值与位置控回撤",
    };
  }
  return {
    label: "可分批观察",
    tone: "good",
    action: "质量与位置暂未冲突，采用分批观察，不一次性追高。",
    trigger: "PE 快速上升、位置超过 85%，或营收/利润/现金流同时转弱时降级。",
    basis: "质量 + 估值 + 趋势确认",
  };
}

function aShareSignal(item) {
  const raw = item?.raw || {};
  if (raw.assetType === "fund") {
    return {
      label: "分散收息",
      tone: "good",
      action: "ETF 只能作为分散收息工具，分红不固定，不把成分股股息率当基金收益率。",
      trigger: "指数调仓、基金分红公告或场内价格明显偏离净值时重新核验。",
      basis: "产品分散，不等于保本",
    };
  }
  const financials = raw.financials || {};
  const current = number(raw.currentDividendYield);
  const sustainable = number(raw.sustainableDividendYield);
  const fcf = number(financials.freeCashFlow);
  const conversion = number(financials.cashConversion);
  const profitGrowth = number(financials.netProfitGrowth);
  const gap = current !== null && sustainable !== null ? current - sustainable : null;
  const risks = [];
  if (gap !== null && gap >= 1.2) risks.push(`当前股息比可持续股息高 ${gap.toFixed(1)} 个百分点`);
  if (fcf !== null && fcf <= 0) risks.push("自由现金流为负");
  if (conversion !== null && conversion < 1) risks.push(`现金利润比 ${conversion.toFixed(2)}`);
  if (profitGrowth !== null && profitGrowth < 0) risks.push(`净利润增长 ${formatPercent(profitGrowth)}`);
  if (current === null || sustainable === null || fcf === null) {
    return {
      label: "资料不足",
      tone: "warn",
      action: "没有同时看到股息、可持续股息和自由现金流，不把高股息直接当安全。",
      trigger: "补齐现金流和最新分红公告后再评估。",
      basis: "先看股息安全，再看股息率",
    };
  }
  if (risks.length >= 2 || (gap !== null && gap >= 1.8)) {
    return {
      label: "高息待核",
      tone: "bad",
      action: "把高股息视为风险信号，先核分红来源和现金流，不急于补仓。",
      trigger: `${risks.join("、")}；下一期现金流/利润未修复前维持谨慎。`,
      basis: "可持续股息与现金流门禁",
    };
  }
  if (risks.length) {
    return {
      label: "继续观察",
      tone: "warn",
      action: "现金流暂未完全确认，先观察分红兑现与经营数据是否同步。",
      trigger: `${risks.join("、")}；若风险线索增加，降级为高息待核。`,
      basis: "股息安全边际尚可但不充分",
    };
  }
  return {
    label: "现金流支持",
    tone: "good",
    action: "当前股息与现金流暂未冲突，优先分散配置，不因单一高息集中。",
    trigger: "可持续股息明显下修、自由现金流转负或利润连续下滑时重新评估。",
    basis: "股息 + 可持续性 + 自由现金流",
  };
}

function goldSignal(item) {
  const gold = item?.raw || {};
  const answer = gold.answer || {};
  const scores = answer.scores || {};
  const intlScore = number(scores.international?.score ?? answer.internationalScore);
  const domesticScore = number(scores.domestic?.score ?? answer.domesticScore);
  const intl = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const plan = answer.pricePlan || {};
  const intlPrice = number(intl.price);
  const domesticPrice = number(domestic.price);
  const intlRisk = number(plan.internationalRisk?.low);
  const domesticRisk = number(plan.domesticRisk?.low);
  const intlUpper = number(plan.internationalUpper?.low);
  const domesticUpper = number(plan.domesticUpper?.low);
  const riskHit = (intlPrice !== null && intlRisk !== null && intlPrice <= intlRisk)
    || (domesticPrice !== null && domesticRisk !== null && domesticPrice <= domesticRisk);
  const upperHit = (intlPrice !== null && intlUpper !== null && intlPrice >= intlUpper)
    || (domesticPrice !== null && domesticUpper !== null && domesticPrice >= domesticUpper);
  const disagreement = intlScore !== null && domesticScore !== null && Math.abs(intlScore - domesticScore) >= 20;

  if (riskHit) {
    return {
      label: "触及风险下沿",
      tone: "bad",
      action: "先核对实际利率、美元、汇率和国内折溢价，再考虑降低风险敞口。",
      trigger: "风险下沿失守且宏观驱动未改善时，不追跌、不摊平。",
      basis: "国际金与人民币金分别设风险下沿",
    };
  }
  if (upperHit) {
    return {
      label: "接近上沿",
      tone: "warn",
      action: "不追高；等价格回到观察区，或等宏观驱动再次确认。",
      trigger: "任一维度接近观察上沿后，先锁定观察，不把上涨外推。",
      basis: "价格区间优先于单一观察分",
    };
  }
  if (disagreement) {
    return {
      label: "双金分歧",
      tone: "warn",
      action: "国际金与人民币金信号不一致，仓位以较弱一侧为准，不用综合分掩盖分歧。",
      trigger: "两侧观察分重新收敛，且都未跌破各自风险下沿后再评估。",
      basis: `国际 ${intlScore ?? "待核"} 分 · 人民币 ${domesticScore ?? "待核"} 分`,
    };
  }
  if (intlScore !== null && domesticScore !== null && intlScore >= 65 && domesticScore >= 65) {
    return {
      label: "双金共振",
      tone: "good",
      action: "两侧观察分暂时同向，只适合分批观察，不把共振当成收益保证。",
      trigger: "任一观察分跌破 50 或价格跌破各自风险下沿时降级。",
      basis: "国际金 + 人民币金双维度",
    };
  }
  return {
    label: "继续观察",
    tone: "warn",
    action: "驱动不足或两侧分数未形成优势，先看位置和风险下沿。",
    trigger: "观察分改善且价格仍在观察区，再考虑分批；不追单日上涨。",
    basis: "双维度未形成明确优势",
  };
}

function guruSignal(item) {
  const raw = item?.raw || {};
  const profile = raw.profile || {};
  const holdings = Array.isArray(raw.holdings) ? raw.holdings : [];
  const changed = holdings.filter((holding) => holding.changeLabel && !/待核|不变|持平/u.test(String(holding.changeLabel)));
  const filingTime = Date.parse(raw.filingDate || "");
  const lagDays = Number.isNaN(filingTime) ? null : Math.max(0, Math.round((Date.now() - filingTime) / 86400000));
  if (lagDays !== null && lagDays > 180) {
    return {
      label: "披露滞后",
      tone: "bad",
      action: "只当历史研究样本，不能把旧持仓当成当前买入信号。",
      trigger: "等新的 13F/季报披露，且结合现价与公司基本面重新核验。",
      basis: `${lagDays} 天披露滞后`,
    };
  }
  if (!changed.length) {
    return {
      label: "观察持仓",
      tone: "warn",
      action: "持仓变化不足，先学习组合结构，不照抄静态名单。",
      trigger: "新增、增持、减持或退出出现后，再看变化是否有持续逻辑。",
      basis: `${profile.name || "公开机构"} · ${holdings.length} 只持仓`,
    };
  }
  return {
    label: "跟踪变化",
    tone: "good",
    action: `本期有 ${changed.length} 项仓位变化，先研究变化原因，再决定是否纳入自己的观察池。`,
    trigger: "下一期披露若方向反转，或公司基本面无法印证机构逻辑，取消跟踪。",
    basis: `${profile.name || "公开机构"} · 仅供对照学习`,
  };
}

function buildStrategySignal(item, context = {}) {
  const market = item?.market;
  if (market === "hk") return hkSignal(item, context.evidence);
  if (market === "us") return usSignal(item);
  if (market === "a") return aShareSignal(item);
  if (market === "gold") return goldSignal(item);
  if (market === "guru") return guruSignal(item);
  return {
    label: "待核验",
    tone: "warn",
    action: "公开资料不足，暂不输出策略信号。",
    trigger: "资料补齐后重新评估。",
    basis: "资料门禁",
  };
}

module.exports = { buildStrategySignal };
