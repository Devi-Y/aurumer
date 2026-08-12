/**
 * 本机持仓观察：只对照公开快照事实，不补内部买卖价或假精确动作。
 */
const { findItem, shortCompanyName } = require("./answers");

const MARKET_LABELS = {
  us: "美股",
  hk: "港股",
  a: "A股",
  gold: "黄金",
  other: "其他",
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function normalizeCode(market, code) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return "";
  if (market === "a") return raw.replace(/\.(SH|SZ)$/i, "").replace(/\s+/g, "");
  if (market === "hk") return raw.replace(/\.HK$/i, "").replace(/^0+/, "").replace(/\s+/g, "") || "0";
  if (market === "gold") return raw.replace(/\s+/g, "") || "TRACK";
  return raw.replace(/\s+/g, "");
}

function rangeHit(price, range) {
  if (!hasNumber(price) || !range) return false;
  const low = Number(range.low);
  const high = Number(range.high);
  if (Number.isFinite(low) && Number.isFinite(high)) {
    return price >= Math.min(low, high) && price <= Math.max(low, high);
  }
  if (Number.isFinite(low)) return price <= low;
  if (Number.isFinite(high)) return price >= high;
  return false;
}

function costHint(cost, current) {
  if (!hasNumber(cost) || !hasNumber(current) || Number(cost) <= 0) return null;
  const delta = ((Number(current) - Number(cost)) / Number(cost)) * 100;
  if (delta <= -8) return { text: "相对成本明显偏低，对照公开研究", tone: "good", triggered: true };
  if (delta >= 12) return { text: "相对成本已抬升，对照公开研究", tone: "risk", triggered: true };
  if (delta >= 0) return { text: "相对成本小幅浮盈，继续观察", tone: "wait", triggered: false };
  return { text: "相对成本小幅浮亏，继续观察", tone: "wait", triggered: false };
}

function currentPriceOf(item, market) {
  const raw = item?.raw || {};
  if (market === "us") return Number(raw.price);
  if (market === "a") return Number(raw.currentPrice);
  if (market === "gold") {
    return Number(raw.quotes?.international?.price || raw.quotes?.domestic?.price);
  }
  return NaN;
}

function deriveGoldAction(holding, snapshot) {
  const gold = snapshot?.gold || {};
  const plan = gold.answer?.pricePlan || {};
  const intl = Number(gold.quotes?.international?.price);
  const dom = Number(gold.quotes?.domestic?.price);
  const cost = Number(holding.cost);
  if (rangeHit(intl, plan.internationalRisk) || rangeHit(dom, plan.domesticRisk)) {
    return { text: "已进入风险观察区", tone: "risk", triggered: true, current: intl };
  }
  if (rangeHit(intl, plan.internationalWatch) || rangeHit(dom, plan.domesticWatch)) {
    return { text: "进入分批观察区间", tone: "good", triggered: true, current: intl };
  }
  if (rangeHit(intl, plan.internationalUpper) || rangeHit(dom, plan.domesticUpper)) {
    return { text: "进入上沿观察区间", tone: "risk", triggered: true, current: intl };
  }
  const fromCost = costHint(cost, Number.isFinite(dom) ? dom : intl);
  if (fromCost) return { ...fromCost, current: Number.isFinite(dom) ? dom : intl };
  const action = gold.answer?.action || gold.answer?.researchLabel;
  return {
    text: action || "继续按公开价格观察区核对",
    tone: "wait",
    triggered: false,
    current: Number.isFinite(intl) ? intl : dom,
  };
}

function packing(base) {
  const currentText = base.currentText || "";
  return {
    ...base,
    displayMeta: [base.meta, currentText].filter(Boolean).join(" · "),
    currentText,
  };
}

