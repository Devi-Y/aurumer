// 开户/网络服务的经营主体、许可及推广授权核验记录。
// 只有完成实际材料核验后才可改为 verified；入口保留，未核验时不提供办理动作。
// 记录公开许可或内部审核编号，不放合同正文及个人信息。
module.exports = {
  "hk-open-account": { status: "pending", provider: "", qualification: "", authorization: "" },
  // 已收到原链接；券商品牌已识别，具体签约主体、推广许可和微信接入尚待核验。
  "open-account": { status: "pending", provider: "Interactive Brokers（盈透证券）", qualification: "", authorization: "" },
  "a-open-account": { status: "pending", provider: "", qualification: "", authorization: "" },
  "global-access": { status: "pending", provider: "", qualification: "", authorization: "" },
};
