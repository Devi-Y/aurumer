import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { buildDailyDigestDocument } from "./build-daily-digest.mjs";

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
  "每只美股必须具备观察低位、观察上沿与风险下沿研究参考",
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
const dividendEtf = (snapshot.aShare?.funds || []).find((item) =>
  String(item.code || "").replace(/\.(SH|SZ)$/i, "") === "515180"
);
assert(dividendEtf && Number.isFinite(Number(dividendEtf.currentPrice)), "A股收息基金必须包含可核验价格的 515180");
assert(dividendEtf.asOf, "A股收息基金 515180 缺少行情时间");
assert(Array.isArray(dividendEtf.history) && dividendEtf.history.length >= 5, "A股收息基金 515180 缺少价格历史");
assert(["live", "fallback"].includes(dividendEtf.dataStatus || "live"), "A股收息基金 515180 数据状态未标记");
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
assert(Number.isFinite(snapshot.gold?.answer?.scores?.international?.score), "黄金国际金观察分缺失");
assert(Number.isFinite(snapshot.gold?.answer?.scores?.domestic?.score), "黄金人民币金观察分缺失");
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
assert(dashboardJs.includes("data/daily-digest.json"), "每日驾驶舱应读取今日答案摘要，而不是随机挑一只股票");
assert(indexHtml.includes("data/daily-digest.json") && indexHtml.includes("function dailyAnswerBoard"), "完整工具栏目页应接入今日答案摘要");

const digest = JSON.parse(await readFile(resolve(root, "data/daily-digest.json"), "utf8"));
assert(digest.updatedAt === snapshot.updatedAt, "今日答案摘要与公开快照 updatedAt 不一致");
assert(["hk", "us", "a", "gold", "guru"].every((market) => Array.isArray(digest.markets?.[market]) && digest.markets[market].length >= 3), "今日答案摘要五个栏目不完整");
// 这份清单对位的是用户提的六条诉求，不是「今天恰好生成了哪几张卡」。
// 少一条就是少回答一个用户花钱买的问题，所以宁可写死也要逐条点名。
const requiredQuestions = {
  hk: ["近期上新", "哪些值得打", "哪些要避雷", "打中后暗盘", "打中后首日"],
  us: ["七姐妹近期怎么了", "低估的七姐妹", "风险升高要减", "最热的三只", "底仓如何配置"],
  a: ["分红稳定性 前五", "分红收益性 前五", "什么价可加大", "什么价可兑现", "周期短持"],
  gold: ["现在什么价", "是否值得买入", "是否应该卖出", "拐点变化"],
  guru: ["业绩靠前持仓", "本季他们在加什么", "本季他们在减什么", "未来持仓趋势", "应该避免什么"],
};
for (const [market, questions] of Object.entries(requiredQuestions)) {
  const actual = new Set((digest.markets[market] || []).map((card) => card.question));
  for (const question of questions) assert(actual.has(question), `今日答案摘要 ${market} 缺少：${question}`);
}
// 上面查的是「文件里有没有这几问」，这里查「文件是不是这份快照现算出来的」。
// 2026-09-04 线上停更 17 小时就栽在这条缝里：卡片改名之后本地 audit 依旧全绿，
// 因为磁盘上那份 daily-digest.json 还是改名前 CI 提交的旧件，CI 一重算就炸。
const miniSnapshot = createRequire(import.meta.url)("../miniprogram/data/live-snapshot.js");
const rebuilt = buildDailyDigestDocument(miniSnapshot);
for (const market of Object.keys(requiredQuestions)) {
  const onDisk = (digest.markets[market] || []).map((card) => card.question).join(" / ");
  const nowBuilt = (rebuilt.markets[market] || []).map((card) => card.question).join(" / ");
  assert(onDisk === nowBuilt, `今日答案摘要 ${market} 与今日答案模块不同步：文件是「${onDisk}」，现算是「${nowBuilt}」，先跑 npm run sync:mini 再提交`);
}
const answerText = JSON.stringify(digest.markets);
// 这三只在「没有符合条件的标的」时也会以兜底文案点名出现，所以断言的是「有没有正面回答」，
// 不是「今天它们一定低估/一定有风险」——后者会在某天估值变化时把 CI 炸掉。
assert(answerText.includes("谷歌-A") && answerText.includes("Meta"), "美股每日答案必须回答谷歌-A与Meta低估观察");
assert(answerText.includes("特斯拉"), "美股每日答案必须回答特斯拉风险观察");
assert(answerText.includes("不照抄仓位") && answerText.includes("滞后披露"), "机构每日答案必须保留跟随边界");
assert(!/strategyAssessment|modelEstimate|breakProbability/.test(JSON.stringify(digest)), "今日答案摘要泄露内部字段");

try {
  const sleeveQuotes = JSON.parse(await readFile(resolve(root, "data/sleeve-quotes.json"), "utf8"));
  for (const symbol of ["VOO", "JEPQ", "SCHD", "O", "SGOV"]) {
    const row = (sleeveQuotes.quotes || []).find((item) => item.symbol === symbol);
    if (!row) continue;
    assert(Number.isFinite(Number(row.price)) && row.source === "Yahoo Finance", `底仓 ETF ${symbol} 缺少可核验 Yahoo 报价`);
  }
} catch (error) {
  if (error && error.code !== "ENOENT" && !String(error.message || "").includes("ENOENT")) {
    throw error;
  }
}

console.log("公开数据与页面边界检查通过");
