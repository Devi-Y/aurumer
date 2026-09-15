# 页面证据

日期：2026-09-14
本文档汇总目前**实际存档在磁盘上**的截图证据，以及本轮会话中做过但未存档为文件的视觉走查，两者分开列出，不混淆。

## 一、已存档截图（29张，`docs/screenshots/`，2026-09-13 归档）

出自 [DETAIL_PAGE_REDESIGN_ACCEPTANCE.md](DETAIL_PAGE_REDESIGN_ACCEPTANCE.md)，验收环境：本地微信开发者工具，`miniprogram-automator` 自动化连接，模拟器机型 iPhone 12/13 (Pro)，`screenWidth: 390`。

| 场景 | 文件 | 内容 |
|---|---|---|
| 美股 NVIDIA (NVDA) | `us-nvda-top.png`/`tab1`~`tab4` | 概览（结论+现价+价格位置+依据+数据时间）、价格图、动态（成交量/公开备案/营收趋势）、依据（研究分+池内分位） |
| A股 华能国际 (600011.SH) | `a-huaneng-top.png`/`tab1`~`tab4` | 概览（结论+股息+买卖区间条）、价格、分红（股息率对比图）、依据（收息观察分+池内分位） |
| 港股新股 永康控股 (02523.HK，发行已取消边界场景) | `hk-listing-top.png`/`tab1`~`tab4` | 概览（"不再申购"+字段如实显示"—"）、申购（如实显示"没有足够数据"）、卖出（历史样本对照）、依据（研究分0/100） |
| 黄金回归 | `gold-regression-top.png`/`tab1`~`tab6` | 原六标签结构（结论/金价/驱动/资料/研究/风险）确认零回归 |
| 聪明钱回归 | `guru-regression-top.png`/`tab1`~`tab6` | 原六标签结构（结论/持仓/业绩/资料/…）确认零回归 |

结论（原文）：三个新市场的四标签结构、黄金/聪明钱的六标签结构，在模拟器中均渲染正确，未发现布局错乱、数据缺失伪装成正常值、或标签丢失等问题。

## 二、本轮（2026-09-14）视觉走查——**未存档为文件，仅会话内截图查看**

出自 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 9.1，验证 `.wxss` 视觉优化（仪表盘填充渐变、跌色层叠顺序修复）：

| 场景 | 内容 |
|---|---|
| 英伟达 NVDA 价格 tab | 近60日折线图 + 涨跌区间仪表盘（70%填充，圆点位置准确） |
| A股 600011 价格 tab | `bandMeterVisual` 参考买卖区间圆点定位准确；`solidVisual` 现价/昨收对照柱新渐变样式正常 |
| A股 600011 分红 tab | `dividendHistoryVisual` 十年柱状图渐变色按tone正确轮换 |
| 黄金追踪 tab | `meterVisual`/`scoreMeter` 国际金/人民币金观察分仪表盘（68/100、60/100）填充准确对应分值 |

**如实说明**：这一组截图是在本轮会话过程中通过 `miniprogram-automator` 截图并直接查看确认的，**没有另存为文件到 `docs/screenshots/`**——如需要可复查的文件证据，需要重新连接开发者工具补拍一组并归档，本轮未做（判断优先级低于产出六份交付文档本身）。

## 三、机构持仓多期趋势图（2026-09-15 新增，已存档）

出自 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.3，验证"聪明钱"模块新增的第三个子标签"持仓走势"：验收环境同上（本地微信开发者工具 + `miniprogram-automator`），机型 iPhone 12/13 (Pro)。

| 场景 | 文件 | 内容 |
|---|---|---|
| Druckenmiller（Duquesne，SEC 13F 全量历史） | `guru-history-druckenmiller.png` | 8期柱状图（24Q3→26Q2）+ "最低 $29.5亿 / 最新 $52.1亿 / 最高 $52.1亿"摘要 + 逐期表格（规模/新增/清仓），数值为 13F 千美元单位 bug 修复后的正确值（见13.1a） |
| chinaamc-largecap（东方财富，无 portfolioValue/positionCount） | `guru-history-chinaamc-empty.png` | 差异化空态："该来源未披露基金规模与持仓数，暂不能画规模趋势图；下方各期新增/清仓变化仍可参考"，表格规模列如实显示"暂缺"、新增/清仓列为真实数字 |
| value-partners-classic（无多期历史） | `guru-history-no-history.png` | "该机构暂未接入多期历史，仅有最新一期公开披露" + "趋势图怎么来的"说明折叠区 + 标准页脚 |

三张截图均在本轮修复 13F 单位 bug、重新生成全量快照后重新截取，反映修复后的正确数据（修复前的旧截图未保留）。

## 四、宽度覆盖说明

所有截图（含上述三组）均为 390px 单一宽度。375px/430px 双宽度不是分别实测得到，而是用 CSS 断点分析论证等价（`rpx` 相对单位布局 + 仅两处不落在 375–430 区间的像素级媒体查询），详见 [DETAIL_PAGE_REDESIGN_ACCEPTANCE.md](DETAIL_PAGE_REDESIGN_ACCEPTANCE.md) 第四节。如需要更严格的双宽度证据，建议改用支持视口切换的 H5/Playwright 预览通道（`miniprogram-automator` SDK 确认无此能力）。

## 五、未覆盖的页面/场景

- 首页：本轮及此前所有会话均未改动首页，因此未产生新的截图证据（沿用此前既有验收记录）。
- 真机测试：全程未做，仅模拟器。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
