const { loadSnapshot } = require("../../data/store");
const { track, trackHomeVisit } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { loadWorkspace } = require("../../services/member");
const { MAGNIFICENT_SEVEN } = require("../../utils/market-lenses");
const OFFERS = require("../../config/offers");
const { toneOf, sampleSeries, sparklineSvg, zeroAxisBars } = require("../../utils/sparkline");
const { hkFirstDaySeries } = require("../../utils/hk-history-stats");

// 服务格子只放已经拿到真实物料的项，没有 copy 的不上九宫格，也不拿别的入口凑数。
const SERVICES = OFFERS.filter((item) => item && item.copy);

// 九宫格的前六格是这六个研究栏目，照微信「服务」页的分组图标网格：只有图标和名字，
// 没有副标题也没有箭头。help 不再上屏，但留着当读屏标签用。
const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "上新·值得打",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "七姐妹·低估与高估",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "分红稳定·分红收益",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "金价·买卖·拐点",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "聪明钱跟踪",
    help: "持仓·动向·趋势",
  },
  {
    id: "news",
    action: "page",
    url: "/pages/news/index",
    icon: "/assets/home/news.svg",
    title: "新闻资讯",
    help: "披露·公告·影响",
  },
];

// 九宫格 = 六个研究栏目 + 已有物料的服务格。服务格点一下是复制，不跳页。
const GRID_ENTRIES = [
  ...CORE_ENTRIES.map((item) => ({ ...item })),
  ...SERVICES.map(({ id, icon, title }) => ({ id, action: "copy", icon, title, help: "点击复制" })),
];

// ---------- 首页走势卡：每张只用快照里的真实序列，序列不够整张不出 ----------

function signedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

// 折线卡：首尾涨跌写在数字旁边，线本身出成 SVG 图片（尺寸和 .trend-line 同比例）。
function lineTrend({ id, market, title, closes, digits }) {
  const values = closes.map(Number).filter((value) => Number.isFinite(value));
  if (values.length < 10) return null;
  const change = values[0] ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : NaN;
  return {
    id,
    market,
    title,
    kind: "line",
    value: values[values.length - 1].toFixed(digits),
    sub: `${values.length}日 ${signedPct(change)}`,
    tone: toneOf(change),
    src: sparklineSvg(sampleSeries(values), { width: 300, height: 104 }),
  };
}

function buildHomeTrends(snapshot) {
  const cards = [];

  const ipos = hkFirstDaySeries(snapshot);
  if (ipos.length >= 3) {
    const changes = ipos.map((item) => item.change);
    cards.push({
      id: "hk",
      market: "hk",
      title: "港股首日",
      kind: "bars",
      value: `${changes.filter((value) => value > 0).length}/${changes.length}`,
      sub: "首日收涨",
      tone: "flat",
      ...zeroAxisBars(changes),
    });
  }

  const stocks = (snapshot.us && snapshot.us.stocks) || [];
  const seven = MAGNIFICENT_SEVEN
    .map((symbol) => stocks.find((item) => item.symbol === symbol))
    .filter((item) => item && Array.isArray(item.history) && item.history.length >= 10)
    .map((item) => {
      const first = Number(item.history[0]);
      const last = Number(item.history[item.history.length - 1]);
      return { length: item.history.length, change: first ? ((last - first) / first) * 100 : NaN };
    })
    .filter((item) => Number.isFinite(item.change));
  if (seven.length >= 3) {
    const changes = seven.map((item) => item.change);
    cards.push({
      id: "us",
      market: "us",
      title: "美股七姐妹",
      kind: "bars",
      value: `${changes.filter((value) => value > 0).length}/${changes.length}`,
      sub: `${Math.min(...seven.map((item) => item.length))}日收涨`,
      tone: "flat",
      ...zeroAxisBars(changes),
    });
  }

  const fund = ((snapshot.aShare && snapshot.aShare.funds) || [])[0];
  const fundCard = fund && lineTrend({
    id: "a",
    market: "a",
    title: fund.shortName || "红利ETF",
    closes: (fund.history || []).map((item) => item && item.close),
    digits: 3,
  });
  if (fundCard) cards.push(fundCard);

  const goldCard = lineTrend({
    id: "gold",
    market: "gold",
    title: "COMEX 黄金",
    closes: ((snapshot.gold && snapshot.gold.history && snapshot.gold.history.international) || []).map((item) => item && item.close),
    digits: 1,
  });
  if (goldCard) cards.push(goldCard);

  return cards;
}

