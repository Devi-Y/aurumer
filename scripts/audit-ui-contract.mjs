import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const dailyHtml = await readFile(resolve(root, "daily.html"), "utf8");
const dashboardJs = await readFile(resolve(root, "assets/dashboard.js"), "utf8");
const miniIndexWxml = await readFile(resolve(root, "miniprogram/pages/index/index.wxml"), "utf8");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.webmanifest"), "utf8"));
const serviceWorker = await readFile(resolve(root, "sw.js"), "utf8");
const smartMoney = await readFile(resolve(root, "assets/smart-money.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const entryBody = html.match(/function renderEntry\(\)\{([\s\S]*?)\n\}\n\n\/\* =+ 二级页面/)?.[1] || "";
assert(entryBody, "无法定位一级首页渲染函数");
assert((entryBody.match(/homePortalCard\(\{/g) || []).length === 5, "一级首页必须包含五个投资入口");
assert(entryBody.includes("href:'#/hk'"), "一级首页缺少港股入口");
assert(entryBody.includes("href:'#/us'"), "一级首页缺少美股入口");
assert(entryBody.includes("href:'#/a-shares'"), "一级首页缺少A股入口");
assert(entryBody.includes("href:'#/gurus'"), "一级首页缺少聪明人持仓入口");
assert(entryBody.includes("href:'#/gold'"), "一级首页缺少黄金追踪入口");
const portalOrder = ["href:'#/hk'", "href:'#/us'", "href:'#/a-shares'", "href:'#/gold'", "href:'#/gurus'"]
  .map((marker) => entryBody.indexOf(marker));
assert(portalOrder.every((position, index) => position >= 0 && (index === 0 || position > portalOrder[index - 1])), "一级首页顺序必须是港股、美股、A股、黄金、聪明人持仓");
for (const feature of ["招股资料", "七姐妹", "自由现金流筛选", "历史价格", "逐个解释 WHY"]) {
  assert(entryBody.includes(feature), `首页入口缺少功能说明：${feature}`);
}
assert(entryBody.includes("title:'美股投资'") && entryBody.includes("title:'黄金追踪'"), "首页入口标题需为美股投资与黄金追踪");

for (const text of [
  "{id:'buy',label:'建议申购'",
  "{id:'caution',label:'暂缓观察'",
  "{id:'skip',label:'暂不建议'",
  "{id:'ended',label:'已结束'",
  "{id:'seven',label:'七姐妹'",
  "{id:'hot',label:'热度前三'",
  "{id:'buy',label:'重点观察'",
  "{id:'wait',label:'继续观察'",
  "{id:'avoid',label:'谨慎观察'",
]) {
  assert(html.includes(text), `二级入口缺失：${text}`);
}

const usGroupsBody = html.match(/function getUSGroups\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
assert(usGroupsBody && !usGroupsBody.includes("id:'gurus'"), "聪明人持仓不应继续嵌在美股分组");
assert(html.includes("hk:{name:'港股',count:3") && html.includes("us:{name:'美股',count:5") && html.includes("a:{name:'A股',count:3"), "聪明人持仓缺少港股3、美股5、A股3分组");
assert(html.includes("WHY · 为什么选它") && html.includes("HOW · 怎么学"), "聪明人持仓缺少 WHY / HOW 分析");
for (const id of ["value-partners-classic", "fidelity-china-special", "jpm-china-growth", "chinaamc-largecap", "fullgoal-tianhui", "xq-herun"]) {
  assert(smartMoney.includes(`id: "${id}"`), `聪明人候选缺失：${id}`);
}
for (const id of ["druckenmiller", "burry", "buffett", "ackman", "wood"]) {
  assert(smartMoney.includes(`${id}: {`), `美股聪明人候选缺失：${id}`);
}
assert(serviceWorker.includes("assets/smart-money.js"), "离线缓存缺少聪明人数据文件");

assert(html.includes("compact-rank"), "三级标的卡缺少排名");
assert(html.includes("综合分"), "三级标的卡缺少分数");
assert(html.includes("待评分 · 待排名"), "资料不足的港股仍可能显示占位分数");
assert(html.includes("历史价格区间") && html.includes("历史区间低点") && html.includes("历史区间高点"), "美股详情缺少历史价格区间");
assert(html.includes("现金流质量"), "A股深度页缺少现金流分析");
assert(html.includes("function aShareCalcNote"), "A股计算器缺少动态持仓说明");
assert(html.includes("button.classList.toggle('on'"), "A股计算器年限按钮不会同步选中状态");
assert(html.includes("动作时间线"), "聪明人深度页缺少动作时间线");
assert(html.includes("function renderGuruOverlap"), "聪明人持仓缺少交叉重叠研究页");
assert(html.includes("保荐人历史样本"), "港股历史页缺少保荐人胜率档案");
assert(html.includes("以上均为已经发生的历史结果，不是预测准确率"), "港股历史页未区分历史结果与预测准确率");
assert(html.includes("收息与现金流总榜"), "A股深度页缺少收息与现金流横向排名");
assert(html.includes("itemCashFlow.label"), "A股横向排名缺少自由现金流结论");
assert(html.includes("复盘分仅比较历史实际表现，不代表当时的申购评分"), "港股已结束列表缺少复盘分口径说明");
assert(html.includes("宁可错过，也不勉强参与"), "港股值得打空状态不够友好");
assert(html.includes("重点观察＝股息率&gt;3%且FCF/市值&gt;5%"), "A股分类页缺少判断标准");
assert(html.includes("历史走势参考 · 资料整理 ${stamp} · 数据日期见各项"), "模块顶部应区分资料整理时间与各项历史数据日期");
assert(html.includes("STALE_ACTION"), "缺少数据过期动作降级文案常量");
assert(html.includes("本平台数据仅供学习参考，不构成投资建议"), "详情页缺少统一学习免责声明");
assert(html.includes("function showUSPriceFloat"), "美股列表缺少观察区间浮层交互");
for (const marker of ["function renderGold"]) {
  assert(html.includes(marker), `黄金页面缺失：${marker}`);
}
assert(html.includes("goldPriceCard('国际金价'") && html.includes("goldPriceCard('上海金 Au99.99'"), "黄金历史资料缺少国际金与上海金记录");
assert(!html.includes("internalAssessment"), "公开页面泄露黄金内部评分拆解");
assert(html.includes("历史区间高点") && html.includes("历史区间低点"), "美股浮层应展示已收录高低点");
assert(html.includes("quickPriceAction(item.t)"), "美股扩展榜单缺少快速价格入口");
assert(html.includes("function renderLoadingApp"), "页面缺少加载状态");
assert(html.includes("function pageNav"), "详情页缺少返回与首页导航");
assert(html.includes("function mobileNav"), "移动端缺少底部导航");
assert(html.includes("function publicShareBase"), "分享链接不能自动适配正式域名");
assert(/@media\(max-width:420px\)/.test(html), "缺少手机端布局规则");
assert(/overflow-x:clip/.test(html), "页面没有阻止横向溢出");
assert(manifest.start_url === "./" && manifest.scope === "./", "PWA 启动路径仍绑定单一域名目录");
assert(serviceWorker.includes("self.registration.scope"), "离线缓存路径不能自动适配正式域名");
const aShareGroupsBody = html.match(/function getAShareGroups\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
const aShareGroupIdBody = html.match(/function aShareGroupIdFor\(item\)\{([\s\S]*?)\n\}/)?.[1] || "";
assert(aShareGroupsBody.includes("重点观察") && aShareGroupsBody.includes("aShareObservationBand"), "A股重点观察组缺少观察分档");
assert(aShareGroupsBody.includes("继续观察") && aShareGroupsBody.includes("谨慎观察"), "A股观察分档未覆盖继续/谨慎");
assert(aShareGroupIdBody.includes("aShareObservationBand"), "A股详情返回分组口径不一致");
assert(dailyHtml.includes("历史资料参考") && dailyHtml.includes("五类历史资料") && dailyHtml.includes("daily-head"), "资料页应明确历史口径与五类资料");
assert(dailyHtml.includes("我的持仓"), "每日驾驶舱缺少本地持仓入口");
assert(dailyHtml.includes("assets/dashboard.js"), "每日驾驶舱缺少交互脚本");
assert(!dailyHtml.includes("五个投资入口") && !dailyHtml.includes("member-card"), "每日驾驶舱不应在答案后重复入口或营销介绍");
assert(html.includes("function dailyAnswerBoard") && !entryBody.includes("digestHomePoint("), "历史首页不应继续把盘后模型摘要当成即时答案");
assert(html.includes("data/daily-digest.json"), "网页应保留与小程序同批次摘要核对能力");
assert(!dailyHtml.includes("legacy.html"), "每日驾驶舱不应把今日答案链接到旧版页面");
assert(dashboardJs.includes("function dailyStrategyCard") && dashboardJs.includes("['hk','us','a','gold','guru']"), "历史资料页应覆盖五类资料");
assert(dashboardJs.includes("记录价") && dashboardJs.includes("数据日期"), "历史资料卡应标明记录价与实际数据日期");
assert(dashboardJs.includes("state.digestSyncing"), "摘要与公开快照时间不一致时必须阻止旧答案混用");
// 行为核验：旧报价日期不能被新处理批次覆盖，也不能退化为即时买卖按钮。
function declaredFunction(source, name) {
  const found = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert(found, `缺少待核验函数：${name}`);
  return found[0];
}
const oldQuote = { symbol: "HISTORY", price: 123.45, changePercent: 2, asOf: "2024-06-14T20:00:00Z" };
const historicalCard = vm.runInNewContext(`(${declaredFunction(dashboardJs, "dailyStrategyCard")})`, {
  state: { data: { updatedAt: "2026-10-27T00:00:00Z", us: { stocks: [oldQuote] } } },
  getUSFocus: (data) => data.us.stocks[0],
  recordedNumber: String,
  formatDateTime: String,
  conclusionCard: (card) => card,
})("us", "美股", "index.html#/us", "来源");
assert(historicalCard.facts.some(([label, value]) => label === "数据日期" && value === oldQuote.asOf), "报价卡没有保留实际记录日期");
assert(!JSON.stringify(historicalCard).includes("2026-10-27"), "处理时间被当成报价日期");
assert(!/[买卖]入|卖出|下单/.test(JSON.stringify(historicalCard)), "历史资料卡出现即时交易动作");
const priceAnswersBody = declaredFunction(html, "stockPriceAnswers");
assert(!/x\.(?:pricePlan|technicalPlan)/.test(priceAnswersBody), "历史价格区间仍取自买卖计划");
assert(priceAnswersBody.includes("stockPositionFacts(x)") && priceAnswersBody.includes("available:false"), "历史模式应使用已收录价格且不开放交易计划");
const dateFormatter = vm.runInNewContext(`(${declaredFunction(dashboardJs, "formatDateTime")})`, { Date, Intl });
assert(dateFormatter(oldQuote.asOf).includes("2024"), "历史报价日期缺少年份，可能混淆不同年份记录");
const sourceState = {};
vm.runInNewContext(`(${declaredFunction(dashboardJs, "renderFreshness")})`, {
  $: () => sourceState,
  Date,
})({ updatedAt: "2020-01-01", status: "partial" });
assert(sourceState.textContent.includes("部分来源失败"), "历史口径掩盖了来源失败");
assert(!/今日|实时|当前价格/.test(entryBody), "历史首页仍有即时数据承诺");

assert(!miniIndexWxml.includes("item.performanceText"), "小程序首页不应恢复基于本地成本的浮盈展示（我的持仓已按产品决策整体从首页移除）");

for (const forbidden of ["策略权重", "模型公式", "评分公式", "保证赚钱", "必然上涨"]) {
  assert(!html.includes(forbidden), `公开页面出现不应展示的内容：${forbidden}`);
}

for (const forbidden of [
  "合理买入",
  "买入参考",
  "快速看止盈止损",
  "已形成买入、止盈和止损",
  "specialDisclaimer('买入和卖出价格",
]) {
  assert(!html.includes(forbidden), `index.html 合规文案未通过：${forbidden}`);
}

console.log("页面层级与多端 UI 合约检查通过");
