const { isActionDataFresh } = require("./action-freshness");
// 栏目页顶上「今天该动的」和每行「现价离参考价多远」只在这里算一份：
// 美股用 pricePlan，A股用 yieldImpliedPlan（按股息率倒推的参考买/卖价），黄金用研究价位。
// 列表跟详情页用同一个价、同一个口径（以现价为底），同一只票不会出两个数。

// 价格写法用详情页同一个 money，两边字面一致。
const { money } = require("./answers");
const { yieldImpliedPlan } = require("./market-lenses");

// 以现价为底：现价要再跌/再涨几%才到这个价。详情页「比现价低 x%」就是这个数。
function gapPct(price, level) {
  return ((price - level) / price) * 100;
}

// 顶上几格「到买入价 N只」：0 只是灰的，有就上色。
function countTiles(orders, defs) {
  return defs.map((def) => {
    const count = orders.filter((order) => order && order.state === def.key).length;
    return { key: def.key, tone: def.key, label: def.label, value: count, unit: "只", count, on: count > 0 };
  });
}

// ---- 美股 ----
// 分档顺序：跌破就卖 → 到卖出价 → 到买入价 → 没到价。风险升高的票不算「到买入价」，
// 详情页那张卡对它写的是「暂不买」，只给已持有的人看跌破就卖价，列表也一样。
function usOrderState(raw, noBuy) {
  if (!isActionDataFresh(raw)) return null;
  const plan = raw && raw.pricePlan;
  const price = Number(raw && raw.price);
  if (!plan || !(price > 0) || !(plan.buy > 0) || !(plan.stop > 0) || !Array.isArray(plan.sell) || !plan.sell.length) return null;
  const sell = Number(plan.sell[0]);
  let state = "wait";
  if (price <= plan.stop) state = "stop";
  else if (price >= sell) state = "sell";
  else if (!noBuy && price <= plan.buy) state = "buy";
  return {
    state,
    noBuy: Boolean(noBuy),
    price,
    buy: plan.buy,
    stop: plan.stop,
    sell,
    buyGapPct: gapPct(price, plan.buy),
    stopGapPct: gapPct(price, plan.stop),
  };
}

// 列表每行下面那一条：标签 + 价 + 再跌几%才到/已到。
function usOrderLine(order) {
  if (!order) return null;
  if (order.state === "stop") return { tone: "stop", label: "跌破就卖", value: money(order.stop), note: "已跌破" };
  if (order.state === "sell") return { tone: "sell", label: "分批卖出价", value: money(order.sell), note: "已到" };
  if (order.state === "buy") return { tone: "buy", label: "参考买入价", value: money(order.buy), note: "已到" };
  if (order.noBuy) return { tone: "nobuy", label: "已持有：跌破就卖", value: money(order.stop), note: `再跌 ${order.stopGapPct.toFixed(1)}%` };
  return { tone: "wait", label: "参考买入价", value: money(order.buy), note: `再跌 ${order.buyGapPct.toFixed(1)}%` };
}

const US_STATE_RANK = { stop: 0, sell: 1, buy: 2, wait: 3 };

// 到价的排最上面；没到价的按离参考买入价由近到远；暂不买的按离跌破就卖价由近到远
// 排在后面；没有参考价的垫底。
function compareUsOrder(left, right) {
  const rank = (order) => (!order ? 5 : (order.state === "wait" && order.noBuy ? 4 : US_STATE_RANK[order.state]));
  const byRank = rank(left) - rank(right);
  if (byRank) return byRank;
  if (!left || !right) return 0;
  if (rank(left) === 4) return left.stopGapPct - right.stopGapPct;
  return left.buyGapPct - right.buyGapPct;
}

const US_TRIGGERS = [
  { key: "buy", label: "到买入价" },
  { key: "stop", label: "跌破就卖" },
  { key: "sell", label: "到卖出价" },
];

// ---- A股 ----
// 参考买入价 / 参考卖出价就是详情页那两格、榜单每行「参考买 / 参考卖」那两个价。
// 现价 ≤ 参考买入价就是 yieldImpliedPlan 的 zone "add"，≥ 参考卖出价就是 "trim"。
function aOrderState(raw) {
  const plan = yieldImpliedPlan(raw);
  if (!plan || !(plan.price > 0)) return null;
  const state = plan.zone === "add" ? "buy" : (plan.zone === "trim" ? "sell" : "wait");
  return {
    state,
    price: plan.price,
    buy: plan.addPrice,
    sell: plan.trimPrice,
    buyGapPct: gapPct(plan.price, plan.addPrice),
    sellGapPct: gapPct(plan.price, plan.trimPrice),
  };
}

