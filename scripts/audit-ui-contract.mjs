import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const dailyHtml = await readFile(resolve(root, "daily.html"), "utf8");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.webmanifest"), "utf8"));
const serviceWorker = await readFile(resolve(root, "sw.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const entryBody = html.match(/function renderEntry\(\)\{([\s\S]*?)\n\}\n\n\/\* =+ 二级页面/)?.[1] || "";
assert(entryBody, "无法定位一级首页渲染函数");
assert((entryBody.match(/homePortalCard\(\{/g) || []).length === 3, "一级首页必须只有三个市场入口");
assert(entryBody.includes("href:'#/hk'"), "一级首页缺少港股入口");
assert(entryBody.includes("href:'#/us'"), "一级首页缺少美股入口");
assert(entryBody.includes("href:'#/a-shares'"), "一级首页缺少A股入口");

for (const text of [
  "{id:'buy',label:'值得打'",
  "{id:'caution',label:'谨慎打'",
  "{id:'skip',label:'不建议'",
  "{id:'ended',label:'已结束'",
  "{id:'seven',label:'七姐妹'",
  "{id:'hot',label:'热度前三'",
  "{id:'gurus',label:'聪明人持仓'",
  "{id:'buy',label:'买入'",
  "{id:'wait',label:'等待'",
  "{id:'avoid',label:'回避'",
]) {
  assert(html.includes(text), `二级入口缺失：${text}`);
}

assert(html.includes("compact-rank"), "三级标的卡缺少排名");
assert(html.includes("综合分"), "三级标的卡缺少分数");
assert(html.includes("待评分 · 待排名"), "资料不足的港股仍可能显示占位分数");
assert(html.includes("买入 / 止盈 / 止损"), "美股详情缺少价格答案");
assert(html.includes("现金流质量"), "A股深度页缺少现金流分析");
assert(html.includes("function aShareCalcNote"), "A股计算器缺少动态持仓说明");
assert(html.includes("button.classList.toggle('on'"), "A股计算器年限按钮不会同步选中状态");
assert(html.includes("动作时间线"), "聪明人深度页缺少动作时间线");
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
