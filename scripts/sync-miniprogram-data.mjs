import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeDailyDigest } from "./build-daily-digest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "data", "live-snapshot.json");
const outputPath = path.join(root, "miniprogram", "data", "live-snapshot.js");
const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
const require = createRequire(import.meta.url);
const { sanitizeSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");
const publicSnapshot = sanitizeSnapshot(snapshot);

function slimForMiniProgram(data) {
  const next = structuredClone(data);
  // 保留全量交易日收盘点数（美股 60 日、A 股近 250 日、港股全量历史），不抽稀任何样本点；
  // 仅将 A 股日线 {date, close} 对象数组压为与美股一致的纯收盘价数值数组（首尾日期单存 historyRange），
  // 并裁去 2014 年以前的远古分红流水与小程序未读取的冗余文本字段，显著降低包体积与反序列化耗时。
  if (next.aShare && Array.isArray(next.aShare.quotes)) {
    next.aShare.quotes = next.aShare.quotes.map((quote) => {
      if (!quote || typeof quote !== "object") return quote;
      const {
        quoteNote,
        actionPriceNote,
        sustainableDividendYield,
        annualDividendPer100k,
        ...rest
      } = quote;
      if (Array.isArray(rest.history) && rest.history.length && typeof rest.history[0] === "object") {
        const validRows = rest.history.filter((r) => r && Number.isFinite(Number(r.close)) && Number(r.close) > 0);
        if (validRows.length) {
          rest.historyRange = [String(validRows[0].date || ""), String(validRows[validRows.length - 1].date || "")];
          rest.history = validRows.map((r) => Number(r.close));
        }
      }
      return rest;
    });
  }
  if (next.aShare && Array.isArray(next.aShare.fundamentals)) {
    next.aShare.fundamentals = next.aShare.fundamentals.map((fund) => {
      if (!fund || typeof fund !== "object" || !Array.isArray(fund.dividendHistory)) return fund;
      const trimmedHistory = fund.dividendHistory
        .filter((yr) => {
          const yNum = Number(yr && yr.year);
          return !Number.isFinite(yNum) || yNum >= 2014;
        })
        .map((yr) => ({
          year: yr.year,
          distributions: Array.isArray(yr.distributions)
            ? yr.distributions.map((d) => {
                if (!d || typeof d !== "object") return d;
                const slimDist = {
                  reportBasis: d.reportBasis,
                  exDividendDate: d.exDividendDate,
                  perTenSharesRmb: d.perTenSharesRmb,
                  plan: d.plan,
                };
                if (d.status) slimDist.status = d.status;
                if (d.implementationStatus) slimDist.implementationStatus = d.implementationStatus;
                if (d.dividendType) slimDist.dividendType = d.dividendType;
                if (d.noticeDate) slimDist.noticeDate = d.noticeDate;
                return slimDist;
              })
            : [],
        }));
      return { ...fund, dividendHistory: trimmedHistory };
    });
  }
  return next;
}

const slimSnapshot = slimForMiniProgram(publicSnapshot);

// 网页复用同一份时效规则，避免只更新生成时间就把旧行情重新变成当前动作。
const freshnessModule = await readFile(path.join(root, "miniprogram/utils/action-freshness.js"), "utf8");
await writeFile(path.join(root, "assets/action-freshness.js"),
  `// Generated from miniprogram/utils/action-freshness.js.\n(function () {\n${freshnessModule.replace("module.exports =", "globalThis.AurumFreshness =")}\n})();\n`);

const eventFactsModule = await readFile(path.join(root, "miniprogram/utils/us-event-facts.js"), "utf8");
await writeFile(path.join(root, "assets/us-event-facts.js"),
  `// Generated from miniprogram/utils/us-event-facts.js.\n(function () {\n${eventFactsModule.replace("module.exports =", "globalThis.AurumEventFacts =")}\n})();\n`);
await writeFile(path.join(root, "cloudfunctions/aurum-data/us-event-facts.js"), eventFactsModule);

const hkDatesModule = await readFile(path.join(root, "miniprogram/utils/hk-date-state.js"), "utf8");
await writeFile(path.join(root, "assets/hk-date-state.js"),
  `// Generated from miniprogram/utils/hk-date-state.js.\n(function () {\n${hkDatesModule.replace("module.exports =", "globalThis.AurumHKDates =")}\n})();\n`);

try {
  // 打包只读已发布批次与已保存资料，不再临时抓取盘中行情。
  const sleeve = JSON.parse(await readFile(path.join(root, "data/sleeve-quotes.json"), "utf8"));
  if (sleeve.quotes.length) {
    const slimSleeves = sleeve.quotes.map((q) => ({
      symbol: q.symbol,
      name: q.name,
      price: q.price,
      changePercent: q.changePercent,
      dividendYield: q.dividendYield,
      asOf: q.asOf,
      history: Array.isArray(q.history)
        ? q.history.map((h) => Number(h?.close ?? h)).filter((v) => Number.isFinite(v) && v > 0)
        : [],
    }));
    slimSnapshot.us = { ...slimSnapshot.us, sleeveQuotes: slimSleeves };
    console.log(`底仓 ETF 行情已并入小程序：${sleeve.quotes.map((item) => `${item.symbol} $${Number(item.price).toFixed(2)}`).join(" · ")}`);
  }
} catch (error) {
  console.warn(`底仓 ETF 行情未同步：${error.message}`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// Generated by scripts/sync-miniprogram-data.mjs. Do not edit manually.\nmodule.exports = ${JSON.stringify(slimSnapshot)};\n`,
);

try {
  const evidencePath = path.join(root, "data", "strategy-evidence.json");
  const evidenceOut = path.join(root, "miniprogram", "data", "strategy-evidence.js");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  await writeFile(
    evidenceOut,
    `// Generated by scripts/sync-miniprogram-data.mjs from data/strategy-evidence.json.\nmodule.exports = ${JSON.stringify(evidence)};\n`,
  );
  console.log(`策略证据已同步到小程序：${evidence.updatedAt}`);
} catch (error) {
  console.warn(`策略证据未同步（可先 npm run build:evidence）：${error.message}`);
}

const digest = await writeDailyDigest(slimSnapshot);
const bytes = Buffer.byteLength(JSON.stringify(slimSnapshot), "utf8");
const aShareHistoryMin = Math.min(...(slimSnapshot.aShare?.quotes || []).map((q) => q.history?.length || 0));
const hkHistoryCount = slimSnapshot.hk?.history?.length || 0;
console.log(`小程序离线快照已同步：${slimSnapshot.updatedAt}（约 ${Math.round(bytes / 1024)} KB，A股日线≥${aShareHistoryMin}日、港股历史${hkHistoryCount}只，全量不抽稀）`);
console.log(`今日答案摘要已同步：港${digest.markets.hk.length} / 美${digest.markets.us.length} / A${digest.markets.a.length} / 金${digest.markets.gold.length} / 机构${digest.markets.guru.length} 问`);
