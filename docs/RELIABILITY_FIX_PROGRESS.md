# 数据补全与可靠性修复 — Phase 1 基线 + Phase 2（A/B/C）进度报告

日期：2026-09-13
范围：本报告对应用户"数据补全、可靠性修复与页面验收"总需求中的 Section 四（三项可靠性问题）与 Section 九 Phase 1/2。

## 一、基线确认（简短清单）

- 项目路径确认：`/Users/y/aurumer-pages`（主项目：小程序、云函数、同步脚本）与 `/Users/y/wangchao`（数据抓取与静态站源仓）均存在、可访问。
- 两边现有未提交改动均已保护，本次会话**未执行任何 `git reset/checkout/clean`**：`aurumer-pages` 25 个文件、`wangchao` 118 个文件的既有未提交改动原样保留。
- 关键脚本确认存在：`npm run sync:mini`（`scripts/sync-miniprogram-data.mjs`）、`scripts/audit-miniprogram.mjs`、`scripts/audit-ui-contract.mjs`、`scripts/check-mini-freshness.mjs`。
- 当前随包快照 `miniprogram/data/live-snapshot.js` 的 `updatedAt` 为 `2026-09-10T11:23:41Z`——距今约 3 天，其本身处于"已过期"状态（超过 36 小时新鲜度阈值）。本轮工作**未对 wangchao 侧做新的实时抓取**（需要联网访问 Nasdaq/港交所等源，属于 Phase 3 数据回补范畴）；本轮修复聚焦在"计算/展示逻辑是否正确"，不等于"把数据刷新到最新"。

## 二、三项可靠性问题处理结果

### C（抽样影响计算）—— 已修复并验证

**真实发现的 bug**：`scripts/sync-miniprogram-data.mjs` 曾把美股 60 日历史抽稀成 24 点再随包，脚本注释写的是"只喂走势小图"，但详情页 `pages/detail/index.js` 的 `meterVisual`/`historyStats`/`stockRange` 是直接拿这份抽样后的数组去算"近60日价格位置""近60日最高/最低/中位数""样本交易日"，抽样点未必落在真正的最高/最低那天。

**实测数字（NVDA）**：真实 60 日位置 83%（区间 $190–$230.4，60 个交易日样本）在抽样后被算成 87%（区间 $192.5–$228.4，"样本交易日"显示成 24 个）。

**修复**：移除抽稀逻辑，把完整历史直接交给计算函数（黄金历史此前就是这样处理的：180 点全量、不抽样，因为 `goldTurningPoint` 需要 ≥60 点才能出结论——这次让美股对齐同一套原则）。`priceVisual` 自身在展示柱状图时仍会另外抽样最多 36 列，但那是纯展示逻辑，不影响其内部统计计算，本来就是解耦的。

**验证**：重新执行 `npm run sync:mini`，逐项核对 NVDA 新快照数字与用真实 60 点重新计算的结果一致（60/$190/$230.4/83%）。

### A（陈旧数据继续生成当前判断）—— 周末/工作日区分已修复并验证安全

**先确认一个已经做对的部分**：`miniprogram/utils/action-freshness.js` 与 `cloudfunctions/aurum-data/action-freshness.js` 两份文件的核心逻辑（36 小时阈值、过期后剥离哪些字段）在本轮修复前就已经完全对齐，线下随包与线上云函数对同一支股票的"是否过期"判断本来就一致——这部分规范要求（"同一标的在栏目/详情/首页新鲜度状态应一致"）已经满足，不是本轮新增的。

**本轮修复的真实缺口**：过期提示文案此前只有一种"数据过期，暂不提供动作"，把"周末没有新收盘"（正常休市）和"工作日抓取失败"混为一谈。

**修复方式**：新增 `isLikelyWeekendGap`/`describeStaleReason`，**只改展示的文案**——周末场景下改显示"周末没有新收盘，动作待下一交易日更新"；**完全没有改** `isActionFresh` 本身的 36 小时阈值判定逻辑。刻意不用"从已过时长里减掉周末时长"这类方案，因为这会让真实的工作日抓取失败被周末掩盖（例如周四收盘失败，到周一早上会被误判成"还新鲜"）。

**验证**：用 6 个具体日期场景测试，包括确认"周三收盘失败、到周五上午已过 38 小时"这种真实工作日失败依然被正确判定为过期，不会被周末规则误伞盖。另外确认全代码库没有其他逻辑文件对旧的单一 `STALE_ACTION` 字符串做相等比较——`cloudfunctions/aurum-data/index.js:239` 唯一一处引用是 `||` 兜底取值，不是比较，两种文案都能正常兜底，不会因为多了一种文案而失效。

### B（同步合并安全）—— 已审查，结构总体扎实，记录两处待跟进的小缺口

审查了 `wangchao/scripts/write-live-snapshot.mjs`（合并主流程）与 `wangchao/lib/live-data.mjs`（抓取与判定逻辑）。

**已经做对、本轮验证确认的部分**：
- 港股新股：`classifyAnnouncement()` 已经区分"定价公告 / 不含发行条款的补充公告 / 发行取消"三种情况；PDF 抽取失败会标记 `ok:false` + 失败原因 + 失败时间，不会假装抽取成功。这正是永康控股 (02523.HK) 能被正确识别为"发行已取消"而不是显示编造数据的原因。
- A股：`mergeASharePayload()`/`mergeAShareFunds()` 用 code/symbol 做稳定标识合并；行情取不到时保留静态参考价并标注 `quoteStatus:"fallback"` + 原因文案，不会静默覆盖或消失。
- 整体写入前有一道"完整性总闸"（`write-live-snapshot.mjs` 约 452-481 行）：只要美股/港股/A股/黄金/机构持仓任一项数量或质量不达标，整份快照直接抛错、不落盘，宁可保留旧快照也不用不完整数据覆盖——这是防止"部分数据错误污染整份生产快照"的强保护，本轮确认其存在且未被削弱。

**发现但未处理的缺口**（不属于本轮已实测会产生错误现价/错误结论的实例，未贸然改动抓取合并逻辑，记录供后续验证后处理）：
1. 美股基本面合并 `mergeFundamentals()` 是整行级别合并（当前抓取里没有这个 symbol 才用旧数据补），不是逐字段合并——如果某次抓取对同一支股票只是部分字段失败而不是整行缺失，旧数据里其他正确字段会被新行的空值静默覆盖，且没有 `dataStatus` 标记提示"这次有字段没取到"。
2. `lib/live-data.mjs:1072`：`shortTermInvestments = shortTermInvestmentsHistory[0] ?? 0`——当数据源没有单独列出"短期投资"这一行时会被当成真实的 $0，而非"未披露"，进而影响 `cashRich`/`qualityMatchCount` 这类会展示为"依据"标签的判断。多数公司这一项确实是 0 或已并入现金科目，实际影响面较小，但字面上确实是"缺失被当成了0"，不完全符合规范 Section 七"缺失不得伪装成0"的要求。

## 三、已发现、尚未处理的数据缺口（对照 Section 五）

