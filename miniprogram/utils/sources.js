// 官方出处登记表。原本只长在 utils/news-feed.js 里，现在抬出来共用——
// 新闻资讯页给每一条披露都挂了一个能核验的官方地址，其余五个模块的详情页
// 一直只有一个来源"名字"、没有地址，用户想核对也无从下手。同一份登记表，
// 五类资产照着新闻页的做法用一遍。
//
// 引擎在 data/live-snapshot.json 里是有一份完整 sources 数组的，但同步进小程序
// 包的那份被脱敏脚本剥掉了（只有 gold.sources 留了下来），线上拉到的对外快照
// 同样没有。所以这里按 source id 备一份站点级官方地址。
//
// 只放"绝对不会指错"的官方入口，不去猜每只标的的深链——链接是给用户复制去核
// 对的，宁可少一层精确度，也不能给出一个 404。逐条能拿到深链的两类（港交所公
// 告 PDF、SEC 每家机构的 EDGAR 页）本来就带在快照条目里，优先用那个。
const OFFICIAL_SOURCES = {
  hkex: { name: "香港交易所新上市资料", url: "https://www2.hkexnews.hk/new-listings/new-listing-information/main-board?sc_lang=zh-HK" },
  sec: { name: "美国证监会公开备案", url: "https://www.sec.gov/edgar/search/" },
  nasdaq: { name: "纳斯达克公司财务数据", url: "https://www.nasdaq.com/market-activity/stocks" },
  "eastmoney-a-financial": { name: "东方财富 A股公开财务数据", url: "https://data.eastmoney.com/" },
  "tencent-a-quote": { name: "腾讯证券 A股公开行情", url: "https://stockapp.finance.qq.com/mstats/" },
  "gold-yahoo": { name: "雅虎财经国际金价", url: "https://finance.yahoo.com/quote/GC=F/" },
  "gold-fred": { name: "美联储宏观数据", url: "https://fred.stlouisfed.org/" },
  "gold-cftc": { name: "美国期货持仓报告", url: "https://www.cftc.gov/dea/newcot/f_disagg.txt" },
  "gold-sge": { name: "上海黄金交易所 Au99.99", url: "https://www.sge.com.cn/sjzx/quotation_daily_new" },
};

// 每个栏目对应哪几个官方入口。黄金那条另有活的 gold.sources，见 marketSources()。
const MARKET_SOURCE_IDS = {
  hk: ["hkex"],
  us: ["nasdaq"],
  a: ["eastmoney-a-financial", "tencent-a-quote"],
  gold: ["gold-sge", "gold-yahoo", "gold-fred", "gold-cftc"],
  guru: ["sec"],
};

function sourceEntry(snapshot, id) {
  const data = snapshot || {};
  const fromSnapshot = (data.sources || []).find((source) => source && source.id === id);
  const fromGold = ((data.gold || {}).sources || []).find((source) => source && source.id === id);
  return fromSnapshot || fromGold || OFFICIAL_SOURCES[id] || null;
}

function sourceUrlOf(snapshot, id, fallback = "") {
  const entry = sourceEntry(snapshot, id);
  return (entry && entry.url) || fallback;
}

function sourceNameOf(snapshot, id, fallback = "") {
  const entry = sourceEntry(snapshot, id);
  return (entry && entry.name) || fallback;
}

// 组一条可展示的出处：没有地址就不返回，页面上宁可少一行，
// 也不要摆一个点了复制不出东西的"来源"。
function sourceLink(snapshot, id, name) {
  const entry = sourceEntry(snapshot, id);
  const url = entry && entry.url;
  if (!url) return null;
  return { id: id || url, name: name || (entry && entry.name) || "官方出处", url };
}

// 栏目级出处：拿不到活的就退回登记表。黄金优先用快照里带回来的那份，
// 因为它带 ok 标志，抓失败的那个口径不该再挂出来让人以为数据是新的。
function marketSources(snapshot, market) {
  const data = snapshot || {};
  const ids = MARKET_SOURCE_IDS[market] || [];
  if (market === "gold") {
    const live = ((data.gold || {}).sources || []).filter((source) => source && source.ok && source.url);
    if (live.length) {
      return live.map((source) => ({ id: source.id, name: sourceName(source.name), url: source.url }));
    }
  }
  return ids.map((id) => sourceLink(data, id)).filter(Boolean);
}

// 去重：同一个地址出现两次（比如条目自带的深链正好等于站点入口）只留一条。
function dedupeSources(list) {
  const seen = new Set();
  return (list || []).filter((entry) => {
    if (!entry || !entry.url || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

// 快照条目自带的来源名是抓取端写的英文缩写（「HKEX」「SEC EDGAR 13F」
// 「… Factsheet」），直接印在页面上读者不认。只换成中文叫法，不改出处本身。
const SOURCE_NAME_ZH = [
  [/^HKEX$/i, "港交所"],
  [/^SEC EDGAR 13F$/i, "美国证监会持仓申报"],
  [/^FRED 宏观指标$/i, "美联储宏观数据"],
  [/^CFTC 黄金持仓$/i, "美国期货持仓报告"],
  [/^Value Partners\s*/i, "惠理"],
  // Trustnet 只是托管基金月报的网站，月报本身是基金公司出的。
  [/^Trustnet\s*/i, ""],
  [/基金月度\s*Factsheet$/i, "基金月报"],
];

function sourceName(text) {
  let name = String(text || "").trim();
  for (const [pattern, zh] of SOURCE_NAME_ZH) name = name.replace(pattern, zh);
  return name;
}

module.exports = {
  sourceName,
  OFFICIAL_SOURCES,
  MARKET_SOURCE_IDS,
  sourceEntry,
  sourceUrlOf,
  sourceNameOf,
  sourceLink,
  marketSources,
  dedupeSources,
};
