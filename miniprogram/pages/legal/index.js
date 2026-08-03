const legalInfo = require("../../config/legal");

const SECTIONS = [
  {
    title: "一、会员商品与价格",
    paragraphs: [
      "望潮年度研究会员是单次购买的 365 天数字工具使用权，价格为人民币 1288 元，不自动续费。",
      "交付范围包括跨市场变化雷达、投资事件日历、决策证据留档、每周复盘，以及同步导出与到期只读保全等研究工具；公开市场信息不会因购买会员而变成个性化荐股服务。",
      "望潮不提供证券交易、自动下单、收益保证，也不把具体买卖建议、收益预测或承诺作为会员商品交付。",
    ],
  },
  {
    title: "二、下单、交付与有效期",
    paragraphs: [
      "会员页在购买按钮旁明确展示价格、期限、协议与成年提示；用户点击购买即确认同意当前版本协议并确认已满 18 周岁，随后直接发起普通小程序微信支付。客户端显示支付成功不直接发放权益，服务端通过微信查单核对订单号、商户号、AppID、用户标识、商品及 1288 元实付金额后生效。",
      "权益从服务端确认发放时起计算 365 天；续期按现有有效期顺延。同一订单只发放一次，待确认订单会在用户访问时及后台定时任务中继续复核。",
      "因网络、微信支付或云服务异常未及时到账时，请通过小程序内微信客服提供脱敏订单号核对，不要发送任何密钥、验证码或完整支付凭证。",
    ],
  },
  {
    title: "三、退款与售后",
    paragraphs: [
      "退款资格、金额和路径以适用法律、微信支付平台规则、实际履约情况及双方确认结果为准，本协议不设置排除法定消费者权利的绝对不退款条款。",
      "退款申请、到账进度、支付失败、重复扣款或投诉均通过小程序内微信客服处理。运营人员核对订单和履约情况后，在微信支付商户平台发起人工原路退款，不要求用户提供密码、验证码或支付密钥。",
      "普通查单只显示订单已进入退款时，可能无法可靠区分全额退款与部分退款。系统会把订单标记为待人工核对，在退款金额和履约状态确认前不自动错误回收全部权益；核对后再按实际退款金额处理对应订单，不影响其他独立订单。",
    ],
  },
  {
    title: "四、处理的信息与用途",
    paragraphs: [
      "为隔离用户数据、验证权益和处理订单，系统处理微信提供的小程序用户标识、登录校验结果、订单号、商品与金额、支付/退款状态、权益起止时间以及必要的安全日志。",
      "用户主动填写的标的名称、代码、备注和决策档案仅用于提供个人研究工作台、跨设备同步、导出与删除功能。购买前还需确认本人已满 18 周岁；望潮只记录该确认结果，不要求填写生日或身份证。请勿在自由文本中填写身份证号、银行卡号、账户密码或其他不必要的敏感信息。",
      "以上信息不用于出售用户画像或向无关第三方投放广告。普通小程序微信支付与云存储由微信支付和微信云开发相关服务提供必要技术处理。",
    ],
  },
  {
    title: "五、保存期限与删除",
    paragraphs: [
      "个人工作台记录保存至用户主动永久删除、处理目的不再需要或服务停止；用户可随时逐条删除或一键永久删除全部工作台记录。",
      "订单、支付、退款、售后和协议确认记录原则上自交易完成之日起保存 3 年；法律、财税、监管或微信平台规则要求更长期间的，按其要求保存，期限届满后删除或匿名化。",
      "法定保存期限未届满或暂时无法删除的数据，只用于存储、安全保护、履约、退款、财税与争议处理，不再用于无关目的。",
    ],
  },
  {
    title: "六、用户权利与退出",
    paragraphs: [
      "用户可以在研究工作台查看、复制导出、更正或删除本人填写的记录；权益到期后仍保留只读、导出和删除能力。",
      "望潮不另行创建用户名密码账户。停止使用时，可先导出并永久删除工作台记录；对依法可删除的订单关联信息、信息处理解释或其他权利请求，可联系微信客服。",
      "撤回同意或停止使用不影响撤回前基于同意或履约所进行处理的效力，也不影响必须履行的订单、退款和法定保存义务。",
    ],
  },
  {
    title: "七、安全、未成年人及变更",
    paragraphs: [
      "AppSecret、商户密钥、APIv3 密钥、证书、商品价格白名单和服务端签名不会进入小程序包；个人工作台集合禁止客户端直接读写，由云函数按当前微信用户隔离访问。",
      "会员商品不面向未满 18 周岁的未成年人销售。继续付款即确认本人已满 18 周岁；若监护人发现未成年人误购或提交个人信息，请及时联系微信客服处理。",
      "协议版本更新后，之前的确认不会自动沿用；再次购买前须阅读并确认新版本。重大变化将在会员页提示，正式文本由运营主体在发布前完成审查。",
    ],
  },
];

function policyText() {
  const header = [
    "望潮会员服务协议与隐私说明",
    `版本：${legalInfo.termsVersion} / ${legalInfo.privacyVersion}`,
    `生效日期：${legalInfo.effectiveDate}`,
    `运营主体：${legalInfo.operatorName}`,
    `联系方式：${legalInfo.contactMethod}`,
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
      success: () => wx.showToast({ title: "协议全文已复制", icon: "none" }),
    });
  },
  openPlatformPrivacy() {
    const fallback = () => wx.showModal({
      title: "查看隐私指引",
      content: "请点小程序右上角“…”进入更多资料，再打开《望潮用户隐私保护指引》。",
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
