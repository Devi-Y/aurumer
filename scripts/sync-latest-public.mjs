import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "data", "live-snapshot.json");
const sourceUrl = `https://devi-y.github.io/aurumer/data/live-snapshot.json?sync=${Date.now()}`;
const require = createRequire(import.meta.url);
const { assertSourceSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");
const { snapshotAgeMs, ACTION_MAX_AGE_MS } = require("../cloudfunctions/aurum-data/action-freshness.js");
const { alertOpsOnce } = require("../cloudfunctions/aurum-data/ops-alert.js");

const response = await fetch(sourceUrl, {
  headers: {
    accept: "application/json",
    "cache-control": "no-cache",
    "user-agent": "Aurum-Local-Snapshot-Sync/1.0",
  },
  signal: AbortSignal.timeout(12_000),
});

if (!response.ok) {
  await alertOpsOnce("sync-latest-http", { error: `HTTP ${response.status}`, sourceUrl });
  throw new Error(`最新公开快照返回 HTTP ${response.status}`);
}

const snapshot = await response.json();
assertSourceSnapshot(snapshot);

const age = snapshotAgeMs(snapshot.updatedAt);
const stale = age > ACTION_MAX_AGE_MS;
if (stale) {
  await alertOpsOnce("sync-latest-stale", {
    error: `公开快照已过期 ${(age / 3_600_000).toFixed(1)} 小时（上限 ${(ACTION_MAX_AGE_MS / 3_600_000).toFixed(0)} 小时）`,
    updatedAt: snapshot.updatedAt,
  });
  // 默认仍写入，便于本地走动作降级与三端对齐；上传门禁由 check:fresh 拦截。
  // 设置 AURUM_SYNC_REQUIRE_FRESH=1 可在源端停更时直接失败。
  if (process.env.AURUM_SYNC_REQUIRE_FRESH === "1") {
    throw new Error(
      `公开快照已过期 ${(age / 3_600_000).toFixed(1)} 小时（updatedAt=${snapshot.updatedAt}）。请先恢复仓外自动生产任务。`,
    );
  }
  console.warn(
    `[告警] 公开快照已过期 ${(age / 3_600_000).toFixed(1)} 小时（updatedAt=${snapshot.updatedAt}）；已写入本地，动作将降级，上传需先恢复源端。`,
  );
}

await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`最新公开快照已同步：${snapshot.updatedAt}${stale ? "（内容过期，动作将降级）" : ""}`);
