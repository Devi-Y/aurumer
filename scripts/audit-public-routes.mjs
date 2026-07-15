import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildPublicRouteSpecs } from "../lib/public-routes.mjs";

const root = resolve(import.meta.dirname, "..");
const snapshot = JSON.parse(
  await readFile(resolve(root, "data/live-snapshot.json"), "utf8"),
);
const aShareCodes = (snapshot.aShare?.quotes || []).map((item) =>
  String(item.code || "").replace(/\.(SH|SZ)$/i, ""),
);
const specs = buildPublicRouteSpecs(snapshot, { aShareCodes });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const spec of specs) {
  const target = resolve(root, spec.route.replace(/^\/+/, ""), "index.html");
  await access(target);
  const html = await readFile(target, "utf8");
  assert(html.includes(spec.canonical), `${spec.route} 缺少 canonical`);
  assert(html.includes("og:description"), `${spec.route} 缺少分享说明`);
  assert(html.includes("aurum-share.png"), `${spec.route} 缺少分享图`);
  assert(!/strategyAssessment|modelEstimate|modelValidation/.test(html), `${spec.route} 泄露内部字段`);
}

const sitemap = await readFile(resolve(root, "sitemap.xml"), "utf8");
assert(!/\/history\/?</.test(sitemap), "公开 sitemap 不得包含历史策略页");
assert(specs.length >= 80, `可分享直达页不足：${specs.length}`);

console.log(`公开直达页检查通过：${specs.length} 条`);
