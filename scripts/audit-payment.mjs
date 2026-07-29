import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  entitlementData,
  entitlementReviewRequired,
  entitlementSchedule,
  normalizeEntitlementCredits,
} = require(path.join(root, "cloudfunctions/aurum-member/entitlement-ledger.js"));
const {
  shouldReconcileOrder,
} = require(path.join(root, "cloudfunctions/aurum-member/order-reconcile-policy.js"));
const {
  REQUIRED_LEGAL_VERSIONS,
  validateLegalConsent,
} = require(path.join(root, "cloudfunctions/aurum-member/legal-policy.js"));
const {
  paymentReadiness,
  paymentTestAccountId,
} = require(path.join(root, "cloudfunctions/aurum-member/payment-readiness.js"));
const {
  FREE_TEST_CAMPAIGN_ID,
  FREE_TEST_DAYS,
  freeTestGrantId,
  prepareFreeTestGrant,
} = require(path.join(root, "cloudfunctions/aurum-member/free-test-entitlement.js"));
const {
  cloudPaySnapshot,
  cloudPayTradeState,
  isCloudPayCallback,
  parseWechatTime,
  validateCloudPayOrder,
} = require(path.join(root, "cloudfunctions/aurum-member/wechat-cloudpay.js"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function versionAtLeast(actual, minimum) {
  const left = String(actual).split(".").map((part) => Number(part) || 0);
  const right = String(minimum).split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) {
      return (left[index] || 0) > (right[index] || 0);
    }
  }
  return true;
}

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

const appConfig = JSON.parse(await source("miniprogram/app.json"));
const rootProject = JSON.parse(await source("project.config.json"));
const miniProject = JSON.parse(await source("miniprogram/project.config.json"));
const runtime = await source("miniprogram/config/runtime.js");
const app = await source("miniprogram/app.js");
const client = await source("miniprogram/services/member.js");
const memberPage = await source("miniprogram/pages/member/index.js");
const memberTemplate = await source("miniprogram/pages/member/index.wxml");
const memberStyles = await source("miniprogram/pages/member/index.wxss");
const legalPage = await source("miniprogram/pages/legal/index.js");
const legalTemplate = await source("miniprogram/pages/legal/index.wxml");
const legalConfigSource = await source("miniprogram/config/legal.js");
const legalConfigModule = { exports: {} };
vm.runInNewContext(legalConfigSource, {
  module: legalConfigModule,
  exports: legalConfigModule.exports,
});
const legalConfig = legalConfigModule.exports;
const workspacePage = await source("miniprogram/pages/workspace/index.js");
const workspaceTemplate = await source("miniprogram/pages/workspace/index.wxml");
const backend = await source("cloudfunctions/aurum-member/index.js");
const paymentReadinessSource = await source("cloudfunctions/aurum-member/payment-readiness.js");
const cloudPaySource = await source("cloudfunctions/aurum-member/wechat-cloudpay.js");
const triggerConfig = JSON.parse(await source("cloudfunctions/aurum-member/config.json"));
const cloudPackage = JSON.parse(await source("cloudfunctions/aurum-member/package.json"));
const cloudPackageLock = JSON.parse(await source("cloudfunctions/aurum-member/package-lock.json"));
const backendReadme = await source("cloudfunctions/aurum-member/README.md");
const launchGuide = await source("MINIPROGRAM_LAUNCH_GUIDE.md");
const reviewCopy = await source("MINIPROGRAM_REVIEW_COPY.txt");
const cloudEnv = runtime.match(/cloudEnv:\s*"([^"]*)"/)?.[1] || "";

function loadMemberClient({ runtimeConfig, wxMock, immediateTimers = true }) {
  const memberModule = { exports: {} };
  vm.runInNewContext(client, {
    module: memberModule,
    exports: memberModule.exports,
    wx: wxMock,
    setTimeout(callback, milliseconds) {
      if (immediateTimers) callback();
      return milliseconds;
    },
    require(request) {
      if (request === "../config/runtime") return runtimeConfig;
      throw new Error(`会员客户端出现未知依赖：${request}`);
    },
  });
  return memberModule.exports;
}

function backendResult(data) {
  return Promise.resolve({ result: { ok: true, data } });
}

function preparedPayment() {
  return {
    orderId: "AU-test-order",
    payment: {
      kind: "wechat-jsapi",
      timeStamp: "1777777777",
      nonceStr: "test-nonce",
      package: "prepay_id=test-prepay",
      signType: "MD5",
      paySign: "test-pay-sign",
    },
  };
}

