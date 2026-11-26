const { loadSnapshot, snapshotVersionKey } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { MAGNIFICENT_SEVEN } = require("../../utils/market-lenses");
const { allItems, usPoolItems } = require("../../utils/answers");
const OFFERS = require("../../config/offers");
const SERVICE_LINKS = require("../../config/services");
const { asOfText } = require("../../utils/dates");
const { referenceDateText } = require("../../utils/historical-reference");
const { openPage } = require("../../utils/nav");
const { toneOf, sampleSeries, sparklineSvg, zeroAxisBars } = require("../../utils/sparkline");
const { hkFirstDaySeries } = require("../../utils/hk-history-stats");
const { historicalGoldRows } = require("../../utils/gold-series");
const { listQuickStars } = require("../../utils/quick-stars");

const SERVICES = SERVICE_LINKS.filter((entry) => OFFERS.some((offer) =>
  entry.offerIds.includes(offer.id) && (offer.copy || offer.image || offer.pending)));
const DIVIDEND_FUND_ID = "515180";

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
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "招股资料和上市首日涨跌",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七家大公司和热门股票",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "分红稳定性和历史股息率",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "金价·历史走势·对照",
  },
  {
    id: "guru",
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

// ---------- 首页走势卡 + 韭圈儿综合温度计：100% 基于真实快照序列计算 ----------

function signedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function positivePrice(raw) {
  return (typeof raw === "number" || typeof raw === "string") && Number.isFinite(Number(raw)) && Number(raw) > 0
    ? Number(raw) : null;
}

function lineMood(values, change) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const last = values[values.length - 1];
  const pos = high > low ? (last - low) / (high - low) : 0.5;
  const temp = Math.max(5, Math.min(95, Math.round(pos * 100)));
  if (pos >= 0.8) return { mood: "靠近区间高位", moodTone: "warn", tempScore: temp };
  if (pos <= 0.2) return { mood: "靠近区间低位", moodTone: "cool", tempScore: temp };
  if (change >= 4) return { mood: "区间走强", moodTone: "up", tempScore: temp };
  if (change <= -4) return { mood: "区间回落", moodTone: "down", tempScore: temp };
  return { mood: "区间震荡", moodTone: "flat", tempScore: temp };
}

function lineTrend({ id, market, title, history, digits, prefix, detailId = "" }) {
  const closesByDate = new Map();
  for (const row of history || []) {
    const date = String(row?.date || "");
    const time = Date.parse(`${date}T00:00:00Z`);
    const close = positivePrice(row?.close);
    if (close !== null && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date) {
      closesByDate.set(date, close);
    }
  }
  const dates = [...closesByDate.keys()].sort();
  if (dates.length < 10) return null;
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const endLabel = firstDate.slice(0, 4) === lastDate.slice(0, 4) ? lastDate.slice(5) : lastDate;
  const values = dates.map((date) => closesByDate.get(date));
  const lastClose = values[values.length - 1];
  const change = (lastClose / values[0] - 1) * 100;
  return {
    id,
    market,
    title,
    detailId,
    kind: "line",
    asOf: `${firstDate}—${endLabel}`,
    value: `${prefix}${lastClose.toFixed(digits)}`,
    sub: signedPct(change),
    tone: toneOf(change),
    ...lineMood(values, change),
    src: sparklineSvg(sampleSeries(values), { width: 300, height: 104 }),
  };
}

