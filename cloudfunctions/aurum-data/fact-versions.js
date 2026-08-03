/**
 * 从 live snapshot 抽出可版本化的精简事实，供变化雷达与收件箱使用。
 */
const FACT_LATEST = "data_fact_latest";
const FACT_HISTORY = "data_fact_history";
const FACT_META = "data_fact_meta";
const HISTORY_RETENTION = 30;

function text(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function fingerprint(fact) {
  if (!fact) return "";
  return [fact.oneLiner, fact.badge, fact.priceLabel, fact.metricLabel, fact.risk, fact.asOf]
    .map((part) => String(part || "").trim())
    .join("|");
}

function makeFact(partial, snapshotUpdatedAt) {
  return {
    market: text(partial.market, 20),
    code: text(partial.code, 30),
    name: text(partial.name, 80),
    oneLiner: text(partial.oneLiner, 200),
    badge: text(partial.badge, 40),
    risk: text(partial.risk, 300),
    priceLabel: text(partial.priceLabel, 60),
    metricLabel: text(partial.metricLabel, 80),
    asOf: text(partial.asOf, 40),
    source: text(partial.source, 80),
    snapshotUpdatedAt: text(snapshotUpdatedAt || partial.snapshotUpdatedAt, 40),
  };
}

function extractFacts(snapshot) {
  if (!snapshot || snapshot.status !== "live") return [];
  const updatedAt = snapshot.updatedAt || "";
  const facts = [];

  (snapshot.us && snapshot.us.stocks || []).forEach((row) => {
    const change = Number(row.changePercent);
    facts.push(makeFact({
      market: "us",
      code: row.symbol || row.code,
      name: row.symbol || row.code,
      oneLiner: Number.isFinite(change) ? `日涨跌 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "美股行情",
      badge: row.marketState || "",
      priceLabel: row.price != null ? `$${Number(row.price).toFixed(2)}` : "",
      metricLabel: Number.isFinite(Number(row.weeklyChange))
        ? `周 ${Number(row.weeklyChange) >= 0 ? "+" : ""}${Number(row.weeklyChange).toFixed(1)}%`
        : "",
      asOf: row.asOf || updatedAt,
      source: row.exchange || "Nasdaq/公开行情",
    }, updatedAt));
  });

  (snapshot.us && snapshot.us.fundamentals || []).forEach((row) => {
    const code = row.symbol || row.code;
    const existing = facts.find((item) => item.market === "us" && item.code === code);
    const fundLine = [
      row.period ? `财报期 ${row.period}` : "",
      row.operatingCashFlow != null ? "含经营现金流" : "",
      row.pe != null ? `PE ${Number(row.pe).toFixed(1)}` : "",
    ].filter(Boolean).join(" · ");
    if (existing && fundLine) {
      existing.oneLiner = `${existing.oneLiner}；${fundLine}`.slice(0, 200);
      existing.source = existing.source || "公开财务资料";
    }
  });

  (snapshot.hk && snapshot.hk.listings || []).forEach((row) => {
    facts.push(makeFact({
      market: "hk",
      code: row.code || row.rawCode,
      name: row.shortName || row.name || row.code,
      oneLiner: (row.publicAnswer && row.publicAnswer.verdict) || row.status || "港股新股",
      badge: row.status || "",
      priceLabel: row.entryFee != null ? `一手约 ${Math.round(Number(row.entryFee))} 港元` : "",
      metricLabel: row.offerDeadline ? `截止 ${row.offerDeadline}` : (row.listingDate ? `上市 ${row.listingDate}` : ""),
      asOf: row.offerDeadline || row.listingDate || updatedAt,
      source: row.source || "港交所公开文件",
      risk: row.publicAnswer && row.publicAnswer.risk || "",
    }, updatedAt));
  });

  (snapshot.aShare && snapshot.aShare.quotes || []).forEach((row) => {
    facts.push(makeFact({
      market: "a",
      code: row.code,
      name: row.name || row.code,
      oneLiner: row.summary || (row.currentDividendYield != null ? `股息率 ${Number(row.currentDividendYield).toFixed(1)}%` : "A股资料"),
      badge: row.rating || "",
      priceLabel: row.currentPrice != null ? `¥${Number(row.currentPrice).toFixed(2)}` : "",
      metricLabel: row.currentDividendYield != null ? `息 ${Number(row.currentDividendYield).toFixed(1)}%` : "",
      asOf: row.priceAsOf || row.asOf || updatedAt,
      source: row.priceSource || row.source || "公开行情",
    }, updatedAt));
  });

  const gold = snapshot.gold;
  if (gold && gold.quotes && gold.quotes.international) {
    const intl = gold.quotes.international;
    const answer = gold.answer || {};
    facts.push(makeFact({
      market: "gold",
      code: "XAU",
      name: "国际金价",
      oneLiner: (answer.summary || answer.stance || "黄金观察").toString().slice(0, 200),
      badge: answer.stance || "",
      priceLabel: intl.price != null ? `${Math.round(Number(intl.price))} USD/oz` : "",
      metricLabel: gold.quotes.domestic && gold.quotes.domestic.price != null
        ? `沪金 ${Math.round(Number(gold.quotes.domestic.price))}`
        : "",
      asOf: intl.asOf || updatedAt,
      source: (gold.sources || []).map((item) => item.name).filter(Boolean).join(" · ") || "公开金价",
      risk: answer.risk || "",
    }, updatedAt));
  }

  (snapshot.investors || []).forEach((row) => {
    const sold = Array.isArray(row.sold) ? row.sold.length : 0;
    const holdings = Array.isArray(row.holdings) ? row.holdings.length : 0;
    facts.push(makeFact({
      market: "investors",
      code: row.id || row.name,
      name: row.name || row.id,
      oneLiner: row.trackingSummary || `持仓 ${holdings} · 退出 ${sold}`,
      badge: row.filingDate ? `披露 ${row.filingDate}` : "",
      priceLabel: row.filingDate || "",
      metricLabel: row.previousReportDate ? `上期 ${row.previousReportDate}` : "",
      asOf: row.filingDate || updatedAt,
      source: row.source || "SEC 13F / 公开披露",
      risk: "披露滞后，不可当实时跟仓",
    }, updatedAt));
  });

  return facts.filter((item) => item.code);
}

function docId(market, code) {
  return `${String(market || "x")}_${String(code || "x")}`.replace(/[^\w.\-一-龥]/g, "_").slice(0, 64);
}

async function ensureCollection(db, name, error) {
  const message = String((error && error.message) || "");
  if (!/collection not exists|not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message)) return false;
  if (!db || typeof db.createCollection !== "function") return false;
  try {
    await db.createCollection(name);
    return true;
  } catch (createError) {
    return /already exist/i.test(String((createError && createError.message) || ""));
  }
}

async function writeFactVersions(db, snapshot) {
  if (!db) return { written: 0, changed: 0 };
  const facts = extractFacts(snapshot);
  let written = 0;
  let changed = 0;
  for (const fact of facts) {
    const id = docId(fact.market, fact.code);
    let previous = null;
    try {
      const current = await db.collection(FACT_LATEST).doc(id).get();
      previous = current && current.data && current.data.fact ? current.data.fact : null;
    } catch (error) {
      if (!(await ensureCollection(db, FACT_LATEST, error))) {
        // ignore missing previous
      }
    }
    const prevFp = fingerprint(previous);
    const nextFp = fingerprint(fact);
    const didChange = Boolean(previous) && prevFp !== nextFp;
    if (didChange) changed += 1;
    const record = {
      market: fact.market,
      code: fact.code,
      fact,
      previousFact: didChange ? previous : (previous || null),
      fingerprint: nextFp,
      changed: didChange,
      snapshotUpdatedAt: fact.snapshotUpdatedAt,
      updatedAt: new Date(),
    };
    try {
      await db.collection(FACT_LATEST).doc(id).set({ data: record });
      written += 1;
    } catch (error) {
      if (await ensureCollection(db, FACT_LATEST, error)) {
        try {
          await db.collection(FACT_LATEST).doc(id).set({ data: record });
          written += 1;
        } catch (retryError) {
          console.warn("fact version write retry failed", id, retryError && retryError.message);
        }
      }
    }
    if (didChange) {
      try {
        await db.collection(FACT_HISTORY).add({
          data: {
            market: fact.market,
            code: fact.code,
            factKey: id,
            fact,
            previousFact: previous,
            fingerprint: nextFp,
            previousFingerprint: prevFp,
            snapshotUpdatedAt: fact.snapshotUpdatedAt,
            createdAt: new Date(),
          },
        });
      } catch (historyError) {
        if (await ensureCollection(db, FACT_HISTORY, historyError)) {
          try {
            await db.collection(FACT_HISTORY).add({
              data: {
                market: fact.market,
                code: fact.code,
                factKey: id,
                fact,
                previousFact: previous,
                fingerprint: nextFp,
                previousFingerprint: prevFp,
                snapshotUpdatedAt: fact.snapshotUpdatedAt,
                createdAt: new Date(),
              },
            });
          } catch (retryHistoryError) {
            console.warn("fact history write failed", id, retryHistoryError && retryHistoryError.message);
          }
        }
      }
    }
  }
  try {
    await db.collection(FACT_META).doc("latest").set({
      data: {
        snapshotUpdatedAt: snapshot.updatedAt || "",
        written,
        changed,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    if (await ensureCollection(db, FACT_META, error)) {
      try {
        await db.collection(FACT_META).doc("latest").set({
          data: {
            snapshotUpdatedAt: snapshot.updatedAt || "",
            written,
            changed,
            updatedAt: new Date(),
          },
        });
      } catch (retryError) {
        console.warn("fact meta write failed", retryError && retryError.message);
      }
    }
  }
  return { written, changed, count: facts.length };
}

module.exports = {
  FACT_LATEST,
  FACT_HISTORY,
  HISTORY_RETENTION,
  extractFacts,
  fingerprint,
  writeFactVersions,
  docId,
};
