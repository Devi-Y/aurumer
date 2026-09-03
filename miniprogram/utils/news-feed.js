// 「新闻资讯」的数据来源说明——改这个文件之前请务必先读完这段。
//
// 快照里没有任何新闻字段：没有媒体稿、没有标题、没有编辑。所以这一页不是资讯
// 转载页，而是一条「变化提醒流」——把快照里**本来就存在、带日期、带官方出处**
// 的公开披露重新按时间排一遍。
//
// 每一条都必须同时满足三个条件，缺一条就不要放进来：
//   1. 事实本身直接来自快照字段，不是为了凑数算出来的观点或补写的文案；
//   2. 有一个真实日期（披露日 / 报告期 / 挂牌日 / 行情 asOf），不能拿"今天"顶上；
//   3. 有一个能核验的官方来源（SEC / 港交所 / 上金所 / FRED / 东方财富 …）。
//
// 产品第四条红线是「数据可信优先于页面完整」：宁可这一页只有三条，也不要为了
// 看起来热闹补一条没有出处的。列表为空时就老老实实显示空态。
//
// 标的名称和可跳转的详情 id 一律走 utils/answers.js 的 allItems()，不要在这里
// 另起一套映射——那样迟早会和列表页/详情页对不上。allItems() 找不到的 id 就不
// 挂详情链接，只落回栏目页。

const { allItems, INVESTOR_NAMES } = require("./answers");

const KIND_LABEL = {
  hk: "港股新股",
  guru: "机构披露",
  gold: "黄金",
  a: "A股",
  us: "美股",
};

// 每类的条数上限。A股 20 份年报报告期完全相同，美股财季也高度重复，
// 不设上限的话整条流会被这两类淹掉，港交所和 13F 反而看不见。
const MAX_PER_KIND = { hk: 8, guru: 9, gold: 5, a: 6, us: 6 };

function pad2(value) {
  return String(value).padStart(2, "0");
}

// null / undefined / 空串必须当成「没有这个数」返回 null，不能落进 Number()——
// Number(null) 是 0 且有限，会把「五日涨跌未公布」渲染成「五日 0.00%」，
// 那就是拿假数据填版面，违反数据可信优先于页面完整这条红线。
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 统一成 YYYY-MM-DD。识别不了就返回空串，调用方会把这条丢掉——
// 没有真实日期的条目不进这条流。
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

