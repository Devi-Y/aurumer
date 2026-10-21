// 商业物料（推荐链接、社群微信号）只放这一个文件，物料全部由产品负责人提供，这里只做搬运；
// 要下架某一项，删掉这一项或清空 copy 即可，页面上对应的按钮会自己收起，首页那一格也会消失。
//
// 首页九宫格里有 icon 的三项（全球信息获取、付费交流群、海外开户）点一下进各自的二级页，
// 物料挂在二级页末尾：global-access 在「全球信息获取」页，open-account 在「海外开户」页，
// paid-group 在「付费交流群」页。首页本身不复制任何东西。
//
// 小程序打不开外部网页，所以按钮要么复制、要么打开二维码：copy 是写进剪贴板的内容，toast 是复制成功
// 后的提示，label 是按钮上的字，disclosure 是按钮旁边必须写出来的推广关系或收费说明。
// image 是放在包里的二维码图片（产品负责人给的原图），点按钮全屏打开，用户长按识别。
// copy 和 image 都为空的项不出按钮——没拿到链接或微信号之前不要自己编一个占位。
// pending: true 是产品负责人要求先留位置的项（2026-09-29 海外开户）：没有开户链接可复制，
// 但不能让用户走到这里就断掉——pendingContact 指向另一项里真实存在的微信号（这里不再另写一份），
// 按钮复制它，用户加好友后发「我想开户」留下需求。不想收开户咨询时，删掉 pendingContact 和后面三项 pending*，
// 页面就只剩 pendingNote 一句话；下架 paid-group 时这几行也要一起删（检查会提醒）。拿到开户链接和券商名后填进 copy、删掉 pending 和 pending* 字段即可。
// 不提供微信客服按钮（2026-10-06 产品负责人决定）。
module.exports = [
  {
    id: "global-access",
    icon: "/assets/home/globe.svg",
    title: "全球信息获取",
    label: "复制注册链接",
    copy: "https://my.yunti2.net/auth/register?code=KBjZ",
    toast: "已复制，去浏览器打开",
    disclosure: "推荐链接：你通过它注册，望潮可能获得推荐佣金。",
  },
  {
    id: "paid-group",
    icon: "/assets/home/group.svg",
    title: "付费交流群",
    label: "复制微信号",
    copy: "yls8240",
    toast: "已复制，去微信添加朋友",
    disclosure: "付费社群：费用和群规加好友后说明，了解后再决定。",
  },
  {
    id: "open-account",
    icon: "/assets/home/account.svg",
    title: "海外开户",
    label: "复制开户链接",
    copy: "",
    pending: true,
    pendingNote: "开户链接还在准备中。",
    pendingContact: "paid-group",
    pendingLabel: "复制微信号，说「我想开户」",
    pendingToast: "已复制，去微信添加朋友，发「我想开户」",
    pendingDisclosure: "加好友后发「我想开户」留下需求。这个微信号也是「付费交流群」的联系人。",
    toast: "已复制，去浏览器打开",
    disclosure: "推荐链接：你通过它开户，望潮可能获得推荐佣金。",
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
