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
  "pages/member/index",
  "pages/legal/index",
  "pages/workspace/index",
];
const pageStylesByPath = new Map();
const pageTemplatesByPath = new Map();
const forbiddenKeys = new Set([
  "strategyHealth",
  "strategyAssessment",
  "strategyBacktest",
  "modelEstimate",
  "modelValidation",
  "qualityCriteria",
  "backtest",
  "technicalPlan",
  "publishedEstimate",
  "rating",
  "buy_zone_low",
  "buy_zone_high",
  "buyZoneLow",
  "buyZoneHigh",
  "targetPrice",
  "targetUpside",
  "growthScore",
  "profitScore",
  "valueScore",
  "finalScore",
  "qualityEligible",
  "trackingScore",
  "trackingSummary",
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
  const pageConfig = JSON.parse(await readFile(path.join(miniRoot, `${page}.json`), "utf8"));
  assert(!("navigationStyle" in pageConfig), `${page} 不应覆盖微信原生导航栏`);
  assert(pageConfig.navigationBarTitleText, `${page} 缺少清晰的原生导航标题`);
  const pageStyles = await readFile(path.join(miniRoot, `${page}.wxss`), "utf8");
  const pageTemplate = await readFile(path.join(miniRoot, `${page}.wxml`), "utf8");
  pageStylesByPath.set(page, pageStyles);
  pageTemplatesByPath.set(page, pageTemplate);
  assert(pageTemplate.includes('class="page-shell'), `${page} 没有使用完整小程序视口容器`);
  assert(pageStyles.includes("@media (max-width: 340px)"), `${page} 缺少小屏手机适配`);
  assert(pageStyles.includes("@media (min-width: 700px)"), `${page} 缺少平板或大屏适配`);
  assert(pageStyles.includes("border-radius: 24rpx"), `${page} 缺少适合触屏识别的圆角内容分组`);
}
assert(appConfig.pages[0] === "pages/index/index", "小程序启动页必须是今日重点首页");
assert(!appConfig.pages.some((page) => page.includes("webview")), "小程序仍注册了外部 web-view 页面");

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
assert(snapshot.aShare.quotes.length >= 20, "小程序 A 股不足 20 只");
assert(snapshot.aShare.fundamentals.length >= 20, "小程序 A 股现金流数据不足 20 只");
assert(Array.isArray(snapshot.aShare.funds), "小程序 A 股收息快照缺少基金资产数组");
const miniDividendEtf = snapshot.aShare.funds.find((item) =>
  String(item.code || "").replace(/\.(SH|SZ)$/i, "") === "515180"
);
assert(miniDividendEtf && Number.isFinite(Number(miniDividendEtf.currentPrice)), "小程序 A 股收息快照缺少可核验价格的 515180");
assert(miniDividendEtf.asOf, "小程序 A 股收息快照缺少 515180 行情时间");
assert(Array.isArray(miniDividendEtf.history) && miniDividendEtf.history.length >= 5, "小程序 515180 缺少足够价格历史");
assert(snapshot.investors.length >= 8, "小程序聪明人持仓不足 8 位");

const sectionSource = await readFile(path.join(miniRoot, "utils", "answers.js"), "utf8");
const smartMoneySource = await readFile(path.join(miniRoot, "utils", "smart-money.js"), "utf8");
const strategyScoreSource = await readFile(path.join(miniRoot, "utils", "strategy-score.js"), "utf8");
const strategySignalsSource = await readFile(path.join(miniRoot, "utils", "strategy-signals.js"), "utf8");
const marketLensesSource = await readFile(path.join(miniRoot, "utils", "market-lenses.js"), "utf8");
const guruOverlapSource = await readFile(path.join(miniRoot, "utils", "guru-overlap.js"), "utf8");
const smartMoneyModule = { exports: {} };
vm.runInNewContext(smartMoneySource, { module: smartMoneyModule, exports: smartMoneyModule.exports });
const strategyScoreModule = { exports: {} };
vm.runInNewContext(strategyScoreSource, { module: strategyScoreModule, exports: strategyScoreModule.exports });
const strategySignalsModule = { exports: {} };
vm.runInNewContext(strategySignalsSource, { module: strategySignalsModule, exports: strategySignalsModule.exports });
const marketLensesModule = { exports: {} };
vm.runInNewContext(marketLensesSource, {
  module: marketLensesModule,
  exports: marketLensesModule.exports,
  require(request) {
    if (request === "./strategy-score") return strategyScoreModule.exports;
    if (request === "./strategy-signals") return strategySignalsModule.exports;
    throw new Error(`分档透镜出现未知依赖：${request}`);
  },
});
const guruOverlapModule = { exports: {} };
vm.runInNewContext(guruOverlapSource, {
  module: guruOverlapModule,
  exports: guruOverlapModule.exports,
  require(request) {
    if (request === "./smart-money") return smartMoneyModule.exports;
    throw new Error(`交叉重叠模块出现未知依赖：${request}`);
  },
});
const miniModule = { exports: {} };
vm.runInNewContext(sectionSource, {
  module: miniModule,
  exports: miniModule.exports,
  require(request) {
    if (request === "./smart-money") return smartMoneyModule.exports;
    if (request === "./strategy-score") return strategyScoreModule.exports;
    if (request === "./guru-overlap") return guruOverlapModule.exports;
    if (request === "./market-lenses") return marketLensesModule.exports;
    throw new Error(`小程序答案模块出现未知依赖：${request}`);
  },
});
const answers = miniModule.exports;
const miniUsItems = answers.allItems(snapshot, "us");
const miniAShareItems = answers.allItems(snapshot, "a");
const miniHKItems = answers.allItems(snapshot, "hk");
const miniGoldItems = answers.allItems(snapshot, "gold");
const miniGuruItems = answers.allItems(snapshot, "guru");
const smartMoneyProfiles = smartMoneyModule.exports.SMART_MONEY_PROFILES;
const sevenSymbols = new Set(["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"]);
const nonSeven = snapshot.us.stocks
  .filter((item) => !sevenSymbols.has(item.symbol))
  .sort((left, right) => Number(right.heatScore || 0) - Number(left.heatScore || 0));
const expectedHot = nonSeven.slice(0, 3).map((item) => item.symbol);
const actualHot = miniUsItems.filter((item) => item.group === "hot").map((item) => item.id);
assert(JSON.stringify(actualHot) === JSON.stringify(expectedHot), `小程序热度前三口径不一致：${actualHot.join(",")}`);
const hot10 = miniUsItems.filter((item) => item.group === "hot10");
const valueBoard = miniUsItems.filter((item) => item.group === "value");
assert(hot10.length === 10, `小程序热度前十应为 10 只，实际 ${hot10.length}`);
assert(valueBoard.length === 10, `小程序性价比观察榜应为 10 只，实际 ${valueBoard.length}`);
assert(hot10.every((item, index) => item.rank === index + 1), "热度前十排名必须从 1 连续");
assert(valueBoard.every((item, index) => item.rank === index + 1), "性价比观察榜排名必须从 1 连续");
assert(sectionSource.includes("热度前十") && sectionSource.includes("性价比观察"), "栏目分组缺少热度前十或性价比观察");
const overlapItems = miniGuruItems.filter((item) => item.group === "overlap");
assert(overlapItems.length >= 2, `小程序交叉重叠应至少 2 条，实际 ${overlapItems.length}`);
assert(sectionSource.includes("交叉重叠"), "机构栏目缺少交叉重叠深度入口");
assert(miniAShareItems.length === 10, `小程序 A 股收息固定研究样本应为 10 只，实际 ${miniAShareItems.length}`);
const fixedAShareCodes = ["600900.SH", "600036.SH", "600941.SH", "515180.SH", "601088.SH", "000333.SZ"];
assert(
  JSON.stringify(miniAShareItems.slice(0, fixedAShareCodes.length).map((item) => item.code)) === JSON.stringify(fixedAShareCodes),
  `小程序 A 股收息固定样本顺序不一致：${miniAShareItems.slice(0, fixedAShareCodes.length).map((item) => item.code).join(",")}`,
);
assert(miniAShareItems.filter((item) => !fixedAShareCodes.includes(item.code)).length === 4, "小程序 A 股自动补充收息样本应为 4 只");
assert(miniAShareItems.some((item) => item.code === "515180.SH" && item.raw?.assetType === "fund"), "小程序 A 股收息样本缺少独立 ETF 资产 515180");
assert(miniGoldItems.length === 2, `小程序黄金入口应有 2 个答案，实际 ${miniGoldItems.length}`);
assert(miniGoldItems.every((item) => ["track", "plan"].includes(item.group)), "小程序黄金入口应是现在怎么做 / 买点与卖点");
assert(miniGoldItems.some((item) => item.one.includes("人民币金")), "小程序黄金追踪缺少人民币金数据");
const allAShareQuotes = snapshot.aShare?.quotes || [];
assert(allAShareQuotes.length >= 20, `小程序 A 股详情覆盖门槛应至少为 20 只，实际 ${allAShareQuotes.length}`);
assert(allAShareQuotes.every((quote) => answers.findItem(snapshot, "a", quote.code)), "小程序 A 股 20 只行情标的必须均可打开详情");
assert(Number.isFinite(snapshot.gold?.answer?.scores?.international?.score), "小程序缺少国际金观察分");
assert(Number.isFinite(snapshot.gold?.answer?.scores?.domestic?.score), "小程序缺少人民币金观察分");
for (const [group, count] of [["hk", 3], ["us", 5], ["a", 3]]) {
  const profiles = smartMoneyProfiles.filter((item) => item.group === group);
  const items = miniGuruItems.filter((item) => item.group === group);
  assert(profiles.length === count && items.length === count, `小程序聪明人 ${group} 分组应有 ${count} 个`);
  assert(profiles.every((item, index) => item.order === index + 1), `小程序聪明人 ${group} 排名必须连续且从 1 开始`);
  const annualized = profiles.map((item) => Number(String(item.performanceValue).match(/\d+(?:\.\d+)?/)?.[0] || 0));
  assert(annualized.every((value, index) => index === 0 || value <= annualized[index - 1]), `小程序聪明人 ${group} 没有按表观长期年化从高到低排列`);
  for (const profile of profiles) {
    const rendered = items.find((item) => item.id === profile.id);
    assert(profile.why && profile.how && profile.performanceDetail && profile.performanceBasis, `${profile.name} 缺少业绩口径、WHY 或 HOW`);
    assert(rendered && rendered.raw.holdings.length >= 3, `${profile.name} 缺少至少 3 项公开持仓`);
    assert(
      (rendered.one.includes("原因：") && rendered.one.includes("学法："))
      || (rendered.one.includes("WHY：") && rendered.one.includes("HOW：")),
      `${profile.name} 列表没有直接展示原因/学法`,
    );
  }
}
for (const item of miniAShareItems) {
  assert(["prime", "steady", "watch"].includes(item.group), `${item.name} 应收息分级分组`);
  assert(item.raw.researchView?.state, `${item.name} 缺少后端完整度状态`);
  assert(item.score == null || Number.isFinite(Number(item.score)), `${item.name} 观察分异常`);
}
for (const item of miniHKItems.filter((entry) => ["worth", "caution", "avoid"].includes(entry.group))) {
  assert(["建议申购", "暂缓观察", "暂不建议", "资料不够"].includes(item.badge), `${item.name} 缺少人话申购结论`);
}

const indexSource = await readFile(path.join(miniRoot, "pages", "index", "index.js"), "utf8");
const indexTemplate = await readFile(path.join(miniRoot, "pages", "index", "index.wxml"), "utf8");
const indexStyles = await readFile(path.join(miniRoot, "pages", "index", "index.wxss"), "utf8");
const appSource = await readFile(path.join(miniRoot, "app.js"), "utf8");
const appStyles = await readFile(path.join(miniRoot, "app.wxss"), "utf8");
const storeSource = await readFile(path.join(miniRoot, "data", "store.js"), "utf8");
const detailSource = await readFile(path.join(miniRoot, "pages", "detail", "index.js"), "utf8");
const detailTemplate = await readFile(path.join(miniRoot, "pages", "detail", "index.wxml"), "utf8");
const memberPageSource = await readFile(path.join(miniRoot, "pages", "member", "index.js"), "utf8");
const memberTemplate = await readFile(path.join(miniRoot, "pages", "member", "index.wxml"), "utf8");
const legalConfig = await readFile(path.join(miniRoot, "config", "legal.js"), "utf8");
const legalPage = await readFile(path.join(miniRoot, "pages", "legal", "index.js"), "utf8");
const legalTemplate = await readFile(path.join(miniRoot, "pages", "legal", "index.wxml"), "utf8");
const privacySupplement = await readFile(path.join(root, "MINIPROGRAM_PRIVACY_SUPPLEMENT.txt"), "utf8");
const workspaceSource = await readFile(path.join(miniRoot, "pages", "workspace", "index.js"), "utf8");
const workspaceTemplate = await readFile(path.join(miniRoot, "pages", "workspace", "index.wxml"), "utf8");
const memberService = await readFile(path.join(miniRoot, "services", "member.js"), "utf8");
const sitemap = JSON.parse(await readFile(path.join(miniRoot, "sitemap.json"), "utf8"));
const liveDataFunction = await readFile(path.join(root, "cloudfunctions", "aurum-data", "index.js"), "utf8");
const liveDataSanitizer = await readFile(path.join(root, "cloudfunctions", "aurum-data", "sanitize.js"), "utf8");
const hkExitPlan = await readFile(path.join(miniRoot, "utils", "hk-exit-plan.js"), "utf8");
const detailContract = `${detailSource}\n${detailTemplate}`;
const expectedDetailModuleLabels = ["结论", "金价", "驱动", "资料", "研究", "风险", "持仓", "业绩", "价格", "财务"];
assert(
  detailTemplate.includes('scroll-x="true"')
  && detailTemplate.includes('class="detail-tabs"')
  && detailSource.includes("buildDetailModules")
  && detailSource.includes("switchModule"),
  "详情页缺少横向滑动模块",
);
for (const label of expectedDetailModuleLabels) {
  assert([...label].length === 2, `详情页模块名称不是 2 个字：${label}`);
  assert(detailSource.includes(`label: "${label}"`), `详情页缺少模块：${label}`);
}
for (const marker of ["先看答案", "价格与位置", "数据与质量", "研究图表", "已披露资料", "风险提醒"]) {
  assert(detailTemplate.includes(marker), `详情页横向模块缺少对应内容：${marker}`);
}
assert(
  detailSource.includes("buildAShareRiskItems")
    && detailSource.includes('title: "经营风险"')
    && detailSource.includes('title: "行业风险"')
    && detailSource.includes('title: "价格风险"')
    && detailSource.includes('title: "退出触发"')
    && detailTemplate.includes("riskItems"),
  "A 股详情缺少经营/行业/价格/退出触发四类投研风险提醒",
);
assert(detailSource.includes("国际观察分") && detailSource.includes("人民币观察分"), "黄金详情缺少双观察分展示");
assert(indexSource.includes("pages/section/index"), "小程序首页仍未进入原生二级页");
assert(appConfig.pages.includes("pages/member/index"), "小程序仍应保留会员页路由");
assert(indexSource.includes("pages/member/index"), "小程序首页缺少研究会员入口");
assert(
  indexTemplate.includes("entry-grid")
    && indexStyles.includes("display: flex")
    && indexStyles.includes("flex-wrap: wrap")
    && indexStyles.includes("width: 33.333333%"),
  "小程序首页核心入口不是手机端 3 列布局",
);
assert(
  appStyles.includes("width: 100%")
    && appStyles.includes("min-height: 100vh")
    && appStyles.includes("max-width: none"),
  "小程序全局页面仍被网页式窄容器限制，未铺满实际视口",
);
assert(indexTemplate.includes("today-card") || indexTemplate.includes("home-hero"), "小程序首页没有以今日重点和核心入口铺满移动视口");
assert(
  indexStyles.includes("min-height: 100vh")
    && (indexStyles.includes("min-height: 176rpx") || indexStyles.includes("min-height: 188rpx") || indexStyles.includes("min-height: 210rpx"))
    && (indexTemplate.includes("today-card") || indexTemplate.includes("home-hero")),
  "小程序首页没有以今日重点和核心入口铺满移动视口",
);
assert(indexStyles.includes("border-right: 1rpx") && indexStyles.includes("border-bottom: 1rpx"), "小程序首页核心入口没有使用无间距细分隔线");
assert(indexTemplate.includes('class="entry-icon"') && indexTemplate.includes('class="entry-badge"'), "小程序核心入口缺少大图标或年度会员角标");
assert(indexTemplate.includes('aria-label="{{item.title}}，{{item.help}}"') && indexTemplate.includes('aria-hidden="true"'), "小程序核心入口缺少按钮朗读标签或装饰图标隐藏语义");
assert(indexTemplate.includes('role="button"') && !indexTemplate.includes("<button"), "小程序首页整块入口不应受原生 button 默认宽度干扰");
for (const label of ["今日重点", "核心研究"]) {
  assert(
    indexTemplate.includes(label) || indexSource.includes(`"${label}"`),
    `小程序首页缺少清晰层级：${label}`,
  );
}
for (const marker of ["港股", "美股", "A股", "黄金"]) {
  assert(indexSource.includes(marker), `今日重点缺少方向：${marker}`);
}
assert(
  ['id: "hk"', 'id: "us"', 'id: "a"', 'id: "gold"'].every((marker) => indexSource.includes(marker)),
  "今日重点应覆盖港股、美股、A股、黄金四个方向",
);
assert(
  indexTemplate.includes("我的持仓")
    && indexSource.includes("openHoldingDetail")
    && indexSource.includes("add_holding")
    && indexSource.includes("trackHomeVisit")
    && indexTemplate.includes("thesis-ticker")
    && indexSource.includes("buildThesisTicker")
    && !indexTemplate.includes("本机速记")
    && !indexTemplate.includes("我的研究记录")
    && !indexTemplate.includes("查看 4 项速览"),
  "首页应恢复我的持仓闭环与滚动思路条，且不再保留旧的本机速记条、研究记录条或展开速览",
);
assert(await access(path.join(miniRoot, "utils", "holding-observe.js")).then(() => true).catch(() => false), "首页持仓观察缺少 holding-observe 工具");
assert(await access(path.join(miniRoot, "utils", "master-playbooks.js")).then(() => true).catch(() => false), "缺少大师策略摘要模块");
assert(await access(path.join(miniRoot, "utils", "thesis-ticker.js")).then(() => true).catch(() => false), "缺少首页滚动思路条模块");
const analyticsSource = await readFile(path.join(miniRoot, "utils", "analytics.js"), "utf8");
assert(analyticsSource.includes("return_visit") && analyticsSource.includes("add_holding"), "首页行为埋点应覆盖添加持仓与次日回访");
assert(analyticsSource.includes("trackHomeVisit"), "首页应通过 trackHomeVisit 统一记录打开与次日回访");
const playbookSource = await readFile(path.join(miniRoot, "utils", "master-playbooks.js"), "utf8");
for (const name of ["李嘉诚", "潘石屹", "沈南鹏", "桥水基金", "文艺复兴", "索罗斯", "孙宇晨案例"]) {
  assert(playbookSource.includes(name), `大师策略摘要缺少：${name}`);
}
assert(playbookSource.includes("不可照抄") || playbookSource.includes("copyHoldings: false"), "大师策略必须标明不可照抄仓位");
assert((pageTemplatesByPath.get("pages/section/index") || "").includes("大师策略摘要"), "机构持仓栏目应露出大师策略摘要");
assert(!appConfig.tabBar, "首页已去掉记录/会员后不应再保留底部 tabBar");
assert(indexStyles.includes("width: 25%") && indexStyles.includes("font-size: 28rpx"), "小程序首页方向标签或标题没有使用清晰统一尺寸");
assert(
  (indexTemplate.includes("today-matrix") || indexTemplate.includes("hero-matrix"))
    && (indexTemplate.includes("today-values") || indexTemplate.includes("hero-value"))
    && (indexTemplate.includes("hero-label") || indexTemplate.includes("today-labels")),
  "今日重点应为四列：品类 + 标的值",
);
for (const label of ["港股", "美股", "A股", "黄金"]) {
  assert(indexSource.includes(`label: "${label}"`), `今日重点缺少品类标签：${label}`);
}
assert(
  indexTemplate.includes("dataAsOf")
  && !indexTemplate.includes("footerMeta")
  && indexSource.includes("数据截至"),
  "首页数据截至时间应只保留一处",
);
const expectedIconStrokes = {
  hk: "#07C160",
  us: "#2F7FE8",
  a: "#E5484D",
  gold: "#D99A12",
  member: "#9B5DE5",
  guru: "#4256C5",
  today: "#07C160",
  watch: "#07C160",
  decision: "#07C160",
};
for (const [icon, stroke] of Object.entries(expectedIconStrokes)) {
  const iconSource = await readFile(path.join(miniRoot, "assets", "home", `${icon}.svg`), "utf8");
  assert(iconSource.includes(`stroke="${stroke}"`), `小程序首页 ${icon} 图标没有使用约定的语义色 ${stroke}`);
}
for (const [page, marker] of [
  ["pages/section/index", "group-panel"],
  ["pages/list/index", "item-panel"],
  ["pages/detail/index", "metric-panel"],
  ["pages/member/index", "member-status-card"],
  ["pages/legal/index", "policy-list"],
  ["pages/workspace/index", "workspace-status-card"],
]) {
  const template = pageTemplatesByPath.get(page) || "";
  const styles = pageStylesByPath.get(page) || "";
  assert(template.includes(marker), `${page} 没有使用移动端分组列表结构`);
  assert(styles.includes("background: #ffffff"), `${page} 缺少微信生活缴费式白色内容面板`);
  assert(styles.includes("border-radius: 24rpx"), `${page} 缺少统一触屏卡片圆角`);
  assert(!styles.includes("grid-template-columns: repeat(2"), `${page} 仍在大屏强行改成网页双栏布局`);
}
for (const page of ["pages/section/index", "pages/list/index"]) {
  const template = pageTemplatesByPath.get(page) || "";
  assert(template.includes('role="button"') && !template.includes("<button"), `${page} 的整行点击区不应受原生 button 布局影响`);
}
assert(indexSource.includes('badge: "¥1288/年"'), "小程序年度会员入口没有显示唯一年费价格");
const gridDefinition = indexSource.match(/const CORE_ENTRIES = \[([\s\S]*?)\n\];/)?.[1] || "";
assert((gridDefinition.match(/\n\s+id: /g) || []).length === 6, "小程序首页应只保留 6 个核心入口");
for (const title of ["港股打新", "美股投资", "A股收息", "黄金追踪", "年费会员", "机构持仓"]) {
  assert(gridDefinition.includes(`title: "${title}"`), `小程序首页缺少准确入口标题：${title}`);
}
const homeEntryIcons = [...gridDefinition.matchAll(/icon: "([^"]+)"/g)].map((match) => match[1]);
assert(homeEntryIcons.length === 6 && new Set(homeEntryIcons).size === 6, "小程序首页六个入口必须使用六个不同图标");
const miniEntryOrder = ["id: \"hk\"", "id: \"us\"", "id: \"a\"", "id: \"gold\"", "id: \"member\"", "id: \"guru\""]
  .map((marker) => indexSource.indexOf(marker));
assert(miniEntryOrder.every((position, index) => position >= 0 && (index === 0 || position > miniEntryOrder[index - 1])), "小程序首页顺序必须是港股、美股、A股、黄金、年费会员、机构持仓");
assert(gridDefinition.trimEnd().endsWith("},") && gridDefinition.lastIndexOf('id: "guru"') > gridDefinition.lastIndexOf('id: "member"'), "机构持仓必须位于核心入口最下面的最后一格");
for (const removedId of ['id: "today"', 'id: "watch"', 'id: "decision"']) {
  assert(!gridDefinition.includes(removedId), `低频入口仍占用首页核心网格：${removedId}`);
}
assert(
  indexSource.includes("openTodayCategory")
    && indexSource.includes("openTodayTarget")
    && indexTemplate.includes("today.points")
    && indexTemplate.includes("openTodayTarget"),
  "今日重点应支持点击跳转标的详情，无标的时回退品类",
);
assert(!indexSource.includes("pages/workspace/index"), "首页不应再挂研究记录入口");
for (const label of ["建议申购", "暂缓观察", "暂不建议", "已结束", "高杠杆观察", "七姐妹", "低估七姐妹", "风险七姐妹", "长期观察", "热度前三", "热度前十", "性价比观察", "行业观察", "交叉重叠", "收息清单", "优等收息", "稳健收息", "高息待核", "底仓长期", "周期短持", "加大观察", "兑现观察", "现在怎么做", "买点与卖点", "资料较完整", "重点核验", "资料不足", "现金流待核验", "资料待补充", "资料结论", "价格位置", "驱动与风险", "港股 · 3 个", "美股 · 5 个", "A股 · 3 个", "公开长期年化排序"]) {
  assert(sectionSource.includes(label), `小程序缺少二级入口：${label}`);
}
assert(
  indexTemplate.includes("copyDailyCard")
    && indexSource.includes("buildDailyCard")
    && indexSource.includes("daily_card_copy"),
  "首页应提供可复制的微信群每日卡片文案",
);
assert(
  (await readFile(path.join(miniRoot, "pages", "section", "index.js"), "utf8")).includes("buildDeepLinks")
    && (pageTemplatesByPath.get("pages/section/index") || "").includes("deepLinks"),
  "栏目页应提供历史样本 / 热度前十 / 性价比深度入口",
);
assert(
  (await readFile(path.join(miniRoot, "pages", "section", "index.js"), "utf8")).includes("buildDailyAnswers")
    && (pageTemplatesByPath.get("pages/section/index") || "").includes("answer-panel")
    && (pageTemplatesByPath.get("pages/section/index") || "").includes("今日答案"),
  "栏目页应直接回答今日答案问题",
);
assert(
  indexSource.includes("buildHomeDigest")
    && (await readFile(path.join(miniRoot, "utils", "daily-card.js"), "utf8")).includes("extraLines")
    && (await readFile(path.join(miniRoot, "utils", "thesis-ticker.js"), "utf8")).includes("buildHomeDigest"),
  "首页今日重点、群卡片和思路条应接入栏目今日答案",
);
assert(await access(path.join(miniRoot, "utils", "daily-answers.js")).then(() => true).catch(() => false), "缺少今日答案模块");
assert(await access(path.join(miniRoot, "utils", "market-lenses.js")).then(() => true).catch(() => false), "缺少分档透镜模块");
assert(marketLensesSource.includes("hkHistoricalCrowdEligible"), "十倍融资应能回看历史拥挤度对照样本");
const dailyAnswerSource = await readFile(path.join(miniRoot, "utils", "daily-answers.js"), "utf8");
assert(dailyAnswerSource.includes("sleevePrice") && dailyAnswerSource.includes("sleeveQuotes"), "美股底仓配置应读取已核验 ETF 报价");
for (const question of [
  "近期上新", "哪些值得打", "哪些要避雷", "十倍融资观察", "打中后暗盘", "打中后首日", "打中后首周",
  "低估的七姐妹", "风险升高要减", "可长期观察", "行业公司观察", "底仓如何配置",
  "底仓长期持有", "周期短持", "什么价可加大", "什么价可兑现",
  "美元金可持有", "美元金卖出观察", "人民币金可持有", "人民币金卖出观察",
  "业绩靠前持仓", "他们怎么想", "我们如何借鉴", "应该避免什么",
]) {
  assert(dailyAnswerSource.includes(question), `今日答案缺少问题：${question}`);
}
assert(miniUsItems.filter((item) => item.group === "industry").length >= 1, "美股行业观察榜不能为空");
assert(miniAShareItems.some((item) => (item.lenses || []).includes("core")), "A 股收息样本应能分出底仓角色");
assert(detailSource.includes("加大观察价") && detailSource.includes("兑现观察价"), "A 股详情应展示加大/兑现观察价");
assert(detailSource.includes("美元金") && detailSource.includes("人民币金"), "黄金详情应分美元金与人民币金");
assert(detailSource.includes("应该避免"), "机构详情应说明应该避免什么");
assert(
  detailSource.includes("公开事实")
    && detailSource.includes("跟随边界")
    && detailSource.includes("【望潮研究归纳】"),
  "机构持仓详情应区分公开事实与望潮研究归纳，并展示跟随边界",
);
for (const label of ["近 60 日最低", "近 60 日中位数", "近 60 日最高", "历史样本区间", "自由现金流", "公开持仓", "完整分析", "为什么看它", "怎么学"]) {
  assert(detailContract.includes(label), `小程序详情缺少关键内容：${label}`);
}
for (const [template, labels] of [
  [pageTemplatesByPath.get("pages/section/index") || "", ["hero-image", "结论", "group-panel", "hero-metrics"]],
  [pageTemplatesByPath.get("pages/list/index") || "", ["summary-image", "data-bar-block", "item-panel"]],
  [detailTemplate, ["detail-image", "结论", "visual-card", "metric-panel", "chart-stats"]],
]) {
  for (const label of labels) assert(template.includes(label), `后续页面缺少图片、数据、分析或结论层级：${label}`);
}
for (const actionLabel of ["模型观察值", "模型区间上沿", "模型风险边界", "估值观察位", "保守估值位", "分析师目标价"]) {
  assert(!`${sectionSource}\n${detailContract}\n${indexSource}`.includes(actionLabel), `小程序公开页面仍含内部模型表述：${actionLabel}`);
}
for (const actionField of ["technicalPlan", "targetPrice", "targetUpside", "buy_zone_low", "buy_zone_high"]) {
  assert(!generatedSource.includes(`\"${actionField}\"`), `小程序离线包仍包含内部价格字段：${actionField}`);
}
assert(liveDataSanitizer.includes("publicAnswer") && liveDataSanitizer.includes("pricePlan"), "云函数清洗层应保留公开动作结论与黄金买卖观察区");
assert(
  indexTemplate.includes("今日重点")
  && indexTemplate.includes("openTodayCategory")
  && indexTemplate.includes("openTodayTarget")
  && (indexSource.includes("数据截至") || indexTemplate.includes("dataAsOf")),
  "今日重点缺少固定标题或自动更新的数据截至时间",
);

assert(sectionSource.includes('one: "') || (await readFile(path.join(miniRoot, "pages", "section", "index.js"), "utf8")).includes("one:"), "栏目页缺少品类研究摘要文案配置");
for (const label of [
  "逻辑哨兵",
  "365 天会员",
  "不含买卖建议",
  "不自动续费",
  "会员协议与退款规则",
  "立即微信支付",
  "点击即确认",
]) {
  assert(`${memberPageSource}\n${memberTemplate}`.includes(label), `小程序会员页缺少关键内容：${label}`);
}
assert(memberTemplate.includes("个人投资逻辑哨兵") && memberTemplate.includes("写理由 · 盯变化 · 复盘"), "会员页缺少简化后的核心定位文案");
assert(!memberTemplate.includes("打开逻辑哨兵") && !memberTemplate.includes("page-nav"), "会员页不应保留额外工作台入口或页脚导航");
assert(
  (pageTemplatesByPath.get("pages/workspace/index") || "").includes("今日")
  && (pageTemplatesByPath.get("pages/workspace/index") || "").includes("关注")
  && (pageTemplatesByPath.get("pages/workspace/index") || "").includes("复盘")
  && (pageTemplatesByPath.get("pages/workspace/index") || "").includes("逻辑哨兵")
  && (pageTemplatesByPath.get("pages/workspace/index") || "").includes("站内收件箱")
  && (pageTemplatesByPath.get("pages/workspace/index") || "").includes("今日变化摘要"),
  "工作台应包含今日/关注/复盘三 Tab、收件箱与今日变化摘要",
);
assert(await access(path.join(miniRoot, "utils", "fact-snapshot.js")).then(() => true).catch(() => false), "工作台应接入变化对照能力");
assert(!`${memberPageSource}\n${memberTemplate}`.includes("暗盘/首周出价") && !`${memberPageSource}\n${memberTemplate}`.includes("打新出价观察"), "会员页不应再把精确出价当作付费卖点");
assert(indexTemplate.includes("todayHelp") && indexTemplate.includes("card-help"), "首页应露出今日帮助与入口说明");
assert((pageTemplatesByPath.get("pages/section/index") || "").includes("meta.one") && (pageTemplatesByPath.get("pages/section/index") || "").includes("group-help"), "栏目页应露出本页用途与分组说明");
assert((pageTemplatesByPath.get("pages/list/index") || "").includes("groupHelp"), "列表页应露出当前分组说明");
assert(!detailSource.includes('label: "半年分位"') || !detailSource.includes("收益与位置"), "黄金图表不应把涨跌百分比与分位混在同一柱图");
assert(detailSource.includes("期间现金流") && detailSource.includes("现金存量"), "美股现金图应按流量/存量分开展示");
assert(!indexSource.includes("高潜力") && !indexSource.includes("提收益") && !indexSource.includes("首周出价观察"), "首页不应再使用承诺式收益/出价文案");
assert(!sectionSource.includes("高潜力") && !sectionSource.includes("提收益"), "栏目页不应再使用承诺式收益文案");
assert(detailSource.includes("parseOfferPrice") === false || !detailSource.includes("首周观察出价"), "详情不应再展示假精确首周出价");
assert(hkExitPlan.includes("历史样本") && !hkExitPlan.includes("toFixed(2) 港元"), "港股退出计划应改为样本对照，不应输出精确港元出价");
for (const label of ["会员协议与隐私", "会员商品与价格", "保存期限与删除", "用户权利与退出", "复制全部文字", "微信平台隐私指引"]) {
  assert(`${legalPage}\n${legalTemplate}`.includes(label), `小程序协议页缺少关键内容：${label}`);
}
assert(legalPage.includes("wx.openPrivacyContract"), "协议页没有接入微信平台隐私指引入口");
for (const label of ["深圳岳大科技有限公司", "剪贴板", "不主动读取剪贴板", "个人工作台记录", "保存3年", "未满18周岁", "无需填写生日或身份证"]) {
  assert(privacySupplement.includes(label), `公众平台隐私补充说明缺少关键内容：${label}`);
}
assert(
  legalConfig.includes('operatorName: "深圳岳大科技有限公司"')
  && legalConfig.includes("operatorReady: true")
  && !legalConfig.includes("待填写营业执照主体全称"),
  "营业执照主体全称没有正确写入公开协议配置",
);
assert(legalPage.includes("draft: !legalInfo.operatorReady") && legalTemplate.includes('wx:if="{{draft}}"'), "运营主体未完成时的草案保护逻辑被移除");
for (const label of ["逻辑哨兵", "今日", "关注", "复盘", "站内收件箱", "今日变化摘要", "待办与节点", "为什么", "失效条件", "复制导出全部记录", "删除全部记录", "记录仅当前微信用户可见"]) {
  assert(workspaceTemplate.includes(label), `小程序研究工作台缺少关键内容：${label}`);
}
for (const action of ["workspace", "refreshSentinel", "saveWatchItem", "removeWatchItem", "saveDecision", "removeDecision", "ackWatchBaselines", "saveEventMark", "removeEventMark", "updateReviewTask", "saveIpoRecord", "saveDividendLot", "saveSettings", "deleteWorkspace"]) {
  assert(memberService.includes(`"${action}"`) || memberService.includes(`'${action}'`) || memberService.includes(action), `小程序会员服务缺少工作台操作：${action}`);
}
assert(
  (detailTemplate.includes("保存决策快照") || detailContract.includes("保存决策快照"))
  && detailTemplate.includes("追踪此标的变化")
  && detailSource.includes("pages/workspace/index"),
  "详情页没有接入研究工作台",
);
assert(memberTemplate.includes('open-type="contact"'), "会员页缺少微信客服入口");
assert(memberPageSource.includes("purchase(planId") && memberPageSource.includes("adultConfirmed: true") && memberPageSource.includes('url: "/pages/legal/index"'), "会员页缺少直达支付、成年确认或完整协议入口");
assert(
  memberService.includes("preparePurchase")
    && memberService.includes("wx.requestPayment")
    && memberService.includes("wechat-jsapi")
    && memberService.includes("PAYMENT_CANCELLED"),
  "会员支付链路缺少下单、拉起收银台或取消处理",
);
assert(
  memberTemplate.includes("立即微信支付")
    && memberTemplate.includes("state.purchaseAllowed")
    && memberPageSource.includes("purchaseAllowed"),
  "会员页缺少可完成支付的收银台入口",
);
assert(memberTemplate.includes("点击即确认已满 18 周岁") && !memberTemplate.includes("showPaymentTestTools") && !memberTemplate.includes("changePurchaseConsent"), "会员页应使用清晰的按钮确认，不应暴露内部验收控件");
assert(!memberTemplate.includes("核心价值") && !memberTemplate.includes("履约证据") && !memberTemplate.includes("购买须知"), "会员页不应重新引入已删除的长篇页面介绍");
assert(!memberTemplate.includes("公开答案免费") && !memberTemplate.includes("会员用于个人跟踪"), "会员页不应保留营销式页面介绍");
assert(legalPage.includes("pages/member/index") && legalTemplate.includes('open-type="contact"'), "协议页缺少返回会员或客服通道");
assert(sitemap.rules.some((rule) => rule.action === "disallow" && rule.page === "pages/workspace/index"), "个人工作台不应进入小程序页面索引");
assert(!indexSource.includes("pages/webview/index?target=${target}"), "小程序首页仍直接依赖 web-view");
assert(!appSource.includes("PUBLIC_ORIGIN"), "小程序 App 仍依赖外部网页域名");
assert(!storeSource.includes("wx.request"), "小程序数据层仍依赖运行时外部请求");
assert(storeSource.includes('name: "aurum-data"') && storeSource.includes("离线备用数据") && storeSource.includes("自动更新"), "小程序没有接入最新数据云函数与离线回退");
assert(storeSource.includes("degradeStaleActions") || storeSource.includes("action-freshness"), "小程序数据层缺少运行时过期动作降级");
assert(storeSource.includes("quotes.length >= 20"), "小程序可用快照 A 股门槛应与公开契约同为 20");
assert(liveDataFunction.includes("devi-y.github.io/aurumer/data/live-snapshot.json") && liveDataFunction.includes("CACHE_TTL_MS") && liveDataFunction.includes("REQUEST_TIMEOUT_MS"), "最新数据云函数缺少公开源、缓存或超时保护");
for (const field of forbiddenKeys) {
  assert(liveDataSanitizer.includes(field) || !generatedSource.includes(`\"${field}\"`), `实时数据清洗没有覆盖内部字段：${field}`);
}
assert(indexSource.includes("FOOTER_DISCLAIMER") && indexTemplate.includes("footerDisclaimer"), "首页缺少底部免责声明");
assert(
  (pageTemplatesByPath.get("pages/section/index") || "").includes("disclaimer")
  && (pageTemplatesByPath.get("pages/list/index") || "").includes("disclaimer"),
  "栏目页或列表页缺少研究免责声明",
);
assert(
  detailTemplate.includes("risk-card")
  && detailTemplate.includes("riskLabel")
  && detailTemplate.includes("view.disclaimer")
  && detailSource.includes("RESEARCH_DISCLAIMER"),
  "详情页缺少风险提醒或免责声明",
);
assert(
  memberTemplate.includes("disclaimer")
  && memberTemplate.includes("点击即确认")
  && workspaceTemplate.includes("disclaimer"),
  "会员页或记录页缺少注意事项/免责声明",
);
assert(detailSource.includes("detailsExpanded: false") && detailTemplate.includes('wx:if="{{detailsExpanded}}"'), "详情页没有使用先结论、后展开的渐进式呈现");
assert(detailSource.includes("kind: \"columns\"") && detailSource.includes("kind: \"solid\"") && detailSource.includes("kind: \"meter\""), "详情页缺少价格轨迹、竖柱对比或位置仪表图");
assert(!pageStylesByPath.get("pages/detail/index").includes("solid-cap") && !pageStylesByPath.get("pages/detail/index").includes("solid-side") && !pageStylesByPath.get("pages/detail/index").includes("column-pillar"), "详情图表不应再使用立体柱体样式");
assert(detailSource.includes("base.charts.slice(0, 8)") || detailSource.includes(".slice(0, 8)") || detailSource.includes(".slice(0, 6)"), "详情页应展示更完整的多图数据");
assert(workspaceSource.includes('activeTab: "today"') && workspaceTemplate.includes('data-tab="today"') && workspaceTemplate.includes('data-tab="watch"') && workspaceTemplate.includes('data-tab="review"') && workspaceSource.includes("markInboxRead") && workspaceSource.includes("buildWeeklyReview") && workspaceSource.includes("refreshSentinel"), "记录页应提供今日/关注/复盘三 Tab，并接入收件箱、持续复盘与打开时扫描");
assert(workspaceSource.includes("FREE") || workspaceTemplate.includes("免费额度") || workspaceSource.includes("freeRemaining") || workspaceSource.includes("freeLabel"), "工作台应支持免费少量关注额度提示");
assert(workspaceTemplate.includes("inputWatchThesis") && workspaceTemplate.includes("inputDecisionNextReview"), "关注/想法表单应支持原始理由与复核日");
assert(!detailSource.includes("openDeep"), "小程序详情仍保留外链分析入口");
assert(!detailContract.includes("继续看完整分析"), "小程序详情仍会引导用户离开原生页面");
assert(!detailSource.includes("raw.currentPrice || 0"), "小程序 A 股缺失价格仍会显示 0 元");
assert(!detailSource.includes("raw.trackingScore || 0"), "小程序缺失跟踪分仍会显示 0 分");

const projectConfig = JSON.parse(await readFile(path.join(miniRoot, "project.config.json"), "utf8"));
const appIdState = projectConfig.appid === "touristappid" ? "旅游 AppID，仅可本地预览" : "正式 AppID 已配置";
console.log(`小程序原生层级与离线数据检查通过：${appIdState}`);
