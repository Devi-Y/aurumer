const { PUBLIC_ORIGIN } = require("../../config");

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
    wx.request({
      url: `${PUBLIC_ORIGIN}/data/live-snapshot.json`,
      timeout: 8000,
      success: ({ data }) => {
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
        };
        this.setData({
          entries: this.data.entries.map((item) => ({
            ...item,
            answer: answers[item.id] || item.question,
          })),
        });
      },
      fail: () => {
        this.setData({
          entries: this.data.entries.map((item) => ({
            ...item,
            answer: item.question,
          })),
        });
      },
      complete: () => {
        if (typeof done === "function") done();
      },
    });
  },
  openEntry(event) {
    const target = event.currentTarget.dataset.target;
    wx.navigateTo({ url: `/pages/webview/index?target=${target}` });
  },
  onShareAppMessage() {
    return {
      title: "望潮 Aurum｜港美股投资答案工具",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "望潮 Aurum｜港美股投资答案工具" };
  },
});
