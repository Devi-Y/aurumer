// 首页九宫格里六个研究栏目之后的服务格，物料全部由产品负责人提供，这里只做搬运。
// 小程序打不开外部网页，所以每一格都是「点一下复制」：copy 是写进剪贴板的内容，
// toast 是复制成功后的提示。copy 为空的项默认不上屏——没拿到链接或微信号之前
// 不要自己编一个占位。唯一例外是 pending: true：产品负责人要求先把格子摆上
// （2026-09-29 海外开户），点了只提示 pendingToast，不复制任何东西；
// 拿到开户链接和券商名后填进 copy、删掉 pending 即可。
module.exports = [
  {
    id: "global-access",
    icon: "/assets/home/globe.svg",
    title: "全球信息获取",
    copy: "https://my.yunti2.net/auth/register?code=KBjZ",
    toast: "已复制，去浏览器打开",
  },
  {
    id: "paid-group",
    icon: "/assets/home/group.svg",
    title: "付费交流群",
    copy: "yls8240",
    toast: "已复制，去微信加好友",
  },
  {
    id: "open-account",
    icon: "/assets/home/account.svg",
    title: "海外开户",
    copy: "",
    pending: true,
    pendingToast: "开户通道即将开放",
    toast: "已复制，去浏览器打开",
  },
];
