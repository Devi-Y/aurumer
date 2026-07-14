import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchLiveData, sanitizePublicData } from "../lib/live-data.mjs";
import {
  appendUSSnapshot,
  writeStrategyAudit,
} from "../lib/us-snapshot-history.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputPath = resolve(projectRoot, "data/live-snapshot.json");
const usHistoryPath = resolve(projectRoot, "data/us-signal-snapshots.json");
const strategyAuditPath = resolve(projectRoot, "data/strategy-audit.json");
const sitemapPath = resolve(projectRoot, "sitemap.xml");
const demoHKPath = resolve(projectRoot, "data/demo/hk-ipos.json");
const enableDemoData = process.env.AURUM_ENABLE_DEMO === "1";
const publicOrigin = "https://devi-y.github.io/aurumer/";
const A_SHARE_CODES = [
  "600900",
  "600941",
  "601398",
  "600036",
  "601939",
  "600377",
  "601088",
  "600938",
  "000651",
  "600585",
  "000333",
  "600011",
];

function withTimeout(promise, milliseconds, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} 超时 ${milliseconds}ms`));
    }, milliseconds);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

function mergeFundamentals(primary, fallback) {
  const current = Array.isArray(primary) ? primary : [];
  const previous = Array.isArray(fallback) ? fallback : [];
  const merged = new Map(current.map((row) => [row.symbol, row]));
  for (const row of previous) {
    if (!merged.has(row.symbol)) merged.set(row.symbol, row);
  }
  return [...merged.values()];
}

function gradeFromScore(score) {
  const value = Number(score) || 0;
  if (value >= 85) return "A";
  if (value >= 70) return "B";
  if (value >= 55) return "C";
  return "D";
}

function buildHistoricalHKListings(backtest) {
  const recent = Array.isArray(backtest?.recent) ? backtest.recent : [];
  return recent.map((row, index) => {
    const stockCode = String(row.stockCode || "").replace(/\s+/g, "");
    const offerPrice = Number.isFinite(row.offerPrice) ? Number(row.offerPrice) : null;
    const boardLotShares = Number.isFinite(row.boardLotShares) ? Number(row.boardLotShares) : null;
    const boardLotAmount = Number.isFinite(row.boardLotAmount) ? Number(row.boardLotAmount) : null;
    const firstDayChange = Number.isFinite(row.firstDayChange) ? Number(row.firstDayChange) : null;
    const greyMarketChange = Number.isFinite(row.greyMarketChange) ? Number(row.greyMarketChange) : null;
    const fiveDayChange = Number.isFinite(row.fiveDayChange) ? Number(row.fiveDayChange) : null;
    return {
      id: `hk-history-${stockCode || index}`,
      stockCode,
      code: stockCode ? `${stockCode}.HK` : "",
      name: row.name || "历史样本",
      industry: row.industry || "港股历史样本",
      offerPrice: offerPrice !== null ? `${offerPrice.toFixed(2)} 港元` : "以历史招股文件为准",
      offerPriceValue: offerPrice,
      boardLotShares,
      boardLot: boardLotShares ? `${boardLotShares}股/手` : "以历史招股文件为准",
      entryFee: boardLotAmount,
      offerStart: row.listingDate || null,
      offerDeadline: row.listingDate || null,
      listingDate: row.listingDate || null,
      sponsor: Array.isArray(row.sponsorNames) && row.sponsorNames.length
        ? row.sponsorNames.join("、")
        : row.sponsors || "见历史招股文件",
      sponsorNames: Array.isArray(row.sponsorNames) ? row.sponsorNames : [],
      underwriterNames: [],
      stabilizingManager: "见历史招股文件",
      cornerstoneInvestors: [],
      cornerstonePercent: Number.isFinite(row.cornerstonePercent) ? row.cornerstonePercent : null,
      publicOversubscription: Number.isFinite(row.publicOversubscription) ? row.publicOversubscription : null,
      approxSubscriptionAmount: Number.isFinite(row.approxSubscriptionAmount) ? row.approxSubscriptionAmount : null,
      oneLotRate: Number.isFinite(row.oneLotRate) ? row.oneLotRate : null,
      isAH: Boolean(row.isAH),
      historical: true,
      listingStatus: "ended",
      historicalReview: {
        verdict: "已结束",
        greyMarketChange,
        firstDayChange,
        fiveDayChange,
        fiveDayHighChange: null,
      },
      modelEstimate: {
        sampleCount: 1,
        intervalPercent: null,
        subscriptionMultiple: Number.isFinite(row.publicOversubscription) ? row.publicOversubscription : null,
        oneLotWinRate: Number.isFinite(row.oneLotRate) ? row.oneLotRate : null,
        greyMarketChange: greyMarketChange !== null
          ? { low: greyMarketChange, high: greyMarketChange, mid: greyMarketChange }
          : null,
        firstDayChange: firstDayChange !== null
          ? { low: firstDayChange, high: firstDayChange, mid: firstDayChange }
          : null,
        fiveDayChange: fiveDayChange !== null
          ? { low: fiveDayChange, high: fiveDayChange, mid: fiveDayChange }
          : null,
        fiveDayHighChange: null,
        publishable: false,
        confidence: "历史",
      },
      strategyAssessment: {
        verdict: "已结束",
        action: "历史样本已结束，只保留结果回顾。",
      },
      one: "历史样本，仅供回顾。",
      pros: ["来自港股历史回顾样本"],
      cons: ["不代表当前申购机会"],
    };
  });
}

async function loadDemoHKListings() {
  try {
    const raw = await readFile(demoHKPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
          ...item,
          code:
            item.code ||
            (item.stockCode ? `${String(item.stockCode).replace(/\s+/g, "")}.HK` : ""),
        }))
      : [];
  } catch {
    return [];
  }
}

async function buildStaticASharePayload() {
  const indexHtml = await readFile(resolve(projectRoot, "index.html"), "utf8");
  const match = indexHtml.match(
    /const A_SHARES = \[([\s\S]*?)\];\s*A_SHARES\.forEach\(syncAShareAliases\);/,
  );
  if (!match) return null;
  const items = new Function(`return ([${match[1]}]);`)();
  return {
    quotes: items.map((item) => ({
      code: item.code,
      name: item.name,
      currentPrice: item.currentPrice,
      currentDividendYield: item.currentDividendYield,
      sustainableDividendYield: item.sustainableDividendYield,
      currentAdvice: item.currentAdvice,
      score: item.score,
      summary: item.summary,
      industry: item.industry,
      annualDividendPer100k: item.annualDividendPer100k,
      recommendPrice: item.recommendPrice ?? null,
      buyPrice: item.buyPrice ?? null,
      safeMarginPrice: item.safeMarginPrice ?? null,
      rating: item.rating ?? gradeFromScore(item.score),
      buy_zone_low: item.buy_zone_low ?? null,
      buy_zone_high: item.buy_zone_high ?? null,
    })),
    fundamentals: items.map((item) => ({
      symbol: item.code.replace(/\.(SH|SZ)$/i, ""),
      period: "mock",
      dividendYield: item.currentDividendYield,
      sustainableDividendYield: item.sustainableDividendYield,
      dividendScore: item.score,
      industry: item.industry,
      buyZoneLow: item.buy_zone_low ?? null,
      buyZoneHigh: item.buy_zone_high ?? null,
    })),
  };
}

let previousPublicSnapshot = null;
try {
  previousPublicSnapshot = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  previousPublicSnapshot = null;
}

const payload = await withTimeout(fetchLiveData({ deepHK: true }), 60_000, "实时抓数");
if (!payload.aShare) {
  payload.aShare = await buildStaticASharePayload();
}
const historicalHKListings = buildHistoricalHKListings(payload.hk?.backtest);
if (payload.hk) {
  // 当前招股项目与历史回顾分开保存，避免历史样本被误认为正在招股。
  payload.hk.history = historicalHKListings;
}
if (payload.us?.fundamentals?.length < 30 && previousPublicSnapshot?.us?.fundamentals) {
  payload.us.fundamentals = mergeFundamentals(
    payload.us.fundamentals,
    previousPublicSnapshot.us.fundamentals,
  );
}
if (payload.strategyHealth?.us) {
  payload.strategyHealth.us.eligibleCount = (payload.us?.fundamentals || []).filter(
    (row) => row.qualityEligible && row.qualityMatchCount >= 2,
  ).length;
}
const listings = payload.hk?.listings || [];
if (
  payload.us?.stocks?.length !== 30 ||
  payload.us?.fundamentals?.length !== 30 ||
  listings.length < 1 ||
  historicalHKListings.length < 10 ||
  (payload.investors?.length || 0) < 9 ||
  (payload.hk?.backtest?.sampleCount || 0) < 50 ||
  (payload.hk?.backtest?.userStrategy?.rules?.length || 0) < 7 ||
  (payload.hk?.backtest?.modelValidation?.sampleCount || 0) < 40 ||
  !payload.strategyHealth?.hk ||
  !payload.strategyHealth?.us ||
  payload.us.fundamentals.filter(
    (row) => row.qualityEligible && row.qualityMatchCount >= 2,
  ).length < 10 ||
  listings.filter((listing) => listing.modelEstimate).length !== listings.length ||
  listings.filter((listing) => listing.strategyAssessment).length !== listings.length
) {
  throw new Error("真实数据不完整，停止覆盖现有生产快照");
}

const usHistory = await appendUSSnapshot(payload, usHistoryPath);
payload.strategyHealth.us = {
  ...payload.strategyHealth.us,
  ...usHistory.health,
};
payload.us = {
  ...payload.us,
  strategyBacktest: usHistory.health.backtest,
};

await mkdir(dirname(outputPath), { recursive: true });
const publicPayload = sanitizePublicData(payload);
await writeFile(outputPath, `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
await writeStrategyAudit(strategyAuditPath, {
  history: usHistory.history,
  hkBacktest: payload.hk?.backtest,
  usMarketData: payload.us?.stocks,
  generatedAt: payload.updatedAt,
});

