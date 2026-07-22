import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const dailyHtml = await readFile(resolve(root, "daily.html"), "utf8");
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
assert(entryBody.includes("href:'#/gold'"), "一级首页缺少黄金投资入口");
const portalOrder = ["href:'#/hk'", "href:'#/us'", "href:'#/a-shares'", "href:'#/gold'", "href:'#/gurus'"]
  .map((marker) => entryBody.indexOf(marker));
assert(portalOrder.every((position, index) => position >= 0 && (index === 0 || position > portalOrder[index - 1])), "一级首页顺序必须是港股、美股、A股、黄金、聪明人持仓");
for (const feature of ["今日新股结论", "性价比排名", "自由现金流筛选", "伦敦金与上海金", "逐个解释 WHY"]) {
  assert(entryBody.includes(feature), `首页入口缺少功能说明：${feature}`);
}

for (const text of [
  "{id:'buy',label:'值得打'",
  "{id:'caution',label:'谨慎打'",
  "{id:'skip',label:'不建议'",
  "{id:'ended',label:'已结束'",
  "{id:'seven',label:'七姐妹'",
  "{id:'hot',label:'热度前三'",
  "{id:'buy',label:'买入'",
  "{id:'wait',label:'等待'",
  "{id:'avoid',label:'回避'",
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
assert(html.includes("买入 / 止盈 / 止损"), "美股详情缺少价格答案");
assert(html.includes("现金流质量"), "A股深度页缺少现金流分析");
assert(html.includes("function aShareCalcNote"), "A股计算器缺少动态持仓说明");
assert(html.includes("button.classList.toggle('on'"), "A股计算器年限按钮不会同步选中状态");
assert(html.includes("动作时间线"), "聪明人深度页缺少动作时间线");
assert(html.includes("function insightMeters"), "深层答案页缺少直观温度条");
assert(html.includes("以上均为已经发生的历史结果，不是预测准确率"), "港股历史页未区分历史结果与预测准确率");
assert(html.includes("收息与现金流总榜"), "A股深度页缺少收息与现金流横向排名");
assert(html.includes("itemCashFlow.label"), "A股横向排名缺少自由现金流结论");
assert(html.includes("复盘分仅比较历史实际表现，不代表当时的申购评分"), "港股已结束列表缺少复盘分口径说明");
assert(html.includes("宁可错过，也不勉强参与"), "港股值得打空状态不够友好");
assert(html.includes("买入＝股息率&gt;3%且FCF/市值&gt;5%"), "A股分类页缺少判断标准");
assert(html.includes("数据状态：${syncing?'正在同步':'实时更新'}"), "模块顶部缺少动态数据状态");
assert(html.includes("本平台数据仅供学习参考，不构成投资建议"), "详情页缺少统一学习免责声明");
assert(html.includes("function showUSPriceFloat"), "美股列表缺少止盈止损浮层交互");
for (const marker of ["function renderGold", "function renderGoldAnswer", "function renderGoldPrice", "function renderGoldDrivers", "function renderGoldAnalysis"]) {
  assert(html.includes(marker), `黄金页面缺失：${marker}`);
}
assert(html.includes("国际金关注区") && html.includes("上海金关注区"), "黄金答案缺少双市场价格区间");
assert(!html.includes("internalAssessment"), "公开页面泄露黄金内部评分拆解");
assert(html.includes("建议止盈区间") && html.includes("建议止损区间"), "美股价格浮层字段不完整");
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
assert(aShareGroupsBody.includes("item.currentAdvice==='买入'"), "A股买入组缺少买入条件");
assert(!aShareGroupsBody.includes("item.currentAdvice==='买入'||item.currentAdvice==='持有'"), "A股持有标的不应归入买入组");
assert(aShareGroupsBody.includes("['持有','等待','观察'].includes(item.currentAdvice)"), "A股等待组未覆盖持有、等待和观察");
assert(aShareGroupIdBody.includes("['持有','等待','观察'].includes(item?.currentAdvice)"), "A股详情返回分组口径不一致");
assert(dailyHtml.includes("今日结论"), "每日驾驶舱缺少今日结论");
assert(dailyHtml.includes("我的持仓"), "每日驾驶舱缺少本地持仓入口");
assert(dailyHtml.includes("assets/dashboard.js"), "每日驾驶舱缺少交互脚本");

for (const forbidden of ["策略权重", "模型公式", "评分公式", "保证赚钱", "必然上涨"]) {
  assert(!html.includes(forbidden), `公开页面出现不应展示的内容：${forbidden}`);
}

console.log("页面层级与多端 UI 合约检查通过");
