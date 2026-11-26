// 简短服务页。真实物料只引用 offers.js；没有开户链接时明确显示咨询入口。
module.exports = {
  accounts: {
    title: "港美股开户",
    lead: "按你要看的市场选择，全程在持牌券商官方渠道独立办理。",
    sections: [
      {
        title: "怎么选",
        rows: [
          ["港股开户", "适合参与港股打新与配置港股龙头"],
          ["美股开户", "适合配置美股科技巨头与全球指数 ETF"],
        ],
      },
    ],
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
    sections: [
      {
        title: "办理前准备",
        rows: [
          ["身份材料", "有效身份证件及常用邮箱、手机号"],
          ["同名账户", "用于本人同名出入金结算"],
        ],
      },
    ],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）",
      body: "复制链接，在浏览器打开。",
    },
  },

  "hk-open": {
    title: "港股开户",
    sections: [
      {
        title: "办理前准备",
        rows: [
          ["身份材料", "本人有效身份证件及实名联系方式"],
          ["香港银行卡", "用于后续本人同名港币出入金"],
        ],
      },
    ],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）",
      body: "复制链接，在浏览器打开。",
    },
  },

  vpn: {
    title: "VPN开通",
    sections: [
      {
        title: "使用提示",
        points: [
          "仅用于合法查阅海外公开学术、商业及金融披露资讯",
          "服务由独立第三方提供，请核对服务条款后按需选用",
        ],
      },
    ],
    offer: {
      id: "global-access",
      head: "查看VPN服务",
      body: "复制链接，在浏览器打开。",
    },
  },

  "a-open": {
    title: "A股开户",
    sections: [
      {
        title: "办理前准备",
        rows: [
          ["本人身份证", "处于有效期内的二代居民身份证"],
          ["一类银行卡", "本人名下常见商业银行一类储蓄卡"],
        ],
      },
    ],
    offer: {
      id: "a-open-account",
      head: "开户咨询",
      body: "长按二维码，添加企业微信一对一咨询开户。",
    },
  },
};
