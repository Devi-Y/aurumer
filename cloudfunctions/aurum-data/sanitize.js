"use strict";

function hasNumber(value) {
  return value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
}

function hkResearchView(item = {}) {
  // 发行人已公告取消的项目不能再按"资料是否齐全"来评价：它根本不能申购，
  // 必须单独标注，否则会和正常在售新股混在一起展示。
  if (item.withdrawn) {
    return {
      state: "withdrawn",
      label: "发行已取消",
      score: null,
      note: "发行人已公告本次全球发售及上市不予进行，申请款项按公告安排退回，无法再申购。",
    };
  }
  const present = [
    item.prospectusUrl,
    item.offerStart,
    item.offerDeadline,
    item.listingDate,
    item.offerPrice || (item.priceLow && item.priceHigh),
    item.boardLot,
    item.sponsor || (item.sponsorNames && item.sponsorNames.length),
  ].filter(Boolean).length;
  const state = present >= 6 ? "complete" : present >= 3 ? "review" : "limited";
  // 完整度只给后端排序用；前端展示以 publicAnswer / 人话结论为准。
  const labels = { complete: "资料齐备", review: "资料待补", limited: "资料偏少" };
  const notes = {
    complete: "关键招股字段已齐，可结合研究结论判断是否申购。",
    review: "部分关键字段仍缺，结论仅供参考，建议先补齐再下决定。",
    limited: "关键招股字段不足，暂不宜下申购结论。",
  };
  return { state, label: labels[state], score: null, note: notes[state] };
}

function sanitizePublicAnswer(answer) {
  if (!answer || typeof answer !== "object") return null;
  return {
    verdict: answer.verdict || null,
    action: answer.action || null,
    score: hasNumber(answer.score) ? Number(answer.score) : null,
  };
}

