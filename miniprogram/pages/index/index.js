const { loadSnapshot, snapshotVersionKey } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { MAGNIFICENT_SEVEN } = require("../../utils/market-lenses");
const { allItems, usPoolItems } = require("../../utils/answers");
const OFFERS = require("../../config/offers");
const SERVICE_LINKS = require("../../config/services");
const { asOfText } = require("../../utils/dates");
const { openPage } = require("../../utils/nav");
const { toneOf, sampleSeries } = require("../../utils/sparkline");
const { searchIconSvg, cleanSparkSvg, ipoTrackSvg } = require("../../utils/svg-charts");
const { listQuickStars } = require("../../utils/quick-stars");

const SERVICES = SERVICE_LINKS.filter((entry) => OFFERS.some((offer) =>
  entry.offerIds.includes(offer.id) && (offer.copy || offer.image || offer.pending)));
const SHORT_MKT = {
  hk: "港",
  us: "美",
  a: "A",
};

const MARKET_TAG = {
  hk: "港股",
  us: "美股",
  a: "A股",
  gold: "黄金",
  guru: "机构",
};

// 九宫格的前五格是这五个研究栏目，照微信「服务」页的分组图标网格：只有图标和名字，
// 没有副标题也没有箭头。help 不再上屏，但留着当读屏标签用。
const CORE_ENTRIES = [
  {
    id: "hk",
    market: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "招股资料和上市首日涨跌",
  },
  {
    id: "us",
    market: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七家大公司和热门股票",
  },
  {
    id: "a",
    market: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "分红稳定性和历史股息率",
  },
  {
    id: "gold",
    market: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "金价·历史走势·对照",
  },
  {
    id: "guru",
    market: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "聪明钱跟踪",
    help: "持仓·动向·趋势",
  },
];

// 用户指定九格：五个免费研究栏目 + 四个服务入口。
const GRID_ENTRIES = [
  ...CORE_ENTRIES.map((item) => ({ ...item })),
  ...SERVICES.map((item) => ({ ...item, action: "page" })),
];

function signedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function positivePrice(raw) {
  return (typeof raw === "number" || typeof raw === "string") && Number.isFinite(Number(raw)) && Number(raw) > 0
    ? Number(raw) : null;
}

const SEARCH_ALIASES = {
  "600036": "招行",
  "601398": "工行 宇宙行",
  "601939": "建行",
  "601288": "农行",
  "601988": "中行",
  "601328": "交行",
  "600000": "浦发",
  "601166": "兴业",
  "600900": "长电 水电",
  "601088": "神华 煤炭",
  "600938": "海油 中海油",
  "600941": "移动 中移动",
  "600028": "石化 中石化",
  "601857": "石油 中石油",
  "601006": "大秦",
  "515180": "红利etf 中证红利 etf",
  GOOGL: "google 谷歌 alphabet",
  META: "facebook fb 脸书",
  AAPL: "iphone 苹果",
  MSFT: "microsoft 微软",
  NVDA: "nvidia 英伟达 老黄",
  AMZN: "amazon 亚马逊",
  TSLA: "tesla 特斯拉 马斯克",
  TSM: "tsmc 台积电",
};

