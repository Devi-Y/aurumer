#!/usr/bin/env node
/**
 * 多端对齐：本地/随包 audit → 云 warm → 在线 Pages updatedAt 核对。
 * 推送 main 后运行：npm run sync:multi
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { SOURCE_REVISION } = require("../cloudfunctions/aurum-data/index.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 失败，退出码 ${result.status ?? 1}`);
  }
}

const localSnapshot = JSON.parse(await readFile(path.join(root, "data", "live-snapshot.json"), "utf8"));
assert(localSnapshot.status === "live", "本地快照不是 live");
const localUpdatedAt = localSnapshot.updatedAt;

console.log(`本地 updatedAt=${localUpdatedAt}`);
run("npm", ["run", "audit:release"]);

const envId = JSON.parse(await readFile(path.join(root, "cloudbaserc.json"), "utf8")).envId;
console.log(`触发云 warm：${envId} / aurum-data`);
const warm = spawnSync(
  "tcb",
  ["fn", "invoke", "aurum-data", "-e", envId, "-d", JSON.stringify({ action: "warm" })],
  { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);
if (warm.status !== 0) {
  console.warn(warm.stdout || warm.stderr || "warm 调用失败；若 CLI 未登录，请在浏览器完成 tcb 授权后重试。");
} else {
  console.log(warm.stdout.trim());
}

const pagesUrl = `https://devi-y.github.io/aurumer/data/live-snapshot.json?audit=${Date.now()}`;
const pagesResponse = await fetch(pagesUrl, {
  headers: { accept: "application/json", "cache-control": "no-cache" },
  signal: AbortSignal.timeout(15_000),
});
assert(pagesResponse.ok, `Pages 快照 HTTP ${pagesResponse.status}`);
const pagesSnapshot = await pagesResponse.json();
assert(pagesSnapshot.status === "live", "Pages 快照不是 live");
assert(
  pagesSnapshot.updatedAt === localUpdatedAt,
  `Pages updatedAt=${pagesSnapshot.updatedAt} 与本地 ${localUpdatedAt} 不一致；main 推送后等待 Pages 构建完成再重试`,
);

const miniSnapshot = require(path.join(root, "miniprogram", "data", "live-snapshot.js"));
assert(miniSnapshot.updatedAt === localUpdatedAt, "小程序随包 updatedAt 与本地不一致，请运行 npm run sync:mini");

console.log("多端同步核对通过：");
console.log(`- 本地 / 随包 / Pages updatedAt=${localUpdatedAt}`);
console.log(`- 云函数 revision=${SOURCE_REVISION}`);
console.log("- 微信开发版请确认版本管理已上传最新开发版");
