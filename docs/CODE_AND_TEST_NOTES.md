# 代码与测试说明

日期：2026-09-14
本文档只列**改动了什么代码、怎么验证的**，不重复"为什么改"的完整推理过程（那部分在 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md)）。所有改动截至本文档写作时点均**未提交**（两仓库均为只加不减的工作区状态）。

## 一、`wangchao` 仓库

### 1.1 `lib/live-data.mjs`（累计 +677/-18 行，跨多个子任务）

| 函数/改动 | 内容 | 验证方式 |
|---|---|---|
| `shortTermInvestments` 取值 | `?? 0` → `?? null`，未披露时详情页正确留空而非显示编造的"$0" | 3组合成数据单元测试（缺失/真实为0/真实有值） |
| `findRecent13FFilings(submission, limit = 2)` | 新增 `limit` 参数，`.slice(0, 2)` → `.slice(0, limit)` | 随下方 `fetchManager13F` 一并验证 |
| `buildManagerHistory(filings, positionsByFiling)`（新增） | 按 `reportDate` 逆序输出每期 `{reportDate, filingDate, portfolioValue, positionCount, topHoldings(top3), newCount, soldCount}`；`newCount`/`soldCount` 用相邻两期 `cusip:putCall` 集合做差集；最早一期无更早数据可比，留 `null` | 真实数据验证（见 1.3） |
| `fetchManager13F(manager, options = {})` | 新增 `options.deep` 分支：`historyDepth = deep ? 8 : 2`；额外顺序（非并发）调用 `fetch13FTable` 补齐 filings[2..7]，遇到单次失败立即停止（保留已抓到的部分历史） | 同上 |
| `fetchSECManagers(options = {})` | 把 `options` 透传给批量首轮请求与失败重试的两条路径 | 同上 |
| `fetchEastMoneyGuruFundQuarters(fund, year)`（新增，从旧逻辑抽取） | `year` 留空即原有行为（最新2期）；传入年份返回该年全部4期 | curl 手工验证 `year=` 参数行为（见 1.4） |
| `buildEastMoneyGuruHistory(quarters)`（新增） | 按 `reportDate` 去重、逆序、裁到8条，结构与 `buildManagerHistory` 对称 | 真实数据验证（见 1.3） |
| `fetchEastMoneyGuruFund(fund, options = {})` | `options.deep` 时循环请求 `[今年,去年,前年]` 三年数据拼接后调 `buildEastMoneyGuruHistory` | 同上 |
| `fetchEastMoneyGuruFunds(options = {})` | 透传 `options` | 同上 |
| `fetchLiveData(options = {})` | 新增 `deepGuru` 开关，透传给上述两个 `fetchXxx({deep})` 调用；默认不传，行为与改动前完全一致 | 代码审查确认默认路径未变 |

**临时导出后已恢复**：为验证 1.3 的真实数据测试，一度把 `fetchManager13F`/`fetchEastMoneyGuruFund`/`MANAGERS`/`A_SHARE_GURU_FUNDS` 从模块内部声明改成 `export`，验证完成后已全部改回非导出（`git diff` 目前只反映恢复后的最终状态，不留多余公共接口）。

### 1.1a `parse13FInformationTable(xml)` 千美元/整美元单位自检修复（新增，13.1a）

**改动**：聚合完全部持仓后，新增单位自检——取该申报里全部普通股（非期权）持仓的"市值/股数"隐含每股价格，排序取中位数（样本量需 ≥3），若中位数 < $1（真实股票不可能中位数持仓是几分钱一股），判定整份申报使用了 SEC 2023 规则修订前的 legacy 千美元计价单位，把该申报全部持仓的 `value` 统一乘以1000。按申报（filing）粒度整体判定，不逐条持仓判定。

**为什么不能用申报自己的封面总值对账**：`primary_doc.xml` 的 `tableValueTotal` 由同一份软件生成，用的是同一套（可能错误的）单位，跟 `<value>` 求和结果必然自洽，无法用来发现问题；只能靠外部常识（真实股价不可能是几分钱）交叉验证。

