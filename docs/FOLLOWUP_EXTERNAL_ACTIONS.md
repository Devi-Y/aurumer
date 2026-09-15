# 后续外部操作清单

日期：2026-09-14（2026-09-15 更新：原"一、需要用户判断"三项已由用户授权评估并逐条执行；用户进一步明确指示"1.真实完整跑过一次手动验证 2.做机构持仓走势图 3.完成后可以提交推送部署"，三项均已执行，见下方更新记录）
本轮工作范围明确排除微信体验版上传 / 提审 / 真实收费；git commit / push / 云函数重新部署已按用户明确授权（"完成后可以提交推送部署"）在本轮内执行，见第二节。

## 一、原三项待决策事项——已评估执行，结果如下（详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 十三节）

1. **机构持仓8季度深度历史的刷新节奏——已选定方案(b)并接入，已真实完整验证**：`wangchao/.github/workflows/daily-us-snapshot.yml` 新增每月1日的低频 cron，只有这一条触发会打开 `AURUM_DEEP_GURU=1`，让 `write-live-snapshot.mjs` 用 `deepGuru: true` 抓一次完整8季度历史；其余9次/周的常规快照不受影响。同时补上了评估时发现的一个真实风险：非深度模式的抓取结果不带 `history` 字段，如果不处理，`history` 会在月度深度任务跑完当天出现、第二天就被常规快照覆盖消失——已加上"沿用上一份快照 history"的合并逻辑，让这个字段能持续可用。**验证已完成**：按你的要求本地真实完整跑了两次 `AURUM_DEEP_GURU=1 node scripts/write-live-snapshot.mjs`（真实发起全部深度请求），第一次跑出的数据核对时发现了一个真实的13F单位换算bug（见下方第3项），修复代码后重新跑第二次得到修正后的正确数据并已同步上线前的全部环节。唯一还没有真实验证的只剩"月度cron在下个月1日UTC自动触发"这个调度时机本身，这个只能等到自然到期或你手动改cron表达式测试。

2. **`npm run audit` 三项检查失败——重新核实后发现不需要改断言**：`check:public`/`check:ui`/`check:mini` 现在单独跑和整体跑 `npm run audit` 都通过，此前"需要改审计脚本口径"的判断已经过时（很可能是之前的产品代码改动已经让断言自然满足，只是没人回来复核）。重新跑发现了一个真实但完全不同的问题：`check:pages` 报"NVDA 分享说明未同步"，原因是本轮测试反复写过 `data/live-snapshot.json`，但生成静态分享页的 `npm run routes` 没跟着重新跑。已经跑过 `npm run routes`（纯本地重新生成98个静态页，不联网不碰git），现在 `npm run audit` 五项检查全部通过。**如果界面上还留着一个关于"审计断言需要产品判断"的任务提醒，那条已经过时，可以直接关掉/忽略。**

3. **机构持仓多期趋势前端UI——用户已明确要求，已实现并验收**：原"评估后决定本轮不做"的结论已作废（存档见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.3）。"聪明钱"模块新增第三个子标签"持仓走势"，消费后端 `history` 字段画多期柱状图+逐期表格，对无 `portfolioValue`/无多期历史的来源展示差异化空态文案，不伪造数据。验收过程中发现并修复了一个此前完全未知的真实bug：Druckenmiller（Duquesne Family Office）的13F申报用了SEC 2023规则修订前的legacy千美元单位，导致规模被少算1000倍（$521万 vs 真实$52.1亿）——这个bug在此次趋势图上线之前从未在任何已上线页面暴露过（原有"重仓前5"只展示百分比权重，不受单位错误影响），已在 `wangchao/lib/live-data.mjs` 修复并用真实SEC数据交叉验证，详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.1a、[CODE_AND_TEST_NOTES.md](CODE_AND_TEST_NOTES.md) 1.1a。

## 二、本轮已按你的授权执行完毕的操作

4. 审阅六份交付文档与 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 全文（含新增的十三节/13.1a），确认结论符合预期——这一步仍建议你抽空复核一遍，尤其是13.1a这个新发现的bug的root cause和修复逻辑。
5. `git add`/`git commit` 两个仓库（`wangchao`：`lib/live-data.mjs` 的13F单位修复 + 此前累计的其它改动；`aurumer-pages`：机构持仓趋势图前端代码 + 修复后重新生成的快照/小程序数据/102个静态直达页），已按你的指示执行提交。
6. 云函数重新部署：线上小程序读取的是云函数 `aurum-data` 打包的快照，不是本地代码——已重新部署，让机构持仓 `history` 字段（含修复后的正确数值）在线上生效。
7. `git push` 两个仓库，同步到远程。

## 三、仍需要你亲自执行的操作（本轮工具权限范围外或明确排除范围内）

8. 如需要更严格的375px/430px双宽度截图证据：改用支持视口切换的H5/Playwright预览通道重新走查（详见 [PAGE_EVIDENCE.md](PAGE_EVIDENCE.md) 第四节）。
9. 真机测试：本轮全程只在开发者工具模拟器内验证，未在真实手机上打开小程序体验版。
10. 上传体验版 → 提审 → 正式发布：这一整条链路本轮明确排除（不含真实收费变更），需要你后续自行触发（每一步都建议单独确认）。

## 四、不需要你做，但建议留意的已知限制（无需行动，纯提醒）

- Trustnet/Value Partners两个港股机构持仓源的历史深度无法通过抓取延展（单页PDF快照，无可访问归档），这是数据源本身的天花板。
- 分红收益率历史趋势、美股七巨头额外数据深度、港股新股"全生命周期"持续行情——三项均已确认不是真实缺口，不会在后续会话里被重新提出，除非需求本身发生变化。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