function buildHomeTrends(snapshot) {
  const cards = [];

  const ipos = hkFirstDaySeries(snapshot);
  if (ipos.length >= 3) {
    const changes = ipos.map((item) => item.change);
    const upCount = changes.filter((value) => value > 0).length;
    const upRatio = upCount / changes.length;
    cards.push({
      id: "hk",
      market: "hk",
      title: "港股新股首日",
      asOf: referenceDateText([ipos[ipos.length - 1].date], "上市至"),
      kind: "bars",
      value: `${upCount}只涨`,
      sub: `共${changes.length}只`,
      tone: "flat",
      tempScore: Math.max(5, Math.min(95, Math.round(upRatio * 100))),
      mood: upRatio >= 0.6 ? "首日偏暖" : (upRatio <= 0.4 ? "破发偏多" : "冷热分化"),
      moodTone: upRatio >= 0.6 ? "up" : (upRatio <= 0.4 ? "down" : "flat"),
      ...zeroAxisBars(changes),
    });
  }

  const stocks = (snapshot.us && snapshot.us.stocks) || [];
  const seven = MAGNIFICENT_SEVEN
    .map((symbol) => stocks.find((item) => item.symbol === symbol))
    .filter((item) => item && Array.isArray(item.history) && item.history.length >= 10)
    .map((item) => ({ history: item.history.map(positivePrice), asOf: item.asOf }))
    .filter((item) => item.history.every((close) => close !== null));
  if (seven.length >= 3) {
    const sampleCount = Math.min(...seven.map((item) => item.history.length));
    const changes = seven.map(({ history }) => (history[history.length - 1] / history[history.length - sampleCount] - 1) * 100);
    const upCount = changes.filter((value) => value > 0).length;
    const upRatio = upCount / changes.length;
    cards.push({
      id: "us",
      market: "us",
      title: "美股七姐妹",
      asOf: referenceDateText(seven.map((item) => item.asOf)),
      kind: "bars",
      value: `${upCount}只涨`,
      sub: `共${changes.length}只 · ${sampleCount}个交易日`,
      tone: "flat",
      tempScore: Math.max(5, Math.min(95, Math.round(upRatio * 100))),
      mood: upRatio >= 0.65 ? "多数收涨" : (upRatio <= 0.35 ? "多数回调" : "涨跌互现"),
      moodTone: upRatio >= 0.65 ? "up" : (upRatio <= 0.35 ? "down" : "flat"),
      ...zeroAxisBars(changes),
    });
  }

  const fund = ((snapshot.aShare && snapshot.aShare.funds) || [])
    .find((item) => String(item?.code || "").replace(/\.(SH|SZ)$/i, "") === DIVIDEND_FUND_ID);
  const fundCard = fund && lineTrend({
    id: "a",
    market: "a",
    title: fund.shortName || "红利ETF",
    history: fund.history,
    detailId: DIVIDEND_FUND_ID,
    digits: 3,
    prefix: "¥",
  });
  if (fundCard) cards.push(fundCard);

  const goldBars = historicalGoldRows(snapshot);
  const goldCard = lineTrend({
    id: "gold",
    market: "gold",
    title: "国际金价",
    history: goldBars,
    digits: 0,
    prefix: "$",
  });
  if (goldCard) cards.push(goldCard);

  return cards;
}

// 借鉴韭圈儿温度计 + 且慢大白话：汇总 4 个真实样本区间的冷暖读数（0~100°），一眼知冷暖。
function buildMarketPulse(trends) {
  const scored = (trends || []).filter((card) => Number.isFinite(card && card.tempScore));
  if (!scored.length) return null;
  const avg = Math.round(scored.reduce((sum, card) => sum + card.tempScore, 0) / scored.length);
  const score = Math.max(4, Math.min(96, avg));
  let zoneLabel = "舒适均衡区";
  let zoneTone = "flat";
  let plainCopy = "各市场冷热不一，不急着追涨杀跌，先点具体板块核对依据与风险。";
  if (score <= 35) {
    zoneLabel = "偏冷观察区";
    zoneTone = "cool";
    plainCopy = "多数样本靠近历史区间偏低位置，适合少焦虑、静心看清基本面。";
  } else if (score >= 68) {
    zoneLabel = "偏热审慎区";
    zoneTone = "warm";
    plainCopy = "多数样本处于阶段偏高区间，保持克制，重点盯估值与回撤风险。";
  }
  const pills = scored.map((card) => ({
    id: card.id,
    market: card.market,
    detailId: card.detailId || "",
    shortName: card.id === "hk" ? "港股" : (card.id === "us" ? "美股" : (card.id === "a" ? "红利" : "黄金")),
    mood: card.mood || "—",
    moodTone: card.moodTone || "flat",
  }));
  return { score, zoneLabel, zoneTone, plainCopy, pills };
}

