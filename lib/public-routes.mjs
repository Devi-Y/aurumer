import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function uniqueByRoute(specs) {
  const routes = new Map();
  for (const spec of specs) {
    if (!routes.has(spec.route)) routes.set(spec.route, spec);
  }
  return [...routes.values()];
}

function normalizeIPOCode(listing) {
  const value = String(
    listing.rawCode || listing.stockCode || listing.code || listing.id || "",
  ).replace(/\.HK$/i, "");
  const digits = value.match(/\d{1,5}/)?.[0] || "";
  return digits ? digits.padStart(5, "0") : "";
}

function adapterHtml(spec) {
  const parts = spec.route.split("/").filter(Boolean);
  const prefix = "../".repeat(parts.length);
  const destination = `${prefix}#/${spec.hash}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${spec.title}｜望潮 Aurum</title><script>location.replace('${destination}');</script></head><body><a href="${destination}">进入望潮答案</a></body></html>
`;
}

export function buildPublicRouteSpecs(payload, options = {}) {
  const aShareCodes = options.aShareCodes || [];
  const specs = [
    { route: "/hk-ipo", hash: "hk", title: "港股打新" },
    { route: "/us-stocks", hash: "us", title: "美股投资" },
    { route: "/a-shares", hash: "a-shares", title: "A股收息" },
    { route: "/gurus", hash: "gurus", title: "聪明人持仓" },
  ];

  for (const stock of payload.us?.stocks || []) {
    const symbol = String(stock.symbol || "").toUpperCase();
    if (!symbol) continue;
    specs.push({
      route: `/stocks/${encodeURIComponent(symbol)}`,
      hash: `stock/${symbol}`,
      title: `${symbol} 美股答案`,
    });
  }

  for (const listing of [
    ...(payload.hk?.listings || []),
    ...(payload.hk?.history || []),
  ]) {
    const code = normalizeIPOCode(listing);
    if (!code) continue;
    specs.push({
      route: `/hk-ipo/${code}`,
      hash: `ipo/${code}`,
      title: `${listing.name || code} 港股打新答案`,
    });
    const shortCode = code.replace(/^0+/, "") || "0";
    if (shortCode !== code) {
      specs.push({
        route: `/hk-ipo/${shortCode}`,
        hash: `ipo/${code}`,
        title: `${listing.name || code} 港股打新答案`,
        sitemap: false,
      });
    }
  }

  for (const code of aShareCodes) {
    const normalized = String(code).replace(/\.(SH|SZ)$/i, "");
    if (!normalized) continue;
    specs.push({
      route: `/a-shares/${normalized}`,
      hash: `a-share/${normalized}`,
      title: `${normalized} A股收息答案`,
    });
  }

  for (const investor of payload.investors || []) {
    const id = String(investor.id || "").toLowerCase();
    if (!id) continue;
    specs.push({
      route: `/gurus/${encodeURIComponent(id)}`,
      hash: `investor/${id}`,
      title: `${investor.name || id} 持仓追踪`,
    });
  }

  return uniqueByRoute(specs);
}

export async function writePublicRouteAdapters(projectRoot, specs) {
  const managedRoots = new Set(
    specs
      .map((spec) => spec.route.split("/").filter(Boolean)[0])
      .filter(Boolean),
  );
  await Promise.all(
    [...managedRoots].map((root) =>
      rm(resolve(projectRoot, root), { recursive: true, force: true }),
    ),
  );
  await Promise.all(
    specs.map(async (spec) => {
      const target = resolve(
        projectRoot,
        spec.route.replace(/^\/+/, ""),
        "index.html",
      );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, adapterHtml(spec), "utf8");
    }),
  );
}
