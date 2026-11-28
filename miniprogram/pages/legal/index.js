const legalInfo = require("../../config/legal");

const SECTIONS = [
  {
    title: "一、会员商品与价格",
    paragraphs: [
      "年度研究会员为 365 天数字工具权限（人民币 1288 元，不自动续费），支持记录同步与导出；望潮不提供荐股或具体买卖建议。",
    ],
  },
  {
    title: "二、下单、交付与有效期",
    paragraphs: [
      "使用普通小程序微信支付结算，服务端核实订单实付金额后即时开通 365 天权益。",
    ],
  },
  {
    title: "三、退款与售后",
    paragraphs: [
      "售后与原路退款请联系微信客服处理；系统区分核对全额退款与部分退款状态，保障双方合法权益。",
    ],
  },
  {
    title: "四、处理的信息与用途",
    paragraphs: [
      "仅处理订单核验与个人工作台同步所需最小信息；成年确认仅记录勾选状态，不要求填写生日或身份证。",
    ],
  },
  {
    title: "五、保存期限与删除",
    paragraphs: [
      "个人记录可随时一键永久删除；交易与售后凭证按法规保存 3 年后删除或匿名化。",
    ],
  },
  {
    title: "六、用户权利与退出",
    paragraphs: [
      "用户可随时查看、复制导出或删除个人记录，到期后仍保留只读、导出与删除权限。",
    ],
  },
  {
    title: "七、安全、未成年人及变更",
    paragraphs: [
      "服务不面向未满 18 周岁未成年人；密钥与个人记录均由云端严格隔离保护。",
    ],
  },
];

function policyText() {
  const header = [
    "望潮会员服务协议与隐私说明",
    `版本：${legalInfo.termsVersion} / ${legalInfo.privacyVersion}`,
    `生效日期：${legalInfo.effectiveDate}`,
    `运营主体：${legalInfo.operatorName}`,
    "",
  ];
  return header.concat(SECTIONS.flatMap((section) => [section.title, ...section.paragraphs, ""])).join("\n");
}

Page({
  data: {
    legalInfo,
    sections: SECTIONS.map((section) => ({ ...section, expanded: false })),
    draft: !legalInfo.operatorReady,
  },
  toggleSection(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.sections[index]) return;
    this.setData({ [`sections[${index}].expanded`]: !this.data.sections[index].expanded });
  },
  copyPolicy() {
    wx.setClipboardData({
      data: policyText(),
      success: () => wx.showToast({ title: "已复制", icon: "none" }),
    });
  },
  openPlatformPrivacy() {
    const fallback = () => wx.showModal({
      title: "隐私指引",
      content: "请点右上角“…”进入更多资料查看《望潮用户隐私保护指引》。",
      showCancel: false,
    });
    if (typeof wx.openPrivacyContract !== "function") {
      fallback();
      return;
    }
    wx.openPrivacyContract({ fail: fallback });
  },
  openMember() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/member/index" }) });
  },
  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
