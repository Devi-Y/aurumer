# 望岳（望潮 Aurum）8 条变现渠道分步落地与风控清单

更新：2026-11-25。核心原则：**免费研究工具永远保持客观、纯净、零弹窗；所有商业变现按三梯队隔离推进，绝不让渠道利益干扰免费研究排序。**

## 总控配置与组件位置

- 统一变现风控配置：[monetization.js](../miniprogram/config/monetization.js)
- 商业赞助 / 自有家庭消费品牌零打扰承接组件：[partner-strip](../miniprogram/components/partner-strip/index.wxml)（未核验或空配置时 100% 隐藏，不占 1px 空间）
- 微信流量主原生广告组件：[research-ad](../miniprogram/components/research-ad/index.wxml)（填 `config/product.js` 的 `sectionAdUnitId` 即自动启用）
- 付费微信群支付配置：[community.js](../miniprogram/config/community.js) 与云函数 [aurum-member](../cloudfunctions/aurum-member/COMMUNITY_CHECKOUT.md)

---

## 第一梯队（本月即可落地现金流）

### 1. 付费微信群（298 元/年 · 小程序内微信直付）
- **当前状态**：`aurum-member` 独立群商品（`community-365d`）、订单/履约集合、查单对账与管理员白名单均已部署，处于负责人受控测试态。
- **档期已更新**：负责人已确认将 [community.js](../miniprogram/config/community.js) 与云函数 [community-purchase.js](../cloudfunctions/aurum-member/community-purchase.js) 的 `promotionEndsAt` 顺延至 **`2026-12-31T23:59:59+08:00`**，到期后服务端自动停单，绝不自动续费或静默涨价。
- **上线 3 步闭环验收**：
  1. 用负责人白名单微信在真机跑通 1 笔真实支付 → 查单自动弹微信二维码 → 手机管理页登记入群；
  2. 完成 1 笔真实原路退款验证，确认退款后权限隐藏；
  3. 确认无误后开启客户端 `checkoutEnabled: true` 与云端 `WANGCHAO_COMMUNITY_RELEASE_APPROVED=true`（关闭 `TEST_MODE`）。
- **合规底线**：服务限定为公开资料交流与工具使用答疑，不含荐股、收益保证或代客操作；不展示无依据的划线原价或诱导倒计时。

### 2. 微信原生广告（流量主）
- **落地动作**：小程序达到流量主门槛后，在微信后台申请原生模板/Banner 广告位，将真实 `unit-id` 填入 [product.js](../miniprogram/config/product.js) 的 `sectionAdUnitId`。
- **风控底线**：只出现在栏目底部，绝不加开屏弹窗或诱导点击文案；收入仅以微信后台结算账单为准。

---

## 第二梯队（随日活增长放量）

### 3. 港美 A 股开户分成
- **当前状态**：九宫格「港美股开户 / A股开户」与研究页末单行入口均已上线并独立分流。
- **关键风控**：
  - 境内 A 股与境外港美股严格区分，不收集用户证券密码、银行卡或代办开户；
  - 明示地区与奖励边界（例如盈透证券好友推荐计划明确排除中国大陆居民奖励）；
  - 逐步补齐正式推广授权、合规活动有效期与可核验官方结算回执。

### 4. VPN / 全球信息网络服务分成
- **当前状态**：保留九宫格指定入口与二级页合规中性文案。
- **关键风控**：全仓严格禁止敏感违规宣传词（已由 `audit-miniprogram.mjs` 自动拦截）；持续核验服务主体许可、授权与微信平台准入规范。

### 5. 商业赞助（单行高质感铭牌）
- **落地动作**：签约合适品牌（家庭理财工具、正规金融出版、高品质生活品牌等）后，在 [monetization.js](../miniprogram/config/monetization.js) 的 `CHANNELS.sponsorship` 中填入 `sponsorName`、`tagline`、合规 `disclosure`，并将 `enabled` 与 `reviewed` 置为 `true` 即可在栏目页与详情页底部自动呈现极简铭牌。
- **关键风控**：必须清晰标注「商业赞助」与「不影响免费研究排序」，绝不接无资质金融喊单类赞助。

---

## 第三梯队（长期品牌护城河与高毛利放大器）

### 6. 自有家庭消费品牌
- **核心策略**：望岳聚拢的是理性、重视透明事实与性价比的家庭财务主理人——先在 298 元付费群内做种子家庭用户共创与口碑冷启动，**绝不在财经工具小程序里直接做重电商卖货**。
- **落地动作**：搭建独立「微信小店 / 品牌小程序」，审核通过后在 [monetization.js](../miniprogram/config/monetization.js) 的 `CHANNELS.familyBrand` 填入合法 `miniProgramAppId` 与 `brandName`，开启 `enabled` 与 `reviewed`，望岳底部即自动呈现克制的「望岳严选」跳转入口（`wx.navigateToMiniProgram`），实现**财经类目与电商类目的物理合规隔离**。
- **关键风控**：齐备企业经营资质、质检报告、售后服务与七天无理由退换保障。

### 7. IP 授权 & 8. 版权与品牌合作
- **传播发动机已就绪**：详情页已上线借鉴韭圈儿的「一键复制研报摘要（发群 / 留存）」，输出带望潮品牌标识、真实数据日期与风险边界的标准内容卡片，持续在微信群、公众号、视频号积累高审美 IP 辨识度。
- **落地顺序**：
  1. 先完成「望岳 / 望潮」核心商标注册与标志性视觉/IP 美术作品版权登记；
  2. 固化招牌内容形态（如年度家庭收息/配置白皮书、高颜值数据图表体系）；
  3. 开展品牌联名、出版/财商教育版权授权与周边联名合作，均以正式书面协议与对公到账为验收依据。
