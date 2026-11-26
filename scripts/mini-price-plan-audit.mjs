import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { degradeStaleActions } = require("../cloudfunctions/aurum-data/action-freshness.js");

// Apply the same evaluation time to the bundled data and the sanitized source.
// Stale plans are removed by runtime rules; fresh plans still need an exact match.
export function assertMiniPricePlans(snapshot, sanitized, now) {
  const mini = degradeStaleActions(snapshot, now);
  const sourceBySymbol = new Map((sanitized.us?.stocks || []).map((stock) => [stock.symbol, stock]));
  for (const stock of mini.us?.stocks || []) {
    if (JSON.stringify(stock.pricePlan) !== JSON.stringify(sourceBySymbol.get(stock.symbol)?.pricePlan)) {
      throw new Error(`小程序离线包里 ${stock.symbol} 的 pricePlan 跟云函数清洗结果不一致，请运行 npm run sync:mini`);
    }
  }
}
