// 简短服务页。真实物料只引用 offers.js；没有开户链接时明确显示咨询入口。
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
    lead: "看全球市场，先要读到一手信息：公司公告、官方数据、海外媒体。",
    sections: [
      {
        title: "去哪看",
        rows: [
          ["公司公告和财报", "美股看美国证监会，港股看港交所披露易"],
          ["宏观数据", "利率、通胀、就业，看美联储数据库"],
        ],
        points: ["一手来源最准，媒体解读放在后面看"],
        links: ["sec", "hkexnews", "gold-fred"],
      },
      {
        title: "怎么读",
        points: [
          "浏览器自带整页翻译，先看懂大意",
          "长财报、专业术语交给 AI 总结，并让它标出原文出处",
          "数字和日期以原文为准，AI 可能算错或编造",
        ],
      },
    ],
    offer: {
      id: "global-access",
      head: "海外网站打不开？",
      body: "部分海外网站在国内访问不稳定，可以按需选用下面的访问服务。",
    },
  },

  "us-start": {
    title: "美股开户",
    sections: [],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）",
      body: "开户条件、费用及好友推荐活动资格以盈透证券官方说明为准。",
    },
  },

  "hk-open": {
    title: "港股开户",
    sections: [],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）",
      body: "开户条件、费用及邀请活动资格以盈立证券官方说明为准。",
    },
  },

  vpn: {
    title: "VPN开通",
    sections: [],
    offer: {
      id: "global-access",
      head: "查看VPN服务",
      body: "复制现有推荐链接，在浏览器查看套餐和服务说明。",
    },
  },

  "a-open": {
    title: "A股开户",
    sections: [],
    offer: {
      id: "a-open-account",
      head: "还没有 A股账户？",
      body: "买红利股和红利 ETF 都要先有 A股证券账户，想好再开。",
    },
  },
};
