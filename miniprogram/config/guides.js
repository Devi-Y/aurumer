// 极简渠道页：只给渠道名称与开通方式，零多余铺垫。
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
    title: "全球信息入口",
    sections: [
      {
        title: "常用官方网址",
        links: ["sec", "hkexnews", "gold-fred"],
      },
    ],
    offer: {
      id: "global-access",
      head: "VPN 开通渠道",
      body: "复制链接 → 手机浏览器打开注册",
    },
  },
  "us-start": {
    title: "美股开户",
    sections: [],
    offer: {
      id: "open-account",
      head: "盈透证券（IBKR）",
      body: "复制链接 → 手机浏览器打开申请",
    },
  },
  "hk-open": {
    title: "港股开户",
    sections: [],
    offer: {
      id: "hk-open-account",
      head: "盈立证券（uSMART）",
      body: "复制链接 → 手机浏览器打开申请",
    },
  },
  vpn: {
    title: "VPN开通",
    sections: [],
    offer: {
      id: "global-access",
      head: "在线注册通道",
      body: "复制链接 → 手机浏览器打开注册",
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
