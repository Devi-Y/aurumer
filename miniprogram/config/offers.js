// 首页九宫格里六个研究栏目之后的服务格，物料全部由产品负责人提供，这里只做搬运。
// 小程序打不开外部网页，所以每一格都是「点一下复制」：copy 是写进剪贴板的内容，
// toast 是复制成功后的提示。copy 为空的项不会上屏——没拿到链接或微信号之前
// 宁可空着，也不要自己编一个占位。海外开户拿到链接后加在最后，正好补满第九格。
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
];
