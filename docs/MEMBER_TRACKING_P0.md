# 会员跟踪 P0：变化中心 · 决策快照 · 节点待办

> 基于已有「逻辑哨兵」增量完善。开发版：**0.2.39**（P0–P2 运维硬化 + 源端 A20 契约恢复与最新快照）。

## 多端同步记录

| 端 | 状态 |
| --- | --- |
| 本地 / 小程序随包 | `updatedAt=2026-08-07T17:18:52.168Z`，A股 **20**；`actionsFresh=true` |
| 私有生产 `aurum-engine` | `200996c` 恢复 A20 + market-first merge；已推送 |
| GitHub `main` / Pages | `0a52cd0` publish public snapshot；CDN 已对齐 |
| 云函数 | revision=`2026-08-08-action-freshness-ops-alert-a20-contract`；warm 已对齐最新戳 |
| 微信开发版 | **0.2.39** 已 CLI 上传（373.7 KB） |

## 数据结构 / 云函数 / 页面

见上文既有说明；关键增量：

- `refreshSentinel`：打开工作台扫描当前用户
- 详情快照快捷选项（关注原因 / 复评条件 / 7·14·30 天）

## 仍需平台人工

1. 真机验收三场景（快照 / 变化 / 待办）
2. 订阅消息模板 `WANGCHAO_SUBSCRIBE_EVENT_TMPL`（可选；未配置时仅站内提醒）

## 运维已落地（2026-08-08）

- A 股契约统一 **20**（README / 审计 / sanitize ingest）
- 快照过期自动降级动作；网页只展示真实 `updatedAt`
- **主告警（免费）**：`aurum-engine` GitHub Actions 失败开 `ops-alert` Issue，成功自动关闭；仓库设为 Watching 收邮件。可用 `workflow_dispatch` 的 `force_fail=true` 做实弹演练。
- `WANGCHAO_OPS_ALERT_WEBHOOK`：可选云函数 warm 兜底，不配置不影响生产刷新
- `WANGCHAO_SUBSCRIBE_EVENT_TMPL`：微信订阅消息模板 ID。未配置时事件队列仍写站内收件箱并重试字段，但不发微信订阅消息；页面只显示「小程序内提醒」。在云开发控制台给 `aurum-member` 配置该环境变量后重新部署即可开启。
- 变化提醒收窄为结论变化、结论跨档、风险新增、触及失效条件
- 事件标记增加 `deliveryStatus` / `retryCount` / 每日补偿扫描
- 会员页压缩为：核心价值 → 三项能力 → 履约证据 → 价格与边界

## 仍需平台人工

1. 真机验收三场景（快照 / 变化 / 待办）
2. 仓库 Watching 即可收免费运维邮件；可选配置 `WANGCHAO_OPS_ALERT_WEBHOOK` 与 `WANGCHAO_SUBSCRIBE_EVENT_TMPL`
3. 工作日自动生产任务（09:30 / 16:30）持续值守；本次已手动恢复 A20 出数并发布

## 运维已落地（2026-08-03）

- `aurum-data` 超时 **20 秒**；`data-snapshot-warm` 每 30 分钟；`SOURCE_REVISION` 含 `cache-first` / `sentinel`
- 云端 `getSnapshot`：A 股 **20**、`updatedAt=2026-08-03T15:16:45.561Z`（与 Pages / 随包一致）
- `aurum-member` 线上 timer：`member-order-reconcile`（15 分钟）；事件提醒在上海 09:00 窗口挂载（同函数通常只能挂一个 timer；仓库 `config.json` 仍保留两份声明供审计）
- `npm run audit:release` 已通过