assert(appConfig.pages.includes("pages/member/index"), "会员页未注册到 app.json");
assert(appConfig.pages.includes("pages/legal/index"), "会员协议与隐私说明页未注册到 app.json");
assert(appConfig.pages.includes("pages/workspace/index"), "研究工作台未注册到 app.json");
assert(rootProject.cloudfunctionRoot === "cloudfunctions/", "根项目未声明 cloudfunctionRoot");
assert(/^wx[0-9a-f]{16}$/.test(rootProject.appid), "根项目尚未配置有效的独立小程序 AppID");
assert(rootProject.appid === miniProject.appid, "根项目与 miniprogram 子项目 AppID 不一致");
assert(miniProject.cloudfunctionRoot === "../cloudfunctions/", "miniprogram 子项目未关联同一云函数目录");
assert(versionAtLeast(miniProject.libVersion, "2.0.0"), "小程序基础库版本无效");
assert(/^[a-z][a-z0-9-]{5,39}$/.test(cloudEnv), "小程序尚未配置有效的独立云环境 ID");
assert(launchGuide.includes(cloudEnv), "上线手册与小程序云环境 ID 不一致");
assert(app.includes("wx.cloud.init") && app.includes("runtime.cloudEnv"), "小程序未按运行配置初始化云环境");

assert(client.includes("wx.requestPayment"), "会员购买没有使用普通小程序支付");
assert(!client.includes("wx.requestVirtualPayment"), "客户端仍残留虚拟支付道具路线");
assert(!backend.includes("prepareVirtualPurchase") && !backend.includes('kind: "virtual"'), "服务端仍允许创建新的虚拟支付订单");
assert(client.includes('callBackend("preparePurchase"') && !client.includes('callBackend("queryOrder"'), "客户端支付应只下单一次并直接拉起微信收银台，不应阻塞等待查单");
assert(backend.includes('event.action === "queryOrder"'), "服务端缺少支付回调失败后的查单恢复能力");
assert(memberPage.includes("state.paymentReady") && memberPage.includes("state.purchaseAllowed") && memberPage.includes("支付通道准备中"), "支付未就绪时购买入口没有安全拦截");
assert(memberPage.includes("purchase(planId") && !memberPage.includes('title: "确认开通望潮会员"'), "会员页没有使用点击购买后直达微信支付的最短流程");
assert(memberPage.includes("termsVersion: legalInfo.termsVersion") && memberPage.includes("adultConfirmed: true") && client.includes("legalConsent"), "客户端没有向服务端提交当前协议版本或成年确认");
assert(memberTemplate.includes("点击即确认已满 18 周岁") && legalPage.includes("不要求填写生日或身份证"), "购买流程缺少清晰且最小化的成年确认");
const memberAndLegalCopy = `${memberTemplate}\n${legalPage}\n${legalTemplate}`;
assert(memberAndLegalCopy.includes("具体买卖建议") && memberAndLegalCopy.includes("不提供荐股"), "会员商品缺少非荐股交付边界");
assert(legalPage.includes("普通小程序微信支付") && !legalPage.includes("微信虚拟支付"), "协议仍把普通小程序支付误写为虚拟支付");
assert(`${memberTemplate}\n${legalPage}`.includes("个人记录导出") && !memberTemplate.includes("数据更新提醒"), "会员页承诺必须与首期实际交付一致");
assert(memberTemplate.includes("365 天") && client.includes("¥1,288 / 年"), "会员页未展示唯一的 1288 元年度方案");
assert(memberTemplate.includes("¥1,288") && memberTemplate.includes("365 天") && memberTemplate.includes("不自动续费"), "会员主页面缺少清晰的年费与续费说明");
assert(memberStyles.includes("font-size: 54rpx") && memberStyles.includes("min-height: 82rpx"), "会员价格或底部固定购买按钮不符合长辈友好尺寸");
assert(memberTemplate.includes('class="pay-dock"') && memberStyles.includes("position: fixed") && memberTemplate.includes("立即微信支付"), "会员页缺少始终可见的一键支付入口");
assert(memberPage.includes('plan.id === ANNUAL_PLAN.id') && memberPage.includes('id: "research-365d"'), "客户端没有拒绝旧的 30/90 天远端方案");
assert(workspaceTemplate.includes("到期后仍可查看、导出和删除"), "工作台缺少到期用户的数据可携带边界");
assert(workspacePage.includes("wx.setClipboardData"), "工作台缺少个人记录导出实现");
assert(workspacePage.includes("verificationPending") && workspacePage.includes("权益核验中（只读）"), "退款查单失败时工作台没有降级为只读");
assert(workspacePage.includes("deleteWorkspace") && workspaceTemplate.includes("删除全部记录"), "工作台缺少用户主动删除能力");
assert(memberTemplate.includes('open-type="contact"'), "会员页缺少微信客服入口");
assert(memberPage.includes('url: "/pages/legal/index"') && memberTemplate.includes("协议与退款规则"), "会员页缺少完整协议入口");
for (const label of ["会员商品与价格", "下单、交付与有效期", "退款与售后", "处理的信息与用途", "保存期限与删除", "用户权利与退出", "未满 18 周岁", "复制全部文字"]) {
  assert(`${legalPage}\n${legalTemplate}`.includes(label), `协议与隐私页缺少：${label}`);
}
assert(memberTemplate.includes("购买记录") && memberPage.includes("copyOrder"), "会员页缺少可联系客服核对的购买记录");
const paidRules = `${memberTemplate}\n${legalPage}\n${legalTemplate}`;
for (const label of ["不自动续费", "全额退款", "部分退款", "保存 3 年"]) {
  assert(paidRules.includes(label), `会员页或完整协议缺少付费规则：${label}`);
}

