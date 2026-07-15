import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const dailyHtml = await readFile(resolve(root, "daily.html"), "utf8");

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
assert(html.includes("买入 / 止盈 / 止损"), "美股详情缺少价格答案");
assert(html.includes("现金流质量"), "A股深度页缺少现金流分析");
assert(html.includes("动作时间线"), "聪明人深度页缺少动作时间线");
assert(html.includes("function renderLoadingApp"), "页面缺少加载状态");
assert(html.includes("function pageNav"), "详情页缺少返回与首页导航");
assert(html.includes("function mobileNav"), "移动端缺少底部导航");
assert(/@media\(max-width:420px\)/.test(html), "缺少手机端布局规则");
assert(/overflow-x:clip/.test(html), "页面没有阻止横向溢出");
assert(dailyHtml.includes("今日结论"), "每日驾驶舱缺少今日结论");
assert(dailyHtml.includes("我的持仓"), "每日驾驶舱缺少本地持仓入口");
assert(dailyHtml.includes("assets/dashboard.js"), "每日驾驶舱缺少交互脚本");

for (const forbidden of ["策略权重", "模型公式", "评分公式", "保证赚钱", "必然上涨"]) {
  assert(!html.includes(forbidden), `公开页面出现不应展示的内容：${forbidden}`);
}

console.log("页面层级与多端 UI 合约检查通过");
