import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const product = require("../miniprogram/config/product.js");
const community = require("../miniprogram/config/community.js");
const offers = require("../miniprogram/config/offers.js");
const reviews = require("../miniprogram/config/service-verification.js");
// 2026-11-04 负责人确认另一个微信可扫码并添加；图片变更后需重新确认。
const confirmedQrSha256 = "8006311287a01bb9d85a14bb1f89d2664b7e5a140ec8614032dca3aa3c44959a";
let qrConfirmed = false;
if (/^\/assets\/offers\/[a-z0-9-]+\.jpg$/.test(community.wechatQrImage || "")) {
  try {
    const image = readFileSync(new URL(`../miniprogram${community.wechatQrImage}`, import.meta.url));
    qrConfirmed = createHash("sha256").update(image).digest("hex") === confirmedQrSha256;
  } catch (_) { /* Missing image requires a fresh confirmation. */ }
}
const report = {
  generatedAt: new Date().toISOString(),
  research: { free: !product.memberToolsEnabled, dataMode: product.dataMode },
  advertising: {
    state: product.sectionAdUnitId ? "configured-needs-live-verification" : "awaiting-real-ad-unit",
    settlementEvidence: "微信流量主实际结算单；组件加载和点击不是收入",
  },
  community: {
    priceCny: community.priceCny, term: community.termLabel,
    state: community.checkoutEnabled && community.wechatQrImage ? "public-checkout-enabled" : "consultation-only",
    promotionEndsAt: community.promotionEndsAt,
    termsVersion: community.termsVersion,
    qrScanConfirmedByOwner: qrConfirmed,
    ownerAcceptanceConfirmedAt: "2026-11-26",
    missing: [!community.serviceTerms && "服务与交付约定", !community.refundTerms && "退款约定", !qrConfirmed && "二维码微信扫码及账号归属验证", !community.checkoutEnabled && "客户端付款开关", "公众真实订单入群履约与退款结算台账持续核验"].filter(Boolean),
    settlementEvidence: "群服务独立订单、服务端支付确认及真实入群履约；不能沿用旧研究会员订单",
  },
  providers: ["hk-open-account", "open-account", "a-open-account", "global-access"].map((id) => {
    const offer = offers.find((item) => item.id === id);
    const review = reviews[id] || {};
    const authorized = review.status === "verified" && review.provider && review.qualification && review.authorization;
    return {
      id, materialSaved: Boolean(offer && (offer.copy || offer.image)),
      provider: review.provider || "待核验", state: !offer || !(offer.copy || offer.image) ? "material-missing" : (authorized ? "material-visible-reviewed-needs-acceptance" : "material-visible-awaiting-provider-review"),
      missing: [!review.qualification && "主体、服务范围及目标用户准入", !review.authorization && "对应望岳与目标用户的推广授权", "官方办理路径及实际完成验证", "服务方可核验转化与结算记录"].filter(Boolean),
    };
  }),
  liveRevenueLoopVerified: false,
};

const outputIndex = process.argv.indexOf("--out");
const output = outputIndex >= 0 && process.argv[outputIndex + 1];
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
