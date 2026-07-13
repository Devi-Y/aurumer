import { mkdir, writeFile } from "node:fs/promises";
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
const publicOrigin = "https://devi-y.github.io/aurumer/";
const STATIC_HK_CODES = [
  "09001",
  "09002",
  "09003",
  "09004",
  "09005",
  "09006",
  "09007",
  "09008",
  "09009",
  "09010",
  "09011",
  "09012",
];
const A_SHARE_CODES = [
  "600900",
  "600941",
  "601398",
  "601288",
  "601939",
  "601006",
  "601088",
  "600938",
  "601225",
  "600585",
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

const payload = await withTimeout(fetchLiveData({ deepHK: true }), 60_000, "实时抓数");
const listings = payload.hk?.listings || [];
if (
  payload.us?.stocks?.length !== 30 ||
  payload.us?.fundamentals?.length !== 30 ||
  listings.length < 3 ||
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
  "/hk-ipo",
  "/us-stocks",
  "/a-shares",
  "/gurus",
  ...STATIC_HK_CODES.map((code) => `/hk-ipo/${encodeURIComponent(code)}`),
];
const stockRoutes = payload.us.stocks.map(
  (stock) => `/stocks/${encodeURIComponent(stock.symbol)}`,
);
const ipoRoutes = listings.map(
  (listing) => `/hk-ipo/${encodeURIComponent(listing.code.replace(/\.HK$/i, ""))}`,
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
  `生产快照与站点地图已写入：${payload.us.stocks.length} 只美股、${payload.hk.listings.length} 只港股、${payload.investors?.length || 0} 位机构`,
);
