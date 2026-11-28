const { SMART_MONEY_PROFILES } = require("./smart-money");

const CANONICAL_OVERLAP = [
  [/^(0?700|TENCENT(\s+HOLDINGS?(\s+LTD)?)?|腾讯控股)$/i, "0700.HK", "腾讯控股"],
  [/^(9988|BABA|ALIBABA(\s+GROUP(\s+HOLDING\s+LTD)?)?|阿里巴巴(-W)?)$/i, "BABA", "阿里巴巴"],
  [/^(TSM|TSMC|TAIWAN\s+SEMICONDUCTOR(\s+MANUFACTURING(\s+CO\s+LTD)?)?|台积电)$/i, "TSM", "台积电"],
  [/^(PDD|PINDUODUO|PDD\s+HOLDINGS(\s+INC)?|拼多多)$/i, "PDD", "拼多多"],
  [/^(9999|NTES|NETEASE(\s+INC)?|网易(-S)?)$/i, "9999.HK", "网易"],
  [/^(2899|ZIJIN\s+MINING(\s+GROUP(\s+CO\s+LTD)?)?|紫金矿业)$/i, "2899.HK", "紫金矿业"],
  [/^(300750|CATL|CONTEMPORARY\s+AMPEREX(\s+TECHNOLOGY)?|宁德时代)$/i, "300750", "宁德时代"],
  [/^(2318|PING\s+AN\s+INSURANCE(\s+H)?|中国平安)$/i, "2318.HK", "中国平安"],
  [/^(600036|3968|CHINA\s+MERCHANTS\s+BANK|招商银行)$/i, "600036", "招商银行"],
  [/^(300308|ZHONGJI\s+INNOLIGHT|中际旭创)$/i, "300308", "中际旭创"],
  [/^(GOOG|GOOGL|ALPHABET(\s+INC)?)$/i, "GOOGL", "谷歌"],
];

function canonicalEntity(ticker, name) {
  const raw = String(ticker || "").trim().replace(/\.(HK|SH|SZ|US)$/i, "");
  if (!raw || raw === "现金") return null;
  const upper = raw.toUpperCase();
  const cleanName = String(name || "").trim().replace(/[.,]/g, "").replace(/\s+/g, " ");
  for (const [pattern, code, zhName] of CANONICAL_OVERLAP) {
    if (pattern.test(upper) || (cleanName && pattern.test(cleanName))) {
      return { key: code.replace(/\.HK$/i, ""), name: zhName };
    }
  }
  return { key: upper, name: name || upper };
}

function profileHoldings(profile, snapshot) {
  const live = (snapshot?.investors || []).find((item) => item.id === profile.id);
  if (live && Array.isArray(live.holdings) && live.holdings.length) {
    // 期权仓位不算「重叠持仓」：一家买正股、一家买这只票的看跌期权，方向可能
    // 完全相反，不能算作两家机构看法一致。重叠只统计正股持仓。
    return live.holdings
      .filter((holding) => !holding.putCall)
      .map((holding) => ({
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
    const seenInProfile = new Set();
    for (const holding of profileHoldings(profile, snapshot)) {
      const entity = canonicalEntity(holding.ticker, holding.name);
      if (!entity || !entity.key || seenInProfile.has(entity.key)) continue;
      seenInProfile.add(entity.key);
      if (!buckets.has(entity.key)) {
        buckets.set(entity.key, {
          symbol: entity.key,
          name: entity.name,
          holders: [],
        });
      }
      buckets.get(entity.key).holders.push({
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
