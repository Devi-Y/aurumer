import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";

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
]);
// trackingScore/trackingSummary 特意不在上面这份"内部字段"名单里：它们描述的是
// 这位大师的公开持仓披露完不完整、好不好跟踪，是数据来源说明，不是买卖建议或
// 目标价一类的投资建议，产品上刻意要展示给用户（见 buildGuruModule 的"跟踪可靠度"文案）。

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

const appStyles = await readFile(path.join(miniRoot, "app.wxss"), "utf8");
// 圆角内容分组既可以写在页面自己的样式里，也可以引用 app.wxss 里的共享类。
// 这里把共享类先收集出来，页面用了其中任何一个就算数——否则页面一旦改成引用
// 共享类，这条检查就会在样式其实没问题的时候报错，逼着人把同一条圆角抄回每一页。
const sharedRoundedClasses = [...appStyles.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)]
  .filter(([, , body]) => body.includes("border-radius: 24rpx"))
  .map(([, name]) => name);

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
  const usesSharedRounded = sharedRoundedClasses.some((name) =>
    new RegExp(`class="[^"]*\\b${name}\\b`).test(pageTemplate)
  );
  assert(
    pageStyles.includes("border-radius: 24rpx") || usesSharedRounded,
    `${page} 缺少适合触屏识别的圆角内容分组`
  );
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
const guruChangesSource = await readFile(path.join(miniRoot, "utils", "guru-changes.js"), "utf8");
const smartMoneyModule = { exports: {} };
vm.runInNewContext(smartMoneySource, { module: smartMoneyModule, exports: smartMoneyModule.exports });
const strategyScoreModule = { exports: {} };
vm.runInNewContext(strategyScoreSource, { module: strategyScoreModule, exports: strategyScoreModule.exports });
const guruChangesModule = { exports: {} };
vm.runInNewContext(guruChangesSource, { module: guruChangesModule, exports: guruChangesModule.exports });
const strategySignalsModule = { exports: {} };
vm.runInNewContext(strategySignalsSource, {
  module: strategySignalsModule,
  exports: strategySignalsModule.exports,
  require(request) {
    if (request === "./guru-changes") return guruChangesModule.exports;
    throw new Error(`策略信号出现未知依赖：${request}`);
  },
});
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
// 招股已截止、还没进「已结束」分组的新股，详情页结论不能再挂「可研究申购」。
const closedOfferSignal = strategySignalsModule.exports.buildStrategySignal({
  market: "hk",
  group: "upcoming",
  raw: { offerPrice: 10, entryFee: 5000, offerDeadline: "2000-01-03", publicAnswer: { verdict: "值得打", score: 80 } },
});
assert(closedOfferSignal.label === "已截止", `港股招股截止后信号应为「已截止」，实际是「${closedOfferSignal.label}」`);
// 风险下沿落在观察低位里时，页面上会出现「风险线画在观察区中间」；展示前要把观察低位的下限抬到风险下沿。
const clippedGoldPlan = marketLensesModule.exports.goldPlanView({
  internationalWatch: { low: 4048, high: 4171 },
  internationalRisk: { low: 4058, high: 4058 },
});
assert(clippedGoldPlan.internationalWatch.low === 4058, "黄金观察低位不应把风险下沿包在区间里");
// 13F 增持超过 10 倍时写成倍数，不出现「增持 +27712%」。
assert(marketLensesModule.exports.readableChangeLabel("增持 +27712%") === "增持至278倍", "超大增持比例应改写成倍数");
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
const fixedAShareCodes = ["600900.SH", "600036.SH", "600941.SH", "515180.SH", "601088.SH", "000333.SZ"];
assert(
  JSON.stringify(miniAShareItems.slice(0, fixedAShareCodes.length).map((item) => item.code)) === JSON.stringify(fixedAShareCodes),
  `小程序 A 股收息固定样本顺序不一致：${miniAShareItems.slice(0, fixedAShareCodes.length).map((item) => item.code).join(",")}`,
);
// 分红稳定性 / 分红收益性两个前五榜出现之后，样本量不再是固定 10 只：上了榜的
// 必须整组在样本里，否则点开「前五」只看得到其中三只。所以规则是
// 「固定 6 只 + 上榜的 + 自动补齐到 10」，样本量 = max(10, 6 + 上榜数)。
const onBoard = (item) => (item.lenses || []).some((lens) => lens === "stable5" || lens === "yield5");
for (const lens of ["stable5", "yield5"]) {
  const board = miniAShareItems.filter((item) => (item.lenses || []).includes(lens));
  assert(board.length === 5, `小程序 A 股 ${lens} 榜应为 5 只且全在样本内，实际 ${board.length}`);
}
const rankedExtra = miniAShareItems.filter((item) => !fixedAShareCodes.includes(item.code) && onBoard(item)).length;
const expectedAShareCount = Math.max(10, fixedAShareCodes.length + rankedExtra);
assert(
  miniAShareItems.length === expectedAShareCount,
  `小程序 A 股收息研究样本应为 ${expectedAShareCount} 只（固定 ${fixedAShareCodes.length} + 上榜 ${rankedExtra} + 自动补齐），实际 ${miniAShareItems.length}`,
);
assert(
  miniAShareItems.filter((item) => !fixedAShareCodes.includes(item.code) && !onBoard(item)).length
    === Math.max(0, 10 - fixedAShareCodes.length - rankedExtra),
  "小程序 A 股自动补充收息样本只能补到 10 只为止",
);
assert(miniAShareItems.some((item) => item.code === "515180.SH" && item.raw?.assetType === "fund"), "小程序 A 股收息样本缺少独立 ETF 资产 515180");
assert(miniGoldItems.length === 2, `小程序黄金入口应有 2 个答案，实际 ${miniGoldItems.length}`);
assert(miniGoldItems.every((item) => ["track", "plan"].includes(item.group)), "小程序黄金入口应是现在怎么做 / 观察区参考");
assert(miniGoldItems.some((item) => item.one.includes("人民币金")), "小程序黄金追踪缺少人民币金数据");
const allAShareQuotes = snapshot.aShare?.quotes || [];
assert(allAShareQuotes.length >= 20, `小程序 A 股详情覆盖门槛应至少为 20 只，实际 ${allAShareQuotes.length}`);
assert(allAShareQuotes.every((quote) => answers.findItem(snapshot, "a", quote.code)), "小程序 A 股 20 只行情标的必须均可打开详情");
assert(Number.isFinite(snapshot.gold?.answer?.scores?.international?.score), "小程序缺少国际金观察分");
assert(Number.isFinite(snapshot.gold?.answer?.scores?.domestic?.score), "小程序缺少人民币金观察分");
for (const [group, count] of [["hk", 3], ["us", 9], ["a", 3]]) {
  const profiles = smartMoneyProfiles.filter((item) => item.group === group);
  const items = miniGuruItems.filter((item) => item.group === group);
  assert(profiles.length === count && items.length === count, `小程序聪明人 ${group} 分组应有 ${count} 个`);
  assert(profiles.every((item, index) => item.order === index + 1), `小程序聪明人 ${group} 排名必须连续且从 1 开始`);
  const annualized = profiles.map((item) => Number(String(item.performanceValue).match(/\d+(?:\.\d+)?/)?.[0] || 0));
  assert(annualized.every((value, index) => index === 0 || value <= annualized[index - 1]), `小程序聪明人 ${group} 没有按表观长期年化从高到低排列`);
  for (const profile of profiles) {
    const rendered = items.find((item) => item.id === profile.id);
    assert(profile.why && profile.how, `${profile.name} 缺少 WHY 或 HOW`);
    // 业绩三件套（表观年化/区间/口径）要么一起写全，要么一起空着走「业绩待核」
    // 兜底（detail/index.js 的 base.score 就是这么处理的）——不能只写年化数字却
    // 不给口径来源，那是无凭据的数字；也不该编一个数字只为了让这里通过。
    const perfFields = [profile.performanceValue, profile.performanceDetail, profile.performanceBasis];
    const perfComplete = perfFields.every(Boolean);
    const perfAllEmpty = perfFields.every((value) => !value);
    assert(perfComplete || perfAllEmpty, `${profile.name} 业绩口径三个字段（年化/区间/口径）必须同时出现或同时空缺`);
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
  // 「建议申购」是合规清单点名要去掉的说法，产品侧已经统一换成「值得打」，
  // 这里跟着换，顺带把校验反过来用——出现旧词就算不合格。
  assert(["值得打", "暂缓观察", "暂不建议", "资料不够"].includes(item.badge), `${item.name} 缺少人话申购结论`);
}

const indexSource = await readFile(path.join(miniRoot, "pages", "index", "index.js"), "utf8");
const indexTemplate = await readFile(path.join(miniRoot, "pages", "index", "index.wxml"), "utf8");
const indexStyles = await readFile(path.join(miniRoot, "pages", "index", "index.wxss"), "utf8");
const appSource = await readFile(path.join(miniRoot, "app.js"), "utf8");
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
// 美股/A股/港股新股/机构持仓/黄金详情页统一为“决策概览＋标签”，标签集随之
// 更新（原“价格/财务”六标签时代命名已被下方新标签取代，不再要求“财务”作为
// 独立标签存在；机构持仓的“持仓”标签沿用旧名但内容已改为专属的持仓构成图+
// 明细，不再是六标签之一；黄金的“驱动”对应美股的“动态”，都是近期变化/宏观
// 驱动那一档）。
const expectedMarketModuleLabels = ["概览", "价格", "动态", "依据", "分红", "申购", "卖出", "持仓", "驱动"];
assert(
  detailTemplate.includes('scroll-x="true"')
  && detailTemplate.includes('class="detail-tabs"')
  && detailSource.includes("buildDetailModules")
  && detailSource.includes("switchModule"),
  "详情页缺少横向滑动模块",
);
for (const label of expectedMarketModuleLabels) {
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
// 首页年费条（我的会员）已按产品要求撤掉（2026-09-29）；开通入口改由详情页的会员功能承担，
// 这里认详情页仍能进会员页，同时要求首页不再挂会员入口。
assert(!indexSource.includes("pages/member/index") && !indexTemplate.includes("member-bar"), "首页不应再挂年费会员条");
assert(detailSource.includes('openPage("/pages/member/index")'), "撤掉首页年费条后，详情页必须仍能进入会员页");
assert(
  indexTemplate.includes("entry-grid")
    && indexStyles.includes("display: flex")
    && indexStyles.includes("flex-wrap: wrap")
    && /width:\s*33\.3{2,}%/.test(indexStyles),
  "小程序首页核心入口不是手机端 3 列布局",
);
assert(
  appStyles.includes("width: 100%")
    && appStyles.includes("min-height: 100vh")
    && appStyles.includes("max-width: none"),
  "小程序全局页面仍被网页式窄容器限制，未铺满实际视口",
);
// 「今日重点」列表卡已按产品要求从首页整块撤掉（2026-09-29），年费条随后也撤掉；
// 首屏现在是走势卡在上、九宫格在下，这里认这两块的先后，并要求今日重点卡不再出现。
assert(
  indexTemplate.includes("trend-grid")
    && indexTemplate.includes("entry-grid")
    && indexTemplate.indexOf("trend-grid") < indexTemplate.indexOf("entry-grid")
    && !indexTemplate.includes("today-card"),
  "小程序首页应走势卡在上、九宫格在下",
);
assert(
  indexStyles.includes("min-height: 100vh")
    && (indexStyles.includes("min-height: 108rpx") || indexStyles.includes("min-height: 176rpx") || indexStyles.includes("min-height: 188rpx") || indexStyles.includes("min-height: 210rpx"))
    && indexTemplate.includes("trend-grid"),
  "小程序首页没有以走势卡和核心入口铺满移动视口",
);
{
  const gridCardRule = (indexStyles.match(/\.grid-card\s*\{[^}]*\}/) || [""])[0];
  assert(
    /border-radius:\s*16rpx/.test(gridCardRule)
      && !/border-right|border-bottom/.test(gridCardRule),
    "小程序首页核心入口没有使用原型的圆角卡片间距分隔（不应回退为细分隔线）",
  );
}
assert(indexTemplate.includes('class="entry-icon"') && !indexTemplate.includes('class="entry-badge"'), "小程序核心入口应只保留大图标，不应恢复年度会员角标");
assert(indexTemplate.includes('aria-label="{{item.title}}，{{item.help}}"') && indexTemplate.includes('aria-hidden="true"'), "小程序核心入口缺少按钮朗读标签或装饰图标隐藏语义");
assert(indexTemplate.includes('role="button"') && !indexTemplate.includes("<button"), "小程序首页整块入口不应受原生 button 默认宽度干扰");
assert(
  indexTemplate.includes("核心研究") || indexSource.includes('"核心研究"'),
  "小程序首页缺少清晰层级：核心研究",
);
// 只看会渲染出来的部分：WXML 注释里记一句「今日重点已撤掉」不算回潮。
assert(
  !indexTemplate.replace(/<!--[\s\S]*?-->/g, "").includes("今日重点") && !indexSource.includes('"今日重点"'),
  "首页今日重点已按产品要求撤掉，不应重新出现",
);
for (const marker of ["港股", "美股", "A股", "黄金"]) {
  assert(indexSource.includes(marker), `首页缺少方向：${marker}`);
}
// 四个方向既要在六宫格里有入口，也要各有一张走势卡（market 字段就是点进去的栏目）。
assert(
  ['id: "hk"', 'id: "us"', 'id: "a"', 'id: "gold"'].every((marker) => indexSource.includes(marker))
    && ['market: "hk"', 'market: "us"', 'market: "a"', 'market: "gold"'].every((marker) => indexSource.includes(marker)),
  "首页入口与走势卡应覆盖港股、美股、A股、黄金四个方向",
);
// 我的持仓闭环已按产品要求整体从首页撤掉（首页现在只留六宫格 / 走势卡 / 年费条三块），
// 滚动思路条 / 本机速记条 / 研究记录条 / 展开速览等历史尝试也都撤掉了，
// 这里改为要求它们确实都不在首页上，不再要求首页保留持仓闭环。
assert(
  !indexTemplate.includes("我的持仓")
    && !indexSource.includes("openHoldingDetail")
    && !indexTemplate.includes("thesis-ticker")
    && !indexTemplate.includes("本机速记")
    && !indexTemplate.includes("我的研究记录")
    && !indexTemplate.includes("查看 4 项速览"),
  "首页不应恢复我的持仓闭环、滚动思路条、本机速记条、研究记录条或展开速览",
);
assert(await access(path.join(miniRoot, "utils", "holding-observe.js")).then(() => true).catch(() => false), "首页持仓观察缺少 holding-observe 工具");
assert(await access(path.join(miniRoot, "utils", "master-playbooks.js")).then(() => true).catch(() => false), "缺少大师策略摘要模块");

const analyticsSource = await readFile(path.join(miniRoot, "utils", "analytics.js"), "utf8");
assert(analyticsSource.includes("return_visit") && analyticsSource.includes("add_holding"), "首页行为埋点应覆盖添加持仓与次日回访");
assert(analyticsSource.includes("trackHomeVisit"), "首页应通过 trackHomeVisit 统一记录打开与次日回访");
const playbookSource = await readFile(path.join(miniRoot, "utils", "master-playbooks.js"), "utf8");
for (const name of ["李嘉诚", "潘石屹", "沈南鹏", "桥水基金", "文艺复兴", "索罗斯", "孙宇晨案例"]) {
  assert(playbookSource.includes(name), `大师策略摘要缺少：${name}`);
}
assert(playbookSource.includes("不可照抄") || playbookSource.includes("copyHoldings: false"), "大师策略必须标明不可照抄仓位");
assert((pageTemplatesByPath.get("pages/section/index") || "").includes("大师策略摘要"), "聪明钱跟踪栏目应露出大师策略摘要");
assert(!appConfig.tabBar, "首页已去掉记录/会员后不应再保留底部 tabBar");
assert(indexStyles.includes("width: 33.333%") && indexStyles.includes("font-size: 27rpx"), "小程序首页方向标签或标题没有使用清晰统一尺寸");
// 「今日重点」列表卡（today-row）撤掉后，首页的品类信息改由走势卡承担：
// 每张卡一个数 + 一张图（零轴柱或 SVG 折线），序列来自快照、不够就整张不出。
assert(
  indexTemplate.includes("trend-card")
    && indexTemplate.includes("trend-value")
    && indexTemplate.includes("trend-line")
    && indexTemplate.includes("trend-bars")
    && indexSource.includes("sparklineSvg")
    && indexSource.includes("zeroAxisBars")
    && !indexTemplate.includes("today-row"),
  "首页走势卡应展示一个数加一张走势图，且不应恢复今日重点列表",
);
// 这四个品类点位（homePoint）是群卡片和公开摘要的数据源（pages/today 页已于 2026-09-29 删除），
// 这里继续在 daily-answers.js 里核对四个品类都还在。
const dailyAnswersForHomePoints = await readFile(path.join(miniRoot, "utils", "daily-answers.js"), "utf8");
for (const [marketId, label] of [["hk", "港股"], ["us", "美股"], ["a", "A股"], ["gold", "黄金"]]) {
  assert(dailyAnswersForHomePoints.includes(`homePoint("${marketId}", "${label}"`), `今日重点缺少品类标签：${label}`);
}
assert(
  indexTemplate.includes("dataAsOf")
  && !indexTemplate.includes("footerMeta")
  && indexSource.includes("数据截至"),
  "首页数据截至时间应只保留一处",
);
// 首页改成蓝白灰主色调（2026-09-29）后，九宫格里五个研究栏目图标统一用品牌蓝 #1d5fd1
// （原来是 711b420 定的墨绿/墨金）；member/today/watch/decision 不在九宫格里，
// 保留原色未变——这里核对现在这套统一色，而不是被替换掉的旧色。
// 新闻资讯（news）2026-09-29 整页删掉，图标一起删了，不再核对。
const expectedIconStrokes = {
  hk: "#1d5fd1",
  us: "#1d5fd1",
  a: "#1d5fd1",
  gold: "#1d5fd1",
  member: "#9B5DE5",
  guru: "#1d5fd1",
  today: "#07C160",
  watch: "#07C160",
  decision: "#07C160",
};
for (const [icon, stroke] of Object.entries(expectedIconStrokes)) {
  const iconSource = await readFile(path.join(miniRoot, "assets", "home", `${icon}.svg`), "utf8");
  assert(iconSource.includes(`stroke="${stroke}"`), `小程序首页 ${icon} 图标没有使用约定的语义色 ${stroke}`);
}
// group-panel 已在 711b420（六个栏目页补全两视图与证据抽屉）里被 hk/us/a/gold/guru
// 各自的双视图卡片（如 tile-panel）取代，这里改用页面上通用的 page-card 面板壳作为标记。
for (const [page, marker] of [
  ["pages/section/index", "page-card"],
  ["pages/list/index", "item-panel"],
  ["pages/detail/index", "metric-panel"],
  ["pages/member/index", "member-status-card"],
  ["pages/legal/index", "policy-list"],
  ["pages/workspace/index", "workspace-status-card"],
]) {
  const template = pageTemplatesByPath.get(page) || "";
  const styles = pageStylesByPath.get(page) || "";
  const sharedPanel = sharedRoundedClasses.some((name) =>
    new RegExp(`class="[^"]*\\b${name}\\b`).test(template)
  );
  assert(template.includes(marker), `${page} 没有使用移动端分组列表结构`);
  assert(
    styles.includes("background: #ffffff") || sharedPanel,
    `${page} 缺少微信生活缴费式白色内容面板`,
  );
  assert(
    styles.includes("border-radius: 24rpx") || sharedPanel,
    `${page} 缺少统一触屏卡片圆角`,
  );
  assert(!styles.includes("grid-template-columns: repeat(2"), `${page} 仍在大屏强行改成网页双栏布局`);
}
for (const page of ["pages/section/index", "pages/list/index"]) {
  const template = pageTemplatesByPath.get(page) || "";
  assert(template.includes('role="button"') && !template.includes("<button"), `${page} 的整行点击区不应受原生 button 布局影响`);
}
// 首页已不挂年费入口（2026-09-29），唯一年费价格由 audit-payment.mjs 在会员页核对。
const gridDefinition = indexSource.match(/const CORE_ENTRIES = \[([\s\S]*?)\n\];/)?.[1] || "";
assert((gridDefinition.match(/\n\s+id: /g) || []).length === 5, "小程序首页应只保留 5 个核心入口");
// 年费会员已按产品要求从宫格里撤掉；新闻资讯 2026-09-29 整页删掉，宫格是五个研究栏目。
for (const title of ["港股打新", "美股投资", "A股收息", "黄金追踪", "聪明钱跟踪"]) {
  assert(gridDefinition.includes(`title: "${title}"`), `小程序首页缺少准确入口标题：${title}`);
}
assert(!gridDefinition.includes('title: "年费会员"'), "年费会员不应再占用六宫格的位置");
const homeEntryIcons = [...gridDefinition.matchAll(/icon: "([^"]+)"/g)].map((match) => match[1]);
assert(homeEntryIcons.length === 5 && new Set(homeEntryIcons).size === 5, "小程序首页五个入口必须使用五个不同图标");
const miniEntryOrder = ["id: \"hk\"", "id: \"us\"", "id: \"a\"", "id: \"gold\"", "id: \"guru\""]
  .map((marker) => gridDefinition.indexOf(marker));
assert(miniEntryOrder.every((position, index) => position >= 0 && (index === 0 || position > miniEntryOrder[index - 1])), "小程序首页顺序必须是港股、美股、A股、黄金、聪明钱跟踪");
// 新闻资讯删掉后它那一格原位留空：宫格里紧跟五个研究栏目放一个预留格，
// 只画虚线框、不能点，也不能悄悄把新闻资讯的路由、入口或图标带回来。
assert(!appConfig.pages.includes("pages/news/index"), "新闻资讯页已删除，不应再注册路由");
assert(
  !gridDefinition.includes('id: "news"') && !indexSource.includes("/pages/news/") && !indexSource.includes("news.svg"),
  "首页九宫格不应再有新闻资讯入口",
);
assert(
  /\.\.\.CORE_ENTRIES\.map\([^\n]*\),\n\s*\{ id: "reserved", reserved: true \},\n\s*\.\.\.SERVICES/.test(indexSource),
  "九宫格应在五个研究栏目之后、服务格之前保留一个预留格",
);
assert(
  /<view wx:if="\{\{item\.reserved\}\}" class="grid-card is-reserved" aria-hidden="true">/.test(indexTemplate)
    && !/wx:if="\{\{item\.reserved\}\}"[^>]*bindtap/.test(indexTemplate),
  "预留格应只占位、对读屏隐藏且不可点",
);
assert(gridDefinition.trimEnd().endsWith("},") && gridDefinition.lastIndexOf('id: "guru"') > gridDefinition.lastIndexOf('id: "member"'), "聪明钱跟踪必须位于核心入口最下面的最后一格");
for (const removedId of ['id: "today"', 'id: "watch"', 'id: "decision"']) {
  assert(!gridDefinition.includes(removedId), `低频入口仍占用首页核心网格：${removedId}`);
}
// 今日重点列表连同 openTodayRow 一起撤掉后，首页的第二个跳转口是走势卡：
// 整张卡可点，按 data-market 进对应栏目页。
assert(
  indexSource.includes("openTrend")
    && indexTemplate.includes('bindtap="openTrend"')
    && indexTemplate.includes('data-market="{{item.market}}"')
    && indexSource.includes("pages/section/index?market="),
  "首页走势卡应支持点击进入对应栏目",
);
assert(!indexSource.includes("pages/workspace/index"), "首页不应再挂研究记录入口");
for (const label of ["值得打", "暂缓观察", "暂不建议", "已结束", "高杠杆观察", "七姐妹", "低估七姐妹", "风险七姐妹", "长期观察", "热度前三", "热度前十", "性价比观察", "行业观察", "交叉重叠", "优等收息", "稳健收息", "高息待核", "底仓长期", "周期短持", "加大观察", "兑现观察", "现在怎么做", "观察区参考", "分红稳定性 前五", "分红收益性 前五", "收息样本", "港股 · 3 个", "美股 · 9 个", "A股 · 3 个", "公开长期年化排序"]) {
  assert(sectionSource.includes(label), `小程序缺少二级入口：${label}`);
}
// 分组标题里写死的「N 个」必须等于该组实际的聪明钱档案数，档案增减后标题不能过期。
for (const [group, label] of [["hk", "港股"], ["us", "美股"], ["a", "A股"]]) {
  const size = smartMoneyProfiles.filter((item) => item.group === group).length;
  assert(sectionSource.includes(`"${label} · ${size} 个"`), `聪明钱 ${label} 分组标题数量应为 ${size} 个`);
}
// 「复制群卡片」原在 pages/today 独立页；那一页没有入口后于 2026-09-29 删除，
// 功能挪进记录页「今日」tab（仅已开通会员可见），这里改为核对记录页保留这个功能。
assert(!appConfig.pages.includes("pages/today/index"), "今日重点页已删除，不应再注册路由");
assert(
  workspaceTemplate.includes('bindtap="copyDailyCard"')
    && workspaceTemplate.includes("state.active && dailyCardText")
    && workspaceSource.includes("buildDailyCard")
    && workspaceSource.includes("daily_card_copy"),
  "记录页应为已开通会员提供可复制的微信群每日卡片文案",
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
// 首页不再挂今日重点，buildHomeDigest 只剩记录页群卡片和公开摘要在用，
// 这里改认这两处仍接入栏目今日答案。
assert(
  !indexSource.includes("buildHomeDigest")
    && workspaceSource.includes("buildHomeDigest")
    && (await readFile(path.join(root, "scripts", "build-daily-digest.mjs"), "utf8")).includes("buildHomeDigest")
    && (await readFile(path.join(miniRoot, "utils", "daily-card.js"), "utf8")).includes("extraLines"),
  "记录页群卡片与公开摘要应接入栏目今日答案",
);
// 首页服务格：要么有产品负责人给的真实物料（copy），要么明确 pending 占位且不带任何链接，
// 不允许出现「看着像能用、其实是编的」格子。
{
  const offersModule = { exports: {} };
  vm.runInNewContext(await readFile(path.join(miniRoot, "config", "offers.js"), "utf8"), { module: offersModule, exports: offersModule.exports });
  const offers = offersModule.exports;
  for (const offer of offers) {
    assert(offer.copy || (offer.pending && !offer.copy), `首页服务格 ${offer.id} 既没有真实物料也没标 pending`);
    assert(!(offer.pending && offer.copy), `首页服务格 ${offer.id} 已有物料却仍标 pending`);
  }
  assert(offers.length <= 3, "九宫格只剩三个服务格位置");
}
assert(await access(path.join(miniRoot, "utils", "daily-answers.js")).then(() => true).catch(() => false), "缺少今日答案模块");
assert(await access(path.join(miniRoot, "utils", "market-lenses.js")).then(() => true).catch(() => false), "缺少分档透镜模块");
assert(marketLensesSource.includes("hkHistoricalCrowdEligible"), "十倍融资应能回看历史拥挤度对照样本");
const dailyAnswerSource = await readFile(path.join(miniRoot, "utils", "daily-answers.js"), "utf8");
// 2bbaa38 把「底仓如何配置」整卡连同 usSleevePlan/sleevePrice 计算一起撤掉
// （daily-answers.js 里就有说明这段撤除原因的注释），美股栏目改成只答四问，
// 这里改为确认底仓卡不会被误加回来，而不是继续要求它读取 ETF 报价。
assert(!dailyAnswerSource.includes("sleevePrice"), "美股底仓配置卡已按产品决策整体撤掉，不应重新出现");
// 五个栏目的今日答案已经按用户点名的六条需求重排：港股问上新/值得打/避雷/暗盘/首日，
// 美股问七姐妹近况/低估/高估/最热三只/底仓，A 股问两个前五榜与加大兑现，
// 黄金问价格/买/卖/拐点，机构问持仓与趋势。原来那些被并进展开层或改名的问题
// （十倍融资观察、行业公司观察、美元金卖出观察等）不再单独占一张卡。
for (const question of [
  "近期上新", "哪些值得打", "哪些要避雷", "打中后暗盘", "打中后首日",
  "七姐妹近期怎么了", "低估的七姐妹", "风险升高要减", "最热的三只", "底仓如何配置",
  "分红稳定性 前五", "分红收益性 前五", "什么价可加大", "什么价可兑现", "周期短持",
  "现在什么价", "是否值得买入", "是否应该卖出", "拐点变化",
  "业绩靠前持仓", "本季他们在加什么", "本季他们在减什么", "未来持仓趋势", "应该避免什么",
]) {
  assert(dailyAnswerSource.includes(question), `今日答案缺少问题：${question}`);
}
assert(miniUsItems.filter((item) => item.group === "industry").length >= 1, "美股行业观察榜不能为空");
assert(miniAShareItems.some((item) => (item.lenses || []).includes("core")), "A 股收息样本应能分出底仓角色");
assert(detailSource.includes("参考买入价") && detailSource.includes("参考卖出价"), "A 股详情应展示参考买入/参考卖出价");
assert(detailSource.includes("国际金") && detailSource.includes("人民币金"), "黄金详情应分国际金与人民币金");
assert(detailSource.includes("应该避免"), "机构详情应说明应该避免什么");
assert(
  detailSource.includes("公开事实")
    && detailSource.includes("跟随边界")
    && detailSource.includes("【望潮研究归纳】"),
  "聪明钱跟踪详情应区分公开事实与望潮研究归纳，并展示跟随边界",
);
for (const label of ["近 60 日最低", "近 60 日中位数", "近 60 日最高", "历史样本区间", "自由现金流", "公开持仓", "完整分析", "为什么看它", "怎么学"]) {
  assert(detailContract.includes(label), `小程序详情缺少关键内容：${label}`);
}
// 三个页面的页头照新闻资讯页重做过：绿带里是栏目名 + 数据截至 + 一句说明，
// 原来那个装饰图标撤掉了（它比数据本身还显眼）。所以这里认的是「有没有说清
// 这份数据是什么时候的、有没有数据条」，不再认那几个已经不存在的类名。
for (const [template, labels] of [
  [pageTemplatesByPath.get("pages/section/index") || "", ["dataAsOf", "hero-title", "结论", "page-card", "hero-metrics"]],
  [pageTemplatesByPath.get("pages/list/index") || "", ["dataAsOf", "list-hero-help", "item-bar", "item-panel"]],
  [detailTemplate, ["结论", "visual-card", "metric-panel", "chart-stats"]],
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
// 美股「下单参考」的买入 / 跌破就卖 / 分批卖出价只能从引擎 technicalPlan 原样挑出来：
// 清洗层不改数、不补数，离线包跟清洗结果一致；快照过期后整块剥掉，页面上不会挂着过时的价。
{
  const requireCjs = createRequire(import.meta.url);
  const { sanitizeSnapshot } = requireCjs("../cloudfunctions/aurum-data/sanitize.js");
  const { degradeStaleActions } = requireCjs("../cloudfunctions/aurum-data/action-freshness.js");
  const sanitized = sanitizeSnapshot(publicSnapshot);
  const sourceBySymbol = new Map((publicSnapshot.us?.stocks || []).map((stock) => [stock.symbol, stock]));
  const sanitizedBySymbol = new Map((sanitized.us?.stocks || []).map((stock) => [stock.symbol, stock]));
  const sameNumbers = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  for (const [symbol, stock] of sanitizedBySymbol) {
    const source = sourceBySymbol.get(symbol)?.technicalPlan || {};
    const sourceSell = (Array.isArray(source.tp) ? source.tp : []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const ordered = Number(source.buy) > 0 && Number(source.stop) > 0 && sourceSell.length
      && Number(source.stop) < Number(source.buy) && sourceSell[0] > Number(source.buy);
    if (sanitized.actionsFresh && ordered) assert(stock.pricePlan, `美股 ${symbol} 引擎有完整三档价，清洗后却没有 pricePlan`);
    if (!stock.pricePlan) continue;
    assert(
      stock.pricePlan.buy === Number(source.buy)
        && stock.pricePlan.stop === Number(source.stop)
        && sameNumbers(stock.pricePlan.sell, sourceSell),
      `美股 ${symbol} 的 pricePlan 跟引擎 technicalPlan 对不上`,
    );
    assert(stock.pricePlan.stop < stock.pricePlan.buy && stock.pricePlan.sell[0] > stock.pricePlan.buy, `美股 ${symbol} 三档价顺序不对`);
  }
  for (const stock of snapshot.us.stocks) {
    if (!stock.pricePlan) continue;
    assert(
      JSON.stringify(stock.pricePlan) === JSON.stringify(sanitizedBySymbol.get(stock.symbol)?.pricePlan),
      `小程序离线包里 ${stock.symbol} 的 pricePlan 跟云函数清洗结果不一致，请运行 npm run sync:mini`,
    );
  }
  const staleNow = Date.parse(snapshot.updatedAt) + 7 * 24 * 60 * 60 * 1000;
  for (const [label, degraded] of [
    ["离线包", degradeStaleActions(snapshot, staleNow)],
    ["云函数", degradeStaleActions(sanitized, staleNow)],
  ]) {
    assert(degraded.actionsFresh === false, `${label}快照过期后应标记为动作过期`);
    assert(!(degraded.us?.stocks || []).some((stock) => stock.pricePlan), `${label}快照过期后美股仍带参考买卖价`);
  }
}
// 今日重点标题撤掉后，「数据截至」挂在核心研究那一行的右侧，仍是自动更新的。
assert(
  indexTemplate.includes("核心研究")
  && indexTemplate.includes("dataAsOf")
  && indexSource.includes("数据截至"),
  "首页缺少固定分组标题或自动更新的数据截至时间",
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
// todayHelp/card-help 这行常驻可见的入口说明文字已被 2bbaa38 撤掉——首页顶部注释
// 明确写着「一格只有图标和名字，不用先读一行说明」，help 现在只留作 aria-label
// 读屏用；today-sub 随今日重点一起撤掉，走势卡同样靠 aria-label 读出数值与涨跌。
assert(
  indexTemplate.includes("item.help")
    && indexTemplate.includes('aria-label="{{item.title}} {{item.value}} {{item.sub}}"')
    && !indexTemplate.includes("today-sub"),
  "首页应通过读屏标签保留入口与走势卡的帮助信息",
);
// group-help 在 711b420 里改名为 hero-help；2026-09-29 按产品要求（字太多）
// 标题下那行说明整行撤掉，栏目用途 meta.one 只留在标题的读屏标签里。
assert(
  (pageTemplatesByPath.get("pages/section/index") || "").includes('aria-label="{{meta.title}}：{{meta.one}}"')
    && !(pageTemplatesByPath.get("pages/section/index") || "").includes("hero-help"),
  "栏目页标题下不应再挂说明小字，栏目用途应保留在读屏标签里",
);
// 同一轮减字：黄金栏目页不再摆 6 个宏观指标和均线拐点那段话，改成一个进详情的口子；
// 这些内容仍在黄金详情页里（buildGoldView 读 gold.indicators），不是删掉了。
assert(
  !(pageTemplatesByPath.get("pages/section/index") || "").includes("goldIndicatorTiles")
    && /class="gold-detail-link"\s+bindtap="openInsightTarget"/.test(pageTemplatesByPath.get("pages/section/index") || "")
    && detailSource.includes("gold.indicators"),
  "黄金宏观指标应收进详情页，栏目页只留进详情的入口",
);
// 聪明钱「本季在加/减什么」两张答案卡和下面「本季共同方向」条形图是同一批票，
// 栏目页只留条形图；答案卡本身还在 daily-answers 里给别处用。
assert(
  (await readFile(path.join(miniRoot, "pages", "section", "index.js"), "utf8")).includes('item.id !== "guru-add" && item.id !== "guru-cut"')
    && (pageTemplatesByPath.get("pages/section/index") || "").includes("本季共同方向"),
  "聪明钱栏目页不应把加/减仓同一批票印两遍",
);
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
// 「追踪此标的变化」和「保存决策快照」走的是同一段 openSnapshotSheet，是真重复，
// 已经合成一个按钮；风险区现在只剩保存快照 + 提醒我相关事件两个。
assert(
  (detailTemplate.includes("保存决策快照") || detailContract.includes("保存决策快照"))
  && detailTemplate.includes("提醒我相关事件")
  && !detailTemplate.includes("追踪此标的变化")
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
// 价格轨迹图从竖柱升级成 Canvas 折线图（kind: "line"）后，这里跟着认新的
// kind 字面量——检查的本意是「详情页要有价格轨迹/竖柱对比/位置仪表三类图」，
// 不是死认 "columns" 这个具体实现，图表形式升级不该把这条回归检查改弱。
assert(detailSource.includes("kind: \"line\"") && detailSource.includes("kind: \"solid\"") && detailSource.includes("kind: \"meter\""), "详情页缺少价格轨迹、竖柱对比或位置仪表图");
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
