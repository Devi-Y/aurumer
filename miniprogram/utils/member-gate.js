/**
 * 会员付费点：在需求时刻展示具体结果，而不是空泛「解锁专业功能」。
 */
function memberGate(feature) {
  const catalog = {
    track: {
      title: "追踪此标的变化",
      body: "开通后保存当前事实作基线，并对照相对上次哪里变了。",
    },
    remind: {
      title: "提醒我关注事件",
      body: "开通后，招股截止、上市、披露等日期会进入今日简报。",
    },
    compare: {
      title: "与上次相比发生了什么",
      body: "开通后查看结论、价格/费用、风险相对基线是否有变。",
    },
    evidence: {
      title: "自动保存当时证据",
      body: "开通后保存判断时自动附带价格、结论、来源与时间。",
    },
    calendar: {
      title: "加入投资事件日历",
      body: "开通后汇总招股截止与上市节点，并可记申购对照。",
    },
    review: {
      title: "打开持续复盘",
      body: "开通后对照新建、长期判断与失效/到期复核。",
    },
    history: {
      title: "查看更长历史变化",
      body: "开通后保留基线与证据，可跨设备同步。",
    },
    groups: {
      title: "自定义关注分组",
      body: "开通后可为关注选择打新/收息/长期/观察等分组。",
    },
    export: {
      title: "导出与数据保全",
      body: "开通后云端同步；到期仍可只读查看、导出与删除。",
    },
  };
  return catalog[feature] || {
    title: "个人投资逻辑哨兵",
    body: "写下为什么与失效条件；事实一变就提醒你重看。",
  };
}

module.exports = { memberGate };
