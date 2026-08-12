/**
 * 大师策略摘要：只做公开可学方法提炼，不做荐股、不伪造持仓。
 * 无持续公开仓位的人物，一律标注「策略学习 / 不可照抄仓位」。
 */

const MASTER_PLAYBOOKS = [
  {
    id: "li-ka-shing",
    name: "李嘉诚",
    org: "长江实业系公开决策",
    tag: "周期与现金流",
    learnable: true,
    copyHoldings: false,
    principle: "先看现金回流和资产负债，再谈扩张故事。",
    sensitivity: "利率上行、地产去杠杆、港口与基建周期会迅速改变资产定价。",
    valueLens: "市场价值不等于叙事热度；看自由现金流覆盖债务的能力。",
    doNot: "不要把历史地产暴利时段当成当下可复制模板。",
    sourceNote: "公开年报、业绩会与重大交易公告",
  },
  {
    id: "soho-pan",
    name: "潘石屹",
    org: "SOHO 中国公开路径（历史样本）",
    tag: "资产变现纪律",
    learnable: true,
    copyHoldings: false,
    principle: "在周期高点优先兑现流动性，而不是死守账面资产。",
    sensitivity: "一线写字楼供需、监管政策与资本开支节奏。",
    valueLens: "把“卖得出去的价格”当作真实价值锚，而不是概念估值。",
    doNot: "个案退出路径不可直接映射到当下个股买卖。",
    sourceNote: "公司公告与公开访谈（历史样本）",
  },
  {
    id: "neil-shen",
    name: "沈南鹏",
    org: "红杉中国公开投资方法论",
    tag: "早期结构判断",
    learnable: true,
    copyHoldings: false,
    principle: "先判断赛道结构与网络效应，再看单点公司故事。",
    sensitivity: "监管边界、获客成本拐点、同类玩家密度。",
    valueLens: "未上市企业价值看增长质量与退出通道，不是短期热搜。",
    doNot: "私募早期仓位不可公开复制，也不构成二级市场买卖指令。",
    sourceNote: "公开演讲、基金披露与被投公司公开资料",
  },
  {
    id: "bridgewater",
    name: "桥水基金",
    org: "Ray Dalio / Bridgewater",
    tag: "原则与风险平价",
    learnable: true,
    copyHoldings: false,
    principle: "先写清经济机器假设，再用分散表达不确定。",
    sensitivity: "增长、通胀、流动性三轴同时变化时最危险。",
    valueLens: "单个资产的“好故事”要放到组合风险贡献里衡量。",
    doNot: "机构风控与杠杆结构无法个人一比一复制。",
    sourceNote: "Principles、公开信与宏观研究报告",
  },
  {
    id: "renaissance",
    name: "文艺复兴",
    org: "Renaissance Technologies",
    tag: "统计优势边界",
    learnable: true,
    copyHoldings: false,
    principle: "可重复的微小优势，靠纪律与容量管理积累。",
    sensitivity: "拥挤交易、数据衰减、制度切换会抹平统计优势。",
    valueLens: "没有可验证边缘时，复杂模型只是噪音。",
    doNot: "策略黑箱，公开市场无法模仿其真实仓位与执行。",
    sourceNote: "公开报道与学术/访谈边界说明（非持仓披露）",
  },
  {
    id: "soros",
    name: "索罗斯",
    org: "Quantum / 公开宏观实践",
    tag: "反身性与催化",
    learnable: true,
    copyHoldings: false,
    principle: "价格会改变基本面预期，再反过来强化价格。",
    sensitivity: "政策突变、汇率与信用条件是关键催化。",
    valueLens: "先找错误定价与催化剂，再决定敞口大小。",
    doNot: "宏观杠杆路径不适合照抄；先学识别反馈循环。",
    sourceNote: "公开著作与历史案例复盘",
  },
  {
    id: "justin-sun-case",
    name: "孙宇晨案例",
    org: "叙事驱动定价样本（高风险）",
    tag: "市场敏感度案例",
    learnable: true,
    copyHoldings: false,
    principle: "叙事、流量与流动性可以短期支撑估值，但终需兑现。",
    sensitivity: "监管、兑换通道、意见领袖声量与链上真实使用。",
    valueLens: "未知/新锐标的要拆：叙事强度、可变现需求、对手盘深度。",
    doNot: "这是高波动案例教学，不是买入建议；加密与初创风险极高。",
    sourceNote: "公开市场观察与媒体报道（非证券投资咨询）",
  },
];

function playbookTickerLines() {
  return MASTER_PLAYBOOKS.map((item) => ({
    id: `playbook-${item.id}`,
    kind: "playbook",
    title: item.name,
    text: `${item.principle}｜可学：${item.tag}｜不可照抄仓位`,
    market: "guru",
    targetId: item.id,
  }));
}

function findPlaybook(id) {
  const needle = String(id || "").replace(/^playbook-/, "");
  return MASTER_PLAYBOOKS.find((item) => item.id === needle) || null;
}

module.exports = {
  MASTER_PLAYBOOKS,
  playbookTickerLines,
  findPlaybook,
};
