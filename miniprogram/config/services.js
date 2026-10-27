// 九宫格后四项服务，港股/美股开户在同一入口内分别选择。
module.exports = [
  { id: "paid-group", title: "会员群", icon: "/assets/home/group.svg", offerIds: ["paid-group"], url: "/pages/community/index" },
  { id: "overseas-accounts", title: "港美股开户", icon: "/assets/home/account.svg", offerIds: ["hk-open-account", "open-account"], url: "/pages/guide/index?topic=accounts" },
  { id: "a-open-account", title: "A股开户", icon: "/assets/home/a.svg", offerIds: ["a-open-account"], url: "/pages/guide/index?topic=a-open" },
  { id: "global-access", title: "VPN开通", icon: "/assets/home/globe.svg", offerIds: ["global-access"], url: "/pages/guide/index?topic=vpn" },
];
