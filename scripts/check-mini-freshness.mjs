import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 历史参考保留真实批次日期，不因资料较旧而强制追新；其他模式保留原时效门槛。
const MAX_AGE_MS = Number(process.env.AURUM_MINI_MAX_AGE_MS || 36 * 60 * 60 * 1000);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { weekdayAgeMs } = require("../miniprogram/utils/action-freshness.js");
const PRODUCT = require("../miniprogram/config/product.js");

export function validBatchTime(value) {
  if (typeof value !== "string") return NaN;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return NaN;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (day.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}

export function checkMiniFreshness(snapshot, { dataMode = PRODUCT.dataMode, now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  const updatedAt = snapshot && snapshot.updatedAt;
  const age = now - validBatchTime(updatedAt);
  if (!Number.isFinite(age)) throw new Error("小程序随包快照缺少有效 updatedAt，拒绝上传");
  if (age < 0) throw new Error(`小程序随包快照时间在未来，拒绝上传：${updatedAt}`);
  if (dataMode !== "historical-reference" && weekdayAgeMs(updatedAt, now) > maxAgeMs) {
    throw new Error(
      `小程序随包快照距今 ${(age / 3_600_000).toFixed(1)} 小时，已超过 ${(maxAgeMs / 3_600_000).toFixed(0)} 个工作小时（updatedAt=${updatedAt}）。` +
        "请先运行 npm run sync:latest 再上传。",
    );
  }
  return `小程序随包${dataMode === "historical-reference" ? "历史批次日期" : "新鲜度"}检查通过：updatedAt=${updatedAt}，距今 ${(age / 3_600_000).toFixed(1)} 小时`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(checkMiniFreshness(require(path.join(root, "miniprogram/data/live-snapshot.js"))));
}