// 借鉴 DeepSeek / 集思录极速本地索引：涵盖 5 大市场全部标的，零网络延迟秒搜直达详情页。
function buildSearchIndex(snapshot) {
  const rows = [];
  const seen = new Set();
  const pushItem = (market, item) => {
    if (!item || !item.id) return;
    const key = `${market}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name = String(item.name || "");
    const code = String(item.code || "");
    const raw = item.raw || {};
    let figure = "";
    if (market === "us" && Number.isFinite(Number(raw.price))) figure = `$${Number(raw.price).toFixed(2)}`;
    else if (market === "a" && Number.isFinite(Number(raw.currentPrice))) {
      figure = raw.assetType === "fund" ? `¥${Number(raw.currentPrice).toFixed(3)}` : `¥${Number(raw.currentPrice).toFixed(2)}`;
    } else if (market === "hk" && item.badge) figure = String(item.badge);
    else if (market === "guru" && raw.reportDate) figure = String(raw.reportDate).slice(0, 10);
    rows.push({
      key,
      market,
      marketTag: MARKET_TAG[market] || "资料",
      id: item.id,
      name,
      code,
      figure,
      haystack: `${name} ${code} ${MARKET_TAG[market] || ""}`.toLowerCase(),
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

function buildQuickPicks(index) {
  const wanted = ["NVDA", "600900.SH", "GOOGL", "berkshire", "gold"];
  const picks = [];
  for (const target of wanted) {
    const found = index.find((row) =>
      row.id === target
      || row.code === target
      || (target === "berkshire" && /伯克希尔|巴菲特/u.test(row.name))
      || (target === "gold" && row.market === "gold"));
    if (found && !picks.some((p) => p.key === found.key)) {
      picks.push({
        key: found.key,
        market: found.market,
        id: found.id,
        label: found.name.length > 6 ? found.name.slice(0, 6) : found.name,
      });
    }
    if (picks.length >= 4) break;
  }
  return picks;
}

Page({
  data: {
    entries: GRID_ENTRIES,
    trends: [],
    pulse: null,
    pulseInfoOpen: false,
    searchQuery: "",
    searchFocused: false,
    searchResults: [],
    quickPicks: [],
    starPicks: [],
    dataAsOf: "",
    freshnessKind: "offline",
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    trackHomeVisit();
    this._snapshot = null;
    this._searchIndex = [];
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
  togglePulseInfo() {
    this.setData({ pulseInfoOpen: !this.data.pulseInfoOpen });
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
          const trends = buildHomeTrends(data);
          this._searchIndex = buildSearchIndex(data);
          patch.trends = trends;
          patch.pulse = buildMarketPulse(trends);
          patch.quickPicks = buildQuickPicks(this._searchIndex);
        }
        if (Object.keys(patch).length) this.setData(patch);
      },
      done,
      { force },
    );
  },
  onSearchFocus() {
    this.setData({ searchFocused: true });
  },
  onSearchInput(event) {
    const query = String((event.detail && event.detail.value) || "").trim();
    if (!query) {
      this.setData({ searchQuery: "", searchResults: [] });
      return;
    }
    const q = query.toLowerCase();
    const matches = (this._searchIndex || [])
      .filter((row) => row.haystack.includes(q))
      .slice(0, 8);
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
  openTrend(event) {
    const { market, detailId } = event.currentTarget.dataset;
    if (!market) return;
    if (market === "a" && detailId === DIVIDEND_FUND_ID) {
      track("detail_open", { market, from: "home_trend" });
      wx.navigateTo({ url: `/pages/detail/index?market=a&id=${DIVIDEND_FUND_ID}` });
      return;
    }
    track("section_open", { market, from: "home_trend" });
    wx.navigateTo({ url: `/pages/section/index?market=${market}` });
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
