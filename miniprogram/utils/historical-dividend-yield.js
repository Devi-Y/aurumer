"use strict";

const { getDividendStability } = require("./dividend-stability");

// Use the latest completed fiscal year at the quote date, not a forecast or
// the unrelated static "sustainable yield" field.
function getHistoricalDividendYield(raw = {}) {
  if (!raw || typeof raw !== "object" || raw.assetType === "fund") return null;
  const financials = raw.financials || {};
  const dividendSource = String(financials.dividendHistorySource || "").trim();
  const priceSource = String(raw.priceSource || raw.source || "").trim();
  const price = Number(raw.currentPrice);
  const priceDate = String(raw.priceAsOf || raw.asOf || "");
  const datePart = priceDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const calendarStamp = datePart ? Date.parse(`${datePart}T00:00:00Z`) : NaN;
  const priceStamp = datePart && Number.isFinite(calendarStamp) &&
    new Date(calendarStamp).toISOString().slice(0, 10) === datePart
    ? Date.parse(priceDate) : NaN;
  const batchStamp = raw.snapshotUpdatedAt ? Date.parse(raw.snapshotUpdatedAt) : Date.now();
  if (!dividendSource || !priceSource || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(priceStamp) || !Number.isFinite(batchStamp) ||
      priceStamp > batchStamp || priceStamp > Date.now()) return null;

  const priceAsOf = new Date(priceStamp + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const result = getDividendStability(raw, { asOf: priceAsOf });
  const annual = result.window[result.window.length - 1];
  if (!annual || !annual.complete || !annual.shareBasisComparable ||
      !Number.isFinite(annual.perShareRmb) || annual.perShareRmb <= 0) return null;
  // A failed event in the target year must not turn an incomplete year into a
  // deceptively precise yield, even if another year-end event was accepted.
  if (result.excluded.some((event) => event.year === annual.year)) return null;
  return {
    yieldPercent: annual.perShareRmb / price * 100,
    year: annual.year,
    price,
    priceAsOf,
    dividendPerShare: annual.perShareRmb,
    dividendSource,
    priceSource,
  };
}

module.exports = { getHistoricalDividendYield };