- 黄金人民币（境内金/上海金）历史仅有 **2 个数据点**，国际金（COMEX）有 180 个——离 Section 五.4 要求的"≥1年连续人民币金价历史"差距很大。
- `wangchao/lib/live-data.mjs` 中 118 处未提交改动（约 9月7日）疑似新增了 Trustnet/Value Partners/东方财富等非13F基金持仓源，尚未验证这些改动是否可跑通、是否应并入本轮机构持仓数据回补（Section 五.5），本轮未触碰。

## 四、未做事项（如实声明，本轮报告写作时点）

- 未做任何真机测试、未做 git push、未部署、未上传体验版、未提审。
- Phase 3（分市场数据回补）、Phase 4（接入详情页/事件影响/今日看点）、Phase 5（测试与验收，含 375/430px 截图）均尚未开始。
- 本轮未对 wangchao 侧执行新的实时数据抓取（联网操作），随包快照仍是 9 月 10 日的数据。

---

## 五、Phase 3 进展（黄金人民币历史回补 + 机构持仓新源验证）

日期：2026-09-13（同日追加）

### 5.1 黄金人民币历史：2 个点 → 18 个点，已验证接入小程序

**根因**：不是抓取失败。上金所 `quotation_daily_new` 行情页是"一天一页"分页（`&p=N` 每页对应一个交易日的全部品种，例如 Au99.99/iAu99.99/Au100g），网站本身也标注"系统支持查询周期为1个月"。原抓取函数 `fetchSgeGoldQuote()` 只取第一页（即最近一天），所以 `gold.history.domestic` 每次运行脚本只能拿到 1–2 个真实日期的收盘价，跟抓取是否成功无关。

**没有做的事**：没有为了补历史去翻页抓 12 个月 × 18 页 ≈ 200+ 次请求——这个量级对一个官方交易所站点做连续请求，参考此前在其他项目上因为高频抓取触发交易所/政府站点 WAF 拦截的教训，判断风险大于收益，因此放弃了这条路（用户对"先去找数据源试试"的回应选择了这个更保守的方向）。

**实际做法**：发现 `lib/gold-snapshot-history.mjs` 里的 `appendGoldSnapshot()` 本来就在每次跑脚本时把当天的境内金收盘价按 `signalDate` 去重追加进 `data/gold-signal-snapshots.json`——这个积累机制已经安静跑了几周，攒了 16 个真实日期点（2026-07-20 至 2026-09-07，含真实的抓取空档），只是从未被接回 `gold.history.domestic` 这个产品实际读取的字段。修复：在 `write-live-snapshot.mjs` 里把这份已积累的历史和当次抓取的最新值按日期合并写回，不重复抓取、不编造缺失的中间交易日。

**验证结果**（`npm run snapshot` 实际跑通，非模拟）：
- `gold.history.domestic.length`：2 → **18**（2026-07-20 至 2026-09-11，含真实空档，例如 08-11 到 09-07 之间没有点，如实反映脚本当时没有运行）
- `gold.history.international.length`：180（未受影响，本来就正常）
- `data/gold-signal-snapshots.json` 积累历史：16 → 17 条（新增 2026-09-11）

**诚实说明**：18 个点、跨约 7 周，距规范要求的"≥1年连续"仍有很大差距。这是真实进展，不是达标——往后只要脚本按计划每天运行，这个历史会持续、真实地变长，但现在不能说"已满足 Section 五.4"。

**已接入产品**：因为 `publish-pages.mjs` 那条自动发布链路末尾会 `git push` 到公开镜像仓（本次任务明确不能做 push/部署），所以没有走那条自动化脚本，而是手动做了它"发布"之外的本地部分——把 `wangchao/data/live-snapshot.json` 直接复制到 `aurumer-pages/data/live-snapshot.json`（覆盖前已备份到 `/tmp/aurumer-pages-live-snapshot.backup.json`；覆盖前用 `git diff HEAD` 确认这份文件在 aurumer-pages 里本来就和上次提交一致，没有本地手改会被覆盖丢失），再执行 `npm run sync:mini` 重新生成随包快照。已核对 `miniprogram/data/live-snapshot.js` 里 `updatedAt` 变成 `2026-09-13T13:56:01Z`，`gold.history.domestic.length` 为 18——修复已经在本地随包数据里生效，但**没有** push、部署或上传体验版。

### 5.2 机构持仓新源（Trustnet / Value Partners / 东方财富）：已验证可跑通，已接入产品

用户要求"去验证一下"wangchao 里 118 处未提交改动中约 9 月 7 日新增的机构持仓抓取代码。实际验证方式：直接运行 `fetchLiveData()`，不是只读代码。

**验证结果（三个新数据源全部真实跑通）**：
| 来源 | 覆盖标的 | 结果 |
|---|---|---|
| Trustnet 月度 Factsheet | 摩根中国增长与收益、富达中国特殊情况基金 | 2/2 成功，各 10 条真实持仓，reportDate 2026-07-31 |
| Value Partners 月度 Factsheet | 惠理价值基金 | 成功，10 条真实持仓，reportDate 2026-08-31 |
| 东方富基金定期报告 | 华夏大盘精选、富国天惠成长、兴全合润 | 3/3 成功，各 10 条真实持仓 + 与上一期对比的涨跌标签（如"新进""减持 -19%"） |

**代码本身的安全设计**（审查确认，未改动）：三个来源 `isLive` 都固定标记为 `false`（不冒充 13F 那种可核验语义）、`portfolioValue` 固定 `null`（这些来源不披露基金总规模，不硬凑总值）、在 `fetchLiveData()` 里标记为 `advisory: true`（单个来源失败不会把整份快照判定为不完整从而拒绝发布，也不会连累美股/港股/A股/黄金）。

**关键正确性检查**：三个来源用的 `id`（`jpm-china-growth`/`fidelity-china-special`/`value-partners-classic`/`chinaamc-largecap`/`fullgoal-tianhui`/`xq-herun`）与 `aurumer-pages/miniprogram/utils/smart-money.js` 里 `SMART_MONEY_PROFILES` 的静态 `profile.id` **逐一核对完全一致**——这一步很关键，`answers.js` 的 `smartMoneyItems()` 就是靠这个 id 做匹配，id 对不上会静默退回旧的硬编码持仓、界面上完全看不出区别。已确认不会出现这种静默失效。

**已接入产品**：因为这次验证是直接跑 `wangchao/scripts/write-live-snapshot.mjs` 的 `npm run snapshot`（未提交的机构持仓代码和黄金历史修复在同一份工作区里一起生效），所以 5.1 节的那次快照复制 + `sync:mini` 里已经一并带上了这 6 个新机构持仓源。已核对 `miniprogram/data/live-snapshot.js` 的 `investors` 数组从原来的 9 个（SEC 13F 猎人）变成 **15 个**，新增的 6 个 id 与静态画像逐一匹配成功。

**诚实说明**：这只是验证了代码能跑通、产出真实数据、且 id wiring 正确——**没有**把这份代码提交（wangchao 仍是未提交状态，遵守"不主动 commit"的约束）。当前每个基金只有"最新一期 + 与上一期的对比标签"，还不是规范 Section 五.5 要求的"约 8 个季度"完整历史，后续如果要做完整历史需要抓多期 Trustnet/Value Partners PDF 或东方富历史归档，属于进一步的工作量，本轮未做。