function deriveHoldingView(holding, snapshot) {
  const market = String(holding.market || "other").toLowerCase();
  const code = normalizeCode(market, holding.code);
  const marketLabel = MARKET_LABELS[market] || "其他";
  const cost = Number(holding.cost);
  const quantity = Number(holding.quantity);
  const meta = [
    code || null,
    hasNumber(cost) ? `成本 ${cost}` : null,
    hasNumber(quantity) ? `${quantity} 股/克` : null,
  ].filter(Boolean).join(" · ") || "本机记录";

  if (market === "gold") {
    const action = deriveGoldAction(holding, snapshot);
    return packing({
      id: holding.id,
      name: holding.name || "黄金",
      market,
      marketLabel,
      meta,
      actionText: action.text,
      actionTone: action.tone,
      triggered: Boolean(action.triggered),
      hasDetail: true,
      detailMarket: "gold",
      detailId: "track",
      currentText: hasNumber(action.current) ? `现价 ${Number(action.current).toFixed(0)}` : "",
    });
  }

  if (market === "other" || !code) {
    return packing({
      id: holding.id,
      name: holding.name || "未命名",
      market,
      marketLabel,
      meta,
      actionText: "本机记录，未匹配公开研究样本",
      actionTone: "wait",
      triggered: false,
      hasDetail: false,
      detailMarket: "",
      detailId: "",
      currentText: "",
    });
  }

  const item = findItem(snapshot, market, code);
  if (!item) {
    return packing({
      id: holding.id,
      name: holding.name || code,
      market,
      marketLabel,
      meta,
      actionText: "未匹配到当前公开样本，请核对代码",
      actionTone: "wait",
      triggered: false,
      hasDetail: false,
      detailMarket: market,
      detailId: code,
      currentText: "",
    });
  }

  const current = currentPriceOf(item, market);
  let action = { text: "对照公开研究继续观察", tone: "wait", triggered: false };
  if (market === "hk") {
    const answer = item.raw?.publicAnswer || {};
    const verdict = answer.verdict || answer.action || item.badge || "港股公开结论";
    action = {
      text: String(verdict),
      tone: /不|回避|结束/u.test(String(verdict)) ? "risk" : /值得|建议/u.test(String(verdict)) ? "good" : "wait",
      triggered: /风险|不建议|回避|值得|建议/u.test(String(verdict)),
    };
  } else if (market === "a") {
    const yieldNow = Number(item.raw?.currentDividendYield);
    const fromCost = costHint(cost, current);
    if (fromCost) {
      action = fromCost;
    } else if (Number.isFinite(yieldNow)) {
      action = {
        text: `股息 ${yieldNow.toFixed(1)}% · ${item.badge || "收息观察"}`,
        tone: "wait",
        triggered: false,
      };
    } else {
      action = { text: item.one || item.badge || "收息资料对照", tone: "wait", triggered: false };
    }
  } else if (market === "us") {
    const fromCost = costHint(cost, current);
    action = fromCost || {
      text: item.one || "对照公开价格与财报",
      tone: "wait",
      triggered: false,
    };
  }

  return packing({
    id: holding.id,
    name: shortCompanyName(item.name || holding.name || code, code, 8),
    market,
    marketLabel,
    meta,
    actionText: action.text,
    actionTone: action.tone,
    triggered: Boolean(action.triggered),
    hasDetail: true,
    detailMarket: market,
    detailId: String(item.id || code),
    currentText: hasNumber(current) ? `现价 ${Number(current).toFixed(2)}` : "",
  });
}

function viewHoldings(holdings, snapshot) {
  return (holdings || []).map((item) => deriveHoldingView(item, snapshot));
}

function holdingsReminder(views) {
  const list = views || [];
  if (!list.length) {
    return {
      text: "添加至少一只真实持仓后，首页才会给出个人化观察提示。",
      tone: "wait",
      triggeredCount: 0,
    };
  }
  const triggered = list.filter((item) => item.triggered);
  if (triggered.length) {
    return {
      text: `${triggered.length} 只持仓进入观察、风险或止盈相关提示，先点开核对。`,
      tone: "risk",
      triggeredCount: triggered.length,
    };
  }
  return {
    text: "当前持仓没有触发明显区间变化，继续按计划观察。",
    tone: "wait",
    triggeredCount: 0,
  };
}

module.exports = {
  MARKET_LABELS,
  normalizeCode,
  viewHoldings,
  holdingsReminder,
};
