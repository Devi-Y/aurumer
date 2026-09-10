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

const { allItems, INVESTOR_NAMES, US_NAMES, shortCompanyName } = require("./answers");
// SEC 备案是这份快照里唯一「按天发生」的美股事实：财季报告期动辄隔半年，
// 只有它能回答「这一周美股这边出了什么事」。取用写法和详情页/每日答案共用一份。
const { hasFilingFeed, filingsBySymbol } = require("./us-filings");
// 官方出处登记表已抬到 utils/sources.js 共用，五个功能模块的详情页现在
// 和这一页用同一份地址，不会出现"新闻页能核验、详情页核验不了"。
const { sourceUrlOf, sourceNameOf } = require("./sources");
// 日期归一化也抬到了 utils/dates.js 共用，详情页现在和这一页认同一套写法。
const { pad2, toDay } = require("./dates");

const KIND_LABEL = {
  hk: "港股新股",
  guru: "机构披露",
  gold: "黄金",
  a: "A股",
  us: "美股",
};

// 点一行会去哪儿，得写在行上。这一页是引流工具，读者不该靠猜才知道
// 「看完这条能到哪里去看结论」——所以每行末尾写清落点，有标的写标的，
// 没有标的（这家公司不在样本池里）就写它所属的栏目，和 openItem 的
// 两条分支一一对应，不会点了才发现去的是别处。
const MODULE_LABEL = {
  hk: "港股打新",
  guru: "机构持仓",
  gold: "黄金追踪",
  a: "A股收息",
  us: "美股投资",
};

// 每类的条数上限。A股 20 份年报报告期完全相同，美股财季也高度重复，
// 不设上限的话整条流会被这两类淹掉，港交所和 13F 反而看不见。
//
// 美股占两个额度：财季（us）和 SEC 公告（us-filing）在页面上同属「美股」筛选，
// 但公告全是近 30 天、财季全是半年前，放同一个额度里按日期排，公告会把财季
// 整类挤掉。分开计数，两种事实各留一半版面。
const MAX_PER_KIND = { hk: 8, guru: 9, gold: 5, a: 6, us: 6, "us-filing": 6 };

// null / undefined / 空串必须当成「没有这个数」返回 null，不能落进 Number()——
// Number(null) 是 0 且有限，会把「五日涨跌未公布」渲染成「五日 0.00%」，
// 那就是拿假数据填版面，违反数据可信优先于页面完整这条红线。
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

// —— 「落到标的」这一行印什么 ——
//
// 这一页是引流工具：读者是为了看发生了什么事进来的，但看完得能回到「那这只票
// 现在是什么结论」，否则这一页和市场就断开了。所以每条披露后面那一行只印
// **结论**，而且用五个栏目页里同一套说法，读者点进去看到的话是对得上的。
//
// 反过来说，不在下面这几张表里的东西一律不印。原来这一行会印出「性价比 63」
// 「行业 56」「已结束」「收息样本」这类内部档位分和分组名——读者拿它做不了
// 任何判断，等于白占一格，还把真正的结论挤掉了。宁可这一行空着。

// 按透镜（一只票可以同时进好几个透镜）给出的结论。
// 同一只票可以同时进好几个透镜，表里靠前的先说：谷歌同时在「低估」和
// 「长期观察」里，只印「低估」才是结论，两个都印就成了自相矛盾的一行。
const LENS_CONCLUSION = {
  us: [
    ["cheap7", "低估，在可买入的一侧"],
    ["risk7", "风险升高，在要减的一侧"],
    ["hold7", "七姐妹，暂不在买卖两侧"],
    ["seven", "七姐妹，暂不在买卖两侧"],
  ],
  a: [
    ["add", "已到加大观察价"],
    ["trim", "已到兑现观察价"],
  ],
};

// 带名次的榜单：第 1 和第 5 不是一回事，名次本身就是结论的一部分。
const LENS_RANKED = {
  a: { stable5: "分红稳定性前五第", yield5: "分红收益性前五第" },
};

