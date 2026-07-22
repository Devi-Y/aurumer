const SMART_MONEY_PROFILES = [
  {
    id: "value-partners-classic", group: "hk", order: 1, name: "价值伙伴经典基金", org: "Value Partners Hong Kong", marketLabel: "港股",
    performanceValue: "13.2% 年化", performanceDetail: "1993–2026-05 · 累计 +5,958.4%", performanceBasis: "Class A USD NAV，股息再投资、扣费后；不同份额不可直接横比。",
    why: "三十多年公开净值跨越多轮港股周期，长期年化与持仓透明度同时满足筛选门槛。",
    how: "先找价格显著低于内在价值的公司，再等待估值修复；不要只因便宜忽略基本面恶化。",
    report: "2026-05-29 月报", sourceName: "Value Partners 月报",
    holdings: [["0700.HK", "腾讯控股", 6.3, "月报持有", "平台现金流与回购提供价值支撑"], ["2899.HK", "紫金矿业", 5.1, "月报持有", "铜金资源与全球产能扩张兼具周期弹性"], ["9988.HK", "阿里巴巴-W", 4.4, "月报持有", "核心电商现金流与云业务重估并存"]],
  },
  {
    id: "fidelity-china-special", group: "hk", order: 2, name: "富达中国特殊情况基金", org: "Fidelity · Dale Nicholls", marketLabel: "港股",
    performanceValue: "8.0% 年化", performanceDetail: "2010–2026-06 · 累计 +250.0%", performanceBasis: "英镑 NAV、收入再投资、扣费后；基金可使用杠杆。",
    why: "公开组合同时覆盖港股龙头与被低估的中小公司，长期 NAV 明显跑赢同区间指数。",
    how: "找现金流好、管理层强但市场尚未充分理解的公司；复制前先剔除杠杆与非上市资产影响。",
    report: "2026-06-30 月报", sourceName: "Fidelity 月报",
    holdings: [["0700.HK", "腾讯控股", 12.3, "月报持有", "成熟平台现金流支撑 AI 投入"], ["9988.HK", "阿里巴巴-W", 6.6, "月报持有", "观察云业务与即时零售投入回报"], ["2318.HK", "中国平安", 2.8, "月报持有", "保险负债端改善与资产端修复共振"]],
  },
  {
    id: "jpm-china-growth", group: "hk", order: 3, name: "摩根中国增长与收益", org: "J.P. Morgan · Rebecca Jiang 团队", marketLabel: "港股",
    performanceValue: "约 7.6% 年化", performanceDetail: "近十年累计 +107.9%（按公开累计值折算）", performanceBasis: "英镑总回报、股息再投资；基金可使用衍生品和杠杆。",
    why: "长期机构记录和持续公司调研，使持仓逻辑、风险控制与收益都能复核。",
    how: "用盈利质量和持续增长先筛公司，再用估值与组合风险决定权重；高权重不等于短期买入信号。",
    report: "2026-03-31 半年报", sourceName: "J.P. Morgan 半年报",
    holdings: [["0700.HK", "腾讯控股", 16.9, "半年报持有", "高现金流平台与新业务成长兼具"], ["9988.HK", "阿里巴巴-W", 9.9, "半年报持有", "核心电商修复与云业务成长"], ["9999.HK", "网易-S", 3.4, "半年报持有", "内容研发与股东回报相对清晰"]],
  },
  {
    id: "druckenmiller", group: "us", order: 1, name: "斯坦利·德鲁肯米勒", org: "杜肯家族办公室", marketLabel: "美股",
    performanceValue: "约 30% 年化", performanceDetail: "Duquesne Capital · 1981–2010 · 无亏损年度", performanceBasis: "历史基金回报；当前家族办公室完整回报不公开。",
    why: "三十年跨越利率、科技与危机周期，收益和回撤控制同时突出。", how: "先判断宏观主线，再用少数高确信个股表达；趋势失效时快速降仓。", sourceName: "Morgan Stanley 访谈",
  },
  {
    id: "burry", group: "us", order: 2, name: "迈克尔·伯里", org: "Scion（私人办公室）", marketLabel: "美股",
    performanceValue: "约 26.0% 年化", performanceDetail: "2000–2008 · 累计净回报 +489.34%", performanceBasis: "历史累计净回报折算；当前不再持续公开完整仓位。",
    why: "在市场共识最强时寻找定价错误，历史回报体现了逆向研究价值。", how: "把持仓当风险雷达，先读证据链和下行空间；不要照抄做空时点。", sourceName: "Michael Lewis 公开回顾",
  },
  {
    id: "buffett", group: "us", order: 3, name: "沃伦·巴菲特", org: "伯克希尔·哈撒韦", marketLabel: "美股",
    performanceValue: "19.7% 年化", performanceDetail: "1965–2025 · 标普同期 10.5%", performanceBasis: "伯克希尔每股市值复合回报，不等同于公开股票组合单独收益。",
    why: "六十年复利和资本配置记录最完整。", how: "学能力圈、护城河、管理层和买入价格；重点看新建仓，不按季度比例复制。", sourceName: "伯克希尔 2025 年报",
  },
  {
    id: "ackman", group: "us", order: 4, name: "比尔·阿克曼", org: "潘兴广场", marketLabel: "美股",
    performanceValue: "16.2% 年化", performanceDetail: "2004–2025 · 累计 NAV +2,644%", performanceBasis: "管理人披露的核心策略 NAV 回报。",
    why: "组合高度集中且投资论文公开，收益来源和判断错误都容易复盘。", how: "学少而深的研究方法，写清催化、估值与退出条件；不复制其集中度。", sourceName: "Pershing Square 2025 年报",
  },
  {
    id: "wood", group: "us", order: 5, name: "凯茜·伍德", org: "ARK Invest", marketLabel: "美股",
    performanceValue: "12.18% 年化", performanceDetail: "ARKK 2014–2026Q1 · 近五年年化 -10.63%", performanceBasis: "ARKK 官方 NAV；长期年化必须和近五年负回报一起看。",
    why: "每日披露且聚焦颠覆式创新，适合观察高成长主题方向与拥挤度。", how: "只把名单当高风险研究池；用小仓、分散和估值纪律约束波动。", sourceName: "ARKK 2026Q1 报告",
  },
  {
    id: "chinaamc-largecap", group: "a", order: 1, name: "华夏大盘精选", org: "华夏基金 · 屠环宇", marketLabel: "A股",
    performanceValue: "约 18.7% 年化", performanceDetail: "2004–2026Q1 · 累计 +3,984.2%", performanceBasis: "基金历史净值；现任经理自 2024-03-26 起任职，历史收益不能全归因于现任。",
    why: "基金长期累计回报位于公开老牌产品前列，最新季报能看到策略换挡。", how: "把历史业绩与现任经理分开看，只学习当前 AI、半导体与制造组合结构。", report: "2026Q1 季报", sourceName: "华夏基金一季报",
    holdings: [["300750", "宁德时代", 8.06, "季度持有", "动力电池龙头的规模与研发优势"], ["300408", "三环集团", 3.76, "季度持有", "电子陶瓷材料受益国产化"], ["688041", "海光信息", 3.69, "季度持有", "国产算力核心资产，估值是主要风险"]],
  },
  {
    id: "fullgoal-tianhui", group: "a", order: 2, name: "富国天惠", org: "富国基金 · 朱少醒", marketLabel: "A股",
    performanceValue: "约 15.2% 年化", performanceDetail: "2005–2026Q1 · 累计 +1,675.3%", performanceBasis: "A/B 份额公开净值；朱少醒自成立起连续管理。",
    why: "同一经理连续管理二十年，减少把基金历史误归因给后来经理的问题。", how: "自下而上看企业基因、治理和管理层；淡化择时不等于忽视估值与回撤。", report: "2026Q1 季报", sourceName: "富国基金一季报",
    holdings: [["002142", "宁波银行", 7.71, "季度持有", "零售与中小企业金融能力突出"], ["002353", "杰瑞股份", 6.67, "季度持有", "油服设备受益资本开支周期与海外拓展"], ["300750", "宁德时代", 6.51, "季度持有", "制造效率与技术平台构成长期优势"]],
  },
  {
    id: "xq-herun", group: "a", order: 3, name: "兴全合润", org: "兴证全球 · 谢治宇", marketLabel: "A股",
    performanceValue: "约 13.9% 年化", performanceDetail: "2010–2026Q1 · 累计 +694.17%", performanceBasis: "A 份额公开净值；经理自 2013-01-29 任职，成立初期收益不属于其任期。",
    why: "长周期累计回报显著高于基准，最新组合把科技景气与化工供需反转结合。", how: "跟踪企业竞争力与产业供需；高波动赛道分批建仓并设组合上限。", report: "2026Q1 季报", sourceName: "兴全合润一季报",
    holdings: [["600160", "巨化股份", 9.68, "季度持有", "制冷剂供给约束带来盈利弹性"], ["688099", "晶晨股份", 7.09, "季度持有", "智能终端芯片平台受益产品升级"], ["300308", "中际旭创", 6.24, "季度持有", "AI 光模块需求强但景气波动大"]],
  },
];

module.exports = { SMART_MONEY_PROFILES };
