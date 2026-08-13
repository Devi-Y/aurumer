/**
 * 用与小程序相同的今日答案模块，生成网页可读取的公开摘要。
 * 没有已验证数据时保持空白，不补虚拟标的或假价格。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const FALLBACK_HREF = {
  hk: "#/hk",
  us: "#/us",
  a: "#/a-shares",
  gold: "#/gold",
  guru: "#/gurus",
};

const GROUP_HREF = {
  hk: {
    worth: "#/hk/buy",
    caution: "#/hk/caution",
    avoid: "#/hk/skip",
    cancelled: "#/hk/skip",
    ended: "#/hk/ended",
    leverage: "#/hk/buy",
  },
  us: {
    cheap7: "#/us/seven",
    risk7: "#/us/seven",
    hold7: "#/us/seven",
    seven: "#/us/seven",
    industry: "#/us",
    hot: "#/us/hot",
  },
  a: {
    core: "#/a-shares/buy",
    cycle: "#/a-shares/wait",
    add: "#/a-shares/buy",
    trim: "#/a-shares/avoid",
  },
};

function spaHref(market, card) {
  if (market === "gold") return "#/gold/answer";
  if (market === "guru" && card?.targetId) return `#/investor/${card.targetId}`;
  if (card?.action === "detail" && card.targetId) {
    if (market === "hk") return `#/ipo/${card.targetId}`;
    if (market === "us") return `#/stock/${card.targetId}`;
    if (market === "a") return `#/a-share/${card.targetId}`;
  }
  if (card?.group && GROUP_HREF[market]?.[card.group]) return GROUP_HREF[market][card.group];
  if (card?.targetId) {
    if (market === "hk") return `#/ipo/${card.targetId}`;
    if (market === "us") return `#/stock/${card.targetId}`;
    if (market === "a") return `#/a-share/${card.targetId}`;
  }
  return FALLBACK_HREF[market] || "#/";
}

function publicCard(market, card) {
  const href = spaHref(market, card);
  return {
    id: card.id,
    question: card.question,
    answer: card.answer,
    names: card.names || "",
    tone: card.tone || "wait",
    enabled: Boolean(card.enabled),
    hint: card.hint || "",
    href,
    dailyHref: `index.html${href}`,
  };
}

export function buildDailyDigestDocument(snapshot) {
  const { buildDailyAnswers, buildHomeDigest } = require("../miniprogram/utils/daily-answers.js");
  const home = buildHomeDigest(snapshot);
  const markets = {};
  for (const market of ["hk", "us", "a", "gold", "guru"]) {
    markets[market] = buildDailyAnswers(snapshot, market).map((card) => publicCard(market, card));
  }
  return {
    updatedAt: snapshot.updatedAt || null,
    status: snapshot.status || "live",
    markets,
    home: {
      points: home.points,
      cardLines: home.cardLines,
      help: home.help,
    },
  };
}

export async function writeDailyDigest(snapshot, outputPath = path.join(root, "data", "daily-digest.json")) {
  const digest = buildDailyDigestDocument(snapshot);
  await writeFile(outputPath, `${JSON.stringify(digest)}\n`);
  return digest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let snapshot;
  try {
    snapshot = require("../miniprogram/data/live-snapshot.js");
  } catch {
    snapshot = JSON.parse(await readFile(path.join(root, "data", "live-snapshot.json"), "utf8"));
  }
  const digest = await writeDailyDigest(snapshot);
  const hk = digest.markets.hk.length;
  const us = digest.markets.us.length;
  console.log(`今日答案摘要已写入 data/daily-digest.json：${digest.updatedAt}（港${hk}/美${us}问）`);
}
