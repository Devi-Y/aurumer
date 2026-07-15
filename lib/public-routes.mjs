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

const DEFAULT_PUBLIC_ORIGIN = "https://devi-y.github.io/aurumer/";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function adapterHtml(spec) {
  const parts = spec.route.split("/").filter(Boolean);
  const prefix = "../".repeat(parts.length);
  const destination = `${prefix}#/${spec.hash}`;
  const title = `${spec.title}｜望潮 Aurum`;
  const image = new URL("assets/aurum-share.png", spec.publicOrigin).href;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(spec.description)}"><link rel="canonical" href="${escapeHtml(spec.canonical)}"><meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="望潮 Aurum"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(spec.description)}"><meta property="og:url" content="${escapeHtml(spec.canonical)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(spec.description)}"><meta name="twitter:image" content="${escapeHtml(image)}"><meta name="theme-color" content="#F4F1E9"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#F4F1E9;color:#1F2B2A;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{width:min(520px,100%);padding:32px;border:1px solid #E4DED1;border-radius:24px;background:#FFFDF9;box-shadow:0 18px 48px -34px rgba(31,43,42,.35)}small{display:block;color:#B64C35;font-weight:800;letter-spacing:1.5px}h1{margin:10px 0 8px;font-size:28px;line-height:1.25}p{margin:0;color:#69716B;line-height:1.7}a{display:inline-flex;min-height:44px;align-items:center;margin-top:22px;padding:10px 18px;border-radius:999px;background:#1F2B2A;color:#fff;text-decoration:none;font-weight:800}</style><script>location.replace(${JSON.stringify(destination)});</script></head><body><main><small>望潮 AURUM · 先看答案</small><h1>${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.description)}</p><a href="${escapeHtml(destination)}">立即查看答案</a></main></body></html>
`;
}

export function buildPublicRouteSpecs(payload, options = {}) {
  const aShareCodes = options.aShareCodes || [];
  const publicOrigin = new URL(options.publicOrigin || DEFAULT_PUBLIC_ORIGIN).href;
  const canonical = (route) =>
    new URL(`${route.replace(/^\/+/, "").replace(/\/+$/, "")}/`, publicOrigin).href;
  const withPublicMeta = (spec) => ({
    ...spec,
    publicOrigin,
    canonical: canonical(spec.route),
  });
  const specs = [
    { route: "/hk-ipo", hash: "hk", title: "港股打新", description: "一句话先看值得打、谨慎打、不建议和已结束，再进入具体新股答案。" },
    { route: "/us-stocks", hash: "us", title: "美股投资", description: "一句话先看七姐妹、热度前三和聪明人持仓，再进入价格与风险答案。" },
    { route: "/a-shares", hash: "a-shares", title: "A股收息", description: "一句话先看买入、等待和回避，再进入股息率、价格和现金流答案。" },
    { route: "/gurus", hash: "gurus", title: "聪明人持仓", description: "查看巴菲特、李录、达利欧等公开持仓变化、原因和跟随边界。" },
  ];

  for (const stock of payload.us?.stocks || []) {
    const symbol = String(stock.symbol || "").toUpperCase();
    if (!symbol) continue;
    const price = Number(stock.price);
    specs.push({
      route: `/stocks/${encodeURIComponent(symbol)}`,
      hash: `stock/${symbol}`,
      title: `${symbol} 美股答案`,
      description: `${symbol}${Number.isFinite(price) ? ` 当前价 $${price.toFixed(2)}` : ""}；查看综合分、排名、买入、止盈、止损研究参考与风险。`,
    });
  }

  for (const listing of [
    ...(payload.hk?.listings || []),
    ...(payload.hk?.history || []),
  ]) {
    const code = normalizeIPOCode(listing);
    if (!code) continue;
    const verdict = listing.publicAnswer?.verdict || (listing.historical ? "已结束" : "查看最新结论");
    const description = `${listing.name || code}（${code}.HK）：${verdict}。查看分数、排名、招股资料、暗盘与上市表现。`;
    specs.push({
      route: `/hk-ipo/${code}`,
      hash: `ipo/${code}`,
      title: `${listing.name || code} 港股打新答案`,
      description,
    });
    const shortCode = code.replace(/^0+/, "") || "0";
    if (shortCode !== code) {
      specs.push({
        route: `/hk-ipo/${shortCode}`,
        hash: `ipo/${code}`,
        title: `${listing.name || code} 港股打新答案`,
        description,
        sitemap: false,
      });
    }
  }

  const aShareByCode = new Map(
    (payload.aShare?.quotes || []).map((item) => [
      String(item.code || "").replace(/\.(SH|SZ)$/i, ""),
      item,
    ]),
  );
  for (const code of aShareCodes) {
    const normalized = String(code).replace(/\.(SH|SZ)$/i, "");
    if (!normalized) continue;
    const quote = aShareByCode.get(normalized);
    const price = Number(quote?.currentPrice);
    specs.push({
      route: `/a-shares/${normalized}`,
      hash: `a-share/${normalized}`,
      title: `${quote?.name || normalized} A股收息答案`,
      description: `${quote?.name || normalized}${Number.isFinite(price) ? ` 当前价 ${price.toFixed(2)} 元` : ""}；${quote?.currentAdvice || "查看最新结论"}，查看分数、排名、股息率和合理价格。`,
    });
  }

  for (const investor of payload.investors || []) {
    const id = String(investor.id || "").toLowerCase();
    if (!id) continue;
    specs.push({
      route: `/gurus/${encodeURIComponent(id)}`,
      hash: `investor/${id}`,
      title: `${investor.name || id} 持仓追踪`,
      description: `${investor.name || id}：查看最新公开持仓、买卖变化、原因、优缺点和普通用户参考边界。`,
    });
  }

  return uniqueByRoute(specs.map(withPublicMeta));
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
