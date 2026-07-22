const { loadSnapshot } = require("../../data/store");

const ENTRIES = [
  {
    id: "hk",
    kicker: "HK · 新股",
    title: "港股打新",
    question: "这只新股值不值得打？中签后怎么卖？",
    answer: "这只新股值不值得打？中签后怎么卖？",
    tone: "hk",
  },
  {
    id: "us",
    kicker: "US · 机会",
    title: "美股投资",
    question: "七姐妹和热门 AI 股，现在贵不贵？",
    answer: "七姐妹和热门 AI 股，现在贵不贵？",
    tone: "us",
  },
  {
    id: "a",
    kicker: "CN · 收息",
    title: "A股收息",
    question: "资金成本低于多少，适合长期收息？",
    answer: "资金成本低于多少，适合长期收息？",
    tone: "a",
  },
  {
    id: "gold",
    kicker: "GOLD · 配置",
    title: "黄金投资",
    question: "国际金与上海金，现在处在什么位置？",
    answer: "国际金与上海金，现在处在什么位置？",
    tone: "gold",
  },
  {
    id: "guru",
    kicker: "SMART MONEY · 研究",
    title: "聪明人持仓",
    question: "港股 3 · 美股 5 · A股 3，为什么选、怎么学？",
    answer: "港股 3 · 美股 5 · A股 3，为什么选、怎么学？",
    tone: "guru",
  },
];

Page({
  data: { entries: ENTRIES.map((item) => ({ ...item })) },
  onLoad() {
    this.refreshAnswers();
  },
  onPullDownRefresh() {
    this.refreshAnswers(() => wx.stopPullDownRefresh());
  },
  refreshAnswers(done) {
    loadSnapshot(
      (data, source) => {
        const verdictOrder = { "值得打": 0, "谨慎打": 1, "不建议": 2, "待核验": 3 };
        const listing = [...(data.hk?.listings || [])]
          .sort((left, right) =>
            (verdictOrder[left.publicAnswer?.verdict] ?? 9) -
            (verdictOrder[right.publicAnswer?.verdict] ?? 9),
          )[0];
        const nvda = (data.us?.stocks || []).find((item) => item.symbol === "NVDA");
        const aShare = [...(data.aShare?.quotes || [])]
          .sort((left, right) => (right.score || 0) - (left.score || 0))[0];
        const answers = {
          hk: listing
            ? `${listing.name} · ${listing.publicAnswer?.verdict || "查看最新结论"}`
            : "当前暂无可核验的新股",
          us: nvda
            ? `NVDA · $${Number(nvda.price).toFixed(2)} · 查看价格答案`
            : "查看七姐妹与热度前三",
          a: aShare
            ? `${aShare.name} · ${aShare.currentAdvice || "查看收息结论"}`
            : "查看高股息收息答案",
          gold: data.gold?.answer
            ? `${data.gold.answer.action} · 国际金 ${data.gold.quotes?.international?.price || "待更新"}`
            : "查看国际金与上海金",
          guru: "港股 3 · 美股 5 · A股 3",
        };
        this.setData({
          entries: this.data.entries.map((item) => ({
            ...item,
            answer: answers[item.id] || item.question,
          })),
          source,
        });
      },
      done,
    );
  },
  openEntry(event) {
    const target = event.currentTarget.dataset.target;
    wx.navigateTo({ url: `/pages/section/index?market=${target}` });
  },
  onShareAppMessage() {
    return {
      title: "望潮 Aurum｜港美股、黄金与聪明人持仓",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜港美股、黄金与聪明人持仓" };
  },
});