function sanitizeHKListing(item = {}) {
  const {
    publishedEstimate,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return {
    ...rest,
    publicAnswer: sanitizePublicAnswer(item.publicAnswer),
    researchView: hkResearchView(item),
  };
}

function sanitizeHKHistory(item = {}) {
  const {
    publishedEstimate,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return {
    ...rest,
    publicAnswer: sanitizePublicAnswer(item.publicAnswer),
    historicalReview: item.historicalReview
      ? {
          verdict: item.historicalReview.verdict || null,
          greyMarketChange: item.historicalReview.greyMarketChange,
          firstDayChange: item.historicalReview.firstDayChange,
          fiveDayChange: item.historicalReview.fiveDayChange,
          fiveDayHighChange: item.historicalReview.fiveDayHighChange,
        }
      : null,
  };
}

function sanitizeUSStock(stock = {}) {
  const { technicalPlan, strategyAssessment, modelEstimate, modelValidation, ...rest } = stock;
  return rest;
}

/**
 * Nasdaq / 公开财报金额常以「千美元」入库。统一转为基础美元，并标注 amountUnit，
 * 展示层不得再按数量级猜测乘数。
 */
function scaleUsdThousands(value) {
  if (!hasNumber(value)) return null;
  return Number(value) * 1000;
}

function scaleHistoryThousands(values) {
  if (!Array.isArray(values)) return values || [];
  return values.map((value) => (hasNumber(value) ? Number(value) * 1000 : value));
}

function sanitizeUSFundamental(item = {}) {
  const {
    targetPrice,
    targetUpside,
    growthScore,
    profitScore,
    valueScore,
    finalScore,
    qualityEligible,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  if (item.amountUnit === "USD") {
    return { ...rest, amountUnit: "USD", currency: item.currency || "USD" };
  }
  return {
    ...rest,
    operatingCashFlow: scaleUsdThousands(item.operatingCashFlow),
    capitalExpenditures: scaleUsdThousands(item.capitalExpenditures),
    cashAndEquivalents: scaleUsdThousands(item.cashAndEquivalents),
    shortTermInvestments: scaleUsdThousands(item.shortTermInvestments),
    liquidAssets: scaleUsdThousands(item.liquidAssets),
    netIncome: scaleUsdThousands(item.netIncome),
    revenueHistory: scaleHistoryThousands(item.revenueHistory),
    netIncomeHistory: scaleHistoryThousands(item.netIncomeHistory),
    amountUnit: "USD",
    currency: "USD",
    unitMultiplier: 1,
  };
}

function aShareResearchView(item = {}, financials = {}) {
  const hasPriceAndYield = hasNumber(item.currentPrice) && hasNumber(item.currentDividendYield);
  const hasCashFlow = hasNumber(financials.operatingCashFlow) && hasNumber(financials.freeCashFlow);
  const state = hasPriceAndYield && hasCashFlow ? "complete" : hasPriceAndYield ? "review" : "limited";
  const labels = { complete: "收息资料齐", review: "现金流待核", limited: "资料偏少" };
  const notes = {
    complete: "价格、分红与现金流字段较完整。",
    review: "价格和分红已更新，现金流字段仍需核对最新财报。",
    limited: "关键公开资料尚不完整。",
  };
  return { state, label: labels[state], note: notes[state] };
}

function sanitizeAShareQuote(item = {}, financials = {}) {
  const {
    rating,
    buy_zone_low,
    buy_zone_high,
    score,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    currentAdvice,
    recommendPrice,
    buyPrice,
    safeMarginPrice,
    summary,
    ...rest
  } = item;
  // 买入/推荐/安全边际价来自静态 HTML，不是公告驱动自动化；公开链路一律剥离。
  return {
    ...rest,
    researchView: aShareResearchView(item, financials),
  };
}

function sanitizeAShareFundamental(item = {}) {
  const {
    dividendScore,
    buyZoneLow,
    buyZoneHigh,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return rest;
}

function sanitizePriceRange(range) {
  if (!range || typeof range !== "object") return null;
  if (!hasNumber(range.low) && !hasNumber(range.high)) return null;
  return {
    low: hasNumber(range.low) ? Number(range.low) : null,
    high: hasNumber(range.high) ? Number(range.high) : null,
    currency: range.currency || null,
  };
}

function sanitizeGold(gold = {}) {
  const {
    internalAssessment,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...goldRest
  } = gold;
  const answer = gold.answer || {};
  const {
    strategyAssessment: _answerStrategy,
    modelEstimate: _answerModel,
    ...answerRest
  } = answer;
  const pricePlan = answer.pricePlan || {};
  const action = String(answer.action || "").trim();
  const conclusion = String(answer.conclusion || "").trim();
  return {
    ...goldRest,
    answer: {
      ...answerRest,
      score: hasNumber(answer.score) ? Number(answer.score) : null,
      grade: answer.grade || null,
      action: action || null,
      conclusion: conclusion || null,
      // 保留 research* 字段兼容旧页面；动作版以 action / pricePlan 为准。
      researchLabel: action || "追踪结论",
      researchConclusion: conclusion || action || "先看价格位置与买卖观察区。",
      reasons: Array.isArray(answer.reasons) ? answer.reasons.slice(0, 3) : [],
      risks: Array.isArray(answer.risks) ? answer.risks.slice(0, 3) : [],
      macroAvailable: answer.macroAvailable !== false,
      pricePlan: {
        status: pricePlan.status || (sanitizePriceRange(pricePlan.internationalWatch) ? "research" : "unavailable"),
        internationalWatch: sanitizePriceRange(pricePlan.internationalWatch),
        internationalUpper: sanitizePriceRange(pricePlan.internationalUpper),
        internationalRisk: sanitizePriceRange(pricePlan.internationalRisk),
        domesticWatch: sanitizePriceRange(pricePlan.domesticWatch),
        domesticUpper: sanitizePriceRange(pricePlan.domesticUpper),
        domesticRisk: sanitizePriceRange(pricePlan.domesticRisk),
      },
    },
  };
}

function sanitizeInvestor(item = {}) {
  const {
    trackingScore,
    trackingSummary,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return rest;
}

function assertSourceSnapshot(snapshot) {
  const updatedAt = Date.parse(snapshot && snapshot.updatedAt);
  if (!snapshot || snapshot.status !== "live" || Number.isNaN(updatedAt)) {
    throw new Error("公开快照状态或更新时间无效");
  }
  // 机构持仓阈值留出余量：13F 是季度披露，个别机构延迟很常见，
  // 不该因为少一位就把整份行情（美股、A股、港股、黄金）一起判为不可用。
  const checks = [
    [snapshot.us && snapshot.us.stocks, 20, "美股行情"],
    [snapshot.us && snapshot.us.fundamentals, 20, "美股财务"],
    [snapshot.aShare && snapshot.aShare.quotes, 5, "A 股资料"],
    [snapshot.investors, 6, "机构持仓"],
  ];
  for (const [items, minimum, label] of checks) {
    if (!Array.isArray(items) || items.length < minimum) {
      throw new Error(`${label}数量不足`);
    }
  }
  const hkCount = (snapshot.hk && snapshot.hk.listings ? snapshot.hk.listings.length : 0)
    + (snapshot.hk && snapshot.hk.history ? snapshot.hk.history.length : 0);
  if (hkCount < 5) throw new Error("港股资料数量不足");
  if (!snapshot.gold || !snapshot.gold.quotes || !snapshot.gold.quotes.international || !snapshot.gold.quotes.domestic) {
    throw new Error("黄金双市场资料不完整");
  }
}

function sanitizeSnapshot(snapshot) {
  assertSourceSnapshot(snapshot);
  const aShareFundamentals = (snapshot.aShare && snapshot.aShare.fundamentals || [])
    .map(sanitizeAShareFundamental);
  const fundamentalsByCode = new Map(aShareFundamentals.map((item) => [item.code, item]));
  return {
    status: "live",
    updatedAt: snapshot.updatedAt,
    us: {
      stocks: (snapshot.us && snapshot.us.stocks || []).map(sanitizeUSStock),
      fundamentals: (snapshot.us && snapshot.us.fundamentals || []).map(sanitizeUSFundamental),
    },
    hk: {
      listings: (snapshot.hk && snapshot.hk.listings || []).map(sanitizeHKListing),
      history: (snapshot.hk && snapshot.hk.history || []).map(sanitizeHKHistory),
    },
    aShare: {
      ...(snapshot.aShare || {}),
      quotes: (snapshot.aShare && snapshot.aShare.quotes || [])
        .map((item) => sanitizeAShareQuote(item, fundamentalsByCode.get(item.code))),
      fundamentals: aShareFundamentals,
    },
    gold: sanitizeGold(snapshot.gold),
    investors: (snapshot.investors || []).map(sanitizeInvestor),
  };
}

module.exports = { assertSourceSnapshot, sanitizeSnapshot };
