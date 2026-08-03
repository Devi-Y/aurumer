# 会员跟踪 P0：变化中心 · 决策快照 · 节点待办

> 基于已有「逻辑哨兵」（开发版至 0.2.34）增量完善。本轮开发版目标：**0.2.35**。

## 完成了什么

1. **关注对象变化中心**（工作台「今日」）
   - 顶部「我的变化」摘要
   - 需要重新评估 / 重要变化 / 暂无重要变化 / 全部关注对象
   - 变化分类、三级重要性、`changeKey` 去重、已读/未读
   - 打开工作台时对**当前用户**执行 `refreshSentinel` 扫描（非整库全量）

2. **自动决策快照**（详情页）
   - 「保存决策快照」确认层：自动预填价格、结论、风险、数据截止时间
   - 用户补充：关注原因、复评条件、下次查看日期、选填备注
   - 非会员可预览；正式保存失败时进入会员说明，不假装已保存
   - 服务端优先用 `data_fact_latest` 盖章公开字段，不信任客户端伪造结论

3. **待办与节点**（工作台「今日」）
   - 今日到期 / 未来 7 天 / 未来 30 天 / 已过期 / 已完成
   - 支持完成、延后一天、延后一周、删除
   - 系统仅在公开资料有明确日期时生成（如港股截止/上市）；不猜测
   - 文案区分「小程序内提醒」与「订阅微信提醒」；未授权不显示「微信提醒已开启」

4. **会员价值与首页**
   - 会员页核心标题：持续跟踪你的关注对象
   - 三权益：重要变化 / 决策快照 / 节点提醒
   - 首页会员卡：会员态显示新变化/待办摘要；非会员仍为「关注·变化·复盘 / 365天 · ¥1288」

5. **埋点**
   - 扩展 `analytics.js` allowlist，覆盖变化中心、快照、待办、订阅提醒相关事件
   - 不上传完整备注与金额

## 数据结构

仍复用集合 `member_workspaces`（不新建独立业务集合，控制免费云成本）。

| 字段 | 说明 |
| --- | --- |
| `watchItems[].baselineFact` | 历史研究快照（不可被后续公开数据覆盖；ack 才更新基线） |
| `watchItems[].reasonId/Label` | 关注原因 |
| `watchItems[].reviewConditionId/Label` | 复评条件 |
| `decisions[].evidence` | 决策当时证据 |
| `decisions[].closedAt` | 关闭标记（预留） |
| `inbox[]` | 变化/复核消息；含 `changeTypes` / `importance` / `changeKey` / `readAt` |
| `reviewTasks[]` | 节点待办：`taskId`、`sourceType`、`dueAt`、`status`、`reminderChannel`、`subscriptionAuthorized` 等 |
| `data_fact_latest` | 服务端盖章用正式事实 |

## 云函数变化

- `aurum-member`
  - `stampOfficialFact`：保存关注/决策时服务端盖章
  - `updateReviewTask`：完成 / 延后 / 删除
  - `review-tasks.js`：待办幂等生成与变更
  - `change-detect.js`：变化分类与 `changeKey`
  - `sentinel-inbox.js`：扫描时同步待办并写入分类字段
- `aurum-data`：沿用既有 `fact-versions` 写入，无需为本轮另开全量扫描

## 页面变化

| 页面 | 变化 |
| --- | --- |
| `pages/workspace` | 我的变化五段结构 + 待办与节点 |
| `pages/detail` | 决策快照确认层；已保存则「查看我的决策记录」 |
| `pages/member` | 三权益 + 边界说明 |
| `pages/index` | 会员卡动态摘要 |

## 会员与非会员边界

| 能力 | 免费 | 会员 | 到期只读 |
| --- | --- | --- | --- |
| 公开结论/数据/风险 | ✓ | ✓ | ✓ |
| 少量关注/想法 + 快照预览 | ✓（额度内） | ✓ | 不可新增 |
| 变化中心完整确认/基线更新 | 有限 | ✓ | 可查看 |
| 节点待办管理 | 额度内可见 | ✓ | 可完成/删除/导出 |
| 跨设备同步与导出 | ✓（有记录时） | ✓ | ✓ |

## 变化检测逻辑

1. `aurum-data` warm/refresh 写入 `data_fact_latest`
2. 日定时 `member-event-remind`：只扫有工作台文档的用户，对比 `baselineFact`
3. 用户打开工作台：客户端 `buildChangeFeed` + `buildChangeCenter`
4. 同标的同变化值用 `changeKey` 去重，避免重复刷屏

## 幂等逻辑

- 变化 inbox：`dedupeKey` / `changeKey`
- 待办：`dedupeKey = sourceType|...|dueAt`
- 支付权益：既有账本幂等不变
- 事件标记：同 title+date+code 合并

## 成本控制

- 不新建全量用户×全市场扫描
- 待办与变化嵌入 `member_workspaces`
- 事实版本仍按标的变化写入，history 保留策略沿用

## 隐私与安全

- OpenID 仅服务端上下文；不信任客户端传入 OpenID/会员态
- 正式快照公开字段服务端盖章
- 私人记录仅当前用户可读可写
- 埋点不上传完整备注

## 测试结果

本地已执行并通过：

```bash
npm run audit
npm run audit:release
```

- `check:public` / `check:pages` / `check:ui` / `check:mini` / `check:payment` 通过
- `check:fresh` / `check:release` 通过（Pages 在线核对因 DNS 跳过，属环境限制）
- 模块冒烟：`change-center` 分类与 `review-tasks` 生成/延后通过

真机场景（保存快照、变化已读、待办操作、支付与到期只读）仍需人工验证。

## 仍需平台人工完成的事项

1. 微信公众平台申请并配置订阅消息模板，将模板 ID 写入云函数环境变量 `WANGCHAO_SUBSCRIBE_EVENT_TMPL`
2. 真机验证：保存快照、变化已读、待办完成/延后、支付与到期只读
3. 部署更新后的 `aurum-member` 云函数（含新模块文件）
4. 上传微信开发版 **0.2.35** 并保留上传回执
5. 类目/隐私指引/专业审查仍按 `ACCEPTANCE_EVIDENCE.md` 推进

## 假设

- 美股财报日、A 股除息/登记日、暗盘日：公开快照无稳定字段时本轮不生成系统待办（不猜测）
- 价格阈值字段继续保存，本轮仍不单独作为推送通道（避免未实现能力宣传）
- 「研究观察分」以详情页已有公开标签呈现，不暴露内部权重拆解
