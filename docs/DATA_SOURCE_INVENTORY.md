# 数据源接入清单

日期：2026-09-14
所有 URL/常量均取自 `wangchao/lib/live-data.mjs` 的 `SOURCE_URLS` 常量与对应抓取函数，如实列出，未做任何美化或省略已知限制。

## 一、A股

| 来源 | 端点 | 用途 | 已知限制 |
|---|---|---|---|
| 东方财富 K线 | `push2his.eastmoney.com/api/qt/stock/kline/get` | 60点历史行情 | 无 |
| 东方财富 报价 | `push2.eastmoney.com/api/qt/ulist.np/get` | 实时行情 | 无 |
| 东方财富 数据中心 | `datacenter-web.eastmoney.com/api/data/v1/get`（`RPT_SHAREBONUS_DET` 报表） | 分红历史（每10股，含税，按年） | 依赖东方财富数据中心报表结构，若其调整字段名会导致解析失败 |
| 腾讯财经 | `qt.gtimg.cn/q=`、`web.ifzq.gtimg.cn/appstock/app/fqkline/get` | 备用行情/历史源 | 备用，非主源 |

覆盖股票池：见 [DATA_COVERAGE_REPORT.md](DATA_COVERAGE_REPORT.md) 第一节，20 只固定代码（`A_SHARE_MARKET_CODES`），另有 ETF `515180.SH` 单独抓取。

## 二、美股

| 来源 | 端点 | 用途 | 已知限制 |
|---|---|---|---|
| Yahoo Finance | `query1.finance.yahoo.com/v8/finance/chart/` | 主行情源，60点历史 | `BRK.B` 需映射为 `BRK-B`（`YAHOO_SYMBOLS`） |
| Nasdaq API | `api.nasdaq.com/api/` | 备用/补充数据 | `BRK.B` 需映射为 `BRK.A`（`NASDAQ_SYMBOLS`） |
| FRED（圣路易斯联储） | `fred.stlouisfed.org/graph/fredgraph.csv?id=` | 宏观利率等背景数据 | 非个股数据 |

覆盖股票池：30 只固定代码（`US_SYMBOLS`），见覆盖报告第二节。

## 三、黄金

| 来源 | 端点 | 用途 | 已知限制 |
|---|---|---|---|
| 上海黄金交易所（SGE） | `www.sge.com.cn/sjzx/quotation_daily_new` | 人民币金价 | 无 |
| CFTC | `www.cftc.gov/dea/newcot/f_disagg.txt` | 持仓报告（COT），用于国际金观察分背景数据 | 每周更新，非日频 |
| （国际金价来源） | 见 `lib/live-data.mjs` 黄金抓取函数 | 国际金价 | 未在本轮改动范围内，未重新核实 |

## 四、港股打新

| 来源 | 端点 | 用途 | 已知限制 |
|---|---|---|---|
| 港交所（HKEX）新股信息 | `www2.hkexnews.hk/new-listings/new-listing-information/main-board` | 新股列表、招股价、中签率等 | 简体/繁体字段需转换（`TRADITIONAL_TO_SIMPLIFIED`） |
| 港交所交易日历 | `www.hkex.com.hk/Services/Trading/Securities/Trading-News/Newly-Listed-Securities` | 上市日期校准 | 无 |
| 东方财富（港股K线，主源） | `secid: 116.${stockCode}` 走 `eastmoneyHistory` 端点 | 上市后最多30个自然日K线，实际只用前5个交易日（`rows.slice(0, 5)`） | 第6天起数据抓取后即弃用，从未落盘（详见 RELIABILITY_FIX_PROGRESS.md 9.3，已确认为设计意图而非缺口） |
| 腾讯财经（港股K线，备源） | `hk${stockCode}` 走 `tencentHistory`/`tencentQuote` | 同上，东方财富失败时的备用源 | 同上 |
| xiatou.ai | `https://xiatou.ai/ipos` | 打新历史参考/回测校准用 | 第三方站点，未做 SLA 假设 |

## 五、机构持仓（本轮重点延展对象）

