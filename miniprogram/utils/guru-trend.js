/**
 * 聪明人持仓：跨机构的方向汇总。
 *
 * 单家机构的季度变化在 guru-changes.js 里已经有了，这里回答的是另一个问题——
 * 这批人这一季整体在往哪边动、哪些标的是多家同时加或同时减、哪些出现分歧。
 * 所有结论都是把 13F 里已披露的 changeType 数出来，没有预测、没有加权模型：
 * 「未来趋势」在这里的口径就是「这批人最近一次申报里的方向」，不是我们的预测。
 */

// 13F 里 ticker 有时是代码（AAPL），有时直接是发行人全称（Insmed Inc）。
// 两种都保留原样展示，只在归并时统一大小写和空白。
function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/gu, " ");
}

function displayName(symbol, issuer) {
  const code = String(symbol || "").trim();
  // 纯字母且不超过 5 位的当代码用，其余用发行人名（代码位上本来就是全称）。
  if (/^[A-Z]{1,5}$/u.test(code)) return code;
  const name = String(issuer || code).trim();
  return name.length > 14 ? `${name.slice(0, 14)}…` : name;
}

const ADD_TYPES = new Set(["up", "new"]);
const CUT_TYPES = new Set(["down"]);

function buildGuruTrend(snapshot) {
  const investors = Array.isArray(snapshot && snapshot.investors) ? snapshot.investors : [];
  const totals = { new: 0, up: 0, down: 0, exit: 0, same: 0 };
  const bucket = new Map();
  const touch = (symbol, issuer) => {
    const key = normalizeSymbol(symbol);
    if (!key) return null;
    if (!bucket.has(key)) {
      bucket.set(key, { symbol: key, name: displayName(key, issuer), adders: [], cutters: [] });
    }
    return bucket.get(key);
  };

  for (const investor of investors) {
    const who = investor.name || investor.id || "机构";
    // 同一家机构对同一标的在快照里可能出现两行（例如同时有增持与新建两条），
    // 只按一次计，否则「几家在加」会把一家数成两家。
    const seen = new Set();
    for (const holding of investor.holdings || []) {
      const key = normalizeSymbol(holding.ticker);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const type = String(holding.changeType || "").toLowerCase();
      if (totals[type] != null) totals[type] += 1;
      const row = touch(holding.ticker, holding.issuer);
      if (!row) continue;
      if (ADD_TYPES.has(type)) row.adders.push({ who, type, weight: Number(holding.weight) });
      else if (CUT_TYPES.has(type)) row.cutters.push({ who, type, weight: Number(holding.weight) });
    }
    for (const gone of investor.sold || []) {
      const key = normalizeSymbol(gone.ticker);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      totals.exit += 1;
      const row = touch(gone.ticker, gone.issuer || gone.name);
      if (row) row.cutters.push({ who, type: "exit", weight: null });
    }
  }

  const rows = [...bucket.values()];
  // 排序口径：先看几家在同一个方向上动，再看这些机构在这只上压了多少仓位。
  const byCount = (pick) => (left, right) => (
    pick(right).length - pick(left).length
    || sumWeight(pick(right)) - sumWeight(pick(left))
  );
  const adds = rows.filter((row) => row.adders.length && !row.cutters.length)
    .sort(byCount((row) => row.adders));
  const cuts = rows.filter((row) => row.cutters.length && !row.adders.length)
    .sort(byCount((row) => row.cutters));
  // 有人加有人减的，既不能算加也不能算减，单列出来才是诚实的说法。
  const split = rows.filter((row) => row.adders.length && row.cutters.length)
    .sort((left, right) => (
      (right.adders.length + right.cutters.length) - (left.adders.length + left.cutters.length)
    ));

  return {
    totals,
    adds,
    cuts,
    split,
    investorCount: investors.length,
    // 多家同向的那部分才算得上「这批人的方向」，一家一只不算趋势。
    consensusAdds: adds.filter((row) => row.adders.length >= 2),
    consensusCuts: cuts.filter((row) => row.cutters.length >= 2),
  };
}

function sumWeight(list) {
  return (list || []).reduce((total, row) => total + (Number.isFinite(row.weight) ? row.weight : 0), 0);
}

module.exports = { buildGuruTrend };
