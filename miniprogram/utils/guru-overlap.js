const { SMART_MONEY_PROFILES } = require("./smart-money");

function normalizeSymbol(ticker) {
  const raw = String(ticker || "").trim().toUpperCase();
  if (!raw || raw === "现金") return "";
  return raw.replace(/\.HK$/, "");
}

function profileHoldings(profile, snapshot) {
  const live = (snapshot?.investors || []).find((item) => item.id === profile.id);
  if (live && Array.isArray(live.holdings) && live.holdings.length) {
    return live.holdings.map((holding) => ({
      ticker: holding.ticker,
      name: holding.issuer || holding.ticker,
      weight: holding.weight,
    }));
  }
  return (profile.holdings || []).map(([ticker, name, weight]) => ({ ticker, name, weight }));
}

function buildGuruOverlapRows(snapshot) {
  const buckets = new Map();
  for (const profile of SMART_MONEY_PROFILES) {
    for (const holding of profileHoldings(profile, snapshot)) {
      const key = normalizeSymbol(holding.ticker);
      if (!key) continue;
      if (!buckets.has(key)) {
        buckets.set(key, {
          symbol: key,
          name: holding.name || key,
          holders: [],
        });
      }
      buckets.get(key).holders.push({
        id: profile.id,
        name: profile.name,
        market: profile.marketLabel,
        // 这个字段是「占该机构组合的比例」，详情页一直是按 % 渲染的
        // （detail/index.js 的 formatNumber(holding.weight, "%")）。
        // 这里原来只 String() 一下，重合明细里就是一列没有单位的裸数字。
        weight: Number.isFinite(Number(holding.weight)) && holding.weight !== null && holding.weight !== ""
          ? `${Number(holding.weight)}%`
          : "—",
      });
    }
  }
  return [...buckets.values()]
    .filter((row) => row.holders.length >= 2)
    .sort((left, right) => (
      right.holders.length - left.holders.length
      || left.name.localeCompare(right.name, "zh-CN")
    ));
}

function guruOverlapItems(snapshot) {
  return buildGuruOverlapRows(snapshot).map((row, index) => ({
    id: `overlap-${row.symbol}`,
    market: "guru",
    group: "overlap",
    name: row.name,
    code: row.symbol,
    badge: `${row.holders.length} 家重叠`,
    score: null,
    rank: index + 1,
    scoreText: `${row.holders.length} 家共同出现`,
    rankText: `重叠第 ${index + 1}`,
    one: row.holders.map((holder) => `${holder.name} ${holder.weight}`).join(" · "),
    raw: { overlap: row },
  }));
}

module.exports = { buildGuruOverlapRows, guruOverlapItems };