// 徽章里本来就是结论的那几个，原样留用；其余（分数、状态词）不留。
const CONCLUSION_BADGES = {
  hk: new Set(["值得打", "暂缓观察", "暂不建议", "发行已取消"]),
  a: new Set(["优等收息", "稳健收息", "高息待核"]),
  // 美股不列徽章：七姐妹那七只的徽章就是「七姐妹」，而上面的透镜表已经
  // 把这七只全覆盖了，再印一次只会变成「低估，在可买入的一侧 · 七姐妹」。
  gold: new Set(["继续观察"]),
};

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
      // allItems() 对同一只票会按透镜返回好几条：英伟达在「七姐妹」里一条、
      // 在「性价比观察」里又一条。原来这里 new Map(list.map(...)) 是后写覆盖，
      // 留下的永远是最后一条——而最后追加的恰好是性价比/行业这两个内部打分，
      // 所以英伟达的结论印成了「性价比 63」、甲骨文印成了「行业 56」。
      // 改成同一个 id 的条目全收进一个数组，结论由 impactOf 按优先级挑。
      const map = new Map();
      list.forEach((item) => {
        const key = String(item.id || "").toUpperCase();
        if (!key) return;
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
      });
      indexCache[market] = map;
    }
    return indexCache[market];
  };
  const entriesOf = (market, id) => indexOf(market).get(String(id || "").toUpperCase()) || [];
  const hit = (market, id) => entriesOf(market, id)[0] || null;
  const linkId = (market, id) => (hit(market, id) ? String(id) : "");
  const nameOf = (market, id, fallback) => {
    const found = hit(market, id);
    if (found && found.name) return found.name;
    // 美股公告和财季涵盖的公司比分组多（Salesforce、博通、Coinbase 都发了公告
    // 却没进任何分组），allItems 里找不到就退到 answers.js 那张同一份名字表，
    // 而不是把 CRM、AVGO 这种代码直接印在中文资讯流里。
    if (market === "us") {
      const code = String(id || "").toUpperCase();
      if (US_NAMES[code]) return US_NAMES[code];
    }
    return fallback;
  };

  // 港股已结束那批的结论不是「已结束」这个状态，而是它在历史样本里排第几——
  // 那正是「打中后卖多少合适」这一问的依据。分母要真实，所以数一遍。
  let hkEndedTotal = null;
  const endedTotal = () => {
    if (hkEndedTotal === null) {
      let count = 0;
      indexOf("hk").forEach((bucket) => {
        if (bucket.some((entry) => entry.group === "ended")) count += 1;
      });
      hkEndedTotal = count;
    }
    return hkEndedTotal;
  };

  // 见上面 LENS_CONCLUSION 一段的说明：只印结论，不印内部档位分。
  const impactOf = (market, id) => {
    const entries = entriesOf(market, id);
    if (!entries.length) return "";
    const lensTable = LENS_CONCLUSION[market] || [];
    const rankTable = LENS_RANKED[market] || {};
    const okBadges = CONCLUSION_BADGES[market] || new Set();
    const bits = [];
    const add = (text) => {
      if (text && !bits.includes(text)) bits.push(text);
    };
    // 透镜要跨条目合起来看：allItems() 把同一只票拆成了好几条，
    // 逐条判断会让「低估」和「长期观察」各自成立，印出自相矛盾的两段。
    const lenses = new Set();
    const ranks = {};
    entries.forEach((entry) => {
      (entry.lenses || []).forEach((lens) => lenses.add(lens));
      Object.keys(entry.lensRank || {}).forEach((lens) => {
        if (!ranks[lens]) ranks[lens] = entry.lensRank[lens];
      });
    });

    entries.forEach((entry) => {
      const badge = String(entry.badge || "");
      // 港股：在售那几只的徽章就是结论本身。「资料不够」也是结论，只是话没说完，
      // 补成一句完整的——读者要知道这是「我们不给结论」，不是「这只票不好」。
      if (market === "hk") {
        if (badge === "资料不够") add("资料不够，暂不给结论");
        else if (okBadges.has(badge)) add(badge);
        if (entry.group === "ended") {
          // 刚挂牌的那几只还没有首日/暗盘数据，排不进样本名次。这时说
          // 「结果待披露」而不是留白：读者看到的是一条「XX 新上市公告」，
          // 得知道我们还答不上「卖多少合适」，不是忘了写。
          add(entry.rank ? `历史样本第 ${entry.rank}/${endedTotal()}` : "已挂牌，结果待披露");
        }
        return;
      }
      // 机构：这边没有透镜，徽章是长期业绩。裸写「19.7% 年化」读者不知道
      // 这个数是谁的、算的是什么，补上主语。
      if (market === "guru") {
        if (/年化/.test(badge)) add(`长期业绩 ${badge}`);
        return;
      }
      // 美股热度榜的名次只写在徽章上，没有对应的 lensRank。
      const heat = market === "us" && badge.match(/^热度第\s*(\d+)$/);
      if (heat) add(`近期热度第 ${heat[1]}`);
      if (okBadges.has(badge)) add(badge);
    });

    // 榜单名次先说（第 1 和第 5 不是一回事），再说所属档位。
    Object.keys(rankTable).forEach((lens) => {
      if (ranks[lens]) add(`${rankTable[lens]} ${ranks[lens]}`);
    });
    // 透镜结论只取表里最靠前命中的那一个。
    const lensHit = lensTable.find(([lens]) => lenses.has(lens));
    if (lensHit) add(lensHit[1]);

    // 截到两段——这一行是回到市场的指路牌，不是标签墙。
    return joinBits(bits.slice(0, 2));
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
    const fromUrl = dayFromHkexUrl(url);
    const day = fromUrl || toDay(listing.listingDate);
    const extraction = listing.announcementExtraction || {};
    push({
      id: `news-hk-${listing.id || listing.rawCode}`,
      kind: "hk",
      day,
      // 快照里存的是工商全称（「优地机器人（无锡）股份有限公司」），
      // 全站其它地方印的都是简称。这一行是标题，位置比首页四格宽，给到 12 字。
      title: `${shortCompanyName(listing.name, listing.name, 12)} · 港交所新上市公告`,
      // 这一条的日期可能来自公告 PDF 的路径（真·公告日），也可能退回挂牌日，
      // 两者含义不同，所以标签跟着来源走，不要笼统写成"日期"。
      dateNote: fromUrl ? "公告日" : "挂牌日",
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
      title: `${shortCompanyName(entry.name, entry.name, 12)} 已挂牌上市`,
      dateNote: "挂牌日",
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
      // filingDate 是递交日，不是持仓截止日（那个是 reportDate，写在正文里）。
      dateNote: "披露日",
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
      dateNote: "行情日",
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
      dateNote: "行情日",
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
      dateNote: "数据日",
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
      // 快照只给了报告期，没给公告披露日。年报的报告期是 12-31，离读者看到它
      // 的时间可能隔了大半年——不标清楚就会被当成"刚发生的事"。
      dateNote: "报告期",
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
      dateNote: "报告期",
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

  // —— 美股：SEC EDGAR 备案 ——
  // 快照里一条公告都没有和「这些公司这个月没发公告」是两回事，前者不能渲染成
  // 后者，所以整块以 hasFilingFeed 为前提；拿不到就这一类不出现。
  if (hasFilingFeed(data)) {
    filingsBySymbol(data).forEach((filings, symbol) => {
      // 同一家连发三份（Strategy 就常这样连发 Reg FD）时只上最新一份：
      // 三行同名会把这一类变成一家公司的公告墙，其余十几家全被挤出去。
      // 剩下几份不丢，写在正文里，读者知道还有几份可以去原文翻。
      const latest = filings[0];
      if (!latest || !latest.filingDate) return;
      const label = (Array.isArray(latest.labels) && latest.labels[0]) || latest.form || "";
      if (!label) return;
      push({
        id: `news-us-filing-${symbol}-${latest.filingDate}`,
        kind: "us",
        quota: "us-filing",
        day: toDay(latest.filingDate),
        title: `${nameOf("us", symbol, symbol)} · ${label}`,
        // filingDate 是发行人递交给 SEC 的日子，不是事件发生的日子，也不是
        // 我们抓到它的日子——这三个不是一回事，标签跟着字段本身走。
        dateNote: "备案日",
        body: joinBits([
          `SEC ${latest.form || "备案"}`,
          filings.length > 1 ? `近 30 天另有 ${filings.length - 1} 份` : "",
        ]),
        sourceName: "SEC EDGAR",
        sourceUrl: latest.sourceUrl || sourceUrlOf(data, "sec"),
        market: "us",
        targetId: linkId("us", symbol),
      });
    });
  }

  // 先在类内截断，再全局按日期倒序合并。
  const trimmed = [];
  Object.keys(MAX_PER_KIND).forEach((key) => {
    const group = items
      .filter((item) => (item.quota || item.kind) === key)
      .sort((left, right) => {
        if (left.day !== right.day) return left.day < right.day ? 1 : -1;
        return (right.weight || 0) - (left.weight || 0);
      })
      .slice(0, MAX_PER_KIND[key]);
    trimmed.push(...group);
  });

  const feed = trimmed
    .sort((left, right) => (left.day < right.day ? 1 : left.day > right.day ? -1 : 0))
    .map((item) => ({
      id: item.id,
      key: `${item.id}@${item.day}`,
      kind: item.kind,
      kindLabel: KIND_LABEL[item.kind] || "公开披露",
      date: item.day,
      dateLabel: dayLabel(item.day),
      dateNote: item.dateNote || "",
      title: item.title,
      body: item.body,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl || "",
      sourceAction: item.sourceUrl ? "复制链接" : "",
      market: item.market,
      targetId: item.targetId || "",
      impact: item.targetId ? impactOf(item.market, item.targetId) : "",
      // 标的名不写在这里：行首的标题已经写着了，再塞一遍还得截断
      // （「深圳麦科田生物医疗技术」怎么截都不好看）。这一行只回答去哪一层。
      // 黄金那几条挂的是「现在怎么做」这张结论卡，不是某一只标的，
      // 写「看标的详情」会让人以为点进去有只票。
      routeLabel: item.market === "gold"
        ? "看黄金结论"
        : (item.targetId ? "看标的详情" : `去${MODULE_LABEL[item.market] || "栏目"}`),
    }));

  // 黄金那类里五条披露全指向同一个标的，「落到标的」会连着印五遍同一句话——
  // 那时它已经不是指路牌而是一句水印。同一类下所有结论都一样时整类去掉这一行，
  // 结论本身在黄金栏目页里说得更全。
  const impactSeen = {};
  feed.forEach((item) => {
    if (!item.impact) return;
    const seen = impactSeen[item.market] || (impactSeen[item.market] = new Set());
    seen.add(item.impact);
  });
  feed.forEach((item) => {
    const seen = impactSeen[item.market];
    if (seen && seen.size === 1) item.impact = "";
  });

  const filters = [{ id: "all", label: "全部", count: feed.length }];
  Object.keys(KIND_LABEL).forEach((kind) => {
    const count = feed.filter((item) => item.kind === kind).length;
    if (count) filters.push({ id: kind, label: KIND_LABEL[kind], count });
  });

  return { items: feed, filters };
}

// 把已经按时间倒序排好的流切成「最近 7 天 / 最近 30 天 / 更早」三段。
//
// 为什么按真实当前时间切、而不是按快照的 updatedAt 切：读者问的是"这事离我
// 多久"，不是"这事离这份快照多久"。快照要是停更了 40 天，那所有条目本来就
// 都不该叫"最近 7 天"——页头的数据截至那一行会说明原因，这里不该替它圆场。
//
// 分段只是给日期一个参照，不改变顺序，也不增删任何条目。
const AGE_BUCKETS = [
  { id: "d7", title: "最近 7 天", maxDays: 7 },
  { id: "d30", title: "最近 30 天", maxDays: 30 },
  { id: "old", title: "更早的披露", maxDays: Infinity },
];

function groupFeedByAge(items, now) {
  const base = now instanceof Date ? now : new Date(now || Date.now());
  const todayUtc = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  const sections = [];
  (items || []).forEach((item) => {
    const parts = String(item.date || "").split("-");
    // 日期解析不出来的条目本来就进不了 feed（push 会拦掉），这里再兜一次底：
    // 与其猜一个分段，不如放到"更早"，不会假装它很新。
    const stamp = parts.length === 3
      ? Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      : NaN;
    const days = Number.isFinite(stamp) ? Math.round((todayUtc - stamp) / 86400000) : Infinity;
    const bucket = AGE_BUCKETS.find((entry) => days <= entry.maxDays) || AGE_BUCKETS[AGE_BUCKETS.length - 1];
    const last = sections[sections.length - 1];
    if (last && last.id === bucket.id) {
      last.rows.push(item);
      return;
    }
    sections.push({ id: bucket.id, title: bucket.title, rows: [item] });
  });
  return sections.map((section) => ({ ...section, count: section.rows.length }));
}

module.exports = { buildNewsFeed, groupFeedByAge };
