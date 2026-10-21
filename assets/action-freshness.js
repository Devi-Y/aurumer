// Generated from miniprogram/utils/action-freshness.js.
(function () {
/**
 * 小程序运行时动作新鲜度：与云端 action-freshness 对齐。
 * 离线随包超过 36h 时，不展示可执行动作，只保留事实行情。
 */
const ACTION_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const STALE_ACTION = "数据过期，暂不提供动作";
const STALE_ACTION_WEEKEND = "周末没有新收盘，动作待下一交易日更新";

function isActionFresh(updatedAt, now = Date.now()) {
  const stamp = Date.parse(updatedAt);
  if (!updatedAt || Number.isNaN(stamp)) return false;
  const age = now - stamp;
  return age >= 0 && age <= ACTION_MAX_AGE_MS;
}

/**
 * 只用于挑选过期提示文案，不改变 isActionFresh 的过期判定阈值——
 * 阈值放宽会让真实的工作日抓取失败也被当成"只是周末"蒙混过去。
 * 用 UTC 星期近似交易日历（周六/周日不开盘），在午夜 UTC 附近对本地
 * 时区（北京/香港/纽约）会有几小时误差，这是已知的精度局限，不是
 * 判定动作是否展示的依据，只影响这行文案怎么写。超过 4 天的过期不再
 * 按"周末"解释，避免把真正的长期抓取失败说成周末。与
 * cloudfunctions/aurum-data/action-freshness.js 保持一致。
 */
function isLikelyWeekendGap(updatedAt, now = Date.now()) {
  const stamp = Date.parse(updatedAt);
  if (!updatedAt || Number.isNaN(stamp)) return false;
  const ageMs = now - stamp;
  if (ageMs <= 0 || ageMs > 4 * 24 * 60 * 60 * 1000) return false;
  const updatedDay = new Date(stamp).getUTCDay();
  const nowDay = new Date(now).getUTCDay();
  return updatedDay === 5 && (nowDay === 6 || nowDay === 0 || nowDay === 1);
}

function describeStaleReason(updatedAt, now = Date.now()) {
  return isLikelyWeekendGap(updatedAt, now) ? STALE_ACTION_WEEKEND : STALE_ACTION;
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

function isActionDataFresh(raw, now = Date.now()) {
  if (!raw || raw.actionsFresh === false || /数据过期|周末没有新收盘/.test(raw.actionNote || "")) return false;
  const times = [raw.snapshotUpdatedAt, raw.priceAsOf || raw.asOf].filter(Boolean);
  return times.length > 0 && times.every((time) => isActionFresh(time, now));
}

function marketActionsFresh(snapshot, market, now = Date.now()) {
  if (!snapshot || snapshot.actionsFresh === false || !isActionFresh(snapshot.updatedAt, now)) return false;
  if (market === "gold") {
    const gold = snapshot.gold;
    return Boolean(gold && gold.status !== "partial" && gold.actionsFresh !== false
      && [gold.quotes?.international, gold.quotes?.domestic].every((quote) => quote && isActionDataFresh(quote, now)));
  }
  const rows = market === "us" ? snapshot.us?.stocks : market === "a" ? snapshot.aShare?.quotes : null;
  return !rows || (rows.length > 0 && rows.every((raw) => isActionDataFresh(raw, now)));
}

function degradeStaleActions(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const fresh = snapshot.actionsFresh !== false && isActionFresh(snapshot.updatedAt, now);
  const reason = snapshot.actionDegradeReason || describeStaleReason(snapshot.updatedAt, now);
  const next = {
    ...snapshot,
    actionsFresh: fresh,
    actionFreshness: fresh ? "fresh" : "stale",
    ...(fresh ? {} : { actionDegradeReason: reason }),
  };

  if (next.hk) {
    const degradeListing = (item) => {
      if (!item || typeof item !== "object") return item;
      if (fresh) return { ...item, actionsFresh: true, snapshotUpdatedAt: snapshot.updatedAt };
      const publicAnswer = item.publicAnswer && typeof item.publicAnswer === "object"
        ? {
          ...item.publicAnswer,
          action: reason,
          verdict: item.publicAnswer.verdict === "已结束" || item.historical
            ? item.publicAnswer.verdict
            : reason,
        }
        : { verdict: reason, action: reason };
      return { ...item, publicAnswer, actionsFresh: false, snapshotUpdatedAt: snapshot.updatedAt };
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
        if (fresh && isActionDataFresh(stock, now)) return { ...stock, actionsFresh: true, snapshotUpdatedAt: snapshot.updatedAt };
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
          actionsFresh: false,
          snapshotUpdatedAt: snapshot.updatedAt,
          actionNote: reason,
        };
      }),
    };
  }

  if (next.aShare && Array.isArray(next.aShare.quotes)) {
    const degradeQuote = (quote) => {
        if (!quote || typeof quote !== "object") return quote;
        if (fresh && isActionDataFresh(quote, now)) return { ...quote, actionsFresh: true, snapshotUpdatedAt: snapshot.updatedAt };
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
          actionsFresh: false,
          snapshotUpdatedAt: snapshot.updatedAt,
          actionNote: reason,
          summary: reason,
        };
    };
    next.aShare = {
      ...next.aShare,
      quotes: next.aShare.quotes.map(degradeQuote),
      funds: Array.isArray(next.aShare.funds) ? next.aShare.funds.map(degradeQuote) : next.aShare.funds,
    };
  }

  if (next.gold && next.gold.answer && marketActionsFresh(next, "gold", now)) {
    next.gold = { ...next.gold, actionsFresh: true, snapshotUpdatedAt: snapshot.updatedAt };
  }
  if (next.gold && next.gold.answer && !marketActionsFresh(next, "gold", now)) {
    const answer = { ...next.gold.answer };
    next.gold = {
      ...next.gold,
      actionsFresh: false,
      snapshotUpdatedAt: snapshot.updatedAt,
      actionNote: fresh ? "部分黄金数据暂缺，暂不提供当前判断" : reason,
      answer: {
        ...answer,
        action: fresh ? "部分黄金数据暂缺，暂不提供当前判断" : reason,
        conclusion: fresh ? "部分黄金数据暂缺，暂不提供当前判断" : reason,
        researchLabel: fresh ? "部分黄金数据暂缺" : reason,
        researchConclusion: fresh ? "部分黄金数据暂缺，暂不提供当前判断" : reason,
        pricePlan: emptyPricePlan("stale"),
      },
    };
  }

  return next;
}

globalThis.AurumFreshness = {
  ACTION_MAX_AGE_MS,
  STALE_ACTION,
  STALE_ACTION_WEEKEND,
  isActionFresh,
  isActionDataFresh,
  marketActionsFresh,
  isLikelyWeekendGap,
  describeStaleReason,
  degradeStaleActions,
};

})();