## 六、更新后的未做事项（截至本节写作时点）

- 仍未做：git push、部署、上传体验版、提审、真机测试。
- 仍未做：`mergeFundamentals()` 整行合并粒度问题、`shortTermInvestments ?? 0` 缺失当零问题（Section 四 B 的两处已知缺口）。
- 仍未做：美股财报深度（七巨头）、A股 5 年分红历史、港股新股全生命周期回补、机构持仓完整 8 季度历史。
- 仍未做：Phase 5 测试与验收（`audit-miniprogram.mjs` 等脚本重跑、375/430px 截图）。
- wangchao 侧改动仍全部未提交（本次改动只加不减，未执行任何 git reset/checkout/clean）。

---

## 七、Phase 3 进展（A股5年分红历史回补）+ Phase 4 试点（详情页接入）

日期：2026-09-13（同日追加，用户对"继续 A 股 5 年分红历史"回复"同意"后完成）

### 7.1 根因：不是抓取失败，是从来没抓过历史，只抓了当期一条

**修复前的真实状态**：`wangchao/lib/live-data.mjs` 的 `fetchAShareFinancial()` 只请求当期一个报告期的现金流/主要财务指标，`aShare.fundamentals[i]` 里完全没有分红的历史序列字段——这也是为什么 `aurumer-pages/miniprogram/pages/detail/index.js` 里此前专门留了一段注释，说明"这里不是三年股息趋势，快照里每只 A 股只有一个报告期，没有历史分红序列，硬画三年趋势就是编数据"，因此详情页的"分红"标签页此前只能展示当期股息率 + 现金质量指标，完全没有跨年对比。

### 7.2 数据源与过滤设计

新增两个函数（`wangchao/lib/live-data.mjs`）：`fetchAShareDividendHistory(code)` 调用东方财富"数据中心"公开结构化接口（`reportName=RPT_SHAREBONUS_DET`，分红送配详情，无需鉴权），`aggregateDividendHistory(rows)` 做聚合。设计要点：

- **只算 `ASSIGN_PROGRESS === "实施分配"` 的记录**，排除"董事会决议通过"等尚未最终实施的预案——用真实 curl 测试确认了 600028/601328 两只票上确实存在这两种状态并存的情况，不是理论风险。这是直接落实规范"陈旧/未决数据不得当成已发生事实"的原则。
- **同一年内多次分配（中期+年度）按年合并求和**，保证跨年可比。
- **抓取失败时整个字段直接不写入**（不写 `null`/`undefined`），因为下游 `write-live-snapshot.mjs` 的合并逻辑是 `{...上次快照, ...本次抓取}` 的对象展开——如果显式写 `undefined` 会把上一次成功抓到的历史覆盖掉，这是特意避开的一个坑。

### 7.3 验证结果：20 / 20 只 A 股，覆盖 5–29 年，全部满足规范"≥5年"要求

用 `npm run snapshot` 跑通完整生产流水线（含既有的合并与完整性总闸校验，未触发拒绝），再直接读取落盘后的 `wangchao/data/live-snapshot.json`（不是只看合并前的中间结果）逐只核对：

| 覆盖年数 | 股票代码 |
|---|---|
| 5 年（2022–2026） | 600941 中国移动、600938 中国海油 |
| 13–20 年 | 000333 格力(13)、601288 农业银行(16)、601939/601088/601328/601857(19)、601398/601166/601006(20) |
| 23–29 年 | 600900(23)、600585(23)、600011(23)、600036(24)、600028(25)、600377(26)、600000(26)、600019(26)、000651 格力电器(29，1996–2026) |

20 只全部 ≥5 年，中位数在 20 年左右，最长 29 年——不只是"达标"，多数票远超规范最低要求。抽样核对了 600900 的具体金额（2024 年 10 派 8.2 元、2025 年 10 派 7.33+2.10=9.43 元、2026 年 10 派 7.9+2.1=10 元），与东方财富公开数据逐条对得上。

### 7.4 已接入产品（Phase 4）：详情页分红标签页新增真实分年柱状图

原来 `pages/detail/index.js` 的"分红"标签页只有股息率对比和现金质量两张卡，且代码里明确写着"没有历史分红序列"。这次新增 `dividendHistoryVisual()`，把 `raw.financials.dividendHistory` 渲染成一张分年柱状图（最近 10 年，避免个别票 29 年历史把这一屏拉得太长；完整覆盖年数放进图表的 stats 里，不裁掉真实范围的说法），插入到"分红"标签页最前面。同时把详情页里那段"没有历史分红序列"的旧注释改写为如实反映新状态的说明（历史分红金额有了，但分红**收益率**的历史趋势仍然没有——那需要配合历史股价，快照没有这个序列，没有硬凑）。

**验证方式**：由于该页面用 `Page({...})` 直接注册、内部函数未导出，无法用常规 `require` 做单元测试。改用等价的非侵入方案——在内存中把源文件按原路径加载（保证相对 `require` 正常解析）并追加导出 `detailView`，再用 `findItem()` 从**真实的、已同步进小程序包的** `miniprogram/data/live-snapshot.js` 里取 000651、600028、600900 三只真实数据跑 `detailView()`，确认"分红"标签页第一张图正确显示为"分红历史（每10股，含税）"，年份/金额与源数据一致，且 stats 正确显示覆盖年数；另外验证了三种异常输入（无历史/空数组/仅一条记录）都安全返回 `null`、不会导致图表区崩溃，页面会退回到已有的"当前没有足够的分红数据"空态文案。**这不等于在微信开发者工具真机模拟器里截图验证**——本环境没有可用的小程序模拟器工具链，这一步仍待后续用微信开发者工具或真机做视觉走查。

**运行 `npm run audit` 时顺带发现的、与本次工作无关的 3 处历史遗留问题**：`check:public`/`check:ui`/`check:mini` 三个环节各失败一条，但断言的分别是"底仓如何配置"卡片（US）、基于本地成本的持仓浮盈展示、首页年度会员角标——前者的功能代码本身已在更早的会话里被主动整块撤掉（`daily-answers.js` 里有说明撤掉原因的注释），后两者对应的正是本项目多轮明确要求"不得恢复"的"我的持仓"与"旧会员角标"。这是审计脚本没有跟着产品决策同步更新，不是本次改动引入的新问题，本轮未touch这三个脚本（改审计口径本身是个需要用户确认的产品判断，不属于"A股分红历史"这一任务范围）；已经用 spawn_task 单独登记了一个后续任务去跟进。

## 八、再次更新的未做事项（截至本节写作时点）

- 仍未做：git push、部署、上传体验版、提审、真机测试。
- 仍未做：`mergeFundamentals()` 整行合并粒度问题、`shortTermInvestments ?? 0` 缺失当零问题（Section 四 B 的两处已知缺口）。
- 仍未做：美股财报深度（七巨头，本轮评估现有覆盖已经比较完整，需要更精确核对原始需求条文后再判断是否有必要继续）、港股新股全生命周期回补、机构持仓完整 8 季度历史（目前只有最新一期+对比标签）。
- 仍未做：Phase 5 完整测试与验收——`npm run audit` 三项历史遗留失败尚未处理（详见 7.4，已拆分为独立后续任务）、375/430px 真机/模拟器截图走查未做。
- 分红**收益率**的历史趋势（区别于分红**金额**历史，本节已完成）仍然没有，因为缺历史股价配合，没有硬凑。
- wangchao 侧改动仍全部未提交（本次改动只加不减，未执行任何 git reset/checkout/clean）；aurumer-pages 侧 `data/live-snapshot.json`、`miniprogram/data/live-snapshot.js`、`pages/detail/index.js` 的改动同样全部未提交。