| 来源 | 端点 | 覆盖对象 | 历史深度 | 本轮变化 |
|---|---|---|---|---|
| SEC EDGAR | `data.sec.gov/submissions/CIK{cik}.json` + 13F filing 的 `index.json`/xml | 9位美股基金经理（见下表） | 改动前：最新2期；改动后：`deep:true` 时最多8期 | `findRecent13FFilings(submission, limit)` 新增 `limit` 参数；新增 `buildManagerHistory()` |
| 东方财富基金档案 | `fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=...&year=...` | 3只A股明星基金（见下表） | 改动前：不传 `year` 时只返回最近2期；改动后：`deep:true` 时循环请求近3年 `year=` 参数，最多8期 | 新增 `fetchEastMoneyGuruFundQuarters(fund, year)`、`buildEastMoneyGuruHistory()` |
| Trustnet | `www2.trustnet.com/Factsheets/FundFactsheetPDF.aspx` | 2只港股上市中国主题基金（摩根中国增长与收益、富达中国特殊情况基金） | 仅最新1期，`previousReportDate` 硬编码 `null` | 未改动——单页PDF快照，无可访问历史归档 |
| Value Partners | `www.valuepartners-group.com/ftp/files/reports/vpaf/001_fact_sheet/eng/` | 1只香港私募基金（惠理价值基金经典系列） | 仅最新1期 | 未改动，原因同上 |

**SEC 13F 覆盖的9位基金经理**：buffett(Berkshire Hathaway, CIK 0001067983)、ackman(Pershing Square)、burry(Scion Asset Management)、wood(ARK Investment Management)、lilu(Himalaya Capital Management)、druckenmiller(Duquesne Family Office)、dalio(Bridgewater Associates)、munger(Daily Journal Corporation)、leopold(Situational Awareness LP)。

**东方财富覆盖的3只A股明星基金**：chinaamc-largecap(华夏大盘精选混合 000011)、fullgoal-tianhui(富国天惠成长混合(LOF) 161005)、xq-herun(兴全合润混合 163406)。

**`deepGuru` 开关现状**：`fetchLiveData({ deepGuru: true })` 才会产出 8 季度 `history` 字段。已接入 `wangchao/.github/workflows/daily-us-snapshot.yml` 的月度低频 cron（每月1日，其余每周9次常规快照不受影响，行为与改动前完全一致），并加了"非深度模式下沿用上一份快照 history"的合并逻辑，避免该字段按天有按天没有。详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 十三节 13.1。

**已知数据源限制（结构性，非代码缺陷）**：
- **东方财富基金档案不披露 `portfolioValue`/`positionCount`**：`FundArchivesDatas.aspx` 的"jjcc"报表只给持仓明细（代码/名称/占比/股数/市值），不给基金总规模与总持仓数这两个字段本身，所以 `buildEastMoneyGuruHistory()` 产出的每期 `history` 结构性地没有这两个字段（不是抓取失败，是这个源根本不提供）。前端"持仓走势"图表对此展示差异化空态文案（"该来源未披露基金规模与持仓数，暂不能画规模趋势图"），不用新增/清仓数硬凑一张假的规模图，详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.3。
- **SEC 13F 申报存在 legacy 千美元计价单位的历史遗留问题**：SEC 2023年规则修订要求 `<value>` 以整美元报告，但仍有个别申报人/代理机构的软件沿用修订前"千美元"的旧惯例（本轮发现 Duquesne Family Office 即如此），且申报人自己的封面 `tableValueTotal` 用的是同一套（可能错误的）单位，无法靠"跟封面对账"发现。已在 `parse13FInformationTable()` 加入按申报（filing）粒度的"隐含每股价格中位数"自检予以自动识别并修正，详见 [RELIABILITY_FIX_PROGRESS.md](RELIABILITY_FIX_PROGRESS.md) 13.1a、[CODE_AND_TEST_NOTES.md](CODE_AND_TEST_NOTES.md) 1.1a。这是抓取这9位管理人数据时需要长期留意的一个数据源怪癖，未来新增管理人时同样可能遇到。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
