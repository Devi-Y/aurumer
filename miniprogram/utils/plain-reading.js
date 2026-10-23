"use strict";

// Display words only: prices, eligibility and ranking stay with their sources.
function plainLabel(value) {
  const labels = { "等回撤": "等价格回落", "可分批观察": "可以关注", "风险升高": "风险较高",
    "长期观察": "继续关注", "谨慎打": "先观察", "待核验": "资料待核实" };
  return labels[value] || value;
}

function simpleHighlights(rows = []) {
  return rows.filter((row) => !/评分|观察分|研究分|市盈率|年化/.test(row.label || "")).slice(0, 2);
}

function plainOverview(view) {
  return { ...view, grade: plainLabel(view.grade) };
}

module.exports = { plainLabel, simpleHighlights, plainOverview };