---

## 九、详情页柱状图/仪表盘视觉优化 + Section 四 B 两处遗留缺口修复

日期：2026-09-14

### 9.1 柱状对比图/仪表盘视觉优化（用户已明确授权可动）

审查 `miniprogram/pages/detail/index.wxss` 发现两处真实问题，均已修复：

1. **`.meter-fill` 是死 CSS**：该类没有 `background` 属性，`index.wxml` 里内联的 `width: {{item.percent}}%` 完全没有视觉效果——所有仪表盘（`meterVisual`/`bandMeterVisual`/`scoreMeter`，覆盖美股价格位置、黄金国际/人民币观察分、A股参考买卖区间等场景）实际显示的都是 `.meter-track` 那条静态三段彩虹渐变条，唯一真正反映数值的只有圆点位置。修复：给 `.meter-fill` 补上从灰底到实色的真实填充渐变 + `transition`，圆点同时加轻微阴影。
2. **CSS 层叠顺序 bug**：`.bar-value.down`/`.solid-bar.down`（涨跌语义色）在样式表里写在 `.tone-1/2/3`（装饰色）**之前**，WXML 同时套两个 class 且优先级相同时，后声明的 `tone-N` 规则总是覆盖语义色——意味着对比图（如 `revenueGrowth`/`roe`）里任何排在第 2/3/4 位且为负值的柱子，会显示装饰色（蓝/黄/绿）而不是应有的跌色（红橙），存在误导亏损/下跌方向的风险。修复：把 `.down` 规则移到 `.tone-N` 之后，并加注释固定这个顺序依赖。同时给 `.solid-bar`/`.bar-value` 加了渐变、阴影、入场动画（`scaleY`/`scaleX` 生长），视觉观感更接近参考的三个 App。

**回归验证**：`npm run audit` 逐项重跑，`check:public`/`check:ui`/`check:mini`/`check:payment` 全部通过，与改动前结果一致（`check:pages` 的失败是 Section 7.4 已记录的历史遗留断言，与本次改动无关，未被本次改动放大或掩盖）。

**微信开发者工具真机模拟器视觉走查**（本轮新完成，此前几轮进度报告里"375/430px 截图走查未做"这一项在此部分补齐——**用词纠正**：以下走查用的是自动化连接时 DevTools 当前默认的模拟器设备档位，没有分别显式切换到 375px 和 430px 两档做双宽度对比截图，这里如实改成"截图走查已完成，双宽度专项对比另见 `DETAIL_PAGE_REDESIGN_ACCEPTANCE.md` 第四节的等价性论证"，避免误读成两档都各自实测过）：用 `miniprogram-automator` 连接开发者工具，逐一截图验证：
- 英伟达（NVDA）价格 tab：近60日折线图 + 涨跌区间仪表盘（70% 填充，圆点位置准确）。
- A股 600011 价格 tab：`bandMeterVisual` 参考买卖区间圆点定位准确；`solidVisual` 现价/昨收对照柱新渐变样式正常。
- A股 600011 分红 tab：`dividendHistoryVisual` 十年柱状图（对应 Section 7 已回补的真实分红历史数据）渐变色按 tone 正确轮换。
- 黄金追踪 tab：`meterVisual`/`scoreMeter` 国际金/人民币金两个观察分仪表盘（68/100、60/100）填充准确对应分值。

**一个排查插曲，如实记录**：验证过程中一度在多次截图里发现英伟达折线图 canvas 渲染为空白，一度怀疑是本次 CSS 改动引入的真实回归。排查过程：确认图表数据本身完整（`page.data()` 里 `values.length: 60`）、排查出是自己测试脚本导致小程序页面栈堆到 10 层硬上限触发了一次连接错误（`miniProgram.reLaunch()` 修复）、多次延时重试均未解决。最终判定：**不是 CSS 改动导致的回归**，而是本轮压力测试中开发者工具自动化会话本身老化产生的假象——完全重启 `cli auto` 自动化进程后，用同一份已改动的 wxss 文件跑全新会话，折线图立即恢复正常渲染。记录这个排查过程是为了如实说明"截图一度失败"这件事本身，不是要掩盖它。

### 9.2 Section 四 B 两处已知缺口：本轮已修复（此前进度报告只诊断未修复）

**缺口 1：`mergeFundamentals()` 整行级别合并** —— `wangchao/scripts/write-live-snapshot.mjs:64-92`。修复前：只要某支股票在本次抓取里存在（哪怕部分字段抓取失败为 null），就整行采用新数据，旧快照里其他正确字段被静默覆盖，且没有任何标记提示"这次有字段没取到"。修复：新增 `mergeFundamentalRow()` 做逐字段合并——只有当前字段是 `null`/`undefined`/空数组时才用旧快照同一字段兜底，字段是真实值（包括合法的 `0`）时一律采用新抓取结果，整行都缺失时仍走原有的整行兜底路径。用 4 组合成数据（非真实抓取，纯函数单元测试）验证：部分字段失败被正确兜底、整行缺失仍正确兜底、新抓取的真实 `0` 不会被旧值污染、首次运行无旧数据时透传正常——4 组全部通过。

**缺口 2：`shortTermInvestments ?? 0`** —— `wangchao/lib/live-data.mjs:1071-1075`。修复前：数据源没有单独列出"短期投资"这一行时，会被当成真实的 $0；由于 `aurumer-pages/miniprogram/pages/detail/index.js:864,981` 的展示逻辑是 `hasNumber(fund.shortTermInvestments) ? formatLarge(...) : null`，而 `hasNumber(0)` 为真，这会让用户在详情页"依据"标签页看到一行编造的"短期投资 $0"，而不是如实隐藏这一行——这是本次审查中确认的、真实存在用户可见影响的实例，不是纯理论风险。修复：改为 `?? null`，未披露时正确留空，`hasNumber()` 会自动隐藏该行，无需改动小程序端代码。`liquidAssets`（现金+短期投资的合计，用于 `cashRich` 质量判断）计算里仍用 `shortTermInvestments ?? 0` 参与求和——这是有意保留的、影响更小的权衡（合计数取"已知信息的最佳估计"是合理惯例，问题只在于单独字段本身不能谎报是"0"），已在代码注释里写明理由，不是遗漏。用 3 组合成数据验证 `shortTermInvestments`/`liquidAssets` 在"缺失/真实为0/真实有值"三种场景下行为符合预期。

**验证方式说明**：两处修复都只是内部纯函数级别的合并/取值逻辑调整，不涉及新的网络请求，用合成数据做单元测试即可完整覆盖所有分支；未运行 `npm run snapshot` 做真实抓取端到端验证（该命令会对 20 只 A股 + 全部美股 + 黄金 + 港股新股 + 多个机构持仓源发起实时请求，与本次两处窄范围的纯函数修复相比属于不必要的额外外部请求量，遵循此前 Phase 3 阶段同样的"不做非必要高频请求"判断）。**两处修复均未提交**，wangchao 侧仍保持只加不减、未 commit 的状态。

