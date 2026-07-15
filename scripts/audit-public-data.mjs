import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshot = JSON.parse(
  await readFile(resolve(root, "data/live-snapshot.json"), "utf8"),
);
const indexHtml = await readFile(resolve(root, "index.html"), "utf8");
const dailyHtml = await readFile(resolve(root, "daily.html"), "utf8");
const dashboardJs = await readFile(resolve(root, "assets/dashboard.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findForbiddenKeys(value, path = "$", matches = []) {
  if (!value || typeof value !== "object") return matches;
  const forbidden = new Set([
    "strategyHealth",
    "strategyAssessment",
    "strategyBacktest",
    "modelEstimate",
    "modelValidation",
    "qualityCriteria",
  ]);
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (forbidden.has(key)) matches.push(next);
    findForbiddenKeys(child, next, matches);
  }
  return matches;
}

const forbiddenPaths = findForbiddenKeys(snapshot);
assert(forbiddenPaths.length === 0, `公开快照泄露内部字段：${forbiddenPaths.join(", ")}`);
assert(snapshot.status === "live" || snapshot.status === "partial", "公开快照状态不可用");
assert((snapshot.us?.stocks || []).length === 30, "美股行情必须完整覆盖 30 只");
assert((snapshot.us?.fundamentals || []).length === 30, "美股财务必须完整覆盖 30 只");
assert(
  snapshot.us.stocks.every((stock) =>
    Number.isFinite(stock.technicalPlan?.buy)
    && Number.isFinite(stock.technicalPlan?.stop)
    && Array.isArray(stock.technicalPlan?.tp)
    && stock.technicalPlan.tp.length >= 2,
  ),
  "每只美股必须具备买入、止盈和止损研究参考",
);
assert((snapshot.hk?.history || []).length >= 10, "港股历史样本不足 10 只");
assert((snapshot.hk?.listings || []).length >= 1, "港股当前项目为空");
assert((snapshot.aShare?.quotes || []).length === 12, "A股行情必须完整覆盖 12 只");
assert((snapshot.aShare?.fundamentals || []).length === 12, "A股财务必须完整覆盖 12 只");
assert(
  snapshot.aShare.fundamentals.every((item) =>
    Number.isFinite(item.operatingCashFlow)
    && Number.isFinite(item.capitalExpenditure)
    && Number.isFinite(item.freeCashFlow)
    && item.period !== "mock",
  ),
  "A股必须使用可核验现金流资料，不能发布 mock 财务",
);
assert((snapshot.investors || []).length >= 9, "聪明人持仓不足 9 位");
assert(
  snapshot.investors.every((item) => Number.isFinite(item.trackingScore)),
  "每位聪明人必须有最终跟踪价值分",
);

assert(!/breakProbability|破发概率/.test(indexHtml), "公开页面不得用分数反推破发概率");
assert(
  !/strategyAssessment|modelEstimate|strategyHealth|modelValidation|strategyBacktest/.test(`${dailyHtml}\n${dashboardJs}`),
  "每日驾驶舱不得读取内部策略或模型字段",
);
assert(!/LIVE\.hasUS=Boolean\(US_STOCKS|LIVE\.hasAShare=Boolean\(A_SHARES|LIVE\.hasInvestors=Boolean\(INVESTORS/.test(indexHtml), "数据失败时不得回退到静态假行情");
assert(indexHtml.includes("function investorRankInfo"), "聪明人持仓缺少分数排名");
assert(indexHtml.includes("function aShareCashFlowFacts"), "A股详情缺少自由现金流事实");
assert(indexHtml.includes("function renderLoadingApp"), "缺少首页加载状态");

console.log("公开数据与页面边界检查通过");
