"use strict";

/** 与随包新鲜度 / 云缓存陈旧上限对齐：超过则不提供动作。 */
const ACTION_MAX_AGE_MS = Number(process.env.AURUM_ACTION_MAX_AGE_MS || 36 * 60 * 60 * 1000);
const STALE_ACTION = "数据过期，暂不提供动作";

function snapshotAgeMs(updatedAt) {
  const stamp = Date.parse(updatedAt);
  if (!updatedAt || Number.isNaN(stamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - stamp);
}

function isActionFresh(updatedAt, now = Date.now()) {
  const stamp = Date.parse(updatedAt);
  if (!updatedAt || Number.isNaN(stamp)) return false;
  return now - stamp <= ACTION_MAX_AGE_MS;
}

function emptyPricePlan(status = "unavailable") {
  return {
    status,
    internationalWatch: null,
    internationalUpper: null,
    internationalRisk: null,
    domesticWatch: null,
    domesticUpper: null,
    domesticRisk: null,
  };
}

/**
 * 快照过期时剥离可执行动作：申购结论动作、美股价区、A 股建议、黄金动作与价格计划。
 * 事实行情字段保留，只降级“下一步怎么做”。
 */
function degradeStaleActions(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  if (isActionFresh(snapshot.updatedAt, now)) {
    return { ...snapshot, actionsFresh: true, actionFreshness: "fresh" };
  }

  const next = {
    ...snapshot,
    actionsFresh: false,
    actionFreshness: "stale",
    actionDegradeReason: STALE_ACTION,
  };

  if (next.hk) {
    const degradeListing = (item) => {
      if (!item || typeof item !== "object") return item;
      const publicAnswer = item.publicAnswer && typeof item.publicAnswer === "object"
        ? {
          ...item.publicAnswer,
          action: STALE_ACTION,
          verdict: item.publicAnswer.verdict === "已结束" || item.historical
            ? item.publicAnswer.verdict
            : STALE_ACTION,
        }
        : { verdict: STALE_ACTION, action: STALE_ACTION };
      return { ...item, publicAnswer };
    };
    next.hk = {
      ...next.hk,
      listings: Array.isArray(next.hk.listings) ? next.hk.listings.map(degradeListing) : next.hk.listings,
      history: Array.isArray(next.hk.history) ? next.hk.history.map(degradeListing) : next.hk.history,
    };
  }

  if (next.us && Array.isArray(next.us.stocks)) {
    next.us = {
      ...next.us,
      stocks: next.us.stocks.map((stock) => {
        if (!stock || typeof stock !== "object") return stock;
        const {
          technicalPlan,
          buy,
          stop,
          tp,
          pricePlan,
          ...rest
        } = stock;
        return {
          ...rest,
          actionNote: STALE_ACTION,
        };
      }),
    };
  }

  if (next.aShare && Array.isArray(next.aShare.quotes)) {
    next.aShare = {
      ...next.aShare,
      quotes: next.aShare.quotes.map((quote) => {
        if (!quote || typeof quote !== "object") return quote;
        const {
          currentAdvice,
          suggested_action,
          recommendPrice,
          buyPrice,
          safeMarginPrice,
          buy_zone_low,
          buy_zone_high,
          summary,
          ...rest
        } = quote;
        return {
          ...rest,
          actionNote: STALE_ACTION,
          summary: STALE_ACTION,
        };
      }),
    };
  }

  if (next.gold && next.gold.answer) {
    const answer = { ...next.gold.answer };
    next.gold = {
      ...next.gold,
      answer: {
        ...answer,
        action: STALE_ACTION,
        conclusion: STALE_ACTION,
        researchLabel: STALE_ACTION,
        researchConclusion: STALE_ACTION,
        pricePlan: emptyPricePlan("stale"),
      },
    };
  }

  return next;
}

module.exports = {
  ACTION_MAX_AGE_MS,
  STALE_ACTION,
  snapshotAgeMs,
  isActionFresh,
  degradeStaleActions,
  emptyPricePlan,
};
