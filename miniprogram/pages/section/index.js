const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");

const META = {
  hk: {
    title: "港股打新",
    one: "申购结论与中签",
    tone: "hk",
    icon: "/assets/home/hk.svg",
    kicker: "新股申购",
  },
  us: {
    title: "美股投资",
    one: "价格与财报",
    tone: "us",
    icon: "/assets/home/us.svg",
    kicker: "全球公司",
  },
  a: {
    title: "A股收息",
    one: "股息与现金流",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    one: "价格位置",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "买卖观察",
  },
  guru: {
    title: "机构持仓",
    one: "对照公开持仓",
    tone: "guru",
    icon: "/assets/home/guru.svg",
    kicker: "学习与对照",
  },
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function buildOverview(snapshot, market) {
  if (market === "hk") {
    const items = allItems(snapshot, "hk").filter((item) => item.group !== "ended");
    const live = items.filter((item) => item.group !== "cancelled");
    const suggest = items.filter((item) => item.group === "worth");
    const lead = suggest[0] || live[0];
    const scored = scoreForItem(lead);
    const leadId = lead ? String(lead.id || "") : "";
    return {
      metrics: [
        {
          label: "在售",
          value: `${live.length}`,
          action: "group",
          group: suggest.length ? "worth" : (live[0]?.group || "worth"),
          enabled: live.length > 0,
        },
        {
          label: "建议申购",
          value: `${suggest.length}`,
          action: "group",
          group: "worth",
          enabled: suggest.length > 0,
        },
        {
          label: "研究分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: leadId,
          enabled: Boolean(leadId),
        },
      ],
      target: lead ? shortCompanyName(lead.name, "新股", 6) : "暂无在售",
      targetId: leadId,
      grade: lead ? (lead.badge || "待定") : "—",
      gradeGroup: lead?.group || "worth",
      canOpenTarget: Boolean(leadId),
      canOpenGrade: Boolean(lead?.group),
    };
  }

  if (market === "us") {
    const items = allItems(snapshot, "us");
    const hot = items.filter((item) => item.group === "hot");
    const seven = items.filter((item) => item.group === "seven");
    const ranked = [...items]
      .map((item) => ({ item, score: scoreForItem(item).score }))
      .filter((entry) => entry.score != null)
      .sort((left, right) => right.score - left.score);
    const lead = ranked[0]?.item || seven[0] || hot[0];
    const scored = scoreForItem(lead);
    const leadId = lead ? String(lead.id || lead.code || "") : "";
    return {
      metrics: [
        {
          label: "七姐妹",
          value: `${seven.length}`,
          action: "group",
          group: "seven",
          enabled: seven.length > 0,
        },
        {
          label: "热度前三",
          value: `${hot.length}`,
          action: "group",
          group: "hot",
          enabled: hot.length > 0,
        },
        {
          label: "综合分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: leadId,
          enabled: Boolean(leadId),
        },
      ],
      target: lead ? (lead.code || shortCompanyName(lead.name, "美股", 6)) : "待更新",
      targetId: leadId,
      grade: lead
        ? (lead.group === "hot" ? `热度 ${lead.raw?.heatScore ?? "—"}` : "七姐妹")
        : "—",
      gradeGroup: lead?.group || "seven",
      canOpenTarget: Boolean(leadId),
      canOpenGrade: Boolean(lead?.group),
    };
  }

  if (market === "a") {
    const items = allItems(snapshot, "a");
    const ranked = [...items]
      .map((item) => ({ item, score: scoreForItem(item).score }))
      .filter((entry) => entry.score != null)
      .sort((left, right) => right.score - left.score);
    const top = ranked[0]?.item || items[0];
    const scored = scoreForItem(top);
    const topId = top ? String(top.id || "") : "";
    const primeCount = items.filter((item) => item.group === "prime").length;
    return {
      metrics: [
        {
          label: "收息样本",
          value: `${items.length}`,
          action: "group",
          group: "prime",
          enabled: items.length > 0,
        },
        {
          label: "优等收息",
          value: `${primeCount}`,
          action: "group",
          group: "prime",
          enabled: primeCount > 0,
        },
        {
          label: "收息分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: topId,
          enabled: Boolean(topId),
        },
      ],
      target: top ? shortCompanyName(top.name, top.code || "—", 6) : "—",
      grade: top ? (top.badge || "—") : "—",
      targetId: topId,
      gradeGroup: top?.group || "prime",
      canOpenTarget: Boolean(topId),
      canOpenGrade: Boolean(top?.group),
    };
  }

  if (market === "gold") {
    const gold = snapshot.gold || {};
    const answer = gold.answer || {};
    const international = gold.quotes?.international || {};
    const domestic = gold.quotes?.domestic || {};
    const scored = scoreForItem({ market: "gold", raw: gold });
    return {
      metrics: [
        {
          label: "国际金",
          value: hasNumber(international.price) ? Number(international.price).toFixed(0) : "—",
          action: "detail",
          id: "track",
          enabled: true,
        },
        {
          label: "观察分",
          value: scored.score != null ? `${scored.score}` : "—",
          action: "detail",
          id: "track",
          enabled: true,
        },
        {
          label: "人民币金",
          value: hasNumber(domestic.price) ? Number(domestic.price).toFixed(1) : "—",
          action: "detail",
          id: "plan",
          enabled: true,
        },
      ],
      target: hasNumber(domestic.price)
        ? `人民币金 ${Number(domestic.price).toFixed(1)}`
        : (hasNumber(international.price) ? `国际金 ${Number(international.price).toFixed(0)}` : "黄金"),
      targetId: "track",
      grade: answer.action || "继续观察",
      gradeGroup: "track",
      canOpenTarget: true,
      canOpenGrade: true,
    };
  }

  const profiles = allItems(snapshot, "guru");
  const leader = profiles[0];
  const leaderId = leader ? String(leader.id || "") : "";
  const hkCount = profiles.filter((item) => item.group === "hk").length;
  const usCount = profiles.filter((item) => item.group === "us").length;
  const aCount = profiles.filter((item) => item.group === "a").length;
  const topPerf = leader?.badge || leader?.raw?.profile?.performanceValue || "—";
  return {
    metrics: [
      { label: "港股", value: `${hkCount}`, action: "group", group: "hk", enabled: hkCount > 0 },
      { label: "美股", value: `${usCount}`, action: "group", group: "us", enabled: usCount > 0 },
      { label: "A股", value: `${aCount}`, action: "group", group: "a", enabled: aCount > 0 },
    ],
    target: leader ? shortCompanyName(leader.name, "机构", 6) : "待更新",
    targetId: leaderId,
    grade: topPerf,
    gradeGroup: leader?.group || "hk",
    canOpenTarget: Boolean(leaderId),
    canOpenGrade: Boolean(leader?.group),
  };
}

Page({
  data: {
    market: "hk",
    meta: META.hk,
    groups: [],
    overview: {
      metrics: [],
      target: "",
      targetId: "",
      grade: "",
      gradeGroup: "",
      canOpenTarget: false,
      canOpenGrade: false,
    },
    source: "正在读取同步数据",
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    disclaimer: RESEARCH_DISCLAIMER,
  },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    this.setData({ market, meta: META[market] });
    wx.setNavigationBarTitle({ title: META[market].title });
    track("section_open", { market: String(market), from: "direct" });
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const groups = groupDefinitions(snapshot, this.data.market)
        .filter((item) => item.count > 0)
        .map((item, index) => ({
          ...item,
          indexLabel: String(index + 1).padStart(2, "0"),
        }));
      this.setData({
        groups,
        overview: buildOverview(snapshot, this.data.market),
        source,
        freshness: freshnessBanner(source, meta.kind),
      });
    }, done, { force });
  },
  openMetric(event) {
    const { action, group, id, enabled } = event.currentTarget.dataset;
    if (String(enabled) === "false" || enabled === false) {
      wx.showToast({ title: "这一项暂时没有内容", icon: "none" });
      return;
    }
    if (action === "detail" && id) {
      this.openDetail(id, "section_metric");
      return;
    }
    if (action === "group" && group) {
      this.openGroupById(group, "section_metric");
    }
  },
  openInsightTarget() {
    const { targetId, canOpenTarget } = this.data.overview;
    if (!canOpenTarget || !targetId) {
      wx.showToast({ title: "暂无标的可打开", icon: "none" });
      return;
    }
    this.openDetail(targetId, "section_insight_target");
  },
  openInsightGrade() {
    const { gradeGroup, targetId, canOpenGrade, canOpenTarget } = this.data.overview;
    if (canOpenTarget && targetId && (this.data.market === "gold" || this.data.market === "a")) {
      this.openDetail(targetId, "section_insight_grade");
      return;
    }
    if (canOpenGrade && gradeGroup) {
      this.openGroupById(gradeGroup, "section_insight_grade");
      return;
    }
    wx.showToast({ title: "暂无分组可打开", icon: "none" });
  },
  openDetail(id, from = "section") {
    track("detail_open", { market: this.data.market, from });
    wx.navigateTo({
      url: `/pages/detail/index?market=${encodeURIComponent(this.data.market)}&id=${encodeURIComponent(id)}`,
    });
  },
  openGroupById(group, from = "section_group") {
    const live = this.data.groups.find((item) => item.id === group);
    if (live && !live.count) {
      wx.showToast({ title: "这一组当前没有项目", icon: "none" });
      return;
    }
    track("list_open", { market: this.data.market, group: String(group), from });
    wx.navigateTo({ url: `/pages/list/index?market=${this.data.market}&group=${group}` });
  },
  openGroup(event) {
    const group = event.currentTarget.dataset.group;
    this.openGroupById(group, "section_group");
  },
  goBack() {
    wx.navigateBack({ fail: () => goHome() });
  },
  goHome() {
    goHome();
  },
  onShareAppMessage() {
    track("share_tap", { page: "section", market: this.data.market });
    return {
      title: `${this.data.meta.title}｜望潮研究观察`,
      path: `/pages/section/index?market=${this.data.market}`,
    };
  },
});