### 9.3 本轮新确认的数据缺口（供 Section 五/十一 使用）

- **港股新股全生命周期**：**本条经过两轮自我纠正，记录完整过程以便复核**。第一轮：最初判断"本项目完全没有常规港股行情抓取管道"，复查 `wangchao/lib/live-data.mjs` 后发现不准确——`fetchEastmoneyIPOTradingRows`/`fetchTencentIPOTradingRows`（东方财富 `secid: 116.${stockCode}` 为主源、腾讯财经 `hk${stockCode}` 为备源）确实会对每只港股新股请求上市后最多 30 个自然日的日线数据，只是追踪调用链（`fetchIPOFifthTradingDay` → `enrichIPOFifthTradingDays`）后发现这 30 天窗口只是为了在节假日缺口下仍能凑够 5 个交易日而预留的抓取余量，实际只用 `rows.slice(0, 5)`，第 6 天起的数据抓下来即弃用、从未落盘。第二轮（更关键的更正）：继续追踪这份 `fiveDayChange/fiveDayHighChange/greyMarketChange/firstDayChange` 数据最终去了哪里，发现它们只服务于"打新"模型的校准回测（`calibrate`/`meanAbsoluteError` 等，比较预测涨幅与实际结果），以及 `sanitizeHKListing` 里的 `historicalReview`——这正是小程序详情页 `market: "hk"` 模块（`miniprogram/pages/detail/index.js:43` 的标签明确写的是**"港股打新"**，不是"港股行情"）里 `buildHKView()` 展示的"暗盘涨跌/首日涨跌/五日涨跌/五日最高"这几行事实卡片。查看 `buildHKView` 全部渲染字段（一手中签/招股价/公开认购倍数/上市日期等）可以确认：这个模块从设计目标上就是"打新决策 + 结果复盘"的一次性事实卡片，不是像 A股/美股/黄金详情页那样带 60 点行情曲线的持续行情跟踪页——它甚至没有任何 `lineVisual`/`meterVisual` 之类的图表渲染，全部是 `compactFacts` 文字行。**最终结论：这不是一个真实缺口，而是本轮早期的错误类比**（把 A股/美股详情页"应该有持续行情曲线"的预期套用到了一个设计上就不是行情页的打新模块上）。上市第 5 交易日的复盘正好是"打新回顾"这个功能所需要的全部信息；把它延展成无限期的持续行情追踪，属于新增功能而非补全现有功能的缺口，且会与"首页布局不变、不做新交易功能"的既定范围冲突。归类为**确认非缺口**，不再列入待办。
- **机构持仓历史深度**：确认目前每个基金只有"最新一期 `reportDate` + 上一期 `previousReportDate` 的对比标签"，不是规范要求的约 8 个季度完整序列。需要抓取 Trustnet/Value Partners/东方财富的多期历史 PDF/归档页面，属于较大工作量项，本轮未做。
- **美股"七巨头"数据深度**：确认目前七巨头（`market-lenses.js` 里的 `MAGNIFICENT_SEVEN`）只在打分/标签逻辑（`mag7Lenses`/`cheap7`/`risk7`）里被特殊处理，原始数据本身（60点历史、`fundamentals` 字段集合）与其他美股完全一致，没有额外深度。判断：现有覆盖已是所有美股统一的基线水平，暂不认为这是需要单独补的缺口，除非能拿到原始需求条文明确要求七巨头有超出统一基线的额外数据。
- **分红收益率历史趋势**：再次确认不存在（区别于已完成的分红金额历史）——需要历史股价配合计算，快照没有这个序列，维持此前"不硬凑"的判断。

## 十、再次更新的未做事项（截至本节写作时点，已被十二取代）

- 仍未做：git push、部署、上传体验版、提审、真机测试。
- 仍未做：机构持仓完整约8季度历史（需抓取多期历史归档）。
- 不再判断为需要做：美股七巨头额外数据深度（本轮确认现状是统一基线，非缺口）；分红收益率历史趋势（本轮确认无法在不硬凑的前提下实现）；港股新股"全生命周期"持续行情（本轮确认 `market: hk` 模块设计目标就是"打新决策+结果复盘"而非持续行情页，详见 9.3 两轮更正说明，不是真实缺口）。
- 仍未做：Phase 5 完整测试与验收里 `npm run audit` 三项历史遗留失败的处理（详见 7.4，已拆分为独立后续任务）。
- 仍未做：Section 十一 六份交付文档（数据覆盖报告/数据源接入清单/需求验收报告/代码与测试说明/页面证据/后续外部操作清单）尚未正式产出。
- wangchao 侧改动仍全部未提交；aurumer-pages 侧改动（含本轮 `.wxss` 视觉优化）同样全部未提交。

## 十一、机构持仓约8季度历史深度补全（部分完成，如实分源说明）

日期：2026-09-14

### 11.1 四个机构持仓源的可延展性盘点

规范要求约8个季度的完整历史序列，修复前所有源都只有"最新一期 + 上一期对比标签"。逐源核实可延展性：

- **SEC 13F（美股基金经理，`MANAGERS` 共9家）**：`fetchSECManagers` 已经为每个经理拉取过一次 `CIK{cik}.json`，其中 `submission.filings.recent` 本身就带一长串历史filing列表，此前 `findRecent13FFilings` 只用了 `.slice(0, 2)`。**可延展，且不增加"发现"请求**——只是把已经在手里的filing列表多切几条出来，额外成本只在于每多切一条就要多发一次 `fetch13FTable`（index.json + xml，每条2个请求）。
- **东方财富 A股明星基金（`A_SHARE_GURU_FUNDS` 共3只）**：实测 `FundArchivesDatas.aspx` 接口不带 `year` 参数时只返回最近2期（"box"），带上显式 `year=YYYY` 会一次性返回该年全部4期。**可延展**，额外成本是每只基金每多查一年多发1个请求。
- **Trustnet / Value Partners（港股基金工厂表）**：复核抓取代码确认是单页 PDF 工厂表快照抓取，`previousReportDate` 是硬编码 `null`——没有可访问的历史归档页面或API。**不可延展**，维持现状，这是抓取手段本身的天花板，不是本轮遗漏。

### 11.2 实现