// 借鉴 DeepSeek / 集思录极速本地索引：涵盖 5 大市场全部标的，去重并支持口语简称与大佬持仓反查。
function buildSearchIndex(snapshot) {
  const rows = [];
  const seen = new Set();
  const pushItem = (market, item) => {
    if (!item || !item.id) return;
    if (market === "guru" && item.group === "overlap") return;
    const normId = market === "a"
      ? String(item.id || "").replace(/\.(SH|SZ)$/i, "").toUpperCase()
      : (market === "hk" ? String(item.id || "").replace(/\.HK$/i, "").toUpperCase() : String(item.id || ""));
    const key = `${market}:${normId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const raw = item.raw || {};
    const name = String(item.name || "");
    let code = String(item.code || "");
    if (market === "a" && code && !/\.(SH|SZ)$/i.test(code)) {
      code = /^6|^5/.test(code) ? `${code}.SH` : `${code}.SZ`;
    } else if (market === "guru" && !code && raw.profile && raw.profile.org) {
      code = String(raw.profile.org);
    }
    let figure = "";
    if (market === "us" && Number.isFinite(Number(raw.price))) figure = `$${Number(raw.price).toFixed(2)}`;
    else if (market === "a" && Number.isFinite(Number(raw.currentPrice))) {
      figure = raw.assetType === "fund" ? `¥${Number(raw.currentPrice).toFixed(3)}` : `¥${Number(raw.currentPrice).toFixed(2)}`;
    } else if (market === "hk" && item.badge) figure = String(item.badge);
    else if (market === "guru" && raw.reportDate) figure = String(raw.reportDate).slice(0, 10);
    const alias = SEARCH_ALIASES[normId.toUpperCase()] || "";
    const holdingNames = market === "guru" && Array.isArray(raw.holdings)
      ? raw.holdings.slice(0, 10).map((h) => ({
          short: String(h.shortName || h.ticker || "").trim(),
          hay: `${h.shortName || ""} ${h.ticker || ""} ${h.name || ""}`.toLowerCase(),
        })).filter((h) => h.short)
      : [];
    const holdingHay = holdingNames.map((h) => h.hay).join(" ");
    rows.push({
      key,
      market,
      marketTag: MARKET_TAG[market] || "资料",
      id: market === "a" ? normId : item.id,
      name,
      code,
      figure,
      holdingNames,
      primaryHay: `${name} ${code} ${alias}`.toLowerCase(),
      haystack: `${name} ${code} ${alias} ${holdingHay} ${MARKET_TAG[market] || ""}`.toLowerCase(),
    });
  };
  for (const item of usPoolItems(snapshot)) pushItem("us", item);
  for (const market of ["a", "hk", "guru", "gold"]) {
    for (const item of allItems(snapshot, market)) pushItem(market, item);
  }
  for (const quote of (snapshot && snapshot.aShare && snapshot.aShare.quotes) || []) {
    if (quote && quote.code && quote.name) {
      pushItem("a", { id: quote.code, name: quote.name, code: quote.code, raw: quote });
    }
  }
  return rows;
}

function shortHotLabel(rawName) {
  let text = String(rawName || "").trim();
  if (!text) return "";
  text = text
    .replace(/集团股份有限公司|集团控股有限公司|股份有限公司|有限责任公司|控股有限公司|集团|有限公司/gu, "")
    .replace(/\s*-\s*(B|W|SW|S|A)$/iu, "")
    .replace(/^(赣州|常州|镇江|江苏|深圳|北京|上海|广东|浙江|杭州|苏州)/u, "")
    .replace(/^易方达中证/u, "")
    .trim();
  if (text.length > 4 && /新材料|半导体|科技|资讯|文化旅游/u.test(text)) {
    text = text.replace(/(新材料|科技|资讯|文化旅游)$/u, "").trim();
  }
  return text.length > 4 ? text.slice(0, 4) : text;
}

function hotSparkFor(market, item) {
  const raw = (item && item.raw) || {};
  if (market === "hk") {
    const rev = raw.historicalReview || {};
    const stepIndex = item.group === "settled" ? 2 : (Number.isFinite(Number(rev.firstDayChange)) ? 3 : 0);
    const csPct = Number(raw.cornerstonePercent);
    const lockPercent = Number.isFinite(csPct) && csPct > 0 ? csPct : 32;
    return {
      sparkSrc: ipoTrackSvg({ stepIndex, lockPercent, width: 196, height: 56 }),
    };
  }
  const closesAll = (Array.isArray(raw.history) ? raw.history : [])
    .map((entry) => positivePrice(entry && entry.close != null ? entry.close : entry))
    .filter((v) => v != null);
  const closes = closesAll.slice(-30);
  if (closes.length < 6) return { sparkSrc: "" };
  return {
    sparkSrc: cleanSparkSvg(sampleSeries(closes, 26), { width: 196, height: 56 }),
  };
}

// 自动从最新快照拉取美、港、A 三地高热度代表股票（含走势小图与最新价），零滚动铺满展示。
function buildHotPicks(snapshot) {
  const usPool = usPoolItems(snapshot);
  const hkPool = allItems(snapshot, "hk");
  const aPool = allItems(snapshot, "a").filter((item) => (item.raw && item.raw.assetType) !== "fund");

  const itemMap = new Map();
  for (const item of usPool) itemMap.set(`us:${item.id}`, { market: "us", item });
  for (const item of hkPool) itemMap.set(`hk:${item.id}`, { market: "hk", item });
  for (const item of aPool) itemMap.set(`a:${item.id}`, { market: "a", item });

  const usCandidates = usPool
    .map((item) => {
      const symbol = String(item.id || item.code || "");
      const heat = Number(item.raw && item.raw.heatScore) || 0;
      const bonus = symbol === "NVDA" ? 36 : (symbol === "TSLA" ? 22 : (MAGNIFICENT_SEVEN.includes(symbol) ? 10 : 0));
      return { key: `us:${item.id}`, score: heat + bonus };
    })
    .sort((a, b) => b.score - a.score);

  const hkCandidates = hkPool
    .filter((item) => String(item.badge || "") !== "发行已取消")
    .map((item, idx) => {
      const raw = item.raw || {};
      const liveScore = item.badge === "值得打" ? 120 : (raw.isLive ? 85 : 0);
      const starScore = /希音|商米|中际旭创|梅卡曼德/u.test(String(item.name || "")) ? 70 : 0;
      const csScore = Number(raw.cornerstonePercent) || 0;
      return { key: `hk:${item.id}`, score: liveScore + starScore + csScore - idx * 0.5 };
    })
    .sort((a, b) => b.score - a.score);

  const aCandidates = aPool
    .map((item, idx) => {
      const raw = item.raw || {};
      const move = Math.abs(Number(raw.changePercent) || 0) * 6;
      const div = Number(raw.currentDividendYield || (raw.historicalDividendYield && raw.historicalDividendYield.yieldPercent)) || 0;
      const flagship = /^(600900|600036|600941|601088|000333)/.test(String(item.id || "")) ? 18 : 0;
      return { key: `a:${item.id}`, score: flagship + div * 2 + move - idx * 0.3 };
    })
    .sort((a, b) => b.score - a.score);

  const interleaved = [
    usCandidates[0] && usCandidates[0].key,
    aCandidates[0] && aCandidates[0].key,
    hkCandidates[0] && hkCandidates[0].key,
    "us:NVDA",
    "a:600900",
    "us:TSLA",
    "a:600036",
  ].filter(Boolean);

  const formatHotCode = (market, code, id) => {
    const rawCode = String(code || id || "").trim();
    if (!rawCode) return "";
    if (market === "hk") return rawCode.replace(/\.HK$/i, "").toUpperCase();
    if (market === "a") return rawCode.replace(/\.(SH|SZ)$/i, "").toUpperCase();
    return rawCode.toUpperCase();
  };

  const formatHotFigure = (market, item) => {
    const raw = item.raw || {};
    if (market === "us" && positivePrice(raw.price) != null) return `$${Number(raw.price).toFixed(2)}`;
    if (market === "a" && positivePrice(raw.currentPrice) != null) return `¥${Number(raw.currentPrice).toFixed(2)}`;
    if (market === "hk") {
      const match = String(raw.offerPrice || "").match(/\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?/);
      if (match) {
        const numText = match[0].replace(/\s+/g, "");
        return /^\d+$/.test(numText) ? `HK$${Number(numText).toFixed(2)}` : `HK$${numText}`;
      }
      return item.badge || "新股";
    }
    return "";
  };

  const formatHotDelta = (market, item) => {
    const raw = item.raw || {};
    if (market === "us") {
      const ch = Number(raw.changePercent);
      return Number.isFinite(ch) ? { deltaText: `单日 ${signedPct(ch, 1)}`, deltaTone: toneOf(ch) } : { deltaText: "美股龙头", deltaTone: "info" };
    }
    if (market === "a") {
      const yld = Number(raw.historicalDividendYield && raw.historicalDividendYield.yieldPercent);
      if (Number.isFinite(yld) && yld > 0) {
        return { deltaText: `股息 ${yld.toFixed(1)}%`, deltaTone: "info" };
      }
      const ch = Number(raw.changePercent);
      return Number.isFinite(ch) ? { deltaText: `单日 ${signedPct(ch, 1)}`, deltaTone: toneOf(ch) } : { deltaText: "稳分红", deltaTone: "info" };
    }
    if (market === "hk") {
      const rev = raw.historicalReview || {};
      const fd = Number(rev.firstDayChange);
      if (Number.isFinite(fd)) return { deltaText: `首日 ${signedPct(fd, 0)}`, deltaTone: toneOf(fd) };
      const deadline = String(raw.offerDeadline || raw.offerEnd || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (deadline) {
        const target = new Date(Number(deadline[1]), Number(deadline[2]) - 1, Number(deadline[3]));
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((target.getTime() - start.getTime()) / 86400000);
        if (diff >= 0) return { deltaText: diff === 0 ? "今日截止" : `招股剩${diff}天`, deltaTone: "info" };
      }
      const fee = Number(raw.entryFee);
      if (Number.isFinite(fee) && fee > 0) return { deltaText: `一手$${Math.round(fee)}`, deltaTone: "info" };
      return { deltaText: "新股关注", deltaTone: "info" };
    }
    return { deltaText: "", deltaTone: "flat" };
  };

  const picks = [];
  const used = new Set();
  for (const key of interleaved) {
    if (used.has(key)) continue;
    const hit = itemMap.get(key);
    if (!hit) continue;
    const { market, item } = hit;
    const label = shortHotLabel(item.name);
    if (!label) continue;
    used.add(key);
    const { sparkSrc } = hotSparkFor(market, item);
    const { deltaText, deltaTone } = formatHotDelta(market, item);
    picks.push({
      key,
      market,
      marketTag: SHORT_MKT[market] || MARKET_TAG[market] || "",
      id: item.id,
      label,
      code: formatHotCode(market, item.code, item.id),
      figure: formatHotFigure(market, item),
      deltaText,
      deltaTone,
      sparkSrc,
    });
    if (picks.length >= 3) break;
  }
  return picks;
}

Page({
  data: {
    entries: GRID_ENTRIES,
    searchIconSrc: searchIconSvg("#1d5fd1"),
    searchQuery: "",
    searchFocused: false,
    searchResults: [],
    hotPicks: [],
    starPicks: [],
    dataAsOf: "",
    freshnessKind: "offline",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    trackHomeVisit();
    this._snapshot = null;
    this._searchIndex = null;
    this._trendsDataKey = "";
    this._loadedOnce = true;
    this.syncStarPicks();
    this.refreshAnswers();
  },
  onShow() {
    this.syncStarPicks();
    if (this._loadedOnce) {
      this._loadedOnce = false;
      return;
    }
    this.refreshAnswers();
  },
  syncStarPicks() {
    const stars = listQuickStars().slice(0, 6).map((item) => ({
      key: item.key,
      market: item.market,
      id: item.id,
      label: item.name.length > 6 ? item.name.slice(0, 6) : item.name,
    }));
    if (JSON.stringify(stars) !== JSON.stringify(this.data.starPicks)) {
      this.setData({ starPicks: stars });
    }
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const dataKey = snapshotVersionKey(data, "");
        const nextAsOf = this.formatAsOf(data.updatedAt, kind);
        this._snapshot = data;
        const patch = {};
        if (nextAsOf !== this.data.dataAsOf) patch.dataAsOf = nextAsOf;
        if (kind !== this.data.freshnessKind) patch.freshnessKind = kind;
        if (force || !this._trendsDataKey || dataKey !== this._trendsDataKey) {
          this._trendsDataKey = dataKey;
          this._searchIndex = null;
          patch.hotPicks = buildHotPicks(data);
        }
        if (Object.keys(patch).length) this.setData(patch);
      },
      done,
      { force },
    );
  },
  onSearchFocus() {
    if (!this._searchIndex && this._snapshot) {
      this._searchIndex = buildSearchIndex(this._snapshot);
    }
    this.setData({ searchFocused: true });
  },
  onSearchInput(event) {
    const query = String((event.detail && event.detail.value) || "").trim();
    if (!query) {
      this.setData({ searchQuery: "", searchResults: [] });
      return;
    }
    if (!this._searchIndex && this._snapshot) {
      this._searchIndex = buildSearchIndex(this._snapshot);
    }
    const q = query.toLowerCase();
    const matches = (this._searchIndex || [])
      .filter((row) => row.haystack.includes(q))
      .sort((a, b) => Number(b.primaryHay.includes(q)) - Number(a.primaryHay.includes(q)))
      .slice(0, 8)
      .map((row) => {
        if (row.market === "guru" && !row.primaryHay.includes(q) && row.holdingNames.length) {
          const hit = row.holdingNames.find((h) => h.hay.includes(q));
          if (hit) return { ...row, figure: `重仓 ${hit.short}` };
        }
        return row;
      });
    this.setData({ searchQuery: query, searchResults: matches });
  },
  clearSearch() {
    this.setData({ searchQuery: "", searchResults: [], searchFocused: false });
  },
  openSearchResult(event) {
    const { market, id } = event.currentTarget.dataset;
    if (!market || !id) return;
    track("detail_open", { market: String(market), from: "home_search" });
    this.setData({ searchQuery: "", searchResults: [], searchFocused: false });
    wx.navigateTo({ url: `/pages/detail/index?market=${encodeURIComponent(market)}&id=${encodeURIComponent(id)}` });
  },
  formatTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
  formatAsOf(value, kind = "aging") {
    return asOfText(value, kind);
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "page") {
      track("path_open", { path: String(entry.id), from: "grid" });
      openPage(entry.url);
      return;
    }
    if (entry.action === "section") {
      track("section_open", { market: String(entry.id), from: "grid" });
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
      return;
    }
  },
  openLegal() {
    openPage("/pages/legal/index");
  },
  onShareAppMessage() {
    track("share_tap", { page: "home" });
    return {
      title: "望潮 Aurum｜港美A股与黄金走势",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜港美A股与黄金走势" };
  },
});