// 港交所公告本身没有日期字段，但它的官方链接路径里带着发布日：
// .../listconews/sehk/2026/0708/2026070801371_c.pdf → 2026-07-08。
// 只在路径完全符合这个格式时才采信，对不上就宁可这条没有日期。
function dayFromHkexUrl(url) {
  const matched = String(url || "").match(/\/(\d{4})\/(\d{2})(\d{2})\//);
  return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : "";
}

// 这条流横跨一年多（最早的 13F 是上一年 11 月，最新的行情是当年 8 月），
// 只写月日会让"12-31 年报"看起来像刚发生的事，所以日期一律写全年份。
function dayLabel(day) {
  const parts = String(day || "").split("-");
  if (parts.length !== 3) return "";
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function signedPercent(value, digits = 2) {
  const parsed = number(value);
  if (parsed === null) return "";
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(digits)}%`;
}

function joinBits(bits) {
  return bits.filter((bit) => bit !== null && bit !== undefined && bit !== "").join(" · ");
}

// 官方出处兜底表。引擎在 data/live-snapshot.json 里是有一份完整 sources 数组的，
// 但同步进小程序包的那份被脱敏脚本剥掉了（只有 gold.sources 留了下来），
// 线上拉到的对外快照同样没有。所以这里按 source id 备一份站点级官方地址。
//
// 只放"绝对不会指错"的官方入口，不去猜每只标的的深链——链接是给用户复制去核
// 对的，宁可少一层精确度，也不能给出一个 404。逐条能拿到深链的两类（港交所公
// 告 PDF、SEC 每家机构的 EDGAR 页）本来就带在快照条目里，优先用那个。
const SOURCE_FALLBACK = {
  hkex: { name: "香港交易所新上市资料", url: "https://www2.hkexnews.hk/new-listings/new-listing-information/main-board?sc_lang=zh-HK" },
  sec: { name: "SEC EDGAR 13F", url: "https://www.sec.gov/edgar/search/" },
  nasdaq: { name: "Nasdaq 公司财务数据", url: "https://www.nasdaq.com/market-activity/stocks" },
  "eastmoney-a-financial": { name: "东方财富 A股公开财务数据", url: "https://data.eastmoney.com/" },
  "gold-yahoo": { name: "Yahoo Finance 公共行情", url: "https://finance.yahoo.com/quote/GC=F/" },
  "gold-fred": { name: "FRED 宏观指标", url: "https://fred.stlouisfed.org/" },
  "gold-cftc": { name: "CFTC 黄金持仓", url: "https://www.cftc.gov/dea/newcot/f_disagg.txt" },
  "gold-sge": { name: "上海黄金交易所 Au99.99", url: "https://www.sge.com.cn/sjzx/quotation_daily_new" },
};

function sourceEntry(snapshot, id) {
  const fromSnapshot = (snapshot.sources || []).find((source) => source && source.id === id);
  return fromSnapshot || SOURCE_FALLBACK[id] || null;
}

function sourceUrlOf(snapshot, id, fallback = "") {
  const entry = sourceEntry(snapshot, id);
  return (entry && entry.url) || fallback;
}

function sourceNameOf(snapshot, id, fallback = "") {
  const entry = sourceEntry(snapshot, id);
  return (entry && entry.name) || fallback;
}

function buildNewsFeed(snapshot) {
  const data = snapshot || {};
  const indexCache = {};

  // 每个市场只算一次 allItems()，用来做两件事：把 id 校验成"确实能打开的详情"，
  // 以及取到和列表页完全一致的中文名。
  const indexOf = (market) => {
    if (!indexCache[market]) {
      let list = [];
      try {
        list = allItems(data, market) || [];
      } catch (error) {
        list = [];
      }
      indexCache[market] = new Map(
        list.map((item) => [String(item.id || "").toUpperCase(), item]),
      );
    }
    return indexCache[market];
  };
  const hit = (market, id) => indexOf(market).get(String(id || "").toUpperCase()) || null;
  const linkId = (market, id) => (hit(market, id) ? String(id) : "");
  const nameOf = (market, id, fallback) => {
    const found = hit(market, id);
    return (found && found.name) || fallback;
  };

  const items = [];
  const push = (item) => {
    if (!item || !item.day || !item.title) return;
    items.push(item);
  };

  // —— 港股：港交所新上市公告 ——
  const hk = data.hk || {};
  (hk.listings || []).forEach((listing) => {
    if (!listing || !listing.name) return;
    const url = listing.announcementUrl || listing.prospectusUrl || listing.allotmentUrl || "";
    const day = dayFromHkexUrl(url) || toDay(listing.listingDate);
    const extraction = listing.announcementExtraction || {};
    push({
      id: `news-hk-${listing.id || listing.rawCode}`,
      kind: "hk",
      day,
      title: `${listing.name} · 港交所新上市公告`,
      body: joinBits([
        listing.code,
        listing.status,
        extraction.reason || (listing.boardLot ? `每手 ${listing.boardLot}` : ""),
      ]),
      sourceName: listing.extractedFrom || listing.source || "香港交易所",
      sourceUrl: url || sourceUrlOf(data, "hkex"),
      market: "hk",
      targetId: linkId("hk", listing.rawCode || listing.code),
    });
  });

  // —— 港股：已挂牌新股的上市结果 ——
  (hk.history || []).forEach((entry) => {
    if (!entry || !entry.name) return;
    const review = entry.historicalReview || {};
    const lotRate = number(entry.oneLotRate);
    push({
      id: `news-hk-history-${entry.stockCode || entry.id}`,
      kind: "hk",
      day: toDay(entry.listingDate),
      title: `${entry.name} 已挂牌上市`,
      body: joinBits([
        // offerPrice 缺失时快照会填「以历史招股文件为准」这类占位话术，
        // 印在资讯流里既不是事实也不是数字，只有真带数字时才展示。
        /\d/.test(String(entry.offerPrice || "")) ? `发行价 ${entry.offerPrice}` : "",
        number(review.firstDayChange) !== null ? `首日 ${signedPercent(review.firstDayChange)}` : "",
        number(review.fiveDayChange) !== null ? `五日 ${signedPercent(review.fiveDayChange)}` : "",
        lotRate !== null ? `一手中签 ${lotRate.toFixed(1)}%` : "",
      ]),
      sourceName: sourceNameOf(data, "hkex", "香港交易所"),
      sourceUrl: sourceUrlOf(data, "hkex"),
      market: "hk",
      targetId: linkId("hk", entry.stockCode || entry.code),
    });
  });

  // —— 机构：13F 新披露 ——
  (data.investors || []).forEach((investor) => {
    if (!investor || !investor.name) return;
    const holdings = Array.isArray(investor.holdings) ? investor.holdings : [];
    const fresh = holdings.filter((row) => row && row.changeType === "new");
    const up = holdings.filter((row) => row && row.changeType === "up");
    const down = holdings.filter((row) => row && row.changeType === "down");
    const sold = Array.isArray(investor.sold) ? investor.sold : [];
    const top = holdings[0];
    push({
      id: `news-guru-${investor.id}`,
      kind: "guru",
      day: toDay(investor.filingDate),
      title: `${INVESTOR_NAMES[investor.id] || investor.name} 提交 13F`,
      body: joinBits([
        investor.reportDate ? `${investor.reportDate} 报告期` : "",
        top && top.ticker && number(top.weight) !== null
          ? `第一大持仓 ${top.ticker} ${number(top.weight).toFixed(1)}%`
          : "",
        fresh.length ? `新进 ${fresh.slice(0, 3).map((row) => row.ticker).join("/")}` : "",
        up.length ? `增持 ${up.length} 只` : "",
        down.length ? `减持 ${down.length} 只` : "",
        sold.length ? `清仓 ${sold.length} 只` : "",
      ]),
      sourceName: investor.source || "SEC EDGAR 13F",
      sourceUrl: investor.sourceUrl || sourceUrlOf(data, "sec"),
      market: "guru",
      targetId: linkId("guru", investor.id),
    });
  });

  // —— 黄金：两个口径的收盘价，以及 FRED/CFTC 的宏观指标更新 ——
  const gold = data.gold || {};
  const quotes = gold.quotes || {};
  const goldSourceUrl = (id) => {
    const local = (gold.sources || []).find((source) => source && source.id === id);
    return (local && local.url) || sourceUrlOf(data, id);
  };
  if (quotes.domestic && number(quotes.domestic.price) !== null) {
    const domestic = quotes.domestic;
    push({
      id: "news-gold-domestic",
      kind: "gold",
      day: toDay(domestic.asOf),
      title: `${domestic.name || "上海金"} 报 ${number(domestic.price)} ${domestic.currency || ""}`.trim(),
      body: joinBits([
        number(domestic.changePercent) !== null ? `较前值 ${signedPercent(domestic.changePercent)}` : "",
        number(domestic.percentile30) !== null ? `近30日分位 ${Math.round(number(domestic.percentile30))}%` : "",
      ]),
      sourceName: sourceNameOf(data, "gold-sge", "上海黄金交易所"),
      sourceUrl: goldSourceUrl("gold-sge"),
      market: "gold",
      targetId: linkId("gold", "track"),
    });
  }
  if (quotes.international && number(quotes.international.price) !== null) {
    const international = quotes.international;
    const returns = international.returns || {};
    push({
      id: "news-gold-international",
      kind: "gold",
      day: toDay(international.asOf),
      title: `${international.name || "国际金价"} 报 ${number(international.price)} ${international.currency || ""}`.trim(),
      body: joinBits([
        number(international.changePercent) !== null ? `较前值 ${signedPercent(international.changePercent)}` : "",
        number(returns.day20) !== null ? `20日 ${signedPercent(returns.day20, 1)}` : "",
        number(international.percentile180) !== null ? `近180日分位 ${Math.round(number(international.percentile180))}%` : "",
      ]),
      sourceName: sourceNameOf(data, "gold-yahoo", "公共行情"),
      sourceUrl: goldSourceUrl("gold-yahoo"),
      market: "gold",
      targetId: linkId("gold", "track"),
    });
  }
  (gold.indicators || []).forEach((indicator) => {
    if (!indicator || !indicator.label) return;
    const value = number(indicator.value);
    if (value === null) return;
    // 只有 CFTC 那条持仓指标来自 CFTC，其余宏观指标都是 FRED；
    // 上海金折算溢价是用上金所价格算出来的，出处跟着上金所走。
    const sourceId = indicator.id === "positioning"
      ? "gold-cftc"
      : (indicator.id === "domesticPremium" ? "gold-sge" : "gold-fred");
    push({
      id: `news-gold-${indicator.id}`,
      kind: "gold",
      day: toDay(indicator.asOf),
      title: `${indicator.label} 更新至 ${value}${indicator.unit || ""}`,
      body: joinBits([
        number(indicator.change20) !== null ? `20日变化 ${signedPercent(indicator.change20, 1)}` : "",
        indicator.note || "",
      ]),
      sourceName: sourceNameOf(data, sourceId, "公开宏观数据"),
      sourceUrl: goldSourceUrl(sourceId),
      market: "gold",
      targetId: linkId("gold", "track"),
    });
  });

  // —— A股：定期报告里的经营变化 ——
  const aShare = data.aShare || {};
  const aQuotes = new Map((aShare.quotes || []).map((quote) => [String(quote.code || ""), quote]));
  (aShare.fundamentals || []).forEach((row) => {
    if (!row || !row.reportDate) return;
    const code = String(row.code || "");
    const plainCode = code.replace(/\.(SH|SZ)$/i, "") || String(row.symbol || "");
    const quote = aQuotes.get(code) || {};
    const name = nameOf("a", plainCode, quote.name || plainCode);
    push({
      id: `news-a-${plainCode}`,
      kind: "a",
      day: toDay(row.reportDate),
      title: `${name} ${row.period || "定期报告"}`,
      body: joinBits([
        number(row.revenueGrowth) !== null ? `营收同比 ${signedPercent(row.revenueGrowth)}` : "",
        number(row.netProfitGrowth) !== null ? `净利同比 ${signedPercent(row.netProfitGrowth)}` : "",
        number(row.dividendYield) !== null ? `股息率 ${number(row.dividendYield).toFixed(2)}%` : "",
      ]),
      sourceName: row.source || sourceNameOf(data, "eastmoney-a-financial", "东方财富公开财务数据"),
      sourceUrl: sourceUrlOf(data, "eastmoney-a-financial"),
      market: "a",
      targetId: linkId("a", plainCode),
      // 报告期完全相同的 20 家挤在一起时，按变化幅度决定谁留下，
      // 而不是按名次或评分——这条流讲的是"变化"。
      weight: Math.abs(number(row.netProfitGrowth) || 0),
    });
  });

  // —— 美股：最新披露财季 ——
  const us = data.us || {};
  (us.fundamentals || []).forEach((row) => {
    if (!row || !row.symbol) return;
    const day = toDay(row.period);
    if (!day) return;
    push({
      id: `news-us-${row.symbol}`,
      kind: "us",
      day,
      title: `${nameOf("us", row.symbol, row.symbol)} 最新财季（截至 ${day}）`,
      body: joinBits([
        number(row.revenueGrowth) !== null ? `营收同比 ${signedPercent(row.revenueGrowth, 1)}` : "",
        number(row.grossMargin) !== null ? `毛利率 ${number(row.grossMargin).toFixed(1)}%` : "",
        number(row.profitMargin) !== null ? `净利率 ${number(row.profitMargin).toFixed(1)}%` : "",
        number(row.roe) !== null ? `ROE ${number(row.roe).toFixed(1)}%` : "",
      ]),
      sourceName: sourceNameOf(data, "nasdaq", "Nasdaq 公司财务数据"),
      sourceUrl: sourceUrlOf(data, "nasdaq"),
      market: "us",
      targetId: linkId("us", row.symbol),
    });
  });

  // 先在类内截断，再全局按日期倒序合并。
  const trimmed = [];
  Object.keys(MAX_PER_KIND).forEach((kind) => {
    const group = items
      .filter((item) => item.kind === kind)
      .sort((left, right) => {
        if (left.day !== right.day) return left.day < right.day ? 1 : -1;
        return (right.weight || 0) - (left.weight || 0);
      })
      .slice(0, MAX_PER_KIND[kind]);
    trimmed.push(...group);
  });

  const feed = trimmed
    .sort((left, right) => (left.day < right.day ? 1 : left.day > right.day ? -1 : 0))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      kindLabel: KIND_LABEL[item.kind] || "公开披露",
      date: item.day,
      dateLabel: dayLabel(item.day),
      title: item.title,
      body: item.body,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl || "",
      sourceAction: item.sourceUrl ? "复制链接" : "",
      market: item.market,
      targetId: item.targetId || "",
    }));

  const filters = [{ id: "all", label: "全部", count: feed.length }];
  Object.keys(KIND_LABEL).forEach((kind) => {
    const count = feed.filter((item) => item.kind === kind).length;
    if (count) filters.push({ id: kind, label: KIND_LABEL[kind], count });
  });

  return { items: feed, filters };
}

module.exports = { buildNewsFeed };
