import { isDeepStrictEqual } from "node:util";
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
assert(["live", "partial"].includes(localSnapshot.status), "本地快照状态不可用");
assert(Date.parse(localSnapshot.updatedAt), "本地快照缺少 updatedAt");

const sanitized = sanitizeSnapshot(localSnapshot);
const fund = (sanitized.us?.fundamentals || []).find((item) => item.symbol === "NVDA");
assert(fund && fund.amountUnit === "USD", "美股财务未标记 amountUnit=USD");
assert(Number(fund.operatingCashFlow) > 1e10, "NVDA 经营现金流仍像千美元未换算");
assert(Number(fund.liquidAssets) > 1e10, "NVDA 现金资产仍像千美元未换算");

const quote = (sanitized.aShare?.quotes || [])[0];
assert(!quote?.buyPrice && !quote?.recommendPrice && !quote?.safeMarginPrice, "A股静态动作价仍出现在清洗结果");
assert(
  !quote?.currentAdvice
  || quote.currentAdvice === "数据过期，暂不提供动作",
  "A股买入/持有/等待动作结论仍出现在清洗结果",
);

const miniPath = path.join(root, "miniprogram", "data", "live-snapshot.js");
const miniSnapshot = require(miniPath);
assert(miniSnapshot.updatedAt === localSnapshot.updatedAt, "小程序随包快照与本地 updatedAt 不一致");
assert((miniSnapshot.revisionAt || null) === (localSnapshot.revisionAt || null), "小程序内容修订版本与本地不一致");
for (const [label, actual, expected] of [
  ["港股日期", miniSnapshot.hk, sanitized.hk],
  ["SEC公告", miniSnapshot.us?.filings, sanitized.us?.filings],
  ["SEC核验范围", miniSnapshot.us?.filingCoverage, sanitized.us?.filingCoverage],
  ["SEC公司事件", miniSnapshot.us?.eventFacts, sanitized.us?.eventFacts],
  ["黄金历史", miniSnapshot.gold?.history, sanitized.gold?.history],
]) assert(isDeepStrictEqual(actual, expected), `小程序随包${label}与本地事实不一致`);
const miniFund = (miniSnapshot.us?.fundamentals || []).find((item) => item.symbol === "NVDA");
assert(miniFund && miniFund.amountUnit === "USD", "小程序随包美股财务未规范化");
assert(Number(miniFund.operatingCashFlow) > 1e10, "小程序随包 NVDA 经营现金流未换算为基础美元");
const miniQuote = (miniSnapshot.aShare?.quotes || [])[0];
assert(
  !miniQuote?.buyPrice
  && (!miniQuote?.currentAdvice || miniQuote.currentAdvice === "数据过期，暂不提供动作"),
  "小程序随包仍含 A 股静态动作价",
);

assert(typeof SOURCE_REVISION === "string" && SOURCE_REVISION.length > 0, "云函数缺少 SOURCE_REVISION");
assert(
  String(SOURCE_REVISION).includes("action-freshness")
  || String(SOURCE_REVISION).includes("cache-first")
  || String(SOURCE_REVISION).includes("2026"),
  "云函数 revision 未切换到动作新鲜度/缓存优先版本",
);

let pagesNote = "线上未核对（仅本地模式）";
if (!process.argv.includes("--local")) {
  const pagesUrl = `https://devi-y.github.io/aurumer/data/live-snapshot.json?audit=${Date.now()}`;
  const pagesResponse = await fetch(pagesUrl, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(12_000),
  });
  assert(pagesResponse.ok, `公开 Pages 返回 HTTP ${pagesResponse.status}，未通过线上核对`);
  const pagesSnapshot = await pagesResponse.json();
  assert(["live", "partial"].includes(pagesSnapshot.status), "公开 Pages 快照状态不可用");
  assert(pagesSnapshot.updatedAt === localSnapshot.updatedAt,
    `线上与本地不同步：Pages=${pagesSnapshot.updatedAt}，本地=${localSnapshot.updatedAt}`);
  assert(pagesSnapshot.status === localSnapshot.status, "线上与本地的数据状态不一致");
  assert(isDeepStrictEqual(pagesSnapshot, localSnapshot), "线上与本地快照内容不一致，即使更新时间相同也不能通过发布核对");
  pagesNote = `Pages updatedAt 一致=${pagesSnapshot.updatedAt}`;
}
console.log(`本地/小程序一致性检查通过：updatedAt=${localSnapshot.updatedAt}；${pagesNote}；本地云函数 revision=${SOURCE_REVISION}（不代表已部署）`);