**验证**：
- 用真实抓取的 Duquesne Family Office（Druckenmiller）最新13F XML跑修复后的函数：总值从 $5,210,856 修正为 $5,210,856,000；同样用 Buffett/Burry 的真实XML验证保持不变（临时导出该函数，用完恢复非导出，`git diff` 确认无残留导出）。
- 重新跑一次真实 `AURUM_DEEP_GURU=1` 全量快照，核对 Druckenmiller 全部8期历史与其余8位SEC管理人的8期历史，仅 Druckenmiller 被修正、其余全部不变。
- 脚本：`verify-13f-scale-fix.mjs`（单期对比）、`verify-druckenmiller-history.mjs`（8期历史全量核对），均为一次性 scratchpad 脚本，验证完成后未保留在仓库中。

### 1.2 `scripts/write-live-snapshot.mjs`（+45/-18 行此前累计，另加13.1的新改动；含更早会话的 `mergeFundamentalRow` 逐字段合并修复）

**13.1 新增**：`const enableDeepGuru = process.env.AURUM_DEEP_GURU === "1"`；`fetchLiveData({deepHK:true})` 改为 `fetchLiveData({deepHK:true, deepGuru: enableDeepGuru})`；新增非深度模式下的 `history` 字段合并兜底——若某机构本次抓取结果没有 `history` 但上一份快照 `previousPublicSnapshot.investors` 里有（按 `id` 匹配），原样带过来，避免该字段在月度深度任务之间的每次常规快照里消失。验证：`node --check` 通过；**本轮已真实完整跑通两次 `AURUM_DEEP_GURU=1` 端到端全量快照**（真实发起全部深度请求：9位SEC管理人各最多8期历史+3只东方财富基金各3年历史）——第一次跑出的数据在核对中发现了1.1a的13F单位bug，修复代码后重新跑第二次，产出修正后的正确快照并同步到 `aurumer-pages`/小程序/静态路由（详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.1/13.1a）。仍未验证的只剩"月度cron在真实调度时间点自动触发"这一层调度机制本身（`github.event.schedule` 判断逻辑），需要等到下个月1日UTC或用户手动用 `workflow_dispatch` 之外的方式验证。

### 1.2b `scripts/audit-strategies.mjs`（13.1 新增）

同样加上 `const enableDeepGuru = process.env.AURUM_DEEP_GURU === "1"`，`fetchLiveData` 调用透传 `deepGuru: enableDeepGuru`，与快照脚本保持一致的开关方式。验证：`node --check` 通过。

### 1.2c `.github/workflows/daily-us-snapshot.yml`（13.1 新增）

新增第5条 `schedule.cron: "0 2 1 * *"`（每月1日 UTC 02:00）；"Refresh market data and internal strategy audit" 步骤新增 `env: AURUM_DEEP_GURU: ${{ github.event.schedule == '0 2 1 * *' && '1' || '0' }}`，只有这一条cron触发时该变量为 `1`。验证：`python3 -c "import yaml; yaml.safe_load(...)"` 确认语法有效；未做真实end-to-end验证（需要等到下个月1号自然触发，或用户手动跑一次带该环境变量的本地快照）。

### 1.3 真实数据验证脚本（临时，已删除，不在仓库中留存）

脚本位置：会话临时 scratchpad（非仓库路径），逻辑：
```js
import { fetchManager13F, fetchEastMoneyGuruFund, MANAGERS, A_SHARE_GURU_FUNDS } from ".../lib/live-data.mjs";
const secResult = await fetchManager13F(MANAGERS.find(m => m.id === "buffett"), { deep: true });
const emResult = await fetchEastMoneyGuruFund(A_SHARE_GURU_FUNDS[0], { deep: true });
```
结果：
- SEC 13F（buffett/伯克希尔）：`history.length === 8`，2026Q2→2024Q3，`portfolioValue` 2570亿–2990亿美元区间、`positionCount` 29–42、`topHoldings`（AAPL/AXP/KO/BAC轮换）、`newCount`/`soldCount` 数值合理，最早一期正确为 `null`。
- 东方财富（chinaamc-largecap）：`history.length === 8`，2026Q2→2024Q3，`topHoldings`（宁德时代/立讯精密/惠泰医疗等真实持仓轮换）、`newCount`/`soldCount` 合理，最早一期正确为 `null`。