- `wangchao/lib/live-data.mjs`：`findRecent13FFilings(submission, limit = 2)` 增加 `limit` 参数；新增 `fetchManager13F` 的 `options.deep` 分支（`historyDepth = deep ? 8 : 2`），额外调用 `fetch13FTable` 补齐 filings[2..7]，遇到单次失败立即停止（保留已抓到的部分历史，不整体报废）；新增 `buildManagerHistory()` 按 `reportDate` 逆序输出每期 `{reportDate, filingDate, portfolioValue, positionCount, topHoldings(top3), newCount, soldCount}`，`newCount`/`soldCount` 用相邻两期持仓 `cusip:putCall` 集合做差集计算，最早一期（没有更早一期可比）留 `null`。
- 东方财富侧对称实现：新增 `fetchEastMoneyGuruFundQuarters(fund, year)`（`year` 留空即原有"最新2期"行为）与 `buildEastMoneyGuruHistory()`（按 `reportDate` 去重、逆序、裁到8条）；`fetchEastMoneyGuruFund` 的 `options.deep` 分支循环请求 `[今年, 去年, 前年]` 三年数据后拼接。
- `fetchLiveData(options)` 新增 `deepGuru` 开关（用法与既有 `deepHK` 开关一致的模式），透传给 `fetchSECManagers({deep})`/`fetchEastMoneyGuruFunds({deep})`；不传时行为与改动前完全一致（`historyDepth` 默认值仍是2，不产生 `history` 字段）。
- `aurumer-pages/cloudfunctions/aurum-data/sanitize.js` 的 `sanitizeInvestor()` 复核确认是排除名单模式（只剥离5个命名字段，其余用 `...rest` 透传），新增的 `history` 字段不需要改 sanitize.js 就能正常透传到前端。

### 11.3 真实数据验证（非合成数据——风险点在于HTTP/正则集成本身，因此用真实请求验证）

临时导出 `fetchManager13F`/`fetchEastMoneyGuruFund`/`MANAGERS`/`A_SHARE_GURU_FUNDS` 供独立脚本调用真实的 SEC EDGAR 与东方财富接口（验证后已恢复为模块内部非导出声明，未留下多余公共接口）：

- **SEC 13F / 巴菲特（伯克希尔）**：`deep: true` 返回 `history.length === 8`，从 2026Q2 一路到 2024Q3，`portfolioValue`（约2570亿–2990亿美元区间）、`positionCount`（29–42）、`topHoldings`（AAPL/AXP/KO/BAC 轮换）、`newCount`/`soldCount` 全部数值合理，最早一期 `newCount`/`soldCount` 正确为 `null`。
- **东方财富 / 明星基金（`chinaamc-largecap`）**：`deep: true` 返回 `history.length === 8`，从 2026Q2 到 2024Q3，`topHoldings`（宁德时代/立讯精密/惠泰医疗等真实持仓轮换）、`newCount`/`soldCount` 数值合理，最早一期同样正确为 `null`。

两个源均一次通过，未发现需要修复的 bug。本仓库没有 Jest/Mocha 一类的持久化测试框架（`package.json` 里只有 `audit:*`/`check:*` 脚本，无 `test` 目录），延续本轮 Section 9.2 起对"纯函数用合成数据、真实网络集成用一次性脚本打真实请求"的区分惯例，用完即删，不在仓库里留痕。

### 11.4 有意未做的事：`deepGuru` 未接入常驻抓取入口

`scripts/write-live-snapshot.mjs`/`scripts/audit-strategies.mjs` 目前调用 `fetchLiveData({ deepHK: true })`，**本轮未加上 `deepGuru: true`**。原因：深度模式最坏情况下每次运行会多发约114个请求（9个经理最多各6条历史filing×2请求=108，加3只基金各2个历史年份=6），这是一个需要用户决定节奏的运营成本，不应该在没有明确告知的情况下默默开启到每次常驻抓取里；同时 Phase 5 的 `npm run audit` 目前还带着已知的历史遗留断言失败（Section 7.4），现在不适合再往同一条抓取链路上叠加新的失败面。`history` 字段目前只有在显式传入 `deepGuru: true` 时才会出现，默认行为（含线上定时任务）不受影响。

**留给用户决定的问题**：这个约8季度历史要多久刷新一次？可选项包括——(a) 每次常驻快照都带 `deepGuru: true`（约114个额外请求/次，数据最新但成本最高）；(b) 单独开一个低频定时任务（例如每周/每月跑一次深度模式，其余时间用现有的"最新+上一期"模式），历史数据会有相应的滞后；(c) 暂不接入常驻任务，仅在需要时手动跑。本轮不擅自选择，等用户明确后再接入调用点。

### 11.5 未在本轮做的事

- 小程序前端展示：`miniprogram/pages/section/index.js` 的 `buildGuruModule()` 目前只展示单期"重仓前5"+ 与上一期的对比文案，没有消费新的 `history` 字段做多期趋势 UI。本轮判断为**后端补数据优先，前端展示留待后续**——原因是当前遗留的更高优先级事项（Phase 5 审计断言修复、Section 十一六份交付文档）还没做，且规范本身要求的是"数据覆盖深度"，未强制要求前端必须做多期趋势可视化。
- Trustnet/Value Partners 两个港股源的历史深度：如 11.1 所述，抓取手段本身没有可用的历史归档入口，不是本轮遗漏，是真实存在的数据源限制。

## 十二、再次更新的未做事项（截至本节写作时点）

- 仍未做：git push、部署、上传体验版、提审、真机测试。
- 部分完成：机构持仓约8季度历史——SEC 13F（美股）与东方财富（A股明星基金）两源已实现并用真实数据验证通过，但**未接入常驻抓取入口**（见 11.4，等待用户对刷新节奏的决定）；Trustnet/Value Partners（港股）两源因抓取手段限制无法延展，维持现状。
- 不再判断为需要做：美股七巨头额外数据深度；分红收益率历史趋势；港股新股"全生命周期"持续行情（均见 9.3/十）。
- 仍未做：Phase 5 完整测试与验收里 `npm run audit` 三项历史遗留失败的处理——如 7.4 所述，这三条失败对应的是审计脚本没跟上"整块撤掉底仓配置卡/不恢复持仓浮盈/不恢复年度会员角标"这几个已经明确拍板的产品决策，修的应该是审计脚本的断言口径而不是产品代码；但"改断言口径"本身是需要用户确认的产品判断（万一某条断言其实还有别的用途），本轮不擅自改，已用 spawn_task 单独登记跟进。
- 澄清：9.1 的截图走查只验证了自动化连接时的默认模拟器宽度一档（390px），"375px 和 430px 双宽度专项对比"没有分别做。**这不是新问题**——`docs/DETAIL_PAGE_REDESIGN_ACCEPTANCE.md` 第四节已经对此做过更严谨的核实：`miniprogram-automator` SDK 通读源码确认完全没有 `setViewport`/`resize`/`device` 一类的视口切换接口；详情页布局全部用 `rpx`（微信里与屏幕宽度成比例的单位）而非固定 px，代码里仅有的两处像素级媒体查询（`max-width: 340px`、`min-width: 700px`）都不落在 375–430 区间，因此 390px 截图在 CSS/JS 层面代表 375/430 两档是站得住脚的等价论证，但仍明确标注"不等同于两个宽度各自实测"，并建议后续如需更严格证据可改用支持视口切换的 H5/Playwright 预览通道。本轮沿用这个已有的、如实标注局限的结论，不重复排查。
- 仍未做：Section 十一（原始规范编号，非本文档的十一）六份交付文档（数据覆盖报告/数据源接入清单/需求验收报告/代码与测试说明/页面证据/后续外部操作清单）尚未正式产出。
- wangchao 侧改动仍全部未提交；aurumer-pages 侧改动同样全部未提交。

## 十三、11.4/十二遗留的三项决策——用户授权后评估执行