const staticRoutes = [
  "/",
  "/cockpit.html",
  "/hk-ipo",
  "/us-stocks",
  "/a-shares",
  "/gurus",
];
const stockRoutes = payload.us.stocks.map(
  (stock) => `/stocks/${encodeURIComponent(stock.symbol)}`,
);
const ipoRoutes = [...listings, ...historicalHKListings].map(
  (listing) =>
    `/hk-ipo/${encodeURIComponent(
      String(listing.code || listing.stockCode || listing.id || "")
        .replace(/\.HK$/i, "")
        .replace(/^0+/, ""),
    )}`,
);
const aShareRoutes = A_SHARE_CODES.map((code) => `/a-shares/${encodeURIComponent(code)}`);
const investorRoutes = payload.investors.map(
  (investor) => `/gurus/${encodeURIComponent(investor.id)}`,
);
const lastModified = payload.updatedAt?.slice(0, 10)
  || new Date().toISOString().slice(0, 10);
const sitemapUrls = [
  ...staticRoutes,
  ...stockRoutes,
  ...ipoRoutes,
  ...aShareRoutes,
  ...investorRoutes,
].map((route) => {
  const priority = route === "/" ? "1.0" : route.split("/").length === 2 ? "0.8" : "0.7";
  return `  <url>
    <loc>${new URL(route.replace(/^\//, ""), publicOrigin).href}</loc>
    <lastmod>${lastModified}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${priority}</priority>
  </url>`;
});
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join("\n")}
</urlset>
`;
await writeFile(sitemapPath, sitemap, "utf8");

console.log(
  `生产快照与站点地图已写入：${payload.us.stocks.length} 只美股、${payload.hk.listings.length} 只当前港股、${historicalHKListings.length} 只历史港股、${payload.aShare?.quotes?.length || 0} 只 A 股、${payload.investors?.length || 0} 位机构`,
);