两次均一次通过，未发现需要修复的 bug。

### 1.4 东方财富 `year=` 参数行为验证（curl，本轮前置调研）

`curl "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=...&year=..."`（配 `Referer`/`User-Agent`）：不传 `year` 只返回最近2期"box"；传 `year=2025` 一次性返回该年全部4期。首次尝试用了错误的域名/端点（`api.fund.eastmoney.com/f10/JJCCMX`，返回 `ErrCode:4`），改用代码里实际的 `SOURCE_URLS.eastmoneyFundArchives` 常量后成功。

## 二、`aurumer-pages` 仓库

### 2.1 `miniprogram/pages/detail/index.wxss`

| 改动 | 内容 |
|---|---|
| `.meter-fill` | 补上灰底到实色的真实填充渐变 + `transition`；圆点加轻微阴影 |
| CSS层叠顺序 | `.bar-value.down`/`.solid-bar.down` 移到 `.tone-1/2/3` 之后并加注释固定顺序依赖；`.solid-bar`/`.bar-value` 加渐变、阴影、入场动画 |

**验证**：`npm run audit` 全量重跑，`check:public`/`check:ui`/`check:mini`/`check:payment` 通过且与改动前结果一致；微信开发者工具 `miniprogram-automator` 连接真实模拟器，NVDA价格/A股600011价格/A股600011分红/黄金追踪四个场景截图确认视觉效果，详见 [PAGE_EVIDENCE.md](PAGE_EVIDENCE.md)。

### 2.2 `miniprogram/pages/detail/index.js`（更早子任务，本轮未改，随验收一并列出）

新增 `dividendHistoryVisual()`，渲染 `raw.financials.dividendHistory` 为分年柱状图（最近10年），插入"分红"标签页最前面；旧的"没有历史分红序列"注释改写为准确反映当前状态。

**验证**：页面用 `Page({...})` 直接注册、内部函数未导出，无法用常规 `require` 单元测试；改用等价非侵入方案——在内存中按原路径加载源文件（保证相对 `require` 正常解析）并追加导出 `detailView`，用 `findItem()` 从真实的 `miniprogram/data/live-snapshot.js` 取 000651/600028/600900 三只真实数据跑 `detailView()`，确认图表正确显示；另验证三种异常输入（无历史/空数组/仅一条记录）安全返回 `null`。

### 2.3 `cloudfunctions/aurum-data/sanitize.js`（本轮未改，复核确认无需改）

`sanitizeInvestor()` 是排除名单模式（只剥离5个命名字段，其余 `...rest` 透传），新增的机构持仓 `history` 字段不需要改这个文件就能正常透传到前端。`assertSourceSnapshot()` 的 `[snapshot.investors, 6, "机构持仓"]` 最小数量校验维持不变，未被本轮改动影响。

### 2.4 静态直达页重新生成（13.2，无代码改动，纯构建产物同步）

`npm run routes`（`scripts/write-route-adapters.mjs`）：读取当前 `data/live-snapshot.json`，重新生成 `stocks/`、`a-shares/`、`us-stocks/`、`gurus/`、`hk-ipo/`、`gold/` 下共98个静态直达页的 `index.html`（canonical/分享说明/跳转hash）。纯本地文件写入，不联网、不碰git。**原因**：本轮测试过程中 `data/live-snapshot.json` 被多次用真实数据验证脚本重写，静态页构建产物落后，导致 `npm run check:pages` 报"NVDA 分享说明未同步"；重跑一次即恢复一致，59个文件受影响（每个约2行差异）。**验证**：重跑后 `npm run audit` 全部5项检查通过。

