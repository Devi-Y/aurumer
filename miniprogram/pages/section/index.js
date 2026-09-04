const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { MASTER_PLAYBOOKS } = require("../../utils/master-playbooks");
const { buildHkHistoryStats } = require("../../utils/hk-history-stats");
const { buildDailyAnswers } = require("../../utils/daily-answers");
const { listHoldings } = require("../../utils/local-holdings");
const { marketSources } = require("../../utils/sources");
// 页头那句「数据截至 …」和新闻资讯页共用同一个写法。
const { asOfText } = require("../../utils/dates");
// 黄金栏目页顶部那块「四口径同屏」，和黄金详情页用的是同一份换算。
const { goldParity } = require("../../utils/gold-parity");

const META = {
  hk: {
    title: "港股打新",
    one: "上新、值不值得打、打中后看历史对照",
    tone: "hk",
    icon: "/assets/home/hk.svg",
    kicker: "新股申购",
  },
  us: {
    title: "美股投资",
    one: "七姐妹分档与底仓配置",
    tone: "us",
    icon: "/assets/home/us.svg",
    kicker: "全球公司",
  },
  a: {
    title: "A股收息",
    one: "底仓、周期与加减观察价",
    tone: "a",
    icon: "/assets/home/a.svg",
    kicker: "分红清单",
  },
  gold: {
    title: "黄金追踪",
    // 这行是栏目页的副标题，要跟今日答案那四问对上：什么价、能不能买、要不要卖、拐点。
    one: "价格 / 能不能买 / 要不要卖 / 拐点",
    tone: "gold",
    icon: "/assets/home/gold.svg",
    kicker: "价格观察",
  },
  guru: {
    title: "机构持仓",
    // 思路与借鉴收进了「未来持仓趋势」的展开层，副标题跟着答案卡走。
    one: "持仓 · 本季加减 · 方向与边界",
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
          // 格子上写 3、点开却只有 1 只，是因为落地页原本固定在「值得打」。
          // 在售横跨三档，answers.js 里补了一个同名合集，数和落地页这才对得上。
          label: "在售",
          value: `${live.length}`,
          action: "group",
          group: "live",
          enabled: live.length > 0,
        },
        {
          label: "值得打",
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
          // 同上：这一格数的是全部 10 只样本，落地页却和右边那格一样固定在
          // 「优等收息」的 1 只。
          label: "收息样本",
          value: `${items.length}`,
          action: "group",
          group: "sample",
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
          // 「国际金 4519」「人民币金 957.5」都是裸数字，一个是美元每盎司、
          // 一个是人民币每克，同一行摆着看不出是两套口径。详情页那四格已经
          // 写成「国际金/盎司 $4473」，栏目页跟上同一种写法。
          label: "国际金/盎司",
          value: hasNumber(international.price) ? `$${Number(international.price).toFixed(0)}` : "—",
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
          label: "人民币金/克",
          value: hasNumber(domestic.price) ? `¥${Number(domestic.price).toFixed(1)}` : "—",
          action: "detail",
          id: "plan",
          enabled: true,
        },
      ],
      // 结论行原来写「人民币金 957.5」，可这个数字紧接着又在下面的关键数值行
      // 出现一次、在四口径卡里再出现一次，同一屏印三遍。结论行只说这条结论
      // 是关于谁的，数字交给下面两块。
      target: "黄金",
      targetId: "track",
      grade: answer.action || "继续观察",
      gradeGroup: "track",
      canOpenTarget: true,
      canOpenGrade: true,
    };
  }

  const profiles = allItems(snapshot, "guru");
  // leader 原本取 profiles[0]，也就是数组里排头的那条（港股组的价值伙伴经典
  // 13.2% 年化）；而正下方第一行「业绩靠前持仓」用的是 daily-answers 里
  // 美股→港股→A股 的取法（德鲁肯米勒 约 30% 年化）。同一屏两处各说一个「领头」，
  // 数还不一样。这里按 daily-answers 的同一条规则取，两处说的是同一个人。
  const leader = ["us", "hk", "a"]
    .map((group) => profiles.find((item) => item.group === group))
    .find(Boolean) || profiles[0];
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
    // 6 个字会把「斯坦利·德鲁肯米勒」削成「斯坦利·德鲁」，看着像个完整名字，
    // 其实是另一个人。放宽到 10 字，真放不下时交给 CSS 的省略号，至少能看出被截了。
    target: leader ? shortCompanyName(leader.name, "机构", 10) : "待更新",
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
    playbooks: [],
    answers: [],
    deepLinks: [],
    sourceLinks: [],
    dataAsOf: "",
    // 只有黄金栏目页会用到；其余四栏恒为 null，wx:if 直接整块不渲染。
    parity: null,
  },
  onLoad(options) {
    const market = META[options.market] ? options.market : "hk";
    const playbooks = market === "guru"
      ? MASTER_PLAYBOOKS.map((item) => ({
        id: item.id,
        name: item.name,
        tag: item.tag,
        principle: item.principle,
        sensitivity: item.sensitivity,
        valueLens: item.valueLens,
        doNot: item.doNot,
        sourceNote: item.sourceNote,
      }))
      : [];
    this.setData({ market, meta: META[market], playbooks });
    wx.setNavigationBarTitle({ title: META[market].title });
    track("section_open", { market: String(market), from: "direct" });
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh(() => wx.stopPullDownRefresh(), true);
  },
  retryFreshness() { this.refresh(null, true); },
  // 和新闻资讯页同一套交互：小程序打不开任意外链，来源只能复制出去自己核对。
  copySourceLink(event) {
    const url = String(event.currentTarget.dataset.url || "");
    if (!url) return;
    track("news_source_copy", { market: String(this.data.market || "") });
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "已复制来源链接", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  buildDeepLinks(snapshot, market) {
    if (market === "hk") {
      const stats = buildHkHistoryStats(snapshot);
      return [{
        id: "history",
        group: "ended",
        title: "历史样本对照",
        help: stats.summary,
        enabled: stats.sampleCount > 0,
      }];
    }
    if (market === "us") {
      return [
        {
          id: "hot10",
          group: "hot10",
          title: "热度前十",
          help: "公开热度横向比较，热度≠买入信号",
          enabled: true,
        },
        {
          id: "value",
          group: "value",
          title: "性价比观察",
          help: "质量·估值·热度综合排序，非收益承诺",
          enabled: true,
        },
      ];
    }
    if (market === "guru") {
      return [{
        id: "overlap",
        group: "overlap",
        title: "交叉重叠",
        help: "多机构共同持有，仅供研究对照",
        enabled: true,
      }];
    }
    return [];
  },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const groups = groupDefinitions(snapshot, this.data.market)
        .filter((item) => item.count > 0 && item.catalog !== false)
        .map((item, index) => ({
          ...item,
          indexLabel: String(index + 1).padStart(2, "0"),
        }));
      this.setData({
        groups,
        overview: buildOverview(snapshot, this.data.market),
        answers: buildDailyAnswers(snapshot, this.data.market, { holdings: listHoldings() }),
        deepLinks: this.buildDeepLinks(snapshot, this.data.market),
        source,
        freshness: freshnessBanner(source, meta.kind),
        // 这一栏的数据是从哪儿来的。新闻资讯页每条都挂了官方出处，
        // 五个栏目页一直只有一句"公开资料整理"，核对无门。
        sourceLinks: marketSources(snapshot, this.data.market),
        dataAsOf: asOfText(snapshot && snapshot.updatedAt, meta.kind),
        // 四个报价缺一就返回 null，这一块整体不出——不用占位符凑齐一屏。
        parity: this.data.market === "gold" ? goldParity(snapshot && snapshot.gold) : null,
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
  openPlaybook(event) {
    const id = event.currentTarget.dataset.id;
    const book = (this.data.playbooks || []).find((item) => item.id === id);
    if (!book) return;
    track("detail_open", { market: "guru", from: "playbook" });
    wx.showModal({
      title: `${book.name} · ${book.tag}`,
      content: [
        book.principle,
        `敏感度：${book.sensitivity}`,
        `价值透镜：${book.valueLens}`,
        `边界：${book.doNot}`,
        `来源：${book.sourceNote}`,
      ].join("\n"),
      showCancel: false,
      confirmText: "知道了",
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
  openDeepLink(event) {
    const group = event.currentTarget.dataset.group;
    const enabled = event.currentTarget.dataset.enabled;
    if (String(enabled) === "false" || enabled === false) {
      wx.showToast({ title: "暂无历史样本", icon: "none" });
      return;
    }
    this.openGroupById(group, "section_deep");
  },
  openAnswer(event) {
    const id = event.currentTarget.dataset.id;
    const item = (this.data.answers || []).find((row) => row.id === id);
    if (!item) return;
    track("section_answer", { market: this.data.market, id: String(id) });
    if (item.modal) {
      wx.showModal({
        title: item.question,
        content: item.modal,
        showCancel: item.action === "detail" || item.action === "group",
        cancelText: "关闭",
        confirmText: item.action === "detail" || item.action === "group" ? "查看" : "知道了",
        success: (result) => {
          if (!result.confirm || item.action === "none") return;
          if (item.action === "detail" && item.targetId) this.openDetail(item.targetId, "section_answer");
          else if (item.action === "group" && item.group) this.openGroupById(item.group, "section_answer");
        },
      });
      return;
    }
    if (!item.enabled) {
      wx.showToast({ title: item.answer || "这一项暂时没有内容", icon: "none" });
      return;
    }
    if (item.action === "detail" && item.targetId) {
      this.openDetail(item.targetId, "section_answer");
      return;
    }
    if (item.action === "group" && item.group) {
      this.openGroupById(item.group, "section_answer");
    }
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
