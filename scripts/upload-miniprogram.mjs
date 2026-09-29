#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = process.argv[2] || "0.2.45";
const desc =
  process.argv.slice(3).join(" ") ||
  "P1–P1.7：群卡片、热度前十、性价比观察、历史样本、机构披露边界、全站研究观察口径";
const cli = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const logDir = resolve(root, ".tmp-preview");
mkdirSync(logDir, { recursive: true });
const logPath = resolve(logDir, `upload-${version}.log`);
const startedAt = Date.now();

const result = spawnSync(
  cli,
  ["upload", "--project", root, "-v", version, "-d", desc, "-i", logPath],
  { encoding: "utf8", stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// 开发者工具编译失败（比如记着一个已删的临时文件）时 CLI 照样返回 0；
// 只有本次写出了上传信息文件才算传上去了，不然别打印「完成」。
if (!existsSync(logPath) || statSync(logPath).mtimeMs < startedAt - 1000) {
  console.error(`小程序开发版上传失败：${version}，没有生成本次上传日志，看上面的报错`);
  process.exit(1);
}

console.log(`小程序开发版上传完成：${version}，日志 ${logPath}`);
