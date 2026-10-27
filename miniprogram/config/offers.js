// 负责人提供的真实商业物料集中放在这里。
// 港股、美股开户目前分别承接咨询，沿用会员群联系人，不编造开户链接。
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
    label: "复制开户链接",
    copy: "",
    pending: true,
    pendingNote: "美股开户链接准备中，可先咨询。",
    pendingContact: "paid-group",
    pendingLabel: "复制微信号，咨询美股开户",
    pendingToast: "已复制，添加好友后说明「美股开户」",
    pendingDisclosure: "请说明「美股开户」。此微信号也是会员群联系人，具体开户条件及费用以券商说明为准。",
    toast: "已复制，去浏览器打开",
    disclosure: "推荐链接：你通过它开户，望潮可能获得推荐佣金。",
  },
  {
    id: "hk-open-account",
    title: "港股开户",
    label: "复制开户链接",
    copy: "",
    pending: true,
    pendingNote: "港股开户链接准备中，可先咨询。",
    pendingContact: "paid-group",
    pendingLabel: "复制微信号，咨询港股开户",
    pendingToast: "已复制，添加好友后说明「港股开户」",
    pendingDisclosure: "请说明「港股开户」。此微信号也是会员群联系人，具体开户条件及费用以券商说明为准。",
    disclosure: "推荐渠道：你通过它开户，望潮可能获得推荐佣金。",
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
