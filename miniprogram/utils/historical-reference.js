const { toDay, asOfText } = require("./dates");

// Source dates and processing dates remain separate. A missing quote date must
// never be replaced with a new snapshot/revision timestamp.
function referenceDateText(values, label = "报价") {
  const days = [...new Set((values || []).map(toDay).filter((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
  }))].sort();
  if (!days.length) return `${label}日期待核验`;
  return days[0] === days[days.length - 1]
    ? `${label} ${days[0]}`
    : `${label} ${days[0]}—${days[days.length - 1]}`;
}

function marketReferenceAsOf(snapshot, market, kind, item) {
  const raw = item && item.raw;
  if (raw && (market === "us" || market === "a")) {
    return referenceDateText([raw.priceAsOf || raw.asOf]);
  }
  const rows = market === "us" ? snapshot?.us?.stocks
    : market === "a" ? [...(snapshot?.aShare?.quotes || []), ...(snapshot?.aShare?.funds || [])]
      : market === "gold" ? Object.values(snapshot?.gold?.quotes || {}) : null;
  if (rows) return referenceDateText(rows.map((row) => row && (row.priceAsOf || row.asOf)));
  return asOfText(snapshot && snapshot.updatedAt, kind);
}

module.exports = { referenceDateText, marketReferenceAsOf };
