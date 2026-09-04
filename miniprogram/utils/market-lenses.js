/**
 * 五个栏目的研究分档透镜：把公开字段翻译成用户要的问题，不是买卖指令。
 * 没有真实可核验数据时保持空白，不补虚拟标的或假精确价格。
 */
const { usScore } = require("./strategy-score");
const { buildStrategySignal } = require("./strategy-signals");

const MAGNIFICENT_SEVEN = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"];
const US_CYCLICAL = new Set(["JPM", "COIN", "MSTR", "SMCI", "AMD", "AVGO", "TSM", "ASML", "UBER"]);
const A_CORE_INDUSTRY = /水电|公用事业|银行|通信|高速|铁路|家电|现金牛/u;
const A_CYCLE_INDUSTRY = /能源|煤炭|油气|炼化|钢铁|建材|火电/u;

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function number(value) {
  return hasNumber(value) ? Number(value) : null;
}

function parseOfferPrice(value) {
  if (hasNumber(value)) return Number(value);
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function historyPosition(history, current) {
  const values = (history || [])
    .map((entry) => number(entry?.close ?? entry))
    .filter((value) => value !== null);
  const price = number(current);
  if (values.length < 2 || price === null) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high === low ? 50 : Math.max(0, Math.min(100, Math.round(((price - low) / (high - low)) * 100)));
}

function percentile(values, p) {
  const sorted = (values || []).filter(hasNumber).map(Number).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function signedPercent(value, digits = 0) {
  if (!hasNumber(value)) return null;
  const amount = Number(value);
  const text = amount.toFixed(digits);
  return `${amount >= 0 ? "+" : ""}${text}%`;
}

function qualityPass(item) {
  const fund = item?.raw?.fund || {};
  const growth = number(fund.revenueGrowth);
  const margin = number(fund.profitMargin);
  const roe = number(fund.roe);
  const ocf = number(fund.operatingCashFlow);
  const checks = [
    growth !== null ? growth >= 0 : null,
    margin !== null ? margin >= 10 : null,
    roe !== null ? roe >= 12 : null,
    ocf !== null ? ocf > 0 : null,
  ].filter((value) => value !== null);
  return checks.length >= 2 && checks.filter(Boolean).length >= Math.ceil(checks.length * 0.6);
}

function mag7Context(sevenItems) {
  const pes = (sevenItems || [])
    .map((item) => number(item?.raw?.fund?.pe))
    .filter((value) => value !== null && value > 0);
  const sorted = pes.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const medianPe = sorted.length
    ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
    : null;
  return { medianPe };
}

function mag7Lenses(item, context = {}) {
  if (!MAGNIFICENT_SEVEN.includes(item?.code || item?.id)) return [];
  const signal = buildStrategySignal(item);
  const pe = number(item?.raw?.fund?.pe);
  const position = historyPosition(item?.raw?.history, item?.raw?.price);
  const risky = signal.label === "风险升高"
    || (pe !== null && pe >= 80)
    || (position !== null && position >= 85 && context.medianPe != null && pe !== null && pe > context.medianPe);
  const cheap = !risky
    && qualityPass(item)
    && pe !== null
    && context.medianPe != null
    && pe <= context.medianPe
    && (position === null || position < 75);
  const hold = !risky && qualityPass(item);
  const lenses = [];
  if (cheap) lenses.push("cheap7");
  if (risky) lenses.push("risk7");
  if (hold) lenses.push("hold7");
  return lenses;
}

function hkHistoricalCrowdEligible(item) {
  if (item?.market !== "hk" || item?.group !== "ended") return false;
  const raw = item.raw || {};
  const crowd = number(raw.publicOversubscription);
  const lotRate = number(raw.oneLotRate);
  const offer = parseOfferPrice(raw.offerPrice || raw.offerPriceValue || raw.priceHigh || raw.priceLow);
  const entry = number(raw.entryFee);
  if (offer === null || entry === null) return false;
  if (crowd !== null && crowd >= 200) return false;
  if (lotRate !== null && lotRate < 1) return false;
  return true;
}

function hkLeverageEligible(item) {
  if (item?.market !== "hk" || item?.group !== "worth") return false;
  const raw = item.raw || {};
  if (raw.withdrawn || raw.researchView?.state === "withdrawn") return false;
  const answer = raw.publicAnswer || {};
  const score = number(answer.score);
  const crowd = number(raw.publicOversubscription);
  const lotRate = number(raw.oneLotRate);
  const offer = parseOfferPrice(raw.offerPrice || raw.priceHigh || raw.priceLow);
  const entry = number(raw.entryFee);
  if (score === null || score < 80) return false;
  if (offer === null || entry === null) return false;
  if (crowd !== null && crowd >= 200) return false;
  if (lotRate !== null && lotRate < 1) return false;
  return true;
}

function aShareRole(item) {
  const raw = item?.raw || {};
  if (raw.assetType === "fund") return "core";
  const industry = String(raw.industry || raw.financials?.industry || "");
  if (A_CYCLE_INDUSTRY.test(industry)) return "cycle";
  if (A_CORE_INDUSTRY.test(industry) && item?.group !== "watch") return "core";
  return null;
}

function yieldImpliedPlan(raw = {}) {
  const price = number(raw.currentPrice);
  const currentYield = number(raw.currentDividendYield);
  const sustainable = number(raw.sustainableDividendYield);
  if (price === null || currentYield === null || sustainable === null || currentYield <= 0 || sustainable <= 0) {
    return null;
  }
  const dps = price * currentYield / 100;
  const addYield = Math.max(sustainable * 1.12, sustainable + 0.4);
  const trimYield = Math.max(0.2, Math.min(sustainable * 0.88, sustainable - 0.3));
  if (trimYield <= 0 || addYield <= trimYield) return null;
  const zone = currentYield >= addYield ? "add" : (currentYield <= trimYield ? "trim" : "hold");
  return {
    dps,
    addPrice: dps / addYield * 100,
    trimPrice: dps / trimYield * 100,
    addYield,
    trimYield,
    price,
    zone,
  };
}

function aShareLenses(item) {
  const role = aShareRole(item);
  const lenses = [];
  if (role === "core") lenses.push("core");
  if (role === "cycle") lenses.push("cycle");
  if (role === "core" && item?.raw?.assetType !== "fund") {
    const plan = yieldImpliedPlan(item.raw);
    if (plan?.zone === "add") lenses.push("add");
    if (plan?.zone === "trim") lenses.push("trim");
  }
  return lenses;
}

function industryWatchEligible(item) {
  if (MAGNIFICENT_SEVEN.includes(item?.code || item?.id)) return false;
  const scored = usScore(item);
  const signal = buildStrategySignal(item);
  if (scored.score == null || scored.score < 55) return false;
  if (signal.label === "资料不足" || signal.label === "风险升高") return false;
  return true;
}

// 黄金拐点：只从 history 里真实的收盘价数出来，不平滑、不外推、不补点。
// 三件事——20日均线在60日均线的哪一侧、最近一次穿越发生在哪天、现价离半年
// 高低点还有多远。数据不够 60 天就返回 null，让上层如实说算不出，不要拿
// 20 天的样本冒充半年趋势。
function goldTurningPoint(history, price) {
  const closes = (history || [])
    .map((row) => ({ date: row && row.date, close: number(row && row.close) }))
    .filter((row) => row.date && row.close !== null);
  if (closes.length < 60) return null;
  // 均线按闭区间取，endIndex 那天算在内；样本不足就返回 null 而不是拿短窗口凑。
  const meanAt = (endIndex, span) => {
    if (endIndex + 1 < span) return null;
    let sum = 0;
    for (let i = endIndex - span + 1; i <= endIndex; i += 1) sum += closes[i].close;
    return sum / span;
  };
  const last = closes.length - 1;
  const fast = meanAt(last, 20);
  const slow = meanAt(last, 60);
  if (fast === null || slow === null) return null;
  const above = fast >= slow;
  // 从最新一天往回走，第一处两条均线关系反过来的那天的次日，就是最近一次穿越。
  // 找不到说明这半年里一直是同一侧，crossDate 留空，别编一个日期出来。
  let crossDate = "";
  let crossDays = null;
  for (let i = last - 1; i >= 59; i -= 1) {
    const priorFast = meanAt(i, 20);
    const priorSlow = meanAt(i, 60);
    if (priorFast === null || priorSlow === null) break;
    if ((priorFast >= priorSlow) !== above) {
      crossDate = closes[i + 1].date;
      crossDays = last - (i + 1);
      break;
    }
  }
  const peak = closes.reduce((best, row) => (row.close > best.close ? row : best), closes[0]);
  const trough = closes.reduce((best, row) => (row.close < best.close ? row : best), closes[0]);
  const current = number(price) !== null ? number(price) : closes[last].close;
  return {
    above,
    fast,
    slow,
    crossDate,
    crossDays,
    peak,
    trough,
    days: closes.length,
    fromPeak: peak.close ? ((current - peak.close) / peak.close) * 100 : null,
    fromTrough: trough.close ? ((current - trough.close) / trough.close) * 100 : null,
  };
}

function goldZoneForPrice(price, watch, upper, risk) {
  const current = number(price);
  const watchHigh = number(watch?.high ?? watch?.low);
  const watchLow = number(watch?.low ?? watch?.high);
  const upperLow = number(upper?.low ?? upper?.high);
  const riskLow = number(risk?.low ?? risk?.high);
  if (current === null) {
    return { label: "资料不足", tone: "warn", hold: false, sell: false };
  }
  if (riskLow !== null && current <= riskLow) {
    return { label: "触及风险下沿", tone: "bad", hold: false, sell: false };
  }
  if (upperLow !== null && current >= upperLow) {
    return { label: "进入观察上沿", tone: "warn", hold: false, sell: true };
  }
  if (watchHigh !== null && current <= watchHigh) {
    // 口径跟 pricePlan.internationalWatch 在别处的叫法走：观察低位。
    return { label: "仍在观察低位", tone: "good", hold: true, sell: false };
  }
  if (watchLow !== null && upperLow !== null && current > watchHigh && current < upperLow) {
    return { label: "持有区与上沿之间", tone: "warn", hold: false, sell: false };
  }
  return { label: "继续观察", tone: "warn", hold: false, sell: false };
}

function usSleevePlan(sevenItems, industryItems, extraItems = []) {
  const cheap = (sevenItems || []).filter((item) => (item.lenses || []).includes("cheap7")).length;
  const risk = (sevenItems || []).filter((item) => (item.lenses || []).includes("risk7")).length;
  const seen = new Set();
  const pool = [];
  for (const item of [...(industryItems || []), ...(extraItems || [])]) {
    const code = item?.code || item?.id;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    pool.push(item);
  }
  const cyclical = pool.filter((item) => US_CYCLICAL.has(item.code || item.id)).slice(0, 2);
  const picks = cyclical.length ? cyclical : pool.slice(0, 2);
  const defensive = risk >= 2 || cheap === 0;
  const income = defensive ? "SCHD" : (cheap >= 3 ? "JEPQ" : "SCHD");
  const weights = defensive
    ? { VOO: 30, income: 20, O: 10, SGOV: 30, cycle: 10 }
    : { VOO: 40, income: 20, O: 10, SGOV: 20, cycle: 10 };
  return {
    defensive,
    income,
    weights,
    picks,
    summary: defensive
      ? `七姐妹风险线索偏多，底仓偏防守：VOO ${weights.VOO}% + ${income} ${weights.income}% + O ${weights.O}% + SGOV ${weights.SGOV}% + 周期 ${weights.cycle}%`
      : `质量尚可，底仓保持宽基：VOO ${weights.VOO}% + ${income} ${weights.income}% + O ${weights.O}% + SGOV ${weights.SGOV}% + 周期 ${weights.cycle}%`,
  };
}

function matchesGroup(item, groupId) {
  if (!item || !groupId) return false;
  return item.group === groupId || (item.lenses || []).includes(groupId);
}

module.exports = {
  MAGNIFICENT_SEVEN,
  US_CYCLICAL,
  hasNumber,
  number,
  parseOfferPrice,
  percentile,
  signedPercent,
  mag7Context,
  mag7Lenses,
  hkLeverageEligible,
  hkHistoricalCrowdEligible,
  aShareRole,
  aShareLenses,
  yieldImpliedPlan,
  industryWatchEligible,
  goldZoneForPrice,
  goldTurningPoint,
  usSleevePlan,
  matchesGroup,
};
