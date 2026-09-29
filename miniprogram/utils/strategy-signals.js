/**
 * 五个栏目共用的「策略信号」层。
 *
 * 这里不预测确定收益，而是把公开数据翻译成三件用户真正能用的事：
 * 当前状态、为什么这样判断、什么变化会触发重新评估。
 */
const { isPositionChange } = require("./guru-changes");

// null / undefined / 空串要当成「没有这个数」，不能交给 Number()：
// Number(null) 是 0 且有限，会让「一手中签率未公布」之类的缺失字段
// 变成一个真实的 0，然后被下游的 !== null 判断当成有效信号用。
function number(value) {
  if (value === null || value === undefined || value === "") return null;
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

// 认购截止日在今天之前 → 已经申购不了。group 要等配发结果出来才变，
// 这段空档里只看 group 会给出「可研究申购」，和同屏的「已截止」打架。
function deadlinePassed(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return false;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  return target.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
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
  if (item?.group === "settled") {
    return {
      label: "等待结果",
      tone: "muted",
      action: "申购窗口已关闭，暗盘/首日结果公布前不构成新的操作依据。",
      trigger: "暗盘或首日成交公布后，再按实际结果决定去留。",
      basis: "配发结果已公布，尚未计入历史样本",
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
  if (deadlinePassed(raw.offerDeadline || raw.offerEnd)) {
    return {
      label: "已截止",
      tone: "muted",
      action: "认购已经截止，这只现在申购不了。",
      trigger: "配发结果出来后看中没中签；上市首日再决定留不留。",
      basis: "按认购截止日",
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
      action: "亏得起一手的钱再打一手，不因为过去常涨就多打或借钱打。",
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

// position 是现价落在近60日最低到最高之间的百分位（0 最低、100 最高）。
// 「近60日位置 96%」读者看不懂是什么的 96%，直接说离高点/低点多近。
function positionText(position) {
  if (position >= 85) return "股价贴近近60日最高";
  if (position >= 72) return "股价在近60日偏高处";
  if (position <= 15) return "股价贴近近60日最低";
  if (position <= 35) return "股价在近60日偏低处";
  return "股价在近60日中间";
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
  if (pe !== null && pe >= 55) risks.push(`市盈率 ${pe.toFixed(1)} 倍偏高`);
  if (position !== null && position >= 85) risks.push(positionText(position));
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
      trigger: "补齐市盈率、盈利质量和近60日股价后再评估。",
      basis: "质量 + 估值 + 趋势三道门",
    };
  }
  if (risks.length >= 2 || (risks.length && !qualityPass)) {
    return {
      label: "风险升高",
      tone: "bad",
      // 列表页只显示 label + action。原来 action 是整段固定话术，于是同一档
      // 里的每只股票在列表上完全同文，读者分不出谁是因为什么被降级。
      // 这里把已经算好的 risks 拼进去，不新增任何计算，也不新增结论。
      action: `${risks.join("、")}；先停追，优先查财报和估值，价格下跌时不把热度当支撑。`,
      trigger: `${risks.join("、")}；任一经营信号继续恶化就减仓。`,
      basis: "经营质量优先于热度",
    };
  }
  if (risks.length || position >= 72 || pe >= 40) {
    const why = risks.length
      ? risks.join("、")
      : (position >= 72 ? positionText(position) : `市盈率 ${pe.toFixed(1)} 倍`);
    return {
      label: "等回撤",
      tone: "warn",
      action: `质量尚可，但${why}；等股价回落或财报继续验证，不追高。`,
      // 详情页有「参考买入价」时，「回到中间一带」要读的人自己去算是哪个价；直接说那个价。
      trigger: `${Number(raw.pricePlan?.buy) > 0 ? `跌到参考买入价 $${Number(raw.pricePlan.buy).toFixed(2)} 附近、且盈利没变差，再考虑买` : "股价回到近60日中间一带、且盈利没变差，再重新观察"}${pe >= 40 ? "；市盈率降下来也很重要" : ""}。`,
      basis: "质量通过，估值与位置控回撤",
    };
  }
  return {
    label: "可分批观察",
    tone: "good",
    action: `市盈率 ${pe.toFixed(1)} 倍、${positionText(position)}，质量和价格没有冲突；分批观察，不一次性追高。`,
    trigger: "市盈率快速上升、股价冲到近60日最高附近，或营收/利润/现金流同时转弱时降级。",
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
      action: `${risks.join("、")}；把高股息当风险信号，先核分红来源和现金流，不急于补仓。`,
      trigger: `${risks.join("、")}；下一期现金流/利润未修复前维持谨慎。`,
      basis: "可持续股息与现金流门禁",
    };
  }
  if (risks.length) {
    return {
      label: "继续观察",
      tone: "warn",
      action: `${risks.join("、")}；现金流暂未完全确认，先看分红兑现与经营数据是否同步。`,
      trigger: `${risks.join("、")}；若风险线索增加，降级为高息待核。`,
      basis: "股息安全边际尚可但不充分",
    };
  }
  return {
    label: "现金流支持",
    tone: "good",
    action: `当前股息 ${current.toFixed(1)}%、可持续 ${sustainable.toFixed(1)}% 暂未冲突；优先分散配置，不因单一高息集中。`,
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
      action: "先核对美国利率、美元、人民币汇率和国内比国际贵多少，再考虑减仓。",
      trigger: "跌破风险下沿、利率和美元也没好转时，不抄底、不越跌越买。",
      basis: "国际金与人民币金分别设风险下沿",
    };
  }
  if (upperHit) {
    return {
      label: "接近上沿",
      tone: "warn",
      action: "不追高；等价格回到观察区再看。",
      trigger: "国际金或人民币金到了观察上沿，先观察，不当成还会接着涨。",
      basis: "先看价位，再看评分",
    };
  }
  if (disagreement) {
    return {
      label: "国内外不一致",
      tone: "warn",
      action: "国际金和人民币金评分差得多，按低的那个来，不看平均分。",
      trigger: "两个评分重新接近、且都没跌破各自风险下沿，再重新评估。",
      basis: `国际金 ${intlScore ?? "待核"} 分 · 人民币金 ${domesticScore ?? "待核"} 分`,
    };
  }
  if (intlScore !== null && domesticScore !== null && intlScore >= 65 && domesticScore >= 65) {
    return {
      label: "国内外都偏强",
      tone: "good",
      action: "国际金和人民币金评分都偏高，也只适合分批买，不代表一定赚钱。",
      trigger: "任一评分跌破 50，或价格跌破各自风险下沿，就降一级。",
      basis: "国际金、人民币金两个评分",
    };
  }
  return {
    label: "继续观察",
    tone: "warn",
    action: "暂时没有明显买点，先看现价离风险下沿还有多远。",
    trigger: "评分回升、价格仍在观察低位时再分批考虑；不追单日上涨。",
    basis: `国际金 ${intlScore ?? "待核"} 分 · 人民币金 ${domesticScore ?? "待核"} 分`,
  };
}

function guruSignal(item) {
  const raw = item?.raw || {};
  const profile = raw.profile || {};
  const holdings = Array.isArray(raw.holdings) ? raw.holdings : [];
  const changed = holdings.filter(isPositionChange);
  const filingTime = Date.parse(raw.filingDate || "");
  const lagDays = Number.isNaN(filingTime) ? null : Math.max(0, Math.round((Date.now() - filingTime) / 86400000));
  if (lagDays !== null && lagDays > 180) {
    return {
      label: "披露滞后",
      tone: "bad",
      action: `这份持仓是 ${lagDays} 天前公布的，太旧了，只能当历史参考，不能照着买。`,
      trigger: "等新的持仓申报或季报公布，且结合现价与公司基本面重新核验。",
      basis: `${lagDays} 天前公布`,
    };
  }
  const top = holdings
    .filter((holding) => holding && Number.isFinite(Number(holding.weight)))
    .reduce((best, holding) => (best && Number(best.weight) >= Number(holding.weight) ? best : holding), null);
  if (!changed.length) {
    return {
      label: "观察持仓",
      tone: "warn",
      // 这一档以前每家机构一模一样，列表上分不出谁是谁。补一句本来就在
      // 页面别处展示的披露事实：披露了几只、其中权重最高的是谁。
      action: `${top ? `已披露 ${holdings.length} 只，权重最高 ${top.shortName || top.name || top.ticker} ${Number(top.weight).toFixed(1)}%；` : ""}这期没标出增减，先看它重仓什么，不照着买。`,
      trigger: "新增、增持、减持或退出出现后，再看变化是否有持续逻辑。",
      basis: `${profile.name || "公开机构"} · ${holdings.length} 只持仓`,
    };
  }
  return {
    label: "跟踪变化",
    tone: "good",
    // 同上：只报一个数字时，同一档的机构在列表里完全同文。把已经算好的
    // 前两项变化点出来，读者一眼能看出这家和那家变的不是同一批仓位。
    action: `本期 ${changed.length} 项仓位变化：${changed.slice(0, 2).map((holding) => `${holding.shortName || holding.ticker || holding.name} ${holding.changeLabel}`).join("、")}${changed.length > 2 ? " 等" : ""}；先研究变化原因，再决定是否纳入自己的观察池。`,
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
