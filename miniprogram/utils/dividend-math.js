/**
 * 收息测算：预计股息、税后、汇率折算。实际到账由用户填写。
 */
function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function estimateDividend({
  shares,
  yieldPct,
  price,
  expectedPerShare,
  taxRatePct,
  fxRate,
}) {
  const qty = number(shares);
  let perShare = number(expectedPerShare);
  if (!perShare && number(yieldPct) && number(price)) {
    perShare = number(price) * number(yieldPct) / 100;
  }
  const gross = qty * perShare;
  const tax = gross * number(taxRatePct) / 100;
  const net = Math.max(0, gross - tax);
  const fx = number(fxRate, 1) || 1;
  return {
    perShare,
    gross,
    tax,
    net,
    netLocal: net * fx,
  };
}

function yearCashflow(lots, settings = {}) {
  const taxRatePct = number(settings.taxRatePct);
  const rows = (lots || []).map((lot) => {
    const fx = lot.currency === "HKD"
      ? number(settings.hkdCny, 0.92)
      : (lot.currency === "USD" ? number(settings.usdCny, 7.2) : 1);
    const expected = estimateDividend({
      shares: lot.shares,
      expectedPerShare: lot.expectedPerShare,
      yieldPct: lot.yieldPct,
      price: lot.price,
      taxRatePct,
      fxRate: fx,
    });
    const actual = lot.actualTotal != null && lot.actualTotal !== ""
      ? number(lot.actualTotal)
      : null;
    return {
      ...lot,
      expectedGross: expected.gross,
      expectedNet: expected.net,
      expectedNetCny: expected.netLocal,
      actualTotal: actual,
      actualCny: actual == null ? null : actual * fx,
    };
  });
  const sum = (key) => rows.reduce((acc, row) => acc + number(row[key]), 0);
  return {
    rows,
    expectedNetCny: sum("expectedNetCny"),
    actualCny: rows.every((row) => row.actualCny == null) ? null : sum("actualCny"),
    count: rows.length,
  };
}

module.exports = { estimateDividend, yearCashflow };
