// 九宫格后四项服务：港美股与海外访问均采用去敏合规指引口径。
module.exports = [
  { id: "paid-group", title: "会员群", icon: "/assets/home/group.svg", offerIds: ["paid-group"], url: "/pages/community/index" },
  { id: "overseas-accounts", title: "港美股指引", icon: "/assets/home/account.svg", offerIds: ["hk-open-account", "open-account"], url: "/pages/guide/index?topic=accounts" },
  { id: "a-open-account", title: "A股开户", icon: "/assets/home/a-account.svg", offerIds: ["a-open-account"], url: "/pages/guide/index?topic=a-open" },
  { id: "global-access", title: "海外访问", icon: "/assets/home/globe.svg", offerIds: ["global-access"], url: "/pages/guide/index?topic=info" },
];
