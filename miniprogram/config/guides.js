// 极简渠道与市场规则速查卡：只用结构化短标签对照，零长段文字说教。
module.exports = {
  accounts: {
    title: "港美股指引",
    sections: [
      {
        title: "港 · 美 · A 交易规则对比",
        rows: [
          ["交收机制", "A股 T+1 · 港股 T+0买卖/T+2交收 · 美股 T+0买卖/T+1交收"],
          ["涨跌限制", "A股 ±10% · 港股无涨跌幅 · 美股无涨跌幅"],
          ["最小单位", "A股 100股起 · 港股 1手起 · 美股 1股起"],
          ["股息税率", "A股满1年免税 · 港股 10%–20% · 美股 10%"],
        ],
      },
      {
        title: "监管牌照查验",
        links: ["sfc-register", "finra-brokercheck"],
      },
    ],
    choices: [
      { topic: "hk-open", title: "港股渠道" },
      { topic: "us-start", title: "美股渠道" },
    ],
  },
  info: {
    title: "海外访问指引",
    sections: [
      {
        title: "全球官方数据源",
        links: ["sec", "hkexnews", "gold-fred"],
      },
    ],
    offer: {
      id: "global-access",
      head: "外部网络通道",
      body: "复制网址 → 手机浏览器打开",
    },
  },
  "us-start": {
    title: "美股渠道指引",
    sections: [
      {
        title: "美股规则速览",
        rows: [
          ["夏令盘中", "21:30 – 次日 04:00（3月–11月）"],
          ["冬令盘中", "22:30 – 次日 05:00（11月–3月）"],
          ["买卖门槛", "T+0 交易 / T+1 交收 · 1 股起买"],
          ["税务规则", "W-8BEN 免资本利得税 · 股息税 10%"],
        ],
      },
      {
        title: "官方核验",
        links: ["finra-brokercheck", "sec"],
      },
    ],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）",
      body: "复制机构网址 → 手机浏览器打开",
    },
  },
  "hk-open": {
    title: "港股渠道指引",
    sections: [
      {
        title: "港股打新速览",
        rows: [
          ["FINI结算", "新股现金申购 1 手通常免息"],
          ["入场费率", "招股价上限 × 每手股数 × 1.010085"],
          ["暗盘时段", "上市前一交易日 16:15 – 18:30"],
          ["甲乙分界", "认购额 ≤500万港元甲组 · >500万乙组"],
        ],
      },
      {
        title: "官方核验",
        links: ["sfc-register", "hkexnews"],
      },
    ],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）",
      body: "复制机构网址 → 手机浏览器打开",
    },
  },
  "a-open": {
    title: "A股开户",
    sections: [
      {
        title: "A股红利税对照",
        rows: [
          ["持股 ≤1月", "股息红利税 20%"],
          ["1月 – 1年", "股息红利税 10%"],
          ["持股 >1年", "免征股息红利税（0%）"],
          ["红利 ETF", "免印花税 · 分红免个税 · 100份起"],
        ],
      },
      {
        title: "官方名录",
        links: ["csrc-brokers"],
      },
    ],
    offer: {
      id: "a-open-account",
      head: "企业微信专属通道",
      body: "长按二维码添加企业微信，一对一开户",
    },
  },
};
