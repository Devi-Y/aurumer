// 合规指引与渠道页：只保留简明指引与外部渠道索引，明确非招揽与合法使用边界。
module.exports = {
  accounts: {
    title: "港美股指引",
    sections: [],
    choices: [
      { topic: "hk-open", title: "港股渠道" },
      { topic: "us-start", title: "美股渠道" },
    ],
  },
  info: {
    title: "海外访问指引",
    sections: [
      {
        title: "常用官方数据源",
        links: ["sec", "hkexnews", "gold-fred"],
      },
    ],
    offer: {
      id: "global-access",
      head: "外部网络加速通道",
      body: "指引：复制外部网址 → 手机浏览器自行了解（仅限合法查阅公开资料）",
    },
  },
  "us-start": {
    title: "美股渠道指引",
    sections: [],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）",
      body: "指引：复制机构网址 → 手机浏览器自主核验资格与规则",
    },
  },
  "hk-open": {
    title: "港股渠道指引",
    sections: [],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）",
      body: "指引：复制机构网址 → 手机浏览器自主核验资格与规则",
    },
  },
  vpn: {
    title: "海外访问指引",
    sections: [
      {
        title: "常用官方数据源",
        links: ["sec", "hkexnews", "gold-fred"],
      },
    ],
    offer: {
      id: "global-access",
      head: "外部网络加速通道",
      body: "指引：复制外部网址 → 手机浏览器自行了解（仅限合法查阅公开资料）",
    },
  },
  "a-open": {
    title: "A股开户",
    sections: [],
    offer: {
      id: "a-open-account",
      head: "企业微信专属通道",
      body: "长按二维码添加企业微信，一对一开户",
    },
  },
};