日期：2026-09-15
用户原话："你可以自行评估，找到最优方案，然后逐条执行"。以下按 [FOLLOWUP_EXTERNAL_ACTIONS.md](FOLLOWUP_EXTERNAL_ACTIONS.md) 列出的三项逐条处理，结论与改动如实记录。

### 13.1 `deepGuru` 刷新节奏——采用方案(b)，已接入低频月度任务

**评估**：SEC 13F 与东方财富基金季报本身按季更新（一年最多4次新数据），而常规快照一周跑约9次（`daily-us-snapshot.yml` 4条cron：工作日盘后×2、周日补一趟、周一早盘前一趟）。如果方案(a)每次都开深度模式，一年会多发近5万次请求换来的是"同一份季度数据被重复抓几十遍"，纯浪费；方案(c)完全手动则历史数据会长期滞后。方案(b)——单独低频跑深度模式——在及时性和成本之间最合理：每月跑一次，最坏情况下新一期13F/基金季报出来后最多滞后约30天才被收录，但请求量比方案(a)降低超过90%。

**执行**（`wangchao` 仓库）：
- [`.github/workflows/daily-us-snapshot.yml`](../../wangchao/.github/workflows/daily-us-snapshot.yml)：新增第5条 cron `"0 2 1 * *"`（每月1日 UTC 02:00，即北京时间10:00），并在"Refresh market data"步骤加 `env: AURUM_DEEP_GURU: ${{ github.event.schedule == '0 2 1 * *' && '1' || '0' }}`——只有这一条月度触发会把该环境变量设为 `1`，其余4条常规cron行为不变。
- [`scripts/write-live-snapshot.mjs`](../../wangchao/scripts/write-live-snapshot.mjs)：新增 `const enableDeepGuru = process.env.AURUM_DEEP_GURU === "1"`，`fetchLiveData({deepHK:true})` 改为 `fetchLiveData({deepHK:true, deepGuru: enableDeepGuru})`。
- **关键的一处补充**（评估时发现的真实风险，不是原方案里提到的）：`fetchManager13F`/`fetchEastMoneyGuruFund` 在非深度模式下根本不会写入 `history` 字段（不是留空数组，是键都不存在）。而 `write-live-snapshot.mjs` 每次都会用 `fetchLiveData()` 的结果**整体覆盖** `payload.investors`，之前完全没有"沿用上一份快照里的 `history`"这类合并逻辑（其余字段如黄金、A股基本面都有类似的合并兜底，唯独机构持仓没有）。如果不补这一步，`history` 会在月度深度任务跑完的当天出现，第二天常规快照一跑就直接被覆盖消失——等于这个功能一个月里364天都是"无效"的。已比照文件里 `payload.gold = previousPublicSnapshot.gold` 的既有写法，新增：非深度模式下，若某机构在本次抓取结果里没有 `history` 但上一份快照里有，就把上一份的 `history` 原样带过来。这样 `history` 会持续可用，只是内容按月刷新，而不是按天有按天没有。
- [`scripts/audit-strategies.mjs`](../../wangchao/scripts/audit-strategies.mjs)：同样加上 `AURUM_DEEP_GURU` 环境变量读取，保持与快照脚本一致的开关方式，方便用户需要时手动 `AURUM_DEEP_GURU=1 npm run audit:strategies` 本地跑一次深度模式。
- 验证：`node --check` 两个脚本均通过；`python3 -c "import yaml; yaml.safe_load(...)"` 确认 workflow YAML 语法有效。**未做的验证**：没有实际触发一次月度cron或本地跑一次 `AURUM_DEEP_GURU=1` 全量快照（会真的发114个额外请求，且需要等到下个月1号或手动 `workflow_dispatch` 触发cron分支——`github.event.schedule` 只在 `schedule` 触发时存在，手动触发 `workflow_dispatch` 不会命中这个条件），11.3 已经用真实数据验证过 `deepGuru:true` 本身抓取正确，这里新增的只是"什么时候调用它"的调度逻辑，尚未跑过一次完整的真实end-to-end月度触发。

**本轮补充（用户要求"真实完整跑过一次，手动验证"）**：本地执行 `AURUM_DEEP_GURU=1 node scripts/write-live-snapshot.mjs`，真实发起全部深度请求（9位 SEC 13F 管理人各最多8期历史、3只东方财富A股基金各3年历史），端到端跑通并写入 `wangchao/data/live-snapshot.json`。这次真实运行本身就发现了一个此前合成数据/两次单点验证都没有暴露的真实 bug，见下方"13.1a"。

### 13.1a 真实运行中发现并修复的 bug：SEC 13F legacy 千元单位未识别，德鲁肯米勒机构规模曾算错1000倍

**发现过程**：为 13.3 的趋势图接入 `portfolioValue` 后，逐个机构核对图表数字量级是否合理，斯坦利·德鲁肯米勒（Duquesne Family Office）显示"最新 $521.1万"——对比公开认知里 Duquesne 的 13F 规模应在数十亿美元级别，明显不对，但同批其余8位 SEC 管理人（巴菲特$2992.5亿、阿克曼$137.1亿、达利欧$243.8亿等）量级都正常。

**根因**：`lib/live-data.mjs` 的 `parse13FInformationTable()` 直接读 13F XML `<value>` 标签的数字，隐含假设"值以整美元计价"（SEC 2023年规则修订后的新标准）。但实测抓取 Duquesne 最新一期 13F XML（`form13f_20260630.xml`）发现该申报仍沿用2023年前的legacy惯例——以"千美元"为单位（例如 `<value>15455</value>` 对应403,100股10X Genomics，隐含每股约$38.3，若当整美元读则是每股$0.038，不可能）；且该申报自己的 cover page `tableValueTotal`（primary_doc.xml）也用同一套错误单位自报，无法靠"跟封面对账"发现问题，只能靠"隐含每股价格是否落在合理区间"这类外部常识校验。逐一核对同批全部9位管理人最新一期申报的"隐含每股价格中位数"：其余8位全部落在 $45–$210 合理区间，唯独 Duquesne 是 $0.09——确认只有这一家、这一批次的申报使用了legacy千元单位。

**修复**：`parse13FInformationTable()` 新增单位自检——对每份申报，取全部普通股持仓（排除期权）的"市值/股数"隐含每股价格，算中位数；若中位数小于$1（真实机构持仓的中位数持仓不可能是几分钱的股票），判定整份申报使用千元单位，把该申报里全部 `value` 统一乘以1000。按申报（filing）级别判定、不按单只持仓判定，因为单位选择是申报格式层面的选择，不会同一份文件里有的用整元有的用千元。

**验证**：
- 用真实抓取的 Duquesne 与 Buffett 两份 XML 直接跑修复后的 `parse13FInformationTable()`：Duquesne 总值从 $5,210,856 修正为 $5,210,856,000（约$52.1亿，量级转为合理）；Buffett 保持 $299,253,556,246 不变（确认修复不会误伤已经正确的整元格式申报）。
- 重新跑一次真实 `AURUM_DEEP_GURU=1` 全量深度快照，核对 Duquesne 全部8期历史（2024Q3–2026Q2）均落在 $29.5亿–$52.1亿区间，其余8位 SEC 管理人的8期历史逐期核对，量级全部保持不变（说明这个legacy千元单位问题只出现在 Duquesne 这一家，不是普遍性 bug）。
- 用 `miniprogram-automator` 连接真实模拟器加载修复后的快照，确认"持仓走势"图表最终展示"$52.1亿"（而不是修复前的"$521.1万"），见 [PAGE_EVIDENCE.md](PAGE_EVIDENCE.md)。

