/**
 * 这里只放可以进入小程序包的公开运行配置。
 * 商户密钥和证书由云开发 cloudPay 代管；商品价格只在云函数白名单中维护。
 * snapshotCdnUrl（方案 A）：配置已 ICP 备案的国内自有域名静态快照地址
 * （如 "https://aurum.wenyue-sz.com/data/live-snapshot.json" 并在微信后台加入 request 合法域名）
 * 即可开启 20~50ms CDN 零冷启动直连；留空时自动走 aurum-data 云函数，零影响。
 */
module.exports = {
  cloudEnv: "cloud1-d6gl8we7c8fa1d672",
  memberFunction: "aurum-member",
  snapshotCdnUrl: "https://wenyue-sz.com/aurum/live-snapshot.json",
};
