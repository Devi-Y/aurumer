const ENTRIES = [
  {
    id: "hk",
    kicker: "HK · 新股",
    title: "港股打新",
    question: "这只新股值不值得打？中签后怎么卖？",
    tone: "hk",
  },
  {
    id: "us",
    kicker: "US · 机会",
    title: "美股投资",
    question: "七姐妹和热门 AI 股，现在贵不贵？",
    tone: "us",
  },
  {
    id: "a",
    kicker: "CN · 收息",
    title: "A股收息",
    question: "资金成本低于多少，适合长期收息？",
    tone: "a",
  },
];

Page({
  data: { entries: ENTRIES },
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
