// SEC EDGAR 公告：给美股热度补一句「同期发生了什么」。
//
// 热度是成交量比和涨跌幅算出来的，只能说「热」，说不了「为什么热」。公告是
// 发行人自己向 SEC 提交的备案，8-K 的 Item 代码就是公司给这份公告贴的分类，
// 不需要我们从新闻里猜题材。
//
// 但公告和放量是同期发生，不等于因果。所以这里所有文案一律是「同期公告」，
// 任何地方都不写「因为业绩所以涨」——一天里可能有三件事同时在发生，我们只
// 负责把能核对的那一件摆出来，判断留给读的人。
"use strict";

// 「这只近 30 天没发公告」和「我们这份快照根本没带公告字段」是两回事。
// 快照里一条都没有时只能是后者——30 只大盘股一个月集体不发公告不可能——
// 这种时候必须整栏不出现，绝不能写成「无公告」把缺数据说成事实。
function hasFilingFeed(snapshot) {
  const list = (snapshot && snapshot.us && snapshot.us.filings) || [];
  return Array.isArray(list) && list.length > 0;
}

function normalizeSymbol(value) {
  return String(value || "").toUpperCase().trim();
}

// 快照里 filings 是一条扁平数组（按日期倒序），页面按标的取用。
function filingsBySymbol(snapshot) {
  const map = new Map();
  const list = (snapshot && snapshot.us && snapshot.us.filings) || [];
  if (!Array.isArray(list)) return map;
  for (const filing of list) {
    const symbol = normalizeSymbol(filing && filing.symbol);
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push(filing);
  }
  return map;
}

function filingsFor(snapshot, symbol) {
  const key = normalizeSymbol(symbol);
  if (!key) return [];
  const list = (snapshot && snapshot.us && snapshot.us.filings) || [];
  if (!Array.isArray(list)) return [];
  return list.filter((filing) => normalizeSymbol(filing && filing.symbol) === key);
}

// 「2026-09-02」→「09-02」。年份对近 30 天的公告没有信息量，占的是宽度。
function filingDay(filing) {
  const date = String((filing && filing.filingDate) || "");
  return date.length >= 10 ? date.slice(5) : date;
}

// 「09-02 业绩公告」。一份 8-K 可以同时挂几个 Item，全列出来会把一行撑爆，
// 取第一条即可——SEC 的 items 顺序就是发行人自己排的主次。
function formatFiling(filing) {
  if (!filing) return "";
  const label = (Array.isArray(filing.labels) && filing.labels[0]) || filing.form || "";
  if (!label) return "";
  const day = filingDay(filing);
  return day ? `${day} ${label}` : label;
}

function labelOf(filing) {
  return (filing && Array.isArray(filing.labels) && filing.labels[0]) || (filing && filing.form) || "";
}

// 卡片上的一行：「同期公告：09-02 业绩公告 · 08-26 季度报告」。
// 同一类公告连着发两天（Strategy 就常这样连发 Reg FD）不重复念标签，
// 写成「09-01、08-31 自愿披露（Reg FD）」——日期都留着，读起来短一半。
// 没有就返回空串，由调用方决定要不要写「近 30 天无公告」——不同页面语境不同。
function formatFilingLine(filings, max = 2) {
  const groups = [];
  for (const filing of (Array.isArray(filings) ? filings : []).slice(0, max)) {
    const label = labelOf(filing);
    const day = filingDay(filing);
    if (!label || !day) continue;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.days.push(day);
    else groups.push({ label, days: [day] });
  }
  return groups.map((group) => `${group.days.join("、")} ${group.label}`).join(" · ");
}

module.exports = {
  hasFilingFeed,
  filingsBySymbol,
  filingsFor,
  formatFiling,
  formatFilingLine,
};
