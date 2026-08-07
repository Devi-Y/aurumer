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
    "internalAssessment",
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

// 缺少 pdftotext 属于环境配置错误，必然产出"字段全空但看起来正常"的快照，直接拦住。
// 上游改版导致的抽取失败只告警，不阻断美股、A股与黄金的正常发布。
const hkExtraction = snapshot.hk?.extraction;
assert(
  !hkExtraction?.missingBinary,
  `构建环境缺少 pdftotext（poppler-utils），港股公告字段无法抽取：${hkExtraction?.reason || ""}`,
);
if (hkExtraction && hkExtraction.ok === false) {
  console.warn(`[告警] ${hkExtraction.reason}`);
}
assert((snapshot.aShare?.quotes || []).length === 20, "A股行情必须完整覆盖 20 只");
assert((snapshot.aShare?.fundamentals || []).length === 20, "A股财务必须完整覆盖 20 只");
assert(
  snapshot.aShare.fundamentals.every((item) =>
    Number.isFinite(item.operatingCashFlow)
    && Number.isFinite(item.capitalExpenditure)
    && Number.isFinite(item.freeCashFlow)
    && item.period !== "mock",
  ),
  "A股必须使用可核验现金流资料，不能发布 mock 财务",
);
assert(
  snapshot.aShare.quotes.filter((item) => String(item.industry || "").trim()).length >= 20,
  "A股行业事实必须完整覆盖 20 只",
);
assert(
  snapshot.aShare.quotes.filter((item) => Number.isFinite(Number(item.currentDividendYield)) && Number(item.currentDividendYield) > 0).length >= 20,
  "A股股息率事实必须完整覆盖 20 只",
);
// 13F 按季度披露，个别机构延迟属于正常情况：低于 6 位才判定为数据异常，
// 6-8 位只告警，不阻断其余板块发布。
const investorCount = (snapshot.investors || []).length;
assert(investorCount >= 6, `聪明人持仓仅 ${investorCount} 位，低于可发布下限 6 位`);
if (investorCount < 9) {
  console.warn(`[告警] 聪明人持仓 ${investorCount} 位，少于预期的 9 位，请检查 13F 抓取`);
}
assert(snapshot.gold?.quotes?.international, "黄金国际行情缺失");
assert(snapshot.gold?.quotes?.domestic, "上海金 Au99.99 行情缺失");
assert(Number.isFinite(snapshot.gold?.answer?.score), "黄金最终答案与评分缺失");
assert(snapshot.gold?.answer?.action || snapshot.gold?.answer?.conclusion, "黄金缺少公开动作或结论");
assert(snapshot.gold?.answer?.pricePlan?.internationalWatch, "黄金国际金关注区间缺失");
assert(snapshot.gold?.answer?.pricePlan?.domesticWatch, "黄金上海金关注区间缺失");
assert((snapshot.gold?.indicators || []).length >= 6, "黄金驱动数据不足 6 项");
assert(
  snapshot.us.stocks.every((stock) => String(stock.symbol || "").trim() && Number.isFinite(stock.price)),
  "美股策略门禁：每只必须有代码与可核验价格",
);
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
