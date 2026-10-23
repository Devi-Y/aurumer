// Generated from miniprogram/utils/us-event-facts.js.
(function () {
"use strict";

// Only the original SEC document and a fully dated, checked fact can become a
// company event. Filing categories and failed extraction remain separate.
function secArchiveRoot(value) {
  const match = String(value || "").match(/^https:\/\/www\.sec\.gov(\/Archives\/edgar\/data\/\d+\/\d{18}\/)[A-Za-z0-9_][A-Za-z0-9_.-]*\.html?$/);
  return match ? `https://www.sec.gov${match[1]}` : "";
}

function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function sanitizeEventFact(input = {}, symbol = input.symbol) {
  const key = String(symbol || "").trim().toUpperCase();
  const sourceUrl = secArchiveRoot(input.sourceUrl) ? input.sourceUrl : null;
  const fetchedAt = typeof input.fetchedAt === "string" && Number.isFinite(Date.parse(input.fetchedAt)) ? input.fetchedAt : null;
  const checkedAt = typeof input.checkedAt === "string" && Number.isFinite(Date.parse(input.checkedAt)) ? input.checkedAt : fetchedAt;
  const filingDate = validDay(input.filingDate) ? input.filingDate : null;
  const eventDate = validDay(input.eventDate) ? input.eventDate : null;
  const root = secArchiveRoot(sourceUrl);
  const facts = (Array.isArray(input.facts) ? input.facts : []).filter((fact) =>
    typeof fact.summary === "string" && fact.summary.trim() && fact.summary.length <= 600
    && root && secArchiveRoot(fact.sourceUrl) === root
    && /^[a-f0-9]{64}$/i.test(String(fact.documentSha256 || "")))
    .map((fact) => ({ summary: fact.summary.trim(), sourceUrl: fact.sourceUrl,
      documentSha256: fact.documentSha256, metrics: (Array.isArray(fact.metrics) ? fact.metrics : []).filter((metric) => metric && typeof metric === "object")
        .map(({ name, value, unit, qualifier }) => ({ name, value, unit, qualifier })) }));
  const verified = input.state === "verified" && String(input.symbol || "").toUpperCase() === key
    && input.scope === "recent-event-filings" && input.priceCausation === "not_established"
    && sourceUrl && filingDate && eventDate && fetchedAt && checkedAt && facts.length
    && eventDate <= filingDate && filingDate <= fetchedAt.slice(0, 10)
    && Date.parse(checkedAt) >= Date.parse(fetchedAt)
    && Date.parse(checkedAt) <= Date.now() + 5 * 60 * 1000;
  return { symbol: key, state: verified ? "verified" : "unknown", scope: "recent-event-filings",
    eventKind: typeof input.eventKind === "string" ? input.eventKind : null,
    sourceUrl, filingDate, eventDate, period: input.period && typeof input.period === "object"
      ? Object.fromEntries(["start", "end", "fiscalYear", "fiscalQuarter"].filter((key) => input.period[key] != null).map((key) => [key, input.period[key]])) : null, fetchedAt, checkedAt,
    priceCausation: "not_established", facts: verified ? facts : [],
    ...(!verified ? { reason: String(input.reason || "近期公司事件尚未完成正文核验") } : {}) };
}

function sanitizeEventFacts(input) {
  return Object.fromEntries(Object.entries(input && typeof input === "object" && !Array.isArray(input) ? input : {})
    .filter(([symbol, value]) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) && value && typeof value === "object")
    .map(([symbol, value]) => [symbol, sanitizeEventFact(value, symbol)]));
}

function eventFactFor(snapshot, symbol) {
  const key = String(symbol || "").trim().toUpperCase();
  return sanitizeEventFact(snapshot?.us?.eventFacts?.[key] || {}, key);
}

function eventSummary(snapshot, symbol) {
  const event = eventFactFor(snapshot, symbol);
  if (event.state !== "verified") return "近期公司事件待核验";
  const summary = event.facts[0].summary;
  return summary.includes(event.eventDate) ? summary : `${event.eventDate} ${summary}`;
}

function eventSources(snapshot, symbol) {
  const event = eventFactFor(snapshot, symbol);
  if (event.state !== "verified") return [];
  return [...new Set(event.facts.map((fact) => fact.sourceUrl).concat(event.sourceUrl))]
    .map((url, index) => ({ id: `us-event-${event.symbol}-${index}`,
      name: `${event.eventDate} 公司事件（SEC原文）`, url }));
}

function eventBrief(snapshot, symbol) {
  const event = eventFactFor(snapshot, symbol);
  if (event.state !== "verified") return "";
  const labels = { capital_structure_proposal: "拟向股东派发新股，尚未生效", acquisition_agreement: "已签订收购协议",
    quarterly_earnings: "公布季度业绩", preliminary_earnings: "发布初步业绩，未经审计",
    bitcoin_treasury_update: "披露比特币买入情况" };
  // Older cloud caches kept the verified metrics but not the event kind.
  const metrics = new Set(event.facts.flatMap((fact) => fact.metrics.map((metric) => metric.name)));
  const kind = event.eventKind || (metrics.has("classCDividendPerExistingShare") ? "capital_structure_proposal"
    : metrics.has("acquisitionConsideration") ? "acquisition_agreement"
      : metrics.has("bitcoinPurchased") ? "bitcoin_treasury_update"
        : metrics.has("advertisingRevenueGuidance") ? "quarterly_earnings" : null);
  return labels[kind] || "查看已核实的公司近况";
}

globalThis.AurumEventFacts = { sanitizeEventFact, sanitizeEventFacts, eventFactFor, eventSummary, eventBrief, eventSources };

})();
