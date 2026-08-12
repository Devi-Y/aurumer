# 会员跟踪 P0：变化中心 · 决策快照 · 节点待办

> 基于已有「逻辑哨兵」增量完善。开发版：**0.2.44**（首页持仓闭环 + 滚动思路条 + 大师策略摘要）。

## 多端同步记录

| 端 | 状态 |
| --- | --- |
| 本地 / 小程序随包 | `updatedAt=2026-08-12T03:38:19.542Z` |
| 私有生产 `aurum-engine` | 以最新公开快照为准 |
| GitHub `main` / Pages | 与本地 `updatedAt` 一致 |
| 云函数 | revision=`2026-08-11-multisource-strategy-signals-b4` |
| 微信开发版 | **0.2.44** 已 CLI 上传（424.9 KB） |

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
2. 仓库 Watching 即可收免费运维邮件；可用 `force_fail=true` 实弹验证 Issue。可选配置 `WANGCHAO_OPS_ALERT_WEBHOOK`；微信订阅提醒需在云开发配置 `WANGCHAO_SUBSCRIBE_EVENT_TMPL`（未配则仅站内收件箱）
3. 工作日自动生产任务（09:30 / 16:30）持续值守；本次已手动恢复 A20 出数并发布

## 运维已落地（2026-08-03）

- `aurum-data` 超时 **20 秒**；`data-snapshot-warm` 每 30 分钟；`SOURCE_REVISION` 含 `cache-first` / `sentinel`
- 云端 `getSnapshot`：A 股 **20**、`updatedAt=2026-08-03T15:16:45.561Z`（与 Pages / 随包一致）
- `aurum-member` 线上 timer：`member-order-reconcile`（15 分钟）；事件提醒在上海 09:00 窗口挂载（同函数通常只能挂一个 timer；仓库 `config.json` 仍保留两份声明供审计）
- `npm run audit:release` 已通过
