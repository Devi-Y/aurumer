import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 随包离线数据是打包时冻结的。上传开发版时若距上次公开刷新超过这个窗口，
// 用户首次打开/断网/云函数回源失败时就会看到过期结论。
// 公开刷新每天两趟（约 09:30 / 16:30），36 小时覆盖周末与单次失败保底。
const MAX_AGE_MS = Number(process.env.AURUM_MINI_MAX_AGE_MS || 36 * 60 * 60 * 1000);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const snapshot = require(path.join(root, "miniprogram/data/live-snapshot.js"));

const updatedAt = snapshot && snapshot.updatedAt;
const age = Date.now() - Date.parse(updatedAt);
if (!updatedAt || Number.isNaN(age)) {
  throw new Error("小程序随包快照缺少有效 updatedAt，拒绝上传");
}
if (age > MAX_AGE_MS) {
  const hours = (age / 3_600_000).toFixed(1);
  const limitHours = (MAX_AGE_MS / 3_600_000).toFixed(0);
  throw new Error(
    `小程序随包快照已过期 ${hours} 小时（上限 ${limitHours} 小时，updatedAt=${updatedAt}）。` +
      `请先运行 npm run sync:latest 再上传。`,
  );
}

console.log(
  `小程序随包新鲜度检查通过：updatedAt=${updatedAt}，距今 ${(age / 3_600_000).toFixed(1)} 小时`,
);
