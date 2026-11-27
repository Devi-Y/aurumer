// 极简服务操作页：一屏直达，少读字、直接办。真实物料统一来自 offers.js。
module.exports = {
  accounts: {
    title: "港美股开户",
    sections: [],
    choices: [
      { topic: "hk-open", title: "港股开户" },
      { topic: "us-start", title: "美股开户" },
    ],
  },
  info: {
    title: "全球信息获取",
    lead: "看全球市场，先读一手官方公告与数据。",
    sections: [
      {
        title: "官方出处",
        rows: [
          ["公司财报", "美股看美国证监会，港股看港交所披露易"],
          ["宏观利率", "利率、通胀、就业看美联储数据库"],
        ],
        links: ["sec", "hkexnews", "gold-fred"],
      },
    ],
    offer: {
      id: "global-access",
      head: "海外官网打不开？",
      body: "复制下方网址到手机自带浏览器打开即可注册使用。",
    },
  },

  "us-start": {
    title: "美股开户",
    sections: [],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）美股开户",
      body: "复制网址后，打开手机浏览器粘贴即可在线申请。",
    },
  },

  "hk-open": {
    title: "港股开户",
    sections: [],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）港股开户",
      body: "复制网址后，打开手机浏览器粘贴即可在线申请。",
    },
  },

  vpn: {
    title: "VPN开通",
    sections: [],
    offer: {
      id: "global-access",
      head: "海外财经网络访问开通",
      body: "独立第三方网络服务，复制网址到手机浏览器粘贴即可注册。",
    },
  },

  "a-open": {
    title: "A股开户",
    sections: [],
    offer: {
      id: "a-open-account",
      head: "A股一对一协助开户",
      body: "长按下方二维码添加企业微信，顾问一对一协助开户。",
    },
  },
};
