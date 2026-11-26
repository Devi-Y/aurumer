import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "data", "live-snapshot.json");
const outDir = path.join(root, "dist", "cdn");
const wenyuePublicDir = "/Users/y/Documents/问岳/01_代码/主仓库/public/aurum";
const require = createRequire(import.meta.url);
const { sanitizeSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");

const raw = JSON.parse(await readFile(sourcePath, "utf8"));
const sanitized = sanitizeSnapshot(raw);
const body = JSON.stringify(sanitized);
const sha256 = createHash("sha256").update(body).digest("hex");
const etag = `"${sha256.slice(0, 24)}"`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "live-snapshot.json"), body, "utf8");
await writeFile(
  path.join(outDir, "meta.json"),
  `${JSON.stringify({
    updatedAt: sanitized.updatedAt,
    revisionAt: sanitized.revisionAt || sanitized.updatedAt,
    etag,
    sha256,
    bytes: Buffer.byteLength(body, "utf8"),
    exportedAt: new Date().toISOString(),
    suggestedCdnUrl: "https://wenyue-sz.com/aurum/live-snapshot.json",
  }, null, 2)}\n`,
  "utf8",
);

console.log(`方案 A 国内直连快照包已导出至 dist/cdn/：`);
console.log(`- 文件：dist/cdn/live-snapshot.json（${(Buffer.byteLength(body, "utf8") / 1024).toFixed(1)} KB，已脱敏压缩）`);
console.log(`- ETag：${etag}`);
console.log(`- 数据批次：${sanitized.updatedAt}`);

try {
  await access(path.dirname(wenyuePublicDir));
  await mkdir(wenyuePublicDir, { recursive: true });
  await writeFile(path.join(wenyuePublicDir, "live-snapshot.json"), body, "utf8");
  console.log(`- 已同步至问岳静态目录：${path.join(wenyuePublicDir, "live-snapshot.json")}`);
} catch {
  // 独立环境不存在问岳目录时跳过
}
