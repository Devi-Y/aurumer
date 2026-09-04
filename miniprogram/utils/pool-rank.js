// 池内分位：把一个指标放回它自己的池子里，说出它排第几。
//
// 起因是详情页「财务」tab 铺着一排光秃秃的数字——毛利率 43%、股东回报 15.9%。
// 没做过研究的人看到 43% 不知道这算高还是低，于是这一屏等于什么也没说。
// 望潮自己就有 30 只美股、20 只 A 股的同口径字段，把 43% 换成「池内第 6/30」，
// 零新增数据源，只是把已有的数换一种摆法。
//
// 三条纪律：
// 1. 口径必须写在脸上。是「望潮观察池内」，不是「全市场」——池子只有几十只，
//    说成全市场就是编。所以 stats 里永远带一行池子有多大。
// 2. 不做方向性判断。这里只陈述一个谁都能自己复算的事实（比它高的有几只），
//    不说「便宜」「值得买」。市盈率高＝贵，不＝好，读法写在标签里。
// 3. 样本不够就不出。池子里少于 3 个有效值时返回 null，不靠一两个数硬凑分位。

function isNum(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

/**
 * 算一个值在池子里的名次与分位。
 * @param {number} value 这一只的取值
 * @param {Array<number>} pool 池子里的全部取值（含它自己，缺值会被剔掉）
 * @returns {{rank:number,count:number,percentile:number}|null}
 */
function poolRank(value, pool) {
  if (!isNum(value)) return null;
  const values = (pool || []).filter(isNum).map(Number);
  // 池子太小时「排第几」没有意义，宁可这一格不出现。
  if (values.length < 3) return null;
  const self = Number(value);
  const higher = values.filter((entry) => entry > self).length;
  const lower = values.filter((entry) => entry < self).length;
  // 分位＝池子里比它低的占比。最高的那只是 100，最低的是 0。
  const percentile = Math.max(0, Math.min(100, Math.round((lower / (values.length - 1)) * 100)));
  return { rank: higher + 1, count: values.length, percentile };
}

/**
 * 把若干条「值 + 池子」拼成详情页认识的 bars 图表。
 * 柱长直接就是分位（0–100），不再按最大值归一——这条轨道本身就是 0 到 100，
 * 归一会让「池内第 3」和「池内第 1」的柱子一样长。
 *
 * @param {Array<{label:string,value:number,valueText:string,pool:Array<number>,note?:string}>} rows
 * @param {string} title
 * @param {{poolLabel?:string, reading?:string}} options
 */
function poolRankVisual(rows, title, options = {}) {
  const usable = (rows || [])
    .map((row) => {
      if (!row) return null;
      const rank = poolRank(row.value, row.pool);
      return rank ? { row, rank } : null;
    })
    .filter(Boolean);
  if (!usable.length) return null;
  const poolSize = Math.max(...usable.map((entry) => entry.rank.count));
  return {
    kind: "bars",
    title,
    stats: [
      { label: "池子", value: options.poolLabel || `望潮池内 ${poolSize} 只` },
      { label: "读法", value: options.reading || "柱越长＝池内越高" },
    ],
    items: usable.map((entry, index) => ({
      id: `${index}-${entry.row.label}`,
      label: entry.row.note ? `${entry.row.label} · ${entry.row.note}` : entry.row.label,
      valueText: `${entry.row.valueText} · 第 ${entry.rank.rank}/${entry.rank.count}`,
      width: Math.max(4, entry.rank.percentile),
      tone: "up",
      colorIndex: index % 4,
    })),
  };
}

module.exports = { poolRank, poolRankVisual };
