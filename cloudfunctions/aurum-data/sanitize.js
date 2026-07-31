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
  const labels = { complete: "资料较完整", review: "重点核验", limited: "资料不足" };
  const notes = {
    complete: "招股资料相对完整，可继续核对发行、认购与风险信息。",
    review: "部分关键资料仍需核验，先查看缺失项和风险因素。",
    limited: "关键招股资料尚不完整，当前只展示已核验事实。",
  };
  return { state, label: labels[state], score: null, note: notes[state] };
}

function sanitizeHKListing(item = {}) {
  const {
    publicAnswer,
    publishedEstimate,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return { ...rest, researchView: hkResearchView(item) };
}

function sanitizeHKHistory(item = {}) {
  const {
    publicAnswer,
    publishedEstimate,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return rest;
}

function sanitizeUSStock(stock = {}) {
  const { technicalPlan, strategyAssessment, modelEstimate, modelValidation, ...rest } = stock;
  return rest;
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
  return rest;
}

function aShareResearchView(item = {}, financials = {}) {
  const hasPriceAndYield = hasNumber(item.currentPrice) && hasNumber(item.currentDividendYield);
  const hasCashFlow = hasNumber(financials.operatingCashFlow) && hasNumber(financials.freeCashFlow);
  const state = hasPriceAndYield && hasCashFlow ? "complete" : hasPriceAndYield ? "review" : "limited";
  const labels = { complete: "资料较完整", review: "现金流待核验", limited: "资料待补充" };
  const notes = {
    complete: "价格、分红与现金流字段较完整，可继续核对公告口径。",
    review: "价格和分红已更新，现金流字段仍需核对最新财报。",
    limited: "关键公开资料尚不完整，当前只展示已核验字段。",
  };
  return { state, label: labels[state], note: notes[state] };
}

function sanitizeAShareQuote(item = {}, financials = {}) {
  const {
    currentAdvice,
    summary,
    recommendPrice,
    buyPrice,
    safeMarginPrice,
    rating,
    buy_zone_low,
    buy_zone_high,
    score,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...rest
  } = item;
  return { ...rest, researchView: aShareResearchView(item, financials) };
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

function sanitizeGold(gold = {}) {
  const {
    internalAssessment,
    strategyAssessment,
    modelEstimate,
    modelValidation,
    ...goldRest
  } = gold;
  const answer = gold.answer || {};
  const { action, conclusion, pricePlan, score, grade, ...answerRest } = answer;
  const researchConclusion = String(conclusion || "")
    .replace(/^(买入|卖出|继续观察|观察|等待)[；;，,\s]*/u, "")
    .trim();
  return {
    ...goldRest,
    answer: {
      ...answerRest,
      researchLabel: "资料摘要",
      researchConclusion: researchConclusion || "价格位置与宏观驱动已更新，请结合风险指标阅读。",
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
