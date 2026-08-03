/**
 * 构建四品类「公开策略证据」：
 * - 美股 / 黄金：拉取开源长期月度序列（可覆盖近百年及以上）
 * - 港股打新：使用 live-snapshot 中的 IPO 样本统计（事件研究，非百年组合）
 * - A股收息：A股市场约自 1990，无法做到 100 年；用当前样本结构 + 可复核口径说明
 *
 * 输出：data/strategy-evidence.json（并可由 sync:mini 带入小程序）
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "strategy-evidence.json");
const SNAPSHOT = path.join(root, "data", "live-snapshot.json");

const SPX_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500/master/data/data.csv";
const GOLD_URL = "https://raw.githubusercontent.com/datasets/gold-prices/master/data/monthly.csv";

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "aurumer-strategy-evidence/1.0" },
  });
  if (!response.ok) throw new Error(`fetch failed ${response.status} ${url}`);
  return response.text();
}

function parseCsv(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function yearlyFromMonthly(rows, dateIndex, priceIndex) {
  const byYear = new Map();
  for (const row of rows) {
    const date = row[dateIndex];
    const price = Number(row[priceIndex]);
    if (!date || !hasNumber(price) || price <= 0) continue;
    const year = Number(String(date).slice(0, 4));
    if (!Number.isFinite(year)) continue;
    byYear.set(year, price); // 取该年最后一个月收盘
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, close]) => ({ year, close }));
}

function summarizeAnnual(series, label, source, note) {
  if (series.length < 3) return null;
  const returns = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1].close;
    const next = series[i].close;
    if (prev > 0) returns.push((next / prev) - 1);
  }
  if (!returns.length) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sorted = returns.slice().sort((a, b) => a - b);
  const winRate = returns.filter((value) => value > 0).length / returns.length;
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const first = series[0];
  const last = series[series.length - 1];
  const years = last.year - first.year;
  const cagr = years > 0 ? ((last.close / first.close) ** (1 / years)) - 1 : null;

  // 简单「逢低观察」：当年跌超 15% 后，下一年收益均值（佐证观察区/分批思路，非买卖指令）
  const rebound = [];
  for (let i = 0; i < returns.length - 1; i += 1) {
    if (returns[i] <= -0.15) rebound.push(returns[i + 1]);
  }
  const reboundMean = rebound.length
    ? rebound.reduce((sum, value) => sum + value, 0) / rebound.length
    : null;

  // 近 100 年窗口（若序列更长则截取）
  const century = series.filter((row) => row.year >= last.year - 99);
  let centuryCagr = null;
  if (century.length >= 2) {
    const span = century[century.length - 1].year - century[0].year;
    if (span > 0) {
      centuryCagr = ((century[century.length - 1].close / century[0].close) ** (1 / span)) - 1;
    }
  }

  return {
    label,
    source,
    note,
    startYear: first.year,
    endYear: last.year,
    sampleYears: years,
    points: series.length,
    annualWinRate: Number((winRate * 100).toFixed(1)),
    averageAnnualReturn: Number((mean * 100).toFixed(2)),
    cagr: cagr == null ? null : Number((cagr * 100).toFixed(2)),
    centuryCagr: centuryCagr == null ? null : Number((centuryCagr * 100).toFixed(2)),
    bestYear: Number((best * 100).toFixed(1)),
    worstYear: Number((worst * 100).toFixed(1)),
    afterDeepDropNextYearAvg: reboundMean == null ? null : Number((reboundMean * 100).toFixed(2)),
    deepDropSamples: rebound.length,
  };
}

function hkEvidence(snapshot) {
  const backtest = snapshot?.hk?.backtest || {};
  const history = snapshot?.hk?.history || [];
  const recent = Array.isArray(backtest.recent) ? backtest.recent : history.slice(0, 12);
  const sourceName = typeof backtest.source === "string"
    ? backtest.source
    : (backtest.source?.name || "公开 IPO 结果整理");
  const win = Number(backtest.firstDayWinRate);
  return {
    label: "港股打新事件样本",
    source: sourceName,
    note: "打新是事件研究，不是百年组合回测；用来看「建议申购」样本的历史首日/暗盘分布。",
    startYear: null,
    endYear: null,
    sampleYears: null,
    points: Number(backtest.sampleCount || recent.length || 0),
    firstDayWinRate: hasNumber(win)
      ? Number((win <= 1 ? win * 100 : win).toFixed(1))
      : null,
    averageFirstDay: hasNumber(backtest.averageFirstDay)
      ? Number(Number(backtest.averageFirstDay).toFixed(2))
      : null,
    averageGreyMarket: hasNumber(backtest.averageGreyMarket)
      ? Number(Number(backtest.averageGreyMarket).toFixed(2))
      : null,
    recentCount: recent.length,
  };
}

function aShareEvidence(snapshot) {
  const quotes = snapshot?.aShare?.quotes || [];
  const yields = quotes
    .map((item) => Number(item.currentDividendYield))
    .filter((value) => Number.isFinite(value));
  const sustain = quotes
    .map((item) => Number(item.sustainableDividendYield))
    .filter((value) => Number.isFinite(value));
  const avg = (values) => (values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null);
  return {
    label: "A股收息公开样本",
    source: "腾讯行情 / 东方财富公开财务（当前快照）",
    note: "沪深市场约自 1990/1991，无法做到 100 年价格回测。以下为当前候选池股息与可持续股息结构，用于佐证「高股息+现金流」筛选，不是百年组合收益承诺。",
    marketStartYear: 1990,
    maxPossibleYears: new Date().getFullYear() - 1990,
    points: quotes.length,
    averageDividendYield: avg(yields) == null ? null : Number(avg(yields).toFixed(2)),
    averageSustainableYield: avg(sustain) == null ? null : Number(avg(sustain).toFixed(2)),
    highYieldCount: yields.filter((value) => value >= 4).length,
  };
}

const snapshot = JSON.parse(await readFile(SNAPSHOT, "utf8"));

const [spxText, goldText] = await Promise.all([fetchText(SPX_URL), fetchText(GOLD_URL)]);
const spxRows = parseCsv(spxText).slice(1);
const goldRows = parseCsv(goldText).slice(1);
const spxAnnual = yearlyFromMonthly(spxRows, 0, 1);
const goldAnnual = yearlyFromMonthly(goldRows, 0, 1);

const evidence = {
  updatedAt: new Date().toISOString(),
  disclaimer: "公开历史统计仅供研究参考，不构成买卖指令，也不承诺未来收益。各市场可回测年限不同，已在分项注明。",
  markets: {
    us: summarizeAnnual(
      spxAnnual,
      "美股宽基（标普500）长期年化",
      "datasets/s-and-p-500（Shiller 公开整理）",
      "用于佐证「长期持有优质公司/指数」与深跌后观察；个股路径会显著偏离指数。",
    ),
    gold: summarizeAnnual(
      goldAnnual,
      "国际金价长期年化",
      "datasets/gold-prices（LBMA/公开月度整理）",
      "用于佐证黄金作为长期资产的波动与深跌后回升样本；买卖观察区不是自动交易信号。",
    ),
    hk: hkEvidence(snapshot),
    a: aShareEvidence(snapshot),
  },
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const us = evidence.markets.us;
const gold = evidence.markets.gold;
console.log(`策略证据已写入 ${OUT}`);
console.log(`美股：${us?.startYear}-${us?.endYear}，近百年CAGR ${us?.centuryCagr}%`);
console.log(`黄金：${gold?.startYear}-${gold?.endYear}，近百年CAGR ${gold?.centuryCagr}%`);
console.log(`港股打新样本：${evidence.markets.hk.points}；A股说明：最长约 ${evidence.markets.a.maxPossibleYears} 年`);
