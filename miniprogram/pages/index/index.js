const { loadSnapshot } = require("../../data/store");
const { track } = require("../../utils/analytics");
const { openPage } = require("../../utils/nav");
const { shortCompanyName, allItems } = require("../../utils/answers");
const { FOOTER_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { loadWorkspace } = require("../../services/member");
const { homeMemberSummary } = require("../../utils/change-center");

const CORE_ENTRIES = [
  {
    id: "hk",
    action: "section",
    icon: "/assets/home/hk.svg",
    title: "港股打新",
    help: "值不值得打·中签",
    detail: "申购结论",
    tone: "hk",
  },
  {
    id: "us",
    action: "section",
    icon: "/assets/home/us.svg",
    title: "美股投资",
    help: "价格与财报对照",
    detail: "公开资料",
    tone: "us",
  },
  {
    id: "a",
    action: "section",
    icon: "/assets/home/a.svg",
    title: "A股收息",
    help: "股息与现金流",
    detail: "股息清单",
    tone: "a",
  },
  {
    id: "gold",
    action: "section",
    icon: "/assets/home/gold.svg",
    title: "黄金追踪",
    help: "价格位置观察",
    detail: "买卖观察区",
    tone: "gold",
  },
  {
    id: "member",
    action: "member",
    icon: "/assets/home/member.svg",
    title: "年费会员",
    help: "关注·变化·复盘",
    detail: "365天 · ¥1288",
    badge: "¥1288/年",
    tone: "member",
  },
  {
    id: "guru",
    action: "section",
    icon: "/assets/home/guru.svg",
    title: "机构持仓",
    help: "学思路对照仓",
    detail: "港3 · 美5 · A3",
    tone: "guru",
  },
];

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function bestByScore(items) {
  return [...items]
    .map((item) => ({ item, scored: scoreForItem(item) }))
    .filter((entry) => entry.scored.score != null)
    .sort((left, right) => Number(right.scored.score) - Number(left.scored.score))[0]?.item
    || items[0]
    || null;
}

function buildToday(data) {
  // 今日重点按研究观察分排序，仅作资料对照，不是收益预测。
  const hkLive = allItems(data, "hk").filter((item) => (
    item.group !== "ended" && item.group !== "cancelled"
  ));
  const hkPrefer = hkLive.filter((item) => item.group === "worth");
  const hkLead = bestByScore(hkPrefer.length ? hkPrefer : hkLive);

  const usItems = allItems(data, "us");
  const usLead = bestByScore(usItems);

  const aItems = allItems(data, "a");
  const aLead = bestByScore(aItems);

  const gold = data.gold || {};
  const internationalGold = gold.quotes?.international || {};
  const goldPrice = hasNumber(internationalGold.price)
    ? Math.round(Number(internationalGold.price))
    : null;

  const hkId = hkLead
    ? String(hkLead.id || hkLead.code || "").replace(/\.HK$/i, "")
    : "";
  const hkName = hkLead
    ? shortCompanyName(hkLead.name, "新股", 4)
    : "暂无";
  const usId = usLead ? String(usLead.code || usLead.id || "") : "";
  const aId = aLead
    ? String(aLead.id || aLead.code || "").replace(/\.(SH|SZ)$/i, "")
    : "";
  const aName = aLead
    ? shortCompanyName(aLead.name, "收息", 4)
    : "待更新";

  return {
    points: [
      {
        id: "hk",
        label: "港股",
        value: hkName,
        targetId: hkId,
        hasTarget: Boolean(hkId),
        ariaCategory: "打开港股打新栏目",
        ariaTarget: hkId ? `打开港股标的 ${hkName}` : "港股暂无标的",
      },
      {
        id: "us",
        label: "美股",
        value: usId || "—",
        targetId: usId,
        hasTarget: Boolean(usId),
        ariaCategory: "打开美股投资栏目",
        ariaTarget: usId ? `打开美股标的 ${usId}` : "美股暂无标的",
      },
      {
        id: "a",
        label: "A股",
        value: aName,
        targetId: aId,
        hasTarget: Boolean(aId),
        ariaCategory: "打开A股收息栏目",
        ariaTarget: aId ? `打开A股标的 ${aName}` : "A股暂无标的",
      },
      {
        id: "gold",
        label: "黄金",
        value: goldPrice != null ? String(goldPrice) : "—",
        targetId: "track",
        hasTarget: true,
        ariaCategory: "打开黄金追踪栏目",
        ariaTarget: goldPrice != null ? `打开黄金观察 ${goldPrice}` : "打开黄金追踪",
      },
    ],
  };
}

const TODAY_HELP_FRESH = "今天重点关注标的";

Page({
  data: {
    entries: CORE_ENTRIES.map((item) => ({ ...item })),
    today: { points: [] },
    dataAsOf: "",
    freshnessKind: "offline",
    todayHelp: TODAY_HELP_FRESH,
    footerDisclaimer: FOOTER_DISCLAIMER,
  },
  onLoad() {
    track("home_open");
    this.refreshAnswers();
    this.refreshMemberCard();
  },
  onShow() {
    this.refreshMemberCard();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh(), true);
    this.refreshMemberCard();
  },
  refreshMemberCard() {
    loadWorkspace()
      .then((workspace) => {
        const summary = homeMemberSummary({
          active: workspace.active,
          todayBrief: workspace.todayBrief,
          reviewTasks: workspace.reviewTasks,
        });
        const entries = this.data.entries.map((item) => {
          if (item.id !== "member") return item;
          return {
            ...item,
            help: summary.help,
            detail: summary.detail,
          };
        });
        this.setData({ entries });
      })
      .catch(() => {});
  },
  refreshAnswers(done, force = false) {
    loadSnapshot(
      (data, source, meta = {}) => {
        const kind = meta.kind || "aging";
        const asOf = this.formatAsOf(data.updatedAt, kind);
        this.setData({
          today: buildToday(data),
          dataAsOf: asOf,
          freshnessKind: kind,
          todayHelp: TODAY_HELP_FRESH,
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
  openTodayCategory(event) {
    const market = event.currentTarget.dataset.market;
    if (!market) return;
    track("section_open", { market: String(market), from: "today_category" });
    wx.navigateTo({ url: `/pages/section/index?market=${market}` });
  },
  openTodayTarget(event) {
    const market = event.currentTarget.dataset.market;
    const targetId = String(event.currentTarget.dataset.target || "");
    if (!market) return;
    if (!targetId) {
      this.openTodayCategory({ currentTarget: { dataset: { market } } });
      return;
    }
    track("detail_open", { market: String(market), from: "today_target" });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(market)}&id=${encodeURIComponent(targetId)}`,
    });
  },
  openGridEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.action === "section") {
      track("section_open", { market: String(entry.id), from: "grid" });
      wx.navigateTo({ url: `/pages/section/index?market=${entry.id}` });
      return;
    }
    if (entry.action === "member") openPage("/pages/member/index");
  },
  onShareAppMessage() {
    track("share_tap", { page: "home" });
    return {
      title: "望潮 Aurum｜今日重点与市场研究",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜今日重点与市场研究" };
  },
});