function aOrderLine(order) {
  if (!order) return null;
  if (order.state === "sell") return { tone: "sell", label: "参考卖出价", value: money(order.sell, "¥"), note: "已到" };
  if (order.state === "buy") return { tone: "buy", label: "参考买入价", value: money(order.buy, "¥"), note: "已到" };
  return { tone: "wait", label: "参考买入价", value: money(order.buy, "¥"), note: `再跌 ${order.buyGapPct.toFixed(1)}%` };
}

const A_STATE_RANK = { sell: 0, buy: 1, wait: 2 };

// 到卖出价的排最上面（越过得越多越靠前），然后到买入价的、没到价的按离参考买入价由近到远；
// 算不出参考价的垫底。
function compareAOrder(left, right) {
  const rank = (order) => (!order ? 3 : A_STATE_RANK[order.state]);
  const byRank = rank(left) - rank(right);
  if (byRank) return byRank;
  if (!left || !right) return 0;
  if (left.state === "sell") return left.sellGapPct - right.sellGapPct;
  return left.buyGapPct - right.buyGapPct;
}

const A_TRIGGERS = [
  { key: "buy", label: "到买入价" },
  { key: "sell", label: "到卖出价" },
];

// ---- 港股打新 ----
// 「近期申购」顶上三格：还能申购几只、其中值得打几只、最近一只几天后截止。
// rows 是栏目页 applyList（带 closed / tone / deadlineOffset）；没有截止日的不编一个出来。
function hkApplyTiles(rows) {
  const open = (rows || []).filter((row) => !row.closed);
  const worth = open.filter((row) => row.tone === "worth").length;
  const tiles = [
    { key: "open", tone: "plain", label: "可申购", value: open.length, unit: "只", on: open.length > 0 },
    { key: "worth", tone: "buy", label: "值得打", value: worth, unit: "只", on: worth > 0 },
  ];
  const offsets = open.map((row) => row.deadlineOffset).filter((value) => Number.isFinite(value) && value >= 0);
  if (offsets.length) {
    const nearest = Math.min(...offsets);
    const value = nearest === 0 ? "今天" : (nearest === 1 ? "明天" : nearest);
    tiles.push({
      key: "deadline",
      tone: nearest <= 2 ? "sell" : "plain",
      label: "最近截止",
      value,
      unit: nearest > 1 ? "天后" : "",
      on: true,
    });
  }
  return tiles;
}

// ---- 黄金 ----
// 价位轴下面三格各带一句现价离这条线多远。先判风险下沿，跟 goldZoneForPrice 同一个顺序；
// 观察低位传进来的是已经抬到风险下沿的那段（clipWatchAtRisk 之后）。
function goldLevelNotes(price, watchLow, watchHigh, upperLow, riskLow) {
  const current = Number(price);
  const notes = { risk: null, watch: null, upper: null };
  if (!(current > 0)) return notes;
  const pct = (level) => Math.abs(gapPct(current, level)).toFixed(1);
  if (riskLow > 0) {
    notes.risk = current <= riskLow ? { text: "已触及", tone: "stop" } : { text: `再跌 ${pct(riskLow)}%`, tone: "" };
  }
  if (watchLow > 0 && watchHigh > 0) {
    if (current > watchHigh) notes.watch = { text: `再跌 ${pct(watchHigh)}%`, tone: "" };
    else if (current >= watchLow) notes.watch = { text: "现价在内", tone: "" };
    else notes.watch = { text: "已低于", tone: "" };
  }
  if (upperLow > 0) {
    notes.upper = current >= upperLow ? { text: "已到", tone: "sell" } : { text: `再涨 ${pct(upperLow)}%`, tone: "" };
  }
  return notes;
}

module.exports = {
  countTiles,
  usOrderState,
  usOrderLine,
  compareUsOrder,
  US_TRIGGERS,
  aOrderState,
  aOrderLine,
  compareAOrder,
  A_TRIGGERS,
  hkApplyTiles,
  goldLevelNotes,
};
