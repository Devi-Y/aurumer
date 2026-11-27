// 望岳（望潮 Aurum）8 条变现渠道统一配置与合规风控中枢。
// 原则：免费研究保持客观中立，任何商业入口不得影响研究排序；
// 未完成合规核验与独立开关开启的渠道，前台保持 100% 静默隐藏（零占位、零打扰）。

const CHANNELS = {
  // ===== 第一梯队：立即启动现金流 =====
  paidGroup: {
    tier: 1,
    name: "付费微信群（298元/年）",
    status: "public_active",
    enabled: true,
    reviewed: true,
    configFile: "config/community.js",
    cloudFunction: "aurum-member",
    riskGate: "2026-11-26 负责人已完成真机验收并开启公开收款（本期 298 元档期至 2026-12-31）；服务端微信查单 SUCCESS 后弹二维码，服务期自实际入群日起算 365 天，不自动续费。",
    revenueEvidence: "服务端微信支付查单 SUCCESS + 实际入群履约记录",
  },
  wechatAd: {
    tier: 1,
    name: "微信流量主原生广告",
    status: "slot_ready",
    configFile: "config/product.js",
    riskGate: "取得流量主真实广告位 ID 后填入 product.sectionAdUnitId；只放研究内容下方，不弹窗不诱导点击。",
    revenueEvidence: "微信公众平台流量主实际结算账单",
  },

  // ===== 第二梯队：随日活起量，提升单用户价值 =====
  brokerageAccounts: {
    tier: 2,
    name: "公开市场机构信息指引",
    status: "material_shown_pending_auth",
    configFile: "config/offers.js",
    riskGate: "严格区分境内与境外公开信息边界，明示非招揽声明与地区适用限制，不代办业务。",
    revenueEvidence: "合规合作机构真实结算单",
  },
  globalAccess: {
    tier: 2,
    name: "海外公开资料访问指引",
    status: "material_shown_pending_auth",
    configFile: "config/offers.js",
    riskGate: "核验服务主体与微信平台准入规范，页面文案严格保持中性合规，仅限合法查阅公开资料。",
    revenueEvidence: "合格服务方实际订单与结算记录",
  },
  sponsorship: {
    tier: 2,
    name: "商业赞助（单行质感铭牌）",
    status: "component_ready",
    // 核验完赞助合同与广告标识后，将 enabled 与 reviewed 置为 true 并填写真实赞助商信息即可上线。
    enabled: false,
    reviewed: false,
    markets: ["hk", "us", "a", "gold", "guru"],
    sponsorName: "",
    tagline: "",
    disclosure: "商业赞助 · 不影响免费研究排序与独立判断",
    // 可选：点击后跳转的已合规核验品牌小程序，不填则仅展示纯铭牌。
    miniProgramAppId: "",
    miniProgramPath: "",
    riskGate: "须显著标明「商业赞助」字样，不涉及金融荐股/收益承诺，与研究结论物理隔离。",
    revenueEvidence: "正式商业赞助协议与对公收款凭证",
  },

  // ===== 第三梯队：长期品牌资产与高毛利护城河 =====
  familyBrand: {
    tier: 3,
    name: "自有家庭消费品牌",
    status: "bridge_ready",
    // 推荐独立微信小店/品牌小程序承接交易，彻底隔离财经工具类目与电商类目审核风险。
    enabled: false,
    reviewed: false,
    brandName: "",
    tagline: "",
    disclosure: "望岳自有家庭消费品牌 · 独立小程序服务",
    miniProgramAppId: "",
    miniProgramPath: "",
    riskGate: "须具备完整主体经营资质与商品质检/售后体系，使用独立微信小店或品牌小程序完成交易。",
    revenueEvidence: "独立品牌小程序/微信小店实际成交与妥投结算",
  },
  ipLicensing: {
    tier: 3,
    name: "IP 授权",
    status: "foundation_ready",
    riskGate: "先完成核心商标注册与美术/视觉作品版权登记，再签订书面授权协议并限定使用边界。",
    revenueEvidence: "书面 IP 授权合同与授权费到账凭证",
  },
  copyrightCollab: {
    tier: 3,
    name: "版权与品牌合作",
    status: "foundation_ready",
    riskGate: "研报长图/财商读物与联名内容坚持真实公开数据溯源，明确标注免责与版权归属。",
    revenueEvidence: "正式版权/联名合作协议与结算凭证",
  },
};

function isValidAppId(appId) {
  return typeof appId === "string" && /^wx[0-9a-f]{16}$/.test(appId.trim());
}

function activeSponsorFor(market) {
  const cfg = CHANNELS.sponsorship;
  if (!cfg || cfg.enabled !== true || cfg.reviewed !== true) return null;
  if (!cfg.sponsorName || !cfg.disclosure) return null;
  if (Array.isArray(cfg.markets) && market && !cfg.markets.includes(market)) return null;
  return {
    kind: "sponsor",
    badge: "商业赞助",
    title: cfg.sponsorName,
    tagline: cfg.tagline || "",
    disclosure: cfg.disclosure,
    appId: isValidAppId(cfg.miniProgramAppId) ? cfg.miniProgramAppId.trim() : "",
    path: cfg.miniProgramPath || "",
  };
}

function activeFamilyBrand() {
  const cfg = CHANNELS.familyBrand;
  if (!cfg || cfg.enabled !== true || cfg.reviewed !== true) return null;
  if (!cfg.brandName || !cfg.disclosure || !isValidAppId(cfg.miniProgramAppId)) return null;
  return {
    kind: "familyBrand",
    badge: "望岳严选",
    title: cfg.brandName,
    tagline: cfg.tagline || "自有家庭消费品牌",
    disclosure: cfg.disclosure,
    appId: cfg.miniProgramAppId.trim(),
    path: cfg.miniProgramPath || "",
  };
}

module.exports = {
  CHANNELS,
  activeSponsorFor,
  activeFamilyBrand,
};