**13.1a 后二次重跑**：修复13F单位bug并重新生成全量快照（`data/live-snapshot.json`→`aurumer-pages/data/live-snapshot.json`→`scripts/sync-miniprogram-data.mjs`→`npm run routes`）后，同一套流程又跑了一遍，这次输出"已生成 102 个公开短链接入口"（102而非98，因为期间新增了机构条目）。`npm run audit` 全部5项检查再次通过，确认修复后的数据没有破坏既有边界/页面契约检查。

### 2.5 机构持仓多期趋势前端 UI（`miniprogram/pages/section/`，13.3新增）

| 文件 | 改动 |
|---|---|
| `index.js` | 新增 `guruSubTab` 三态（`direction`/`holdings`/`history`）与 `switchGuruSubTab(event)` 切换处理；新增 `guruQuarterLabel(reportDate)`（"2026-06-30"→"26Q2"）、`guruFundSizeText(value)`（原始数字→"$52.1亿"/"$521万"等中文量级文案）、`guruHistoryChart(history)`（返回 `{columns, lowLabel, latestLabel, highLabel}`，`columns` 按 `portfolioValue` 归一化出柱高百分比）、`guruHistoryRows(history)`（返回渲染表格用的逐期行数据，含规模/持仓数"暂缺"兜底与新增/清仓数）；`selectGuruInstitution` 切换机构时同步重算以上四者 |
| `index.wxml` | 新增"持仓走势"标签页：div实现的柱状图（无canvas，`<view>` 按 `columns` 百分比设置高度）+ 摘要文案 + 逐期表格；无 `portfolioValue`/`positionCount` 来源与无 `history` 来源两种空态文案分支 |
| `index.wxss` | 柱状图容器、柱体、摘要行、表格的样式；空态提示样式复用已有空态组件的视觉规范，不新增独立视觉语言 |

**验证**：真实微信开发者工具 + `miniprogram-automator`，`callMethod` 驱动 `switchGuruSubTab`/`selectGuruInstitution`，遍历三类机构（SEC全量历史/东方财富无规模字段/无多期历史）截图核对，详见 [PAGE_EVIDENCE.md](PAGE_EVIDENCE.md) 第三节。验收过程中发现1.1a的13F单位bug（核对Druckenmiller图表金额量级时发现异常），修复并重新截图后归档。

**自动化验证方法论备注**：一台机器上所有微信开发者工具窗口（含不同端口的automator实例）共享同一个Electron主进程；连接旧端口(19422)的automator实例在数据文件已更新到磁盘后，`reLaunch()` 仍显示修复前的旧数据——因为 `reLaunch()` 只重新导航页面，不会强制重新 `require()` 已经加载进JS运行时内存的数据模块。**没有杀掉/重启旧实例**（避免影响同一Electron进程下用户自己可能打开的其它窗口），而是用 `cli auto --project ... --auto-port 19423` 另起一个全新端口的实例，重新连接后拿到修复后的正确数据。旧的19422实例未清理，留给用户自行在开发者工具界面里关闭。

## 三、测试方法论说明

本仓库没有 Jest/Mocha 一类持久化测试框架（`package.json` 无 `test` 目录、无 `test` script），测试策略延续本次会话确立的区分惯例：
- **纯函数、无网络请求**（如 `mergeFundamentalRow`、`buildManagerHistory` 的字段计算逻辑）→ 用合成数据写一次性单元测试脚本，覆盖边界分支。
- **涉及真实HTTP/正则解析的集成风险**（如本轮的SEC/东方财富深度历史抓取）→ 用真实请求跑一次性验证脚本，因为风险点就在于"真实响应结构是否如预期"，合成数据无法暴露这类问题。
- 一次性测试脚本用完即删，不在仓库里留痕；如需复现，本文档已记录足够的函数签名和调用方式。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
