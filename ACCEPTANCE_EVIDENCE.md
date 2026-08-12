# 望潮小程序上线验收证据清单

更新日期：2026-08-12

本清单把「代码已就绪」与「必须人工留证」分开。产品模块与多端同步以最新开发版为准；**运营方确认本期不做退款验收**。

## 最新版本快照（2026-08-12）

| 项 | 状态 |
| --- | --- |
| 微信开发版 | **0.2.46**（440.7 KB）已 CLI 上传 |
| 本地 / 随包 / Pages / 云 warm | `updatedAt=2026-08-12T09:42:31.815Z` 四端一致 |
| GitHub `main` | 已推送；Pages 源分支 `main` |
| 云函数 revision | `2026-08-11-multisource-strategy-signals-b4` |
| 产品路线 P1–P1.7 + backlog（保荐人档案、交叉重叠） | **已完成**（见 `docs/COMPETITOR_BENCHMARK.md`） |

一键核对：`npm run sync:multi`

## A. 代码与配置（已完成）

- [x] 独立 AppID `wx4329d5e05c2f13f9` 与云环境已写入运行配置
- [x] `aurum-member` JSAPI 下单、查单、支付通知、权益账本
- [x] `aurum-data` 公开快照拉取、净化与数据库缓存
- [x] 会员协议 / 隐私版本号与客户端一致
- [x] 购买须知保留人工退款说明（代码能力保留；**本期不做退款真机验收**）
- [x] 提审复制稿见 `MINIPROGRAM_REVIEW_COPY.txt`
- [x] 隐私补充说明见 `MINIPROGRAM_PRIVACY_SUPPLEMENT.txt`
- [x] 开发版 **0.2.46** 已 CLI 上传（说明见 `MINIPROGRAM_LAUNCH_GUIDE.md`）
- [x] 首页今日重点、持仓闭环、群卡片复制、栏目深度入口
- [x] 港股历史样本 / 保荐人·行业档案；美股热度前十 / 性价比观察
- [x] 机构 WHY·HOW 披露边界 + 交叉重叠研究工具
- [x] 全站研究观察口径（观察低位 / 观察上沿 / 风险下沿）

## B. 公众平台与合规（仍须人工，与产品模块解耦）

- [ ] 微信公众平台类目已按当前内容确认（含 A 股模块专业意见）
- [ ] 公众平台《用户隐私保护指引》已填写并与小程序内文案一致
- [ ] 具备证券业务经验的专业意见已归档（通过 / 需改范围 / 需持牌）
- [ ] 营业执照主体「深圳岳大科技有限公司」与商户号主体一致
- [x] 全站文案已按 [docs/COMPETITOR_BENCHMARK.md](docs/COMPETITOR_BENCHMARK.md) 第五节完成研究观察口径审计

> 代码侧支付开关与会员页收费通道状态已就绪。B 节未勾选前，勿对外宣称「类目/隐私/专业意见已完成」。

## C. 支付真机（可选；退款本期不做）

### 运营决定（2026-08-12）

- [x] **无需退款验收**：本期不强制商户原路退款、权益回收与退款截图留证
- [x] 代码仍保留人工退款核对能力，供日后售后需要时使用；不作为上线门禁

### Android / iOS 真实付款（若要对外稳定收款再做）

- [ ] 开发版或体验版确认价格 1288、365 天、不自动续费
- [ ] 真实 JSAPI 支付与权益生效
- [ ] 订单号可复制，购买记录状态正确

> 未做真机付款前，可先提审体验版；正式对外收款前建议至少完成一端真实付款验收。

## D. 提审与发布（必须在微信公众平台完成；CLI 无法代发）

操作卡：[docs/FORMAL_RELEASE_STEPS.md](docs/FORMAL_RELEASE_STEPS.md)  
提审复制稿：[MINIPROGRAM_REVIEW_COPY.txt](MINIPROGRAM_REVIEW_COPY.txt)（已对齐 **0.2.46**）

- [ ] 体验版已分发给审核与内部验收账号（可选）
- [ ] 在「版本管理」对开发版 **0.2.46** 提交审核
- [ ] 审核通过
- [ ] 正式发布
- [ ] 发布后抽查：首页数据、会员购买入口、工作台只读/可写

> 开发版上传 ≠ 审核；审核通过 ≠ 正式发布。上两项须管理员在 https://mp.weixin.qq.com/ 点击完成。

## E. 证据存放建议

```text
YYYYMMDD-android-pay-success.png   # 可选：若做真机付款
YYYYMMDD-ios-pay-success.png       # 可选
YYYYMMDD-category-approval.png
YYYYMMDD-privacy-guide.png
YYYYMMDD-legal-opinion.pdf
```

不要把 AppSecret、商户密钥、证书、原始 OpenID 或完整支付凭证写入本仓库。