for (const token of [
  "WANGCHAO_MINI_APP_SECRET",
  "WANGCHAO_XPAY_APP_KEY_SANDBOX",
  "WANGCHAO_XPAY_APP_KEY_PRODUCTION",
]) {
  assert(!`${runtime}\n${client}\n${memberPage}\n${backend}`.includes(token), `普通支付代码不应再依赖已停用的密钥变量：${token}`);
}
assert(!backend.includes("api.weixin.qq.com/xpay") && !backend.includes("stable_token"), "服务端仍会访问已停用的虚拟支付接口");
assert(backend.includes("archiveLegacyOrder") && backend.includes('paymentProvider: "legacy-virtual-archived"'), "历史虚拟订单缺少无密钥归档路径");

const backendContract = `${backend}\n${paymentReadinessSource}\n${cloudPaySource}`;
for (const contract of [
  "cloud.cloudPay.unifiedOrder",
  "cloud.cloudPay.queryOrder",
  'kind: "wechat-jsapi"',
  "handleCloudPayCallback",
  "validateCloudPayOrder",
  "cloudPaySnapshot",
  'functionName: "aurum-member"',
  "runTransaction",
  "CLOUDPAY_ORDER_MISMATCH",
  "reconcileRecentOrders",
  "partially_refunded",
  "refund_failed",
  "entitlementReviewRequired",
  "ENTITLEMENT_REVIEW_REQUIRED",
  "ENTITLEMENT_VERIFICATION_PENDING",
  "ENTITLEMENT_CREDIT_LIMIT",
  "lastReconciledAt",
  "reconcileGlobalOrders",
  "GLOBAL_RECONCILE_STATE_ID",
  "isGlobalReconcileTimer",
  "isFreeTestGrantTimer",
  "grantFreeTestEntitlement",
  'const FREE_TEST_TRIGGER_NAME = "member-free-test-grant"',
  "FREE_TEST_FORBIDDEN",
  "TIMER_FORBIDDEN",
  "WANGCHAO_PAYMENT_COMPLIANCE_APPROVED",
  "WANGCHAO_PAYMENT_RELEASE_APPROVED",
  "WANGCHAO_PAYMENT_TEST_MODE",
  "WANGCHAO_PAYMENT_TEST_OPENID_HASHES",
  "validateLegalConsent",
  "legalConsent",
  'const WORKSPACES = "member_workspaces"',
  "requireActiveEntitlement",
  'event.action === "workspace"',
  'event.action === "saveWatchItem"',
  'event.action === "removeWatchItem"',
  'event.action === "saveDecision"',
  'event.action === "removeDecision"',
  'event.action === "deleteWorkspace"',
]) {
  assert(backendContract.includes(contract), `普通微信支付服务端缺少：${contract}`);
}
assert(backend.includes("priceFen: 128800") && backend.includes('id: "research-365d"'), "年度会员价格必须由服务端固定为 1288 元");
const freeTestOpenid = "openid-for-free-test-entitlement";
const freeTestGrantedAt = new Date("2026-07-28T07:00:00.000Z");
const firstFreeTestGrant = prepareFreeTestGrant(null, freeTestOpenid, freeTestGrantedAt, 200);
assert(!firstFreeTestGrant.alreadyGranted && FREE_TEST_DAYS === 365, "免费测试首次授权没有发放 365 天权益");
assert(
  firstFreeTestGrant.data.credits.length === 1
    && firstFreeTestGrant.data.credits[0].source === "manual-free-test"
    && firstFreeTestGrant.data.credits[0].campaignId === FREE_TEST_CAMPAIGN_ID,
  "免费测试权益没有使用独立来源和活动标识",
);
assert(
  firstFreeTestGrant.data.expiresAt.toISOString() === "2027-07-28T07:00:00.000Z",
  "免费测试权益有效期不是从授权时起 365 天",
);
assert(
  !freeTestGrantId(freeTestOpenid).includes(freeTestOpenid),
  "免费测试授权编号泄露原始 OpenID",
);
const repeatedFreeTestGrant = prepareFreeTestGrant(
  firstFreeTestGrant.data,
  freeTestOpenid,
  new Date("2026-07-29T07:00:00.000Z"),
  200,
);
assert(
  repeatedFreeTestGrant.alreadyGranted
    && repeatedFreeTestGrant.data === null
    && repeatedFreeTestGrant.expiresAt.toISOString() === firstFreeTestGrant.data.expiresAt.toISOString(),
  "免费测试重复执行会再次延长权益",
);
const freeTestHandlerStart = backend.indexOf("async function grantFreeTestEntitlement()");
const freeTestHandlerEnd = backend.indexOf("async function handleCloudPayCallback", freeTestHandlerStart);
const freeTestHandler = backend.slice(freeTestHandlerStart, freeTestHandlerEnd);
assert(freeTestHandlerStart >= 0 && freeTestHandlerEnd > freeTestHandlerStart, "免费测试授权处理器结构异常");
assert(
  !freeTestHandler.includes("orderRef.update")
    && !freeTestHandler.includes('status: "fulfilled"')
    && !freeTestHandler.includes("paidAt")
    && freeTestHandler.includes("paidOrderChanged: false"),
  "免费测试授权会污染真实订单的支付或履约状态",
);
assert(
  backend.includes('event.TriggerName === FREE_TEST_TRIGGER_NAME')
    && backend.includes('return fail("FREE_TEST_FORBIDDEN"'),
  "免费测试授权没有限制为无客户端 OpenID 的专用后台触发",
);
const legacyVirtualVariablesIgnored = paymentReadiness({
  values: {
    WANGCHAO_PAYMENT_PROVIDER: "virtual",
    WANGCHAO_CLOUDPAY_MERCHANT_BOUND: "false",
    WANGCHAO_MINI_APP_ID: "configured",
    WANGCHAO_MINI_APP_SECRET: "configured",
    WANGCHAO_XPAY_OFFER_ID: "configured",
    WANGCHAO_XPAY_APP_KEY_SANDBOX: "configured",
  },
});
assert(
  !legacyVirtualVariablesIgnored.ready
  && legacyVirtualVariablesIgnored.missing.includes("正式收款合规审查")
  && legacyVirtualVariablesIgnored.missing.includes("正式收款交付验收")
  && !legacyVirtualVariablesIgnored.missing.includes("支付方式")
  && !legacyVirtualVariablesIgnored.missing.includes("云支付商户与 JSAPI 授权"),
  "历史虚拟支付变量仍影响普通 JSAPI 新购路线",
);
const pausedPayment = paymentReadiness({
  openid: "copy-only-openid",
  values: {},
});
assert(!pausedPayment.ready && pausedPayment.reason === "合规审查或上线验收尚未完成，当前不能付款", "默认状态没有保持关闭");
assert(pausedPayment.testAccountId === paymentTestAccountId("copy-only-openid") && !pausedPayment.testModeEnabled && !pausedPayment.testAccountAllowed, "开发版无法在不开启支付的情况下安全复制验收账号编号");
const completeJsapiPayment = paymentReadiness({
  values: {
    WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "true",
    WANGCHAO_PAYMENT_RELEASE_APPROVED: "true",
  },
});
assert(completeJsapiPayment.ready && completeJsapiPayment.mode === "public" && completeJsapiPayment.refundMode === "merchant-manual" && completeJsapiPayment.reason === "普通微信支付已配置", "普通微信支付完整配置或人工退款模式仍被误报为不可用");
const testOpenid = "openid-for-controlled-payment-acceptance";
const testOpenidHash = paymentTestAccountId(testOpenid);
const controlledTestPayment = paymentReadiness({
  openid: testOpenid,
  values: {
    WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "true",
    WANGCHAO_PAYMENT_RELEASE_APPROVED: "false",
    WANGCHAO_PAYMENT_TEST_MODE: "true",
    WANGCHAO_PAYMENT_TEST_OPENID_HASHES: `invalid,${testOpenidHash}`,
  },
});
assert(controlledTestPayment.ready && controlledTestPayment.mode === "test" && !controlledTestPayment.publicReady, "指定验收账号不能在正式开关关闭时安全测试");
const unrelatedTestPayment = paymentReadiness({
  openid: "another-openid",
  values: {
    WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "true",
    WANGCHAO_PAYMENT_RELEASE_APPROVED: "false",
    WANGCHAO_PAYMENT_TEST_MODE: "true",
    WANGCHAO_PAYMENT_TEST_OPENID_HASHES: testOpenidHash,
  },
});
assert(!unrelatedTestPayment.ready && unrelatedTestPayment.mode === "closed", "非验收账号可以绕过正式发布开关付款");
const manualRefundTestPayment = paymentReadiness({
  openid: testOpenid,
  values: {
    WANGCHAO_PAYMENT_COMPLIANCE_APPROVED: "true",
    WANGCHAO_PAYMENT_TEST_MODE: "true",
    WANGCHAO_PAYMENT_TEST_OPENID_HASHES: testOpenidHash,
  },
});
assert(manualRefundTestPayment.ready && manualRefundTestPayment.mode === "test" && manualRefundTestPayment.refundMode === "merchant-manual", "人工原路退款模式仍被错误要求配置退款 API");
assert(!memberTemplate.includes("showPaymentTestTools") && !memberTemplate.includes("验收账号") && !memberTemplate.includes("环境变量"), "会员页不得向普通用户暴露内部支付验收控件");
assert(memberTemplate.includes("直接打开微信收银台") && memberTemplate.includes("点击即确认"), "会员页缺少和问岳一致的直接微信收银台说明与操作");
assert(backend.includes('const NEW_PURCHASE_PROVIDER = "wechat-jsapi"') && backend.includes("paymentProvider: NEW_PURCHASE_PROVIDER"), "普通 JSAPI 没有固定为唯一新购路线");
assert(!backendContract.includes("WANGCHAO_PAYMENT_PROVIDER") && !backendContract.includes("WANGCHAO_CLOUDPAY_MERCHANT_BOUND"), "已确认的 JSAPI/商户绑定仍被重复要求配置环境变量");
assert(REQUIRED_LEGAL_VERSIONS.termsVersion === legalConfig.termsVersion, "客户端与云函数会员协议版本不一致");
assert(REQUIRED_LEGAL_VERSIONS.privacyVersion === legalConfig.privacyVersion, "客户端与云函数隐私说明版本不一致");
const fixedConsentTime = new Date("2026-07-27T00:00:00.000Z");
const acceptedConsent = validateLegalConsent({
  accepted: true,
  adultConfirmed: true,
  termsVersion: legalConfig.termsVersion,
  privacyVersion: legalConfig.privacyVersion,
}, fixedConsentTime);
assert(acceptedConsent.acceptedAt === fixedConsentTime, "服务端没有记录协议确认时间");
for (const invalidConsent of [
  null,
  { accepted: false, adultConfirmed: true, termsVersion: legalConfig.termsVersion, privacyVersion: legalConfig.privacyVersion },
  { accepted: true, adultConfirmed: false, termsVersion: legalConfig.termsVersion, privacyVersion: legalConfig.privacyVersion },
  { accepted: true, adultConfirmed: true, termsVersion: "old", privacyVersion: legalConfig.privacyVersion },
]) {
  let rejected = false;
  try {
    validateLegalConsent(invalidConsent, fixedConsentTime);
  } catch (error) {
    rejected = error.code === "LEGAL_CONSENT_REQUIRED";
  }
  assert(rejected, "服务端接受了缺失、未同意或过期的协议版本");
}
assert(!`${backend}\n${client}`.includes("research-30d") && !`${backend}\n${client}`.includes("research-90d"), "会员端仍残留 30 天或 90 天方案");
assert(!backend.includes("wx.requestPayment"), "云函数不应调客户端支付 API");
assert(triggerConfig.permissions?.openapi?.includes("cloudPay.unifiedOrder"), "云函数没有声明统一下单云调用权限");
assert(triggerConfig.permissions?.openapi?.includes("cloudPay.queryOrder"), "云函数没有声明查单云调用权限");
assert(!triggerConfig.permissions?.openapi?.includes("cloudPay.refund"), "人工原路退款方案不应申请未使用的退款 API 权限");
assert(cloudPackage.dependencies?.["wx-server-sdk"] === "4.0.2", "云函数没有锁定已复核的官方 wx-server-sdk 版本");
assert(cloudPackage.dependencies?.ws === "8.21.1", "云函数缺少 CloudBase Node SDK 运行所需的 ws 依赖");
assert(cloudPackageLock.packages?.["node_modules/ws"]?.version === "8.21.1", "云函数锁文件没有落定 ws 运行依赖");
assert(cloudPackage.overrides?.["lodash.unset"] === "4.18.0", "云函数缺少 lodash.unset 安全覆盖");
assert(cloudPackageLock.packages?.["node_modules/lodash.unset"]?.version === "4.18.0", "云函数锁文件没有落定 lodash.unset 安全版本");
assert(!/if \(order\.status === "fulfilled"\)\s*\{\s*return/.test(backend), "已发放订单仍被跳过，退款无法恢复");
assert(backend.includes("历史虚拟支付已经停用；未付款订单已关闭"), "历史未付款虚拟订单没有保守关闭");
assert(backend.includes("历史虚拟支付已经停用；该订单与权益需要人工核对"), "历史已履约虚拟订单没有转人工核对");
assert(triggerConfig.triggers?.length === 1, "会员云函数必须只配置一个全局订单复核触发器");
assert(triggerConfig.triggers[0].name === "member-order-reconcile" && triggerConfig.triggers[0].type === "timer", "全局订单复核触发器名称或类型错误");
assert(triggerConfig.triggers[0].config === "0 */15 * * * * *", "全局订单复核必须每 15 分钟执行一次");
assert(backendReadme.includes("每 15 分钟启动一次全局订单扫描") && backendReadme.includes("退款通知仍可作为后续实时性增强"), "全局退款对账与通知边界未写明");
assert(backendReadme.includes("日均 DAU 达到 1 万"), "自动续费准入边界未写明");
assert(backendReadme.includes("npm audit --omit=dev"), "云函数依赖安全复查门槛未写明");
assert(backendReadme.includes("5 个高危") && backendReadme.includes("0 个中危、0 个严重"), "云函数依赖审计基线未准确记录");
assert(backendReadme.includes("不接受 npm 建议的破坏性降级"), "云函数依赖处置边界未写明");
assert(backendReadme.includes("member_workspaces"), "云函数文档缺少工作台集合");
for (const gate of ["Gate 0", "证券、期货投资咨询管理暂行办法", "WANGCHAO_PAYMENT_COMPLIANCE_APPROVED=true", "WANGCHAO_PAYMENT_RELEASE_APPROVED=true", "真实付款", "待模板消息确认", "微信审核", "正式发布"]) {
  assert(launchGuide.includes(gate), `小程序上线手册缺少：${gate}`);
}
assert(launchGuide.includes("不开发、打包或发布 Android/iOS 独立 App") && launchGuide.includes("微信内的小程序"), "上线手册没有明确望潮只在微信小程序体系内运行");
for (const label of [
  "一次购买 1288 元，使用 365 天，不自动续费",
  "港股 3 个、美股 5 个、A股 3 个",
  "仅在可核验候选池内按表观长期年化从高到低排列",
  "具体买卖建议、收益预测、荐股或按价位给动作不属于会员商品",
  "确认本人已满 18 周岁",
  "当前开发版可以发起真实 1288 元微信支付",
  "保留 A 股模块提交前",
  "不得用免责声明或改名绕过类目要求",
]) {
  assert(reviewCopy.includes(label), `提审复制稿缺少：${label}`);
}
for (const forbidden of ["WANGCHAO_MINI_APP_SECRET=", "WANGCHAO_XPAY_APP_KEY", "BEGIN PRIVATE KEY", "原始 OpenID："]) {
  assert(!reviewCopy.includes(forbidden), `提审复制稿不得包含敏感配置：${forbidden}`);
}

const legalConsent = {
  accepted: true,
  adultConfirmed: true,
  termsVersion: legalConfig.termsVersion,
  privacyVersion: legalConfig.privacyVersion,
};
const successCalls = [];
let requestPaymentArguments = null;
const successClient = loadMemberClient({
  runtimeConfig: { cloudEnv: "cloud-test", memberFunction: "aurum-member" },
  wxMock: {
    cloud: {
      callFunction({ name, data }) {
        successCalls.push({ name, data });
        if (data.action === "preparePurchase") return backendResult(preparedPayment());
        return Promise.reject(new Error(`未预期的会员操作：${data.action}`));
      },
    },
    requestPayment(options) {
      requestPaymentArguments = options;
      options.success({ errMsg: "requestPayment:ok" });
    },
  },
});
const successfulPurchase = await successClient.purchase("research-365d", legalConsent);
assert(successfulPurchase.paymentAccepted === true && successfulPurchase.orderId === "AU-test-order", "微信收银台成功后没有立即返回支付受理结果");
assert(successCalls.map((call) => call.data.action).join(",") === "preparePurchase", "小程序支付没有使用和问岳一致的单次下单最短链路");
assert(successCalls[0].data.planId === "research-365d" && !("code" in successCalls[0].data), "客户端没有提交唯一年度方案，或仍在传递多余登录码");
assert(successCalls[0].data.legalConsent === legalConsent, "客户端没有原样提交当前协议确认");
assert(
  requestPaymentArguments.timeStamp === "1777777777"
    && requestPaymentArguments.nonceStr === "test-nonce"
    && requestPaymentArguments.package === "prepay_id=test-prepay"
    && requestPaymentArguments.signType === "MD5"
    && requestPaymentArguments.paySign === "test-pay-sign",
  "客户端没有把服务端支付参数完整交给 requestPayment",
);

const cancelledClient = loadMemberClient({
  runtimeConfig: { cloudEnv: "cloud-test", memberFunction: "aurum-member" },
  wxMock: {
    cloud: {
      callFunction({ data }) {
        if (data.action === "preparePurchase") return backendResult(preparedPayment());
        return Promise.reject(new Error("取消支付后不应查单"));
      },
    },
    requestPayment({ fail }) {
      fail({ errMsg: "requestPayment:fail cancel" });
    },
  },
});
let cancelledError = null;
try {
  await cancelledClient.purchase("research-365d", legalConsent);
} catch (error) {
  cancelledError = error;
}
assert(cancelledError?.message === "已取消支付" && cancelledError.code === "PAYMENT_CANCELLED", "用户取消支付没有映射为清晰且可识别的结果");

const unsupportedClient = loadMemberClient({
  runtimeConfig: { cloudEnv: "cloud-test", memberFunction: "aurum-member" },
  wxMock: {
    cloud: {
      callFunction({ data }) {
        if (data.action === "preparePurchase") return backendResult(preparedPayment());
        return Promise.reject(new Error("不支持支付时不应查单"));
      },
    },
  },
});
let unsupportedError = null;
try {
  await unsupportedClient.purchase("research-365d", legalConsent);
} catch (error) {
  unsupportedError = error;
}
assert(unsupportedError?.message.includes("升级微信"), "旧版微信没有得到明确的升级提示");

const cloudPayOrder = {
  _id: "AUCLOUDPAY1234567890",
  openid: "openid-test",
  appId: rootProject.appid,
  planId: "research-365d",
  priceFen: 128800,
};
const cloudPayResult = {
  returnCode: "SUCCESS",
  resultCode: "SUCCESS",
  tradeState: "SUCCESS",
  outTradeNo: cloudPayOrder._id,
  subMchId: "1745865229",
  subAppid: rootProject.appid,
  subOpenid: cloudPayOrder.openid,
  attach: cloudPayOrder.planId,
  totalFee: 128800,
  cashFee: 128800,
  transactionId: "4200000000000000000000000000",
  timeEnd: "20260727120809",
};
validateCloudPayOrder(cloudPayOrder._id, cloudPayOrder, cloudPayResult, {
  requirePaidState: true,
  subMchId: cloudPayResult.subMchId,
});
assert(cloudPayTradeState(cloudPayResult) === "SUCCESS", "普通微信支付状态没有标准化");
assert(parseWechatTime(cloudPayResult.timeEnd)?.toISOString() === "2026-07-27T04:08:09.000Z", "微信支付完成时间解析错误");
const verifiedSnapshot = cloudPaySnapshot(cloudPayResult, fixedConsentTime);
assert(verifiedSnapshot.wechatTotalFeeFen === 128800 && verifiedSnapshot.wxTransactionId === cloudPayResult.transactionId, "普通微信支付快照缺少金额或交易号");
let rejectedCloudPayMismatch = false;
try {
  validateCloudPayOrder(cloudPayOrder._id, cloudPayOrder, { ...cloudPayResult, totalFee: 1 }, {
    requirePaidState: true,
    subMchId: cloudPayResult.subMchId,
  });
} catch (error) {
  rejectedCloudPayMismatch = error.code === "CLOUDPAY_ORDER_MISMATCH";
}
assert(rejectedCloudPayMismatch, "普通微信支付金额不一致时仍会发放权益");
for (const missingField of ["subMchId", "subAppid", "subOpenid", "attach", "transactionId"]) {
  let rejectedMissingIdentity = false;
  try {
    const incompleteResult = { ...cloudPayResult };
    delete incompleteResult[missingField];
    validateCloudPayOrder(cloudPayOrder._id, cloudPayOrder, incompleteResult, {
      requirePaidState: true,
      subMchId: cloudPayResult.subMchId,
    });
  } catch (error) {
    rejectedMissingIdentity = error.code === "CLOUDPAY_ORDER_MISMATCH";
  }
  assert(rejectedMissingIdentity, `普通微信支付缺少 ${missingField} 时仍会发放权益`);
}
const callbackEvent = {
  ...cloudPayResult,
  mchId: cloudPayResult.subMchId,
  appid: cloudPayResult.subAppid,
  openid: cloudPayResult.subOpenid,
};
delete callbackEvent.subMchId;
delete callbackEvent.subAppid;
delete callbackEvent.subOpenid;
validateCloudPayOrder(cloudPayOrder._id, cloudPayOrder, callbackEvent, {
  requirePaidState: true,
  subMchId: cloudPayResult.subMchId,
});
assert(isCloudPayCallback(callbackEvent, {}), "平台支付回调没有被识别");
assert(!isCloudPayCallback(callbackEvent, { OPENID: cloudPayOrder.openid }), "小程序客户端可以伪造支付回调入口");
assert(backend.includes("const result = await cloudPayQueryOrder(orderId)") && backend.includes("requirePaidState: true"), "支付回调没有再次查单验真");
assert(backend.includes("当前查单结果不含可核验退款金额") && backend.includes('status: "fulfillment_review"'), "普通支付退款金额未知时没有进入人工核对");
assert(!backend.includes("if (readiness().ready) await reconcileRecentOrders"), "正式购买关闭时已付款订单的退款复核也被错误关闭");
assert(backend.includes("const config = readiness(context.OPENID)"), "服务端下单没有按当前 OpenID 执行验收账号门禁");
assert(!memberTemplate.includes("开发版支付验收") && !memberTemplate.includes("验收编号") && !memberPage.includes("getAccountInfoSync"), "内部验收编号或开发配置不应暴露在会员页");
assert(!memberTemplate.includes("沙箱联调草案"), "普通微信支付页面仍误称存在业务沙箱");

const offlineClient = loadMemberClient({
  runtimeConfig: { cloudEnv: "", memberFunction: "aurum-member" },
  wxMock: {},
});
const offlineState = await offlineClient.loadMemberState();
assert(!offlineState.paymentReady && offlineState.plans.length === 1 && offlineState.plans[0].id === "research-365d", "云端不可用时没有安全降级到唯一年度方案预览");

const firstGrant = new Date("2026-01-01T00:00:00.000Z");
const secondGrant = new Date("2026-01-15T00:00:00.000Z");
const baseCredits = [
  { orderId: "A", days: 30, remainingDays: 30, grantedAt: firstGrant, refundedAt: null },
  { orderId: "B", days: 30, remainingDays: 30, grantedAt: secondGrant, refundedAt: null },
];
const stacked = entitlementSchedule(baseCredits);
assert(stacked.windows.get("B").startsAt.toISOString() === "2026-01-31T00:00:00.000Z", "续期权益没有按顺序叠加");
assert(stacked.expiresAt.toISOString() === "2026-03-02T00:00:00.000Z", "叠加权益到期日计算错误");

const fullyRefunded = entitlementSchedule([
  { ...baseCredits[0], remainingDays: 0, refundedAt: new Date("2026-01-20T00:00:00.000Z") },
  baseCredits[1],
]);
assert(fullyRefunded.expiresAt.toISOString() === "2026-02-14T00:00:00.000Z", "全额退款没有移除对应权益周期");

const partiallyRefunded = entitlementSchedule([
  { ...baseCredits[0], remainingDays: 15 },
  baseCredits[1],
]);
assert(partiallyRefunded.expiresAt.toISOString() === "2026-02-15T00:00:00.000Z", "部分退款没有按剩余金额缩减权益");

const legacyCredits = normalizeEntitlementCredits({
  expiresAt: new Date("2026-02-01T00:00:00.000Z"),
  updatedAt: firstGrant,
  latestOrderId: "LEGACY",
  revoked: false,
});
assert(legacyCredits.length === 1 && legacyCredits[0].days === 31, "旧版权益没有安全迁移到权益账本");
const emptyEntitlement = entitlementData("openid", [], new Date(), {});
assert(emptyEntitlement.expiresAt === null && emptyEntitlement.latestOrderId === "", "空权益账本仍返回有效期");
assert(!Object.prototype.hasOwnProperty.call(emptyEntitlement, "openid"), "权益文档仍冗余保存原始 OpenID");
const recoveryLocked = entitlementData("openid", baseCredits, new Date(), {
  revoked: true,
  refundRecoveryRequired: true,
  refundRecoveryOrderId: "A",
});
assert(recoveryLocked.revoked && recoveryLocked.refundRecoveryOrderId === "A", "账本异常锁定被新权益意外解除");
assert(entitlementReviewRequired(recoveryLocked), "账本异常没有进入人工核对锁");
assert(!entitlementReviewRequired(entitlementData("openid", baseCredits, new Date(), {})), "正常权益被错误标记为人工核对");
assert(
  backend.includes("当前不会创建新的付款订单")
  && backend.includes("paymentReady: config.ready && !reviewRequired"),
  "历史退款账本异常时仍可能创建新订单或展示可付款状态",
);
assert(!backend.includes("workspace.openid = openid") && backend.includes("delete workspace.openid"), "工作台文档仍冗余保存原始 OpenID");

const reconcileNow = new Date("2026-01-02T12:00:00.000Z").getTime();
assert(shouldReconcileOrder({ _id: "AU1", openid: "o1", status: "pending" }, reconcileNow), "从未核对的待支付订单没有进入定时复核");
assert(!shouldReconcileOrder({
  _id: "AU2",
  openid: "o1",
  status: "pending",
  lastReconcileAttemptAt: new Date(reconcileNow - 5000),
}, reconcileNow), "刚核对过的待支付订单被立即重复请求");
assert(shouldReconcileOrder({
  _id: "AU3",
  openid: "o1",
  status: "fulfilled",
  lastReconciledAt: new Date(reconcileNow - 7 * 60 * 60 * 1000),
}, reconcileNow), "超过 6 小时的已发放订单没有进入退款复核");
assert(!shouldReconcileOrder({
  _id: "AU4",
  openid: "o1",
  status: "fulfilled",
  lastReconciledAt: new Date(reconcileNow - 60 * 60 * 1000),
}, reconcileNow), "刚核对过的已发放订单被过度请求");
assert(!shouldReconcileOrder({ _id: "AU5", openid: "o1", status: "refunded" }, reconcileNow), "已完成退款订单仍被重复复核");
assert(!shouldReconcileOrder({ _id: "AU6", status: "fulfilled" }, reconcileNow), "缺少用户归属的订单进入了全局复核");

console.log("会员支付安全契约检查通过：唯一年费方案、最短 JSAPI 链路、协议门禁、严格查单验真、防伪造回调、人工原路退款、退款状态人工核对、幂等权益与 15 分钟全局对账均已覆盖；历史虚拟订单只归档、不再依赖 AppSecret、AppKey、OfferID 或道具 ID");
