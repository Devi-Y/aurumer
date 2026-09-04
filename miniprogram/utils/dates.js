// 日期格式统一。这份逻辑原来只长在 utils/news-feed.js 里，现在抬出来共用。
//
// 抬出来的原因：快照里的日期有四种写法混在一起——
//   2026-09-02T20:00:00.000Z  （行情接口给的 ISO 时间戳）
//   1/25/2026                 （Nasdaq 财季的 M/D/YYYY）
//   2025-12-31                （A股财报期）
//   2026-08-14                （SEC 递交日）
// 新闻资讯页一进门就把它们都归到 YYYY-MM-DD，所以那一页读起来是齐的；
// 五个功能模块的详情页没做这一步，于是同一屏上会并排出现
// 「行情截至 2026-09-02T20:00:00.000Z」和「披露日期 2026-08-14」，
// 前者既不像日期也读不出是哪天。两边共用这一份，就不会再各走各的。
//
// 关于时区：ISO 串取的是它自己的 UTC 日期，不做本地换算。这不是偷懒——
// 美股 20:00Z 就是当天美东收盘 16:00，换成北京时间会变成第二天，把一条
// 09-02 的收盘价标成 09-03。日期跟着这条数据自己的市场走，才是对的。

function pad2(value) {
  return String(value).padStart(2, "0");
}

// 统一成 YYYY-MM-DD。识别不了就返回空串，由调用方决定是丢掉这条
// 还是原样显示——这个函数自己绝不猜一个日期出来。
function toDay(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  // Nasdaq 的财季写法是 M/D/YYYY，例如 1/25/2026。
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${pad2(us[1])}-${pad2(us[2])}`;
  return "";
}

// 详情页那些「XX 截至 / XX 日期」的字段用这个：能归一就归一，
// 归不了就把原文摆出来。宁可显示一个格式怪的真日期，也不要因为
// 正则没认出来就把一条已经披露的信息悄悄抹掉。
function dayText(value) {
  return toDay(value) || (value ? String(value) : "");
}

// 页头那句「数据截至 09-03 13:50」。原来只长在新闻资讯页里，现在栏目页和
// 明细页的页头也要挂同一句——同一份快照在三个页面上说的时间必须是同一个，
// 各写各的迟早会飘。带 kind === "stale" 时把「已偏旧」直接写进这句话，
// 而不是另起一条横幅：读的人第一眼看到时间，就该同时知道这时间靠不靠谱。
function asOfText(value, kind) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "数据截至待核验";
  const stamp = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return kind === "stale" ? `数据截至 ${stamp} · 已偏旧` : `数据截至 ${stamp}`;
}

module.exports = { pad2, toDay, dayText, asOfText };