Page({
  data: {
    entries: GRID_ENTRIES,
    trends: [],
    dataAsOf: "",
    freshnessKind: "offline",
    memberActive: false,
    memberNote: "365天 · ¥1288",
    memberQueryFailed: false,
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    trackHomeVisit();
    this._snapshot = null;
    this.refreshAnswers();
    this.refreshMemberCard();
  },
  onShow() {
    // 从详情/section 页返回时结论要跟着同一份数据走，不停在打开小程序那一刻。
    this.refreshAnswers();
    this.refreshMemberCard();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
    this.refreshMemberCard();
  },
  refreshMemberCard() {
    loadWorkspace()
      .then((workspace) => {
        const active = !!workspace.active;
        this.setData({
          memberActive: active,
          memberQueryFailed: false,
          memberNote: active ? this.memberNote(workspace) : "365天 · ¥1288",
        });
      })
      // 查询失败不能悄悄当成「未开通」——那会把「不知道」冒充成一个确定结论。
      .catch(() => this.setData({ memberQueryFailed: true }));
  },
  memberNote(workspace) {
    const expires = workspace && workspace.expiresAt ? new Date(workspace.expiresAt) : null;
    if (expires && !Number.isNaN(expires.getTime())) {
      const pad = (value) => String(value).padStart(2, "0");
      return `有效期至 ${expires.getFullYear()}-${pad(expires.getMonth() + 1)}-${pad(expires.getDate())}`;
    }
    return "会员已开通";
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        this._snapshot = data;
        this.setData({
          dataAsOf: this.formatAsOf(data.updatedAt, kind),
          freshnessKind: kind,
          trends: buildHomeTrends(data),
        });
      },
      done,
      { force },
    );
  },
  formatTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
  formatAsOf(value, kind = "aging") {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "数据截至待核验";
    const stamp = this.formatTime(date);
    if (kind === "stale") return `数据截至 ${stamp} · 已偏旧`;
    return `数据截至 ${stamp}`;
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "copy") {
      this.copyService(entry.id);
      return;
    }
    if (entry.action === "section") {
      track("section_open", { market: String(entry.id), from: "grid" });
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
      return;
    }
    // 新闻资讯不是行情栏目，走自己的页面。
    if (entry.action === "page" && entry.url) {
      openPage(entry.url);
    }
  },
  // 年费条：查询失败时点一下是重试，不能把「不知道」当成「未开通」往开通页带。
  tapMemberBar() {
    if (this.data.memberQueryFailed) {
      this.refreshMemberCard();
      return;
    }
    this.openMemberBanner();
  },
  openMemberBanner() {
    track("member_open", { from: this.data.memberActive ? "home_bar_member" : "home_bar_lock" });
    openPage("/pages/member/index");
  },
  openTrend(event) {
    const market = String(event.currentTarget.dataset.market || "");
    if (!market) return;
    track("section_open", { market, from: "home_trend" });
    wx.navigateTo({ url: `/pages/section/index?market=${market}` });
  },
  // 小程序打不开外部网页，服务格一律复制到剪贴板，由用户自己去浏览器或微信里用。
  copyService(id) {
    const service = SERVICES.find((item) => item.id === id);
    if (!service) return;
    track("service_copy", { id });
    wx.setClipboardData({
      data: service.copy,
      success: () => wx.showToast({ title: service.toast || "已复制", icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
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
