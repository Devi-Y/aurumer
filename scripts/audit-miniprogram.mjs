import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const miniRoot = path.join(root, "miniprogram");
const requiredPages = [
  "pages/index/index",
  "pages/section/index",
  "pages/list/index",
  "pages/detail/index",
  "pages/webview/index",
];
const forbiddenKeys = new Set([
  "strategyHealth",
  "strategyAssessment",
  "strategyBacktest",
  "modelEstimate",
  "modelValidation",
  "qualityCriteria",
  "backtest",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectKeys(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKeys.has(key), `小程序离线数据包含内部字段：${[...trail, key].join(".")}`);
    inspectKeys(child, [...trail, key]);
  }
}

const appConfig = JSON.parse(await readFile(path.join(miniRoot, "app.json"), "utf8"));
for (const page of requiredPages) {
  assert(appConfig.pages.includes(page), `app.json 缺少页面：${page}`);
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    await access(path.join(miniRoot, `${page}.${extension}`));
  }
}

const generatedSource = await readFile(path.join(miniRoot, "data", "live-snapshot.js"), "utf8");
const match = generatedSource.match(/module\.exports\s*=\s*([\s\S]+);\s*$/);
assert(match, "小程序离线快照格式错误");
const snapshot = JSON.parse(match[1]);
const publicSnapshot = JSON.parse(await readFile(path.join(root, "data", "live-snapshot.json"), "utf8"));
assert(snapshot.updatedAt === publicSnapshot.updatedAt, "小程序离线快照落后于公开网页数据，请运行 npm run sync:mini");
inspectKeys(snapshot);
assert(snapshot.us.stocks.length >= 20, "小程序美股不足 20 只");
assert(snapshot.us.fundamentals.length >= 20, "小程序美股财务数据不足 20 只");
assert(snapshot.hk.listings.length >= 1, "小程序缺少当前港股新股");
assert(snapshot.hk.history.length >= 8, "小程序港股历史样本不足 8 只");
assert(snapshot.aShare.quotes.length >= 12, "小程序 A 股不足 12 只");
assert(snapshot.aShare.fundamentals.length >= 12, "小程序 A 股现金流数据不足 12 只");
assert(snapshot.investors.length >= 8, "小程序聪明人持仓不足 8 位");

const sectionSource = await readFile(path.join(miniRoot, "utils", "answers.js"), "utf8");
const miniModule = { exports: {} };
vm.runInNewContext(sectionSource, { module: miniModule, exports: miniModule.exports });
const answers = miniModule.exports;
const miniUsItems = answers.allItems(snapshot, "us");
const miniAShareItems = answers.allItems(snapshot, "a");
const miniHKItems = answers.allItems(snapshot, "hk");
const sevenSymbols = new Set(["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"]);
const fundamentals = new Map(snapshot.us.fundamentals.map((item) => [item.symbol, item]));
const nonSeven = snapshot.us.stocks
  .filter((item) => !sevenSymbols.has(item.symbol))
  .sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0));
const qualityHot = nonSeven.filter((item) => fundamentals.get(item.symbol)?.qualityEligible);
const expectedHot = (qualityHot.length >= 3 ? qualityHot : nonSeven).slice(0, 3).map((item) => item.symbol);
const actualHot = miniUsItems.filter((item) => item.group === "hot").map((item) => item.id);
assert(JSON.stringify(actualHot) === JSON.stringify(expectedHot), `小程序热度前三口径不一致：${actualHot.join(",")}`);
for (const item of miniAShareItems) {
  const advice = item.raw.currentAdvice;
  if (advice === "买入") assert(item.group === "buy", `${item.name} 应归入买入组`);
  if (["持有", "等待", "观察"].includes(advice)) assert(item.group === "wait", `${item.name} 应归入等待组`);
}
for (const item of miniHKItems.filter((entry) => entry.raw.publicAnswer?.verdict === "待核验")) {
  assert(item.score === null, `${item.name} 资料待核验时不应显示 0 分`);
  assert(!item.rank, `${item.name} 资料待核验时不应生成占位排名`);
}

const indexSource = await readFile(path.join(miniRoot, "pages", "index", "index.js"), "utf8");
const detailSource = await readFile(path.join(miniRoot, "pages", "detail", "index.js"), "utf8");
const detailTemplate = await readFile(path.join(miniRoot, "pages", "detail", "index.wxml"), "utf8");
const detailContract = `${detailSource}\n${detailTemplate}`;
assert(indexSource.includes("pages/section/index"), "小程序首页仍未进入原生二级页");
for (const label of ["值得打", "谨慎打", "不建议", "已结束", "七姐妹", "热度前三", "聪明人持仓", "买入", "等待", "回避"]) {
  assert(sectionSource.includes(label), `小程序缺少二级入口：${label}`);
}
for (const label of ["买入参考", "止盈参考", "止损参考", "自由现金流", "主要持仓变化"]) {
  assert(detailContract.includes(label), `小程序详情缺少关键内容：${label}`);
}
assert(!indexSource.includes("pages/webview/index?target=${target}"), "小程序首页仍直接依赖 web-view");
assert(!detailSource.includes("raw.currentPrice || 0"), "小程序 A 股缺失价格仍会显示 0 元");
assert(!detailSource.includes("raw.trackingScore || 0"), "小程序缺失跟踪分仍会显示 0 分");

const projectConfig = JSON.parse(await readFile(path.join(miniRoot, "project.config.json"), "utf8"));
const appIdState = projectConfig.appid === "touristappid" ? "旅游 AppID，仅可本地预览" : "正式 AppID 已配置";
console.log(`小程序原生层级与离线数据检查通过：${appIdState}`);
