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
assert(snapshot.aShare.quotes.length >= 12, "小程序 A 股不足 12 只");
assert(snapshot.aShare.fundamentals.length >= 12, "小程序 A 股现金流数据不足 12 只");
assert(snapshot.investors.length >= 8, "小程序聪明人持仓不足 8 位");

const sectionSource = await readFile(path.join(miniRoot, "utils", "answers.js"), "utf8");
const smartMoneySource = await readFile(path.join(miniRoot, "utils", "smart-money.js"), "utf8");
const smartMoneyModule = { exports: {} };
vm.runInNewContext(smartMoneySource, { module: smartMoneyModule, exports: smartMoneyModule.exports });
const miniModule = { exports: {} };
vm.runInNewContext(sectionSource, {
  module: miniModule,
  exports: miniModule.exports,
  require(request) {
    if (request === "./smart-money") return smartMoneyModule.exports;
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
assert(miniGoldItems.length === 2, `小程序黄金入口应有 2 个答案，实际 ${miniGoldItems.length}`);
assert(miniGoldItems.every((item) => ["track", "plan"].includes(item.group)), "小程序黄金入口应是现在怎么做 / 买点与卖点");
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
    assert(rendered.one.includes("WHY：") && rendered.one.includes("HOW："), `${profile.name} 列表没有直接展示 WHY/HOW`);
  }
}
for (const item of miniAShareItems) {
  assert(["watch", "wait", "avoid"].includes(item.group), `${item.name} 应收息动作分组（值得关注/建议等待/应该回避）`);
  assert(item.raw.researchView?.state, `${item.name} 缺少后端完整度状态`);
}
for (const item of miniHKItems.filter((entry) => entry.group === "watch")) {
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
const detailContract = `${detailSource}\n${detailTemplate}`;
assert(indexSource.includes("pages/section/index"), "小程序首页仍未进入原生二级页");
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
assert(
  indexStyles.includes("min-height: 100vh")
    && indexStyles.includes("min-height: 188rpx")
    && indexTemplate.includes("today-card"),
  "小程序首页没有以今日重点和核心入口铺满移动视口",
);
assert(indexStyles.includes("border-right: 1rpx") && indexStyles.includes("border-bottom: 1rpx"), "小程序首页核心入口没有使用无间距细分隔线");
assert(indexTemplate.includes('class="entry-icon"') && indexTemplate.includes('class="entry-badge"'), "小程序核心入口缺少大图标或年度会员角标");
assert(indexTemplate.includes('aria-label="{{item.title}}，{{item.help}}"') && indexTemplate.includes('aria-hidden="true"'), "小程序核心入口缺少按钮朗读标签或装饰图标隐藏语义");
assert(indexTemplate.includes('role="button"') && !indexTemplate.includes("<button"), "小程序首页整块入口不应受原生 button 默认宽度干扰");
for (const label of ["今日重点", "核心研究", "查看 4 项速览", "我的研究记录"]) {
  assert(indexTemplate.includes(label), `小程序首页缺少清晰层级：${label}`);
}
assert(indexStyles.includes("width: 70rpx") && indexStyles.includes("font-size: 29rpx"), "小程序首页图标或栏目字没有使用清晰统一尺寸");
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
assert(indexSource.includes("toggleTodayDetails") && indexTemplate.includes("today.points"), "今日重点没有移到首页顶部并提供展开交互");
assert(indexSource.includes("pages/workspace/index?focus=watch"), "合并后的我的研究记录入口没有接入工作台");
for (const label of ["建议申购", "暂缓观察", "暂不建议", "已结束", "七姐妹", "热度前三", "收息清单", "现在怎么做", "买点与卖点", "资料较完整", "重点核验", "资料不足", "现金流待核验", "资料待补充", "资料结论", "价格位置", "驱动与风险", "港股 · 3 个", "美股 · 5 个", "A股 · 3 个", "可核验候选池内", "按表观长期年化从高到低排列"]) {
  assert(sectionSource.includes(label), `小程序缺少二级入口：${label}`);
}
for (const label of ["近 60 日最低", "近 60 日中位数", "近 60 日最高", "历史样本区间", "自由现金流", "公开持仓", "完整分析", "WHY · 为什么选它", "HOW · 怎么学"]) {
  assert(detailContract.includes(label), `小程序详情缺少关键内容：${label}`);
}
for (const [template, labels] of [
  [pageTemplatesByPath.get("pages/section/index") || "", ["hero-image", "结论", "继续看", "group-panel"]],
  [pageTemplatesByPath.get("pages/list/index") || "", ["summary-image", "先看结论", "全部", "data-bar-block"]],
  [detailTemplate, ["detail-image", "一句话结论", "数据图示", "visual-card", "analysis-index"]],
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
  indexTemplate.includes("今天先看这几件事")
  || (indexTemplate.includes("todayHelp") && indexSource.includes("今天先看这几件事")),
  "今日重点缺少小白人话副标",
);

assert(sectionSource.includes("meta.one") || (await readFile(path.join(miniRoot, "pages", "section", "index.wxml"), "utf8")).includes("meta.one"), "栏目页缺少「这一页帮你干嘛」");
for (const label of ["望潮年费会员", "365 天会员", "会员功能", "保存关注", "记录想法", "复制导出", "购买须知"]) {
  assert(`${memberPageSource}\n${memberTemplate}`.includes(label), `小程序会员页缺少关键内容：${label}`);
}
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
for (const label of ["我的记录", "关注", "想法", "复制导出全部记录", "删除全部记录", "到期后仍可查看、导出和删除"]) {
  assert(workspaceTemplate.includes(label), `小程序研究工作台缺少关键内容：${label}`);
}
for (const action of ["workspace", "saveWatchItem", "removeWatchItem", "saveDecision", "removeDecision", "deleteWorkspace"]) {
  assert(memberService.includes(`\"${action}\"`), `小程序会员服务缺少工作台操作：${action}`);
}
assert(detailContract.includes("保存到我的记录") && detailSource.includes("pages/workspace/index"), "详情页没有接入研究工作台");
assert(memberTemplate.includes('open-type="contact"'), "会员页缺少微信客服入口");
assert(memberPageSource.includes("purchase(planId") && memberPageSource.includes("adultConfirmed: true") && memberPageSource.includes('url: "/pages/legal/index"'), "会员页缺少直达支付、成年确认或完整协议入口");
assert(memberTemplate.includes("点击即确认已满 18 周岁") && !memberTemplate.includes("showPaymentTestTools") && !memberTemplate.includes("changePurchaseConsent"), "会员页应使用清晰的按钮确认，不应暴露内部验收控件");
assert(memberPageSource.includes("showNotice: false") && memberTemplate.includes('wx:if="{{showNotice}}"'), "会员页购买须知应默认收起并可按需展开");
assert(legalPage.includes("pages/member/index") && legalTemplate.includes('open-type="contact"'), "协议页缺少返回会员或客服通道");
assert(sitemap.rules.some((rule) => rule.action === "disallow" && rule.page === "pages/workspace/index"), "个人工作台不应进入小程序页面索引");
assert(!indexSource.includes("pages/webview/index?target=${target}"), "小程序首页仍直接依赖 web-view");
assert(!appSource.includes("PUBLIC_ORIGIN"), "小程序 App 仍依赖外部网页域名");
assert(!storeSource.includes("wx.request"), "小程序数据层仍依赖运行时外部请求");
assert(storeSource.includes('name: "aurum-data"') && storeSource.includes("离线备用数据") && storeSource.includes("自动更新"), "小程序没有接入最新数据云函数与离线回退");
assert(liveDataFunction.includes("devi-y.github.io/aurumer/data/live-snapshot.json") && liveDataFunction.includes("CACHE_TTL_MS") && liveDataFunction.includes("REQUEST_TIMEOUT_MS"), "最新数据云函数缺少公开源、缓存或超时保护");
for (const field of forbiddenKeys) {
  assert(liveDataSanitizer.includes(field) || !generatedSource.includes(`\"${field}\"`), `实时数据清洗没有覆盖内部字段：${field}`);
}
assert(!indexTemplate.includes("card-detail"), "首页九宫格仍显示多余小字");
assert(detailSource.includes("detailsExpanded: false") && detailTemplate.includes('wx:if="{{detailsExpanded}}"'), "详情页没有使用先结论、后展开的渐进式呈现");
assert(workspaceSource.includes('activeTab: "watch"') && workspaceTemplate.includes('data-tab="watch"') && workspaceTemplate.includes('data-tab="decision"'), "记录页没有把关注与想法拆成简单双标签交互");
assert(!detailSource.includes("openDeep"), "小程序详情仍保留外链分析入口");
assert(!detailContract.includes("继续看完整分析"), "小程序详情仍会引导用户离开原生页面");
assert(!detailSource.includes("raw.currentPrice || 0"), "小程序 A 股缺失价格仍会显示 0 元");
assert(!detailSource.includes("raw.trackingScore || 0"), "小程序缺失跟踪分仍会显示 0 分");

const projectConfig = JSON.parse(await readFile(path.join(miniRoot, "project.config.json"), "utf8"));
const appIdState = projectConfig.appid === "touristappid" ? "旅游 AppID，仅可本地预览" : "正式 AppID 已配置";
console.log(`小程序原生层级与离线数据检查通过：${appIdState}`);
