import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { SOURCE_REVISION } = require("../cloudfunctions/aurum-data/index.js");
const { sanitizeSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const localPath = path.join(root, "data", "live-snapshot.json");
const localSnapshot = JSON.parse(await readFile(localPath, "utf8"));
assert(localSnapshot.status === "live", "本地快照不是 live");
assert(Date.parse(localSnapshot.updatedAt), "本地快照缺少 updatedAt");

const sanitized = sanitizeSnapshot(localSnapshot);
const fund = (sanitized.us?.fundamentals || []).find((item) => item.symbol === "NVDA");
assert(fund && fund.amountUnit === "USD", "美股财务未标记 amountUnit=USD");
assert(Number(fund.operatingCashFlow) > 1e10, "NVDA 经营现金流仍像千美元未换算");
assert(Number(fund.liquidAssets) > 1e10, "NVDA 现金资产仍像千美元未换算");

const quote = (sanitized.aShare?.quotes || [])[0];
assert(!quote?.buyPrice && !quote?.recommendPrice && !quote?.safeMarginPrice, "A股静态动作价仍出现在清洗结果");
assert(!quote?.currentAdvice, "A股买入/持有/等待动作结论仍出现在清洗结果");

const miniPath = path.join(root, "miniprogram", "data", "live-snapshot.js");
const miniSnapshot = require(miniPath);
assert(miniSnapshot.updatedAt === localSnapshot.updatedAt, "小程序随包快照与本地 updatedAt 不一致");
const miniFund = (miniSnapshot.us?.fundamentals || []).find((item) => item.symbol === "NVDA");
assert(miniFund && miniFund.amountUnit === "USD", "小程序随包美股财务未规范化");
assert(Number(miniFund.operatingCashFlow) > 1e10, "小程序随包 NVDA 经营现金流未换算为基础美元");
const miniQuote = (miniSnapshot.aShare?.quotes || [])[0];
assert(!miniQuote?.buyPrice && !miniQuote?.currentAdvice, "小程序随包仍含 A 股静态动作价");

assert(typeof SOURCE_REVISION === "string" && SOURCE_REVISION.length > 0, "云函数缺少 SOURCE_REVISION");
assert(String(SOURCE_REVISION).includes("cache-first"), "云函数 revision 未切换到缓存优先版本");

let pagesNote = "Pages 未在线核对";
try {
  const pagesUrl = `https://devi-y.github.io/aurumer/data/live-snapshot.json?audit=${Date.now()}`;
  const pagesResponse = await fetch(pagesUrl, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(12_000),
  });
  if (pagesResponse.ok) {
    const pagesSnapshot = await pagesResponse.json();
    assert(pagesSnapshot.status === "live", "公开 Pages 快照不是 live");
    assert(pagesSnapshot.updatedAt === localSnapshot.updatedAt, "本地 data/live-snapshot.json 与 Pages updatedAt 不一致");
    pagesNote = `Pages updatedAt 一致=${pagesSnapshot.updatedAt}`;
  } else {
    pagesNote = `Pages HTTP ${pagesResponse.status}，已跳过在线核对`;
  }
} catch (error) {
  pagesNote = `Pages 暂不可达（${error.cause?.code || error.message}），已跳过在线核对`;
}

console.log(`发布一致性检查通过：本地/小程序 updatedAt=${localSnapshot.updatedAt}；${pagesNote}；云函数 revision=${SOURCE_REVISION}`);
