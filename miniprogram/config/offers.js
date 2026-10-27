// 负责人提供的真实商业物料集中放在这里。
// 港美股均已收到原始邀请链接；活动资格、推广许可及微信接入仍需单独核验。
// 二维码和注册链接保持原始内容；页面显示推广关系及收费说明。
module.exports = [
  {
    id: "global-access",
    icon: "/assets/home/globe.svg",
    title: "VPN开通",
    label: "复制注册链接",
    copy: "https://my.yunti2.net/auth/register?code=KBjZ",
    toast: "已复制，去浏览器打开",
    disclosure: "推荐链接：你通过它注册，望潮可能获得推荐佣金。",
  },
  {
    id: "paid-group",
    icon: "/assets/home/group.svg",
    title: "会员群",
    label: "复制微信号",
    copy: "yls8240",
    toast: "已复制，去微信添加朋友",
    disclosure: "付费社群：费用和群规加好友后说明，了解后再决定。",
  },
  {
    id: "open-account",
    icon: "/assets/home/account.svg",
    title: "美股开户",
    label: "复制推荐开户链接",
    copy: "https://www.interactivebrokers.com/referral/wenlong409",
    toast: "已复制，去浏览器打开",
    disclosure: "好友推荐链接：符合活动条件时推荐人可能获得奖励，资格与规则以盈透证券说明为准。",
  },
  {
    id: "hk-open-account",
    title: "港股开户",
    label: "复制邀请链接",
    copy: "https://m.usmart66.com/marketing/mgm-poster/mgm-lottery17.html?langType=1&ICode=vxgn8&inviteName=18*******24&id=20240612002&bizId=20240612002&shareId=promotion&register-ct=m&register-cid=hk-2022-aug&avatar=",
    toast: "已复制，去浏览器打开",
    disclosure: "邀请链接：活动有效期、参与资格及推荐奖励以盈立证券官方说明为准。",
  },
  // 2026-10-06 产品负责人给的 A股开户二维码。不上首页宫格，只挂在 A股栏目页底部「还没有A股账户」
  // 进的那一页：A股账户买不了美股，不能当作「海外开户」的入口。
  {
    id: "a-open-account",
    title: "A股开户",
    label: "打开二维码，长按识别",
    image: "/assets/offers/a-open-account.png",
    disclosure: "推荐渠道：你通过它开户，望潮可能获得推荐佣金。",
  },
];