**影响范围说明**：这个 bug 在本轮之前**从未在任何已上线页面暴露**——机构持仓原有的"重仓前5"展示只用持仓权重百分比（分子分母同时错1000倍，比例本身不受影响），唯一会把 `portfolioValue` 绝对值展示给用户的，是本轮 13.3 新做的趋势图。也就是说，这是"新功能开发过程中的验收环节，在正式上线前"发现并修复的，不是线上已经展示错误数据后才补救。

### 13.2 Phase 5 `npm run audit` 三项失败——重新核实后发现原判断已过时，真实原因不同，已修复

**评估**：重新运行 `npm run audit`（`aurumer-pages` 仓库）核实11.4/十二里描述的"`check:public`/`check:ui`/`check:mini` 因审计脚本没跟上产品决策而失败"是否仍然成立。**结果：这三项检查单独跑和放进完整 `npm run audit` 链路里跑，全部通过，不需要改任何断言**——此前的判断已经不是当前真实状态（很可能是更早的会话阶段属实，但后续的产品代码改动已经让这几个断言自然满足，只是没有人回来复核）。

真实复跑 `npm run audit` 发现了一个**不同的、真实存在**的失败：`check:pages`（`audit-public-routes.mjs`）报 `/stocks/NVDA 分享说明未同步`。排查后确认原因：本轮会话过程中 `data/live-snapshot.json` 被多次用真实数据测试脚本重新写入（`git diff` 显示 +7301/-1224 行），但生成 `stocks/*`、`a-shares/*` 等98个静态直达页 `index.html` 的 `npm run routes` 没有跟着重新跑，导致静态页里嵌的分享文案落后于快照里的最新数据——这是**构建产物过期**，不是审计脚本口径有问题，也不需要用户做产品判断。

**执行**：跑了一次 `npm run routes`（纯本地重新生成，读 `data/live-snapshot.json` 写 `stocks/`/`a-shares/`/`us-stocks/`/`gurus/`/`hk-ipo/`/`gold/` 下的 `index.html`，不联网、不碰 git），59个静态页文件被更新（每个平均改2行，即 canonical/分享说明/跳转目标里的具体数值），随后 `npm run audit` 完整跑通全部5项检查（`check:public`/`check:pages`/`check:ui`/`check:mini`/`check:payment`）。

**结论**：11.4/十二里"需要用户对断言口径做判断"这条已经不成立，撤销该未决项；此前登记的对应 spawn_task 建议视为过时，可以在界面里手动关闭（本次会话没有该任务的 task_id，无法用工具直接撤销）。

### 13.3 机构持仓多期趋势前端UI——用户后续明确要求后已实现并验收

> 本节此前的结论是"评估后决定本轮不做"（见下方存档），理由是这属于产品增量决策而非缺陷修复。用户后续明确指示"做机构持仓走势图"，将其转为一条正式需求；本节记录实际实现与验收过程，原"暂不做"结论作废。

**实现**：`miniprogram/pages/section/index.js` 在原有"共同方向""机构持仓"两个子标签基础上新增第三个子标签"持仓走势"（`guruSubTab` 三态切换，`switchGuruSubTab()`），复用后端已就绪的 `history` 字段（`{reportDate, filingDate?, quarterLabel, portfolioValue, positionCount, topHoldings, newCount, soldCount}`）：
- `guruQuarterLabel()` / `guruFundSizeText()`：把原始 `reportDate` 与 `portfolioValue` 转成"24Q3"这类季度短标签与"$52.1亿"这类中文金额短文案；
- `guruHistoryChart()`：不用 canvas，纯 div+CSS 画多期柱状图（列数=期数，柱高按 portfolioValue 归一化），附最低/最新/最高三档摘要文案；
- `guruHistoryRows()`：图表下方补一张逐期表格，展示规模、持仓数、新增/清仓数；
- 对东方财富等结构性缺失 `portfolioValue`/`positionCount` 的来源（如 chinaamc-largecap），展示差异化空态文案"该来源未披露基金规模与持仓数，暂不能画规模趋势图；下方各期新增/清仓变化仍可参考"，不伪造数据填补；对完全没有多期历史的来源（如 value-partners-classic），展示"该机构暂未接入多期历史，仅有最新一期公开披露"。

**验证**（真实模拟器，非猜测）：用 `miniprogram-automator` 连接真实微信开发者工具实例，`callMethod` 驱动 `switchGuruSubTab`/`selectGuruInstitution` 切换到"持仓走势"标签并遍历三类机构，截图三张并逐张人工核对渲染结果（见 [PAGE_EVIDENCE.md](PAGE_EVIDENCE.md)）：
1. Druckenmiller（SEC 全量历史）：8 期柱状图 + 摘要 + 表格，数值正确；
2. chinaamc-largecap（东方财富，无 portfolioValue）：差异化空态文案 + 仅新增/清仓的表格；
3. value-partners-classic（无多期历史）：单期空态文案 + "趋势图怎么来的"说明折叠区。

**验收过程中发现并修复的真实 bug**：为核对图表金额量级是否合理，逐一检查全部机构最新一期 `portfolioValue`，发现 Druckenmiller（Duquesne Family Office）显示"$521.1万"，与其真实体量明显不符，其余 8 位 SEC 机构量级均正常。追查发现是该机构 13F 申报本身使用了 SEC 2023 规则修订前的 legacy"千美元"计价单位（详见上方 13.1a），已在 `wangchao/lib/live-data.mjs` 的 `parse13FInformationTable()` 中修复并重新生成全量快照验证。这是"新功能验收环节倒逼发现底层数据 bug、且在上线前修复"的典型案例，不是需求范围蔓延。

**产品克制边界（保留）**：即便加了这个新标签，也没有改动首页布局、没有恢复"我的持仓"、没有新增交易类功能——新标签只挂在"聪明钱"模块下的第三个子标签，与既有两个子标签同级，符合原规范"首页与既有页面结构不动"的约束。

<details>
<summary>原结论存档（已作废，仅供追溯）</summary>

**评估**：这是纯粹的新增展示功能，不是补数据、不是修复缺陷。原始规范的定位是"增加后端数据覆盖深度的同时保持前端结构简单"，而且明确要求首页等既有页面结构不做改版；虽然聪明钱模块不是首页，但同一条"不擅自扩展前端"的原则同样适用——现在后端 `history` 字段已经就绪、且经过真实数据验证，是否值得为它单独做一版多期趋势图表（涉及新组件、新交互、新的一轮页面验收和截图证据），属于产品增量决策，不属于"评估找最优方案"这类工程判断的范畴。

**决定**：本轮不做。维持 `buildGuruModule()` 现状（单期"重仓前5" + 与上一期对比文案）。数据已经在后端就绪，前端接入的成本主要是设计与验收工作量，留给用户后续按需求优先级决定是否要做，不在本轮自行扩展范围。

</details>

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
