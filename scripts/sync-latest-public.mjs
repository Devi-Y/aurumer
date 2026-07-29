import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "data", "live-snapshot.json");
const sourceUrl = `https://devi-y.github.io/aurumer/data/live-snapshot.json?sync=${Date.now()}`;
const require = createRequire(import.meta.url);
const { assertSourceSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");

const response = await fetch(sourceUrl, {
  headers: {
    accept: "application/json",
    "cache-control": "no-cache",
    "user-agent": "Aurum-Local-Snapshot-Sync/1.0",
  },
  signal: AbortSignal.timeout(12_000),
});

if (!response.ok) throw new Error(`最新公开快照返回 HTTP ${response.status}`);

const snapshot = await response.json();
assertSourceSnapshot(snapshot);
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(`最新公开快照已同步：${snapshot.updatedAt}`);
