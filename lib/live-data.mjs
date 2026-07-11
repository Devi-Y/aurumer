import pdfParse from "pdf-parse/lib/pdf-parse.js";
import OpenCC from "opencc-js";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const hkToSimplified = OpenCC.Converter({ from: "hk", to: "cn" });

const USER_AGENT =
  process.env.DATA_USER_AGENT ||
  "Wangchao market research prototype contact: data@wangchao.local";

const US_SYMBOLS = [
  "NVDA",
  "MSFT",
  "AAPL",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
  "AMD",
  "AVGO",
  "PLTR",
  "SMCI",
  "ARM",
  "TSM",
  "ASML",
  "COIN",
  "MSTR",
  "CRWD",
  "NOW",
  "V",
  "MA",
  "NFLX",
  "ORCL",
  "CRM",
  "SNOW",
  "SHOP",
  "UBER",
  "JPM",
  "BRK.B",
  "LLY",
  "COST",
];

const YAHOO_SYMBOLS = {
  "BRK.B": "BRK-B",
};

const NASDAQ_SYMBOLS = {
  "BRK.B": "BRK.A",
};

const US_QUALITY_THRESHOLDS = {
  liquidAssets: 20_000_000,
  netIncome: 5_000_000,
  profitMargin: 15,
  revenueGrowth: 20,
};

const MANAGERS = [
  { id: "buffett", cik: "0001067983", name: "Berkshire Hathaway" },
  { id: "ackman", cik: "0001336528", name: "Pershing Square" },
  { id: "burry", cik: "0001649339", name: "Scion Asset Management" },
  { id: "wood", cik: "0001697748", name: "ARK Investment Management" },
  { id: "lilu", cik: "0001709323", name: "Himalaya Capital Management" },
  { id: "druckenmiller", cik: "0001536411", name: "Duquesne Family Office" },
  { id: "dalio", cik: "0001350694", name: "Bridgewater Associates" },
  { id: "munger", cik: "0000783412", name: "Daily Journal Corporation" },
  { id: "leopold", cik: "0002045724", name: "Situational Awareness LP" },
];

const CUSIP_TICKERS = {
  "007903107": "AMD",
  "01609W102": "BABA",
  "02079K107": "GOOG",
  "02079K305": "GOOGL",
  "023135106": "AMZN",
  "025816109": "AXP",
  "037833100": "AAPL",
  "060505104": "BAC",
  "093712107": "BE",
  "11135F101": "AVGO",
  "11271J107": "BN",
  "166764100": "CVX",
  "169656105": "CMG",
  "171232101": "CB",
  "191216100": "KO",
  "19260Q107": "COIN",
  "23918K108": "DVA",
  "30303M102": "META",
  "43300A203": "HLT",
  "44267T102": "HHH",
  "47215P106": "JD",
  "500754106": "KHC",
  "57636Q104": "MA",
  "594918104": "MSFT",
  "595112103": "MU",
  "615369105": "MCO",
  "654106103": "NKE",
  "67066G104": "NVDA",
  "674599105": "OXY",
  "68389X105": "ORCL",
  "69608A108": "PLTR",
  "697435105": "PANW",
  "76131D103": "QSR",
  "770700102": "HOOD",
  "771049103": "RBLX",
  "77543R102": "ROKU",
  "874039100": "TSM",
  "88160R101": "TSLA",
  "90353T100": "UBER",
  "907818108": "UNP",
  "92826C839": "V",
  "92840M102": "VST",
  "21873S108": "CRWV",
  "21874A106": "CORZ",
  "80004C200": "SNDK",
  "92189F676": "SMH",
  N07059210: "ASML",
  Q4982L109: "IREN",
};

const SOURCE_URLS = {
  hkex:
    "https://www2.hkexnews.hk/new-listings/new-listing-information/main-board?sc_lang=zh-HK",
  hkexSchedule:
    "https://www.hkex.com.hk/Services/Trading/Securities/Trading-News/Newly-Listed-Securities?sc_lang=en",
  sec: "https://data.sec.gov/submissions/",
  yahoo: "https://query1.finance.yahoo.com/v8/finance/chart/",
  nasdaq: "https://api.nasdaq.com/api/",
  ipoHistory: "https://xiatou.ai/ipos",
  eastmoneyHistory:
    "https://push2his.eastmoney.com/api/qt/stock/kline/get",
  tencentHistory:
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
};

const TRADITIONAL_TO_SIMPLIFIED = {
  亞: "亚",
  億: "亿",
  優: "优",
  價: "价",
  儲: "储",
  參: "参",
  務: "务",
  區: "区",
  國: "国",
  團: "团",
  報: "报",
  實: "实",
  將: "将",
  專: "专",
  對: "对",
  導: "导",
  廣: "广",
  後: "后",
  戶: "户",
  擬: "拟",
  據: "据",
  發: "发",
  東: "东",
  業: "业",
  標: "标",
  機: "机",
  歸: "归",
  歷: "历",
  濱: "滨",
  華: "华",
  計: "计",
  賽: "赛",
  馳: "驰",
  興: "兴",
  為: "为",
  環: "环",
  產: "产",
  當: "当",
  穩: "稳",
  結: "结",
  經: "经",
  聯: "联",
  脈: "脉",
  臺: "台",
  萬: "万",
  號: "号",
  認: "认",
  記: "记",
  設: "设",
  請: "请",
  術: "术",
  訊: "讯",
  與: "与",
  薦: "荐",
  證: "证",
  資: "资",
  購: "购",
  載: "载",
  進: "进",
  遞: "递",
  過: "过",
  醫: "医",
  開: "开",
  關: "关",
  閣: "阁",
  際: "际",
  雲: "云",
  電: "电",
  們: "们",
  佔: "占",
  幣: "币",
  總: "总",
  詳: "详",
  約: "约",
  額: "额",
  稱: "称",
  頁: "页",
  預: "预",
  須: "须",
  應: "应",
  數: "数",
  辦: "办",
  買: "买",
  賣: "卖",
  類: "类",
  駕: "驾",
  體: "体",
  齊: "齐",
  龍: "龙",
};

function toSimplifiedChinese(value) {
  return [...hkToSimplified(value)]
    .map((character) => TRADITIONAL_TO_SIMPLIFIED[character] || character)
    .join("");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(value >= 100 ? 1 : 2));
}

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchResponse(url, options = {}) {
  const timeoutMs = options.timeoutMs || 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": USER_AGENT,
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  return (await fetchResponse(url, options)).json();
}

async function fetchText(url, options) {
  return (await fetchResponse(url, options)).text();
}

async function fetchBuffer(url, options) {
  return Buffer.from(await (await fetchResponse(url, options)).arrayBuffer());
}

async function extractPdfText(buffer, maxPages = 18) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "wangchao-pdf-"));
  const pdfPath = join(tempDirectory, "document.pdf");
  try {
    await writeFile(pdfPath, buffer);
    const pageArguments = Number.isFinite(maxPages)
      ? ["-f", "1", "-l", String(maxPages)]
      : [];
    const { stdout } = await execFileAsync(
      "pdftotext",
      [...pageArguments, "-layout", "-enc", "UTF-8", pdfPath, "-"],
      { maxBuffer: 32 * 1024 * 1024, timeout: 45_000 },
    );
    return stdout;
  } catch {
    const parsed = await pdfParse(
      buffer,
      Number.isFinite(maxPages) ? { max: maxPages } : undefined,
    );
    return parsed.text || "";
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

function calculateTechnicalPlan(result) {
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const rows = closes
    .map((close, index) => ({
      close,
      high: highs[index],
      low: lows[index],
    }))
    .filter(
      (row) =>
        Number.isFinite(row.close) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low),
    );

  const recent = rows.slice(-20);
  if (recent.length < 5) return null;

  const trueRanges = recent.slice(1).map((row, index) => {
    const previousClose = recent[index].close;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    );
  });
  const atr =
    trueRanges.reduce((sum, value) => sum + value, 0) /
    Math.max(trueRanges.length, 1);
  const price = recent.at(-1).close;
  const support = Math.min(...recent.slice(-10).map((row) => row.low));
  const buy = Math.min(price - atr * 0.55, support + atr * 0.35);

  return {
    atr: roundPrice(atr),
    buy: roundPrice(buy),
    stop: roundPrice(support - atr * 0.8),
    tp: [
      roundPrice(price + atr * 2),
      roundPrice(price + atr * 3.2),
    ],
  };
}

async function fetchYahooChart(symbol, range = "6mo") {
  const querySymbol = YAHOO_SYMBOLS[symbol] || symbol;
  const url = `${SOURCE_URLS.yahoo}${encodeURIComponent(
    querySymbol,
  )}?range=${range}&interval=1d&events=div%2Csplits`;
  const payload = await fetchJson(url, { timeoutMs: 10_000 });
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(payload.chart?.error?.description || "No data");

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const history = (quote.close || [])
    .map((close, index) => ({
      close,
      high: quote.high?.[index],
      low: quote.low?.[index],
      time: timestamps[index],
    }))
    .filter((row) => Number.isFinite(row.close));
  const price =
    result.meta?.regularMarketPrice ?? history.at(-1)?.close ?? null;
  const previousClose =
    result.meta?.regularMarketPreviousClose ??
    history.at(-2)?.close ??
    result.meta?.chartPreviousClose ??
    null;
  const changePercent =
    Number.isFinite(price) && Number.isFinite(previousClose)
      ? ((price - previousClose) / previousClose) * 100
      : null;
  const recentVolumes = (quote.volume || [])
    .filter(Number.isFinite)
    .slice(-21);
  const currentVolume = recentVolumes.at(-1) || null;
  const averageVolume = recentVolumes.length > 1
    ? recentVolumes
        .slice(0, -1)
        .reduce((sum, value) => sum + value, 0) /
      (recentVolumes.length - 1)
    : null;
  const volumeRatio =
    Number.isFinite(currentVolume) &&
    Number.isFinite(averageVolume) &&
    averageVolume > 0
      ? currentVolume / averageVolume
      : null;
  const weekStart = history.at(-6)?.close;
  const weeklyChange =
    Number.isFinite(price) && Number.isFinite(weekStart)
      ? ((price - weekStart) / weekStart) * 100
      : null;
  const heatScore = Math.round(
    clamp(
      (volumeRatio || 1) * 35 +
        Math.abs(changePercent || 0) * 6 +
        Math.abs(weeklyChange || 0) * 2,
      0,
      100,
    ),
  );

  return {
    symbol,
    price: roundPrice(price),
    changePercent:
      changePercent === null ? null : Number(changePercent.toFixed(2)),
    weeklyChange:
      weeklyChange === null ? null : Number(weeklyChange.toFixed(2)),
    volumeRatio:
      volumeRatio === null ? null : Number(volumeRatio.toFixed(2)),
    heatScore,
    currency: result.meta?.currency || "USD",
    exchange: result.meta?.fullExchangeName || result.meta?.exchangeName,
    marketState: result.meta?.marketState || "CLOSED",
    asOf: result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString()
      : null,
    history: history.slice(-60).map((row) => roundPrice(row.close)),
    technicalPlan: calculateTechnicalPlan(result),
  };
}

function parseNasdaqNumber(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const negative = value.includes("(") && value.includes(")");
  const parsed = Number(value.replace(/[$,%(),]/g, "").trim());
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function nasdaqRow(table, label) {
  return table?.rows?.find((row) => row.value1 === label) || null;
}

function rowValues(row) {
  return ["value2", "value3", "value4", "value5"]
    .map((key) => parseNasdaqNumber(row?.[key]))
    .filter(Number.isFinite);
}

async function fetchNasdaqFundamentals(symbol, quote) {
  const querySymbol = NASDAQ_SYMBOLS[symbol] || symbol;
  const headers = {
    Accept: "application/json, text/plain, */*",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  };
  const [financialPayload, summaryPayload] = await Promise.all([
    fetchJson(
      `${SOURCE_URLS.nasdaq}company/${encodeURIComponent(
        querySymbol,
      )}/financials?frequency=1`,
      { headers, timeoutMs: 15_000 },
    ),
    fetchJson(
      `${SOURCE_URLS.nasdaq}quote/${encodeURIComponent(
        querySymbol,
      )}/summary?assetclass=stocks`,
      { headers, timeoutMs: 15_000 },
    ),
  ]);
  const financials = financialPayload.data;
  const summary = summaryPayload.data?.summaryData;
  if (!financials) throw new Error("Nasdaq financials unavailable");

  const revenueHistory = rowValues(
    nasdaqRow(financials.incomeStatementTable, "Total Revenue"),
  );
  const netIncomeHistory = rowValues(
    nasdaqRow(financials.incomeStatementTable, "Net Income"),
  );
  const grossProfitHistory = rowValues(
    nasdaqRow(financials.incomeStatementTable, "Gross Profit"),
  );
  const cashFlowHistory = rowValues(
    nasdaqRow(financials.cashFlowTable, "Net Cash Flow-Operating"),
  );
  const cashAndEquivalentsHistory = rowValues(
    nasdaqRow(financials.balanceSheetTable, "Cash and Cash Equivalents"),
  );
  const shortTermInvestmentsHistory = rowValues(
    nasdaqRow(financials.balanceSheetTable, "Short-Term Investments"),
  );
  const capexHistory = rowValues(
    nasdaqRow(financials.cashFlowTable, "Capital Expenditures"),
  );
  const grossMarginValues = rowValues(
    nasdaqRow(financials.financialRatiosTable, "Gross Margin"),
  );
  const profitMarginValues = rowValues(
    nasdaqRow(financials.financialRatiosTable, "Profit Margin"),
  );
  const roeValues = rowValues(
    nasdaqRow(financials.financialRatiosTable, "After Tax ROE"),
  );

  const revenueGrowth =
    revenueHistory.length > 1 && revenueHistory[1] !== 0
      ? ((revenueHistory[0] - revenueHistory[1]) / Math.abs(revenueHistory[1])) *
        100
      : null;
  const grossMargin =
    grossMarginValues[0] ??
    (revenueHistory[0] && grossProfitHistory[0]
      ? (grossProfitHistory[0] / revenueHistory[0]) * 100
      : null);
  const profitMargin =
    profitMarginValues[0] ??
    (revenueHistory[0] && netIncomeHistory[0]
      ? (netIncomeHistory[0] / revenueHistory[0]) * 100
      : null);
  const roe = roeValues[0] ?? null;
  const marketCap = parseNasdaqNumber(summary?.MarketCap?.value);
  const netIncome = netIncomeHistory[0];
  const pe =
    Number.isFinite(marketCap) &&
    Number.isFinite(netIncome) &&
    netIncome > 0
      ? marketCap / (netIncome * 1000)
      : null;
  const targetPrice = parseNasdaqNumber(summary?.OneYrTarget?.value);
  const targetUpside =
    Number.isFinite(targetPrice) && Number.isFinite(quote?.price)
      ? ((targetPrice - quote.price) / quote.price) * 100
      : null;
  const cashAndEquivalents = cashAndEquivalentsHistory[0] ?? null;
  const shortTermInvestments = shortTermInvestmentsHistory[0] ?? 0;
  const liquidAssets = Number.isFinite(cashAndEquivalents)
    ? cashAndEquivalents + shortTermInvestments
    : null;
  const qualityCriteria = {
    cashRich:
      Number.isFinite(liquidAssets) &&
      liquidAssets >= US_QUALITY_THRESHOLDS.liquidAssets,
    highProfit:
      Number.isFinite(netIncome) &&
      netIncome > 0 &&
      (netIncome >= US_QUALITY_THRESHOLDS.netIncome ||
        profitMargin >= US_QUALITY_THRESHOLDS.profitMargin),
    highGrowth:
      Number.isFinite(revenueGrowth) &&
      revenueGrowth >= US_QUALITY_THRESHOLDS.revenueGrowth,
  };
  const qualityMatchCount = Object.values(qualityCriteria).filter(Boolean).length;
  const growthScore = Math.round(
    clamp(50 + (revenueGrowth || 0) * 1.4, 0, 100),
  );
  const profitScore = Math.round(
    clamp(
      35 +
        (profitMargin || 0) * 1.2 +
        (roe || 0) * 0.35 +
        (cashFlowHistory[0] > 0 ? 10 : 0),
      0,
      100,
    ),
  );
  const valueScore = Math.round(
    clamp(
      Number.isFinite(pe)
        ? 92 - Math.max(pe - 12, 0) * 1.35 + (targetUpside || 0) * 0.35
        : 50 + (targetUpside || 0) * 0.5,
      0,
      100,
    ),
  );
  const finalScore = Math.round(
    profitScore * 0.4 + growthScore * 0.3 + valueScore * 0.3,
  );

  return {
    symbol,
    period:
      financials.incomeStatementTable?.headers?.value2 || "最近财年",
    revenueGrowth:
      revenueGrowth === null ? null : Number(revenueGrowth.toFixed(1)),
    grossMargin:
      grossMargin === null ? null : Number(grossMargin.toFixed(1)),
    profitMargin:
      profitMargin === null ? null : Number(profitMargin.toFixed(1)),
    roe: roe === null ? null : Number(roe.toFixed(1)),
    operatingCashFlow: cashFlowHistory[0] || null,
    capitalExpenditures: capexHistory[0] || null,
    cashAndEquivalents,
    shortTermInvestments,
    liquidAssets,
    netIncome,
    marketCap,
    pe: pe === null ? null : Number(pe.toFixed(1)),
    targetPrice,
    targetUpside:
      targetUpside === null ? null : Number(targetUpside.toFixed(1)),
    revenueHistory,
    netIncomeHistory,
    growthScore,
    profitScore,
    valueScore,
    finalScore,
    qualityCriteria,
    qualityMatchCount,
    qualityEligible: qualityMatchCount >= 2,
    qualityThresholds: US_QUALITY_THRESHOLDS,
  };
}

let fundamentalsCache = null;
let fundamentalsCacheAt = 0;

async function fetchNasdaqFundamentalSet(quotes) {
  if (
    fundamentalsCache &&
    Date.now() - fundamentalsCacheAt < 12 * 60 * 60 * 1000
  ) {
    return fundamentalsCache;
  }

  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const fundamentals = [];
  for (let index = 0; index < US_SYMBOLS.length; index += 5) {
    const batch = US_SYMBOLS.slice(index, index + 5);
    const settled = await Promise.allSettled(
      batch.map((symbol) =>
        fetchNasdaqFundamentals(symbol, quoteMap.get(symbol)),
      ),
    );
    fundamentals.push(
      ...settled
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value),
    );
  }
  fundamentalsCache = fundamentals;
  fundamentalsCacheAt = Date.now();
  return fundamentals;
}

function calculateUSMarketTemperature(spy, vix) {
  if (!spy?.history?.length || !Number.isFinite(vix?.price)) return null;

  const recent = spy.history.slice(-200);
  const average =
    recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const trend = ((spy.price - average) / average) * 100;
  const value = Math.round(
    clamp(50 + trend * 1.8 + (20 - vix.price) * 1.35, 5, 95),
  );
  const label =
    value >= 75
      ? "偏热"
      : value >= 60
        ? "偏乐观"
        : value >= 40
          ? "中性"
          : value >= 25
            ? "偏谨慎"
            : "恐慌";

  return {
    value,
    label,
    hint: `VIX ${vix.price}，标普500相对近${recent.length}日均线 ${
      trend >= 0 ? "+" : ""
    }${trend.toFixed(1)}%——该温度由真实行情计算，不是官方指数`,
  };
}

async function fetchUSMarketData() {
  const symbols = [...US_SYMBOLS, "SPY", "^VIX"];
  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchYahooChart(symbol)),
  );
  const rows = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failedSymbols = settled
    .map((result, index) =>
      result.status === "rejected" ? symbols[index] : null,
    )
    .filter(Boolean);
  if (failedSymbols.length) {
    const retried = await Promise.allSettled(
      failedSymbols.map((symbol) => fetchYahooChart(symbol)),
    );
    rows.push(
      ...retried
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value),
    );
  }
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const stocks = US_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter(
    Boolean,
  );

  if (!stocks.length) throw new Error("No US quote returned");
  const fundamentals = await fetchNasdaqFundamentalSet(stocks);

  return {
    stocks,
    fundamentals,
    temperature: calculateUSMarketTemperature(
      bySymbol.get("SPY"),
      bySymbol.get("^VIX"),
    ),
  };
}

function parseHKEXSchedule(html) {
  const schedule = new Map();
  const bodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodyMatch) return schedule;

  for (const rowMatch of bodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => decodeHtml(match[1]),
    );
    if (cells.length < 4 || !/^\d{5}$/.test(cells[2])) continue;

    schedule.set(cells[2], {
      listingDate: cells[0].replace("*", "").trim(),
      shortName: toSimplifiedChinese(cells[1]),
      boardLot: cells[3],
      action: cells.at(-2) || cells.at(-1) || "",
    });
  }

  return schedule;
}

function parseHKEXNewListings(html, schedule) {
  const bodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodyMatch) throw new Error("HKEX listing table not found");

  const listings = [];
  for (const rowMatch of bodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rawCells = [
      ...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((match) => match[1]);
    if (rawCells.length < 5) continue;

    const code = decodeHtml(rawCells[0]).padStart(5, "0");
    const name = toSimplifiedChinese(decodeHtml(rawCells[1]));
    if (!/^\d{5}$/.test(code) || !name) continue;

    const cellLinks = rawCells.map((cell) => [
      ...cell.matchAll(/href="([^"]+)"/gi),
    ].map((match) => match[1]));
    const announcementUrl = cellLinks[2]?.[0] || null;
    const prospectusUrl = cellLinks[3]?.[0] || null;
    const allotmentUrl = cellLinks[4]?.[0] || null;
    const calendar = schedule.get(code);
    listings.push({
      id: `hk-${code}`,
      code: `${code}.HK`,
      rawCode: code,
      name,
      status: allotmentUrl
        ? "配发结果已公布"
        : prospectusUrl
          ? "招股文件已发布"
          : "新上市资料待补齐",
      listingDate: calendar?.listingDate || null,
      boardLot: calendar?.boardLot || null,
      shortName: calendar?.shortName || null,
      announcementUrl,
      prospectusUrl,
      allotmentUrl,
      source: "HKEX",
      isLive: true,
    });
  }

  return listings
    .filter((item) => item.announcementUrl || item.prospectusUrl || item.allotmentUrl)
    .sort((a, b) => Number(Boolean(a.allotmentUrl)) - Number(Boolean(b.allotmentUrl)))
    .slice(0, 12);
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function normalizeChineseDate(value) {
  if (!value) return null;
  const match = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return value;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

async function enrichHKEXListing(listing) {
  if (!listing.announcementUrl) return listing;

  const buffer = await fetchBuffer(listing.announcementUrl, {
    timeoutMs: 20_000,
    headers: { "User-Agent": "Mozilla/5.0 WangchaoResearch/0.2" },
  });
  const text = toSimplifiedChinese(await extractPdfText(buffer)).replace(
    /\u00a0/g,
    " ",
  );
  const compact = text.replace(/\s+/g, "");

  const priceMatch = firstMatch(compact, [
    /发售价\s*[：:]?\s*(?:每股(?:H股|发售股份))?\s*(?:不超过|介乎)?\s*([\d.]+)\s*港元(?:\s*(?:至|到|–|-)\s*(?:每股(?:H股|发售股份))?\s*([\d.]+)\s*港元)?/,
  ]);
  const lotMatch = firstMatch(compact, [
    /申请认购的股数须至少为\s*([\d,]+)\s*股/,
    /必须申请认购最少\s*([\d,]+)\s*股/,
    /最少\s*([\d,]+)\s*股香港发售股份/,
    /至少为\s*([\d,]+)\s*股/,
  ]);
  const offerStartMatch = compact.match(
    /香港公开发售开始.{0,180}?(20\d{2}年\d{1,2}月\d{1,2}日)/,
  );
  const deadlineMatch = compact.match(
    /截止办理(?:认购)?申请登记.{0,180}?(20\d{2}年\d{1,2}月\d{1,2}日)/,
  );
  const listingDateMatch = compact.match(
    /预期.{0,30}?开始在(?:香港)?联交所买卖.{0,180}?(20\d{2}年\d{1,2}月\d{1,2}日)/,
  );
  const sponsorMatch = compact.match(
    /就全球发售而言，(.{2,120}?)作为稳定价格经办人/,
  );
  const publicSharesMatch = compact.match(
    /香港发售股份数目\s*[：:]?\s*([\d,]+)股/,
  );

  const priceLow = priceMatch ? Number(priceMatch[1]) : null;
  const priceHigh = priceMatch
    ? Number(priceMatch[2] || priceMatch[1])
    : null;
  const boardLot = lotMatch
    ? Number(lotMatch[1].replace(/,/g, ""))
    : Number(listing.boardLot?.replace(/,/g, "")) || null;
  const entryFee =
    Number.isFinite(priceHigh) && Number.isFinite(boardLot)
      ? Number((priceHigh * boardLot * 1.010085).toFixed(2))
      : null;

  return {
    ...listing,
    listingDate:
      normalizeChineseDate(listingDateMatch?.[1]) || listing.listingDate,
    boardLot: boardLot ? boardLot.toLocaleString("en-US") : listing.boardLot,
    offerPrice:
      Number.isFinite(priceLow) && Number.isFinite(priceHigh)
        ? priceLow === priceHigh
          ? `${priceHigh.toFixed(2)} 港元`
          : `${priceLow.toFixed(2)}-${priceHigh.toFixed(2)} 港元`
        : null,
    priceLow,
    priceHigh,
    entryFee,
    offerStart: normalizeChineseDate(offerStartMatch?.[1]),
    offerDeadline: normalizeChineseDate(deadlineMatch?.[1]),
    stabilizingManager:
      sponsorMatch?.[1]?.replace(/[（(]+$/, "").trim() || null,
    publicOfferShares: publicSharesMatch
      ? Number(publicSharesMatch[1].replace(/,/g, ""))
      : null,
    extractedFrom: "HKEX 新上市公告",
  };
}

function extractSponsorNames(text) {
  const blockMatch = firstMatch(text, [
    /(?:^|\n)参与全球发售的各方\s*\n\s*联席保荐人\s+([\s\S]{0,1800}?)(?=\n\s*保荐人兼整体协调人|\n\s*整体协调人|\n\s*联席全球协调人)/,
    /(?:^|\n)参与全球发售的各方\s*\n\s*独家保荐人\s+([\s\S]{0,1200}?)(?=\n\s*整体协调人|\n\s*联席全球协调人|\n\s*包销商)/,
    /(?:^|\n)参与全球发售的各方\s*\n\s*保荐人\s+([\s\S]{0,1200}?)(?=\n\s*整体协调人|\n\s*联席全球协调人|\n\s*包销商)/,
  ]);
  if (!blockMatch) return [];
  const companyPattern =
    /有限公司|Limited|LIMITED|Corporation|CORPORATION/;

  return [...new Set(
    blockMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length <= 90 &&
          companyPattern.test(line),
      )
      .map(
        (line) =>
          line
            .split(/\s{2,}/)
            .find((segment) => companyPattern.test(segment)) || line,
      )
      .map(cleanEntityName),
  )].slice(0, 4);
}

function extractUnderwriterNames(text) {
  const blockMatch = firstMatch(text, [
    /(?:^|\n)\s*香港包销商\s*\n([\s\S]{0,5000}?)(?=\n\s*(?:法律顾问|核数师|申报会计师|行业顾问|收款银行|合规顾问|独立非执行董事))/,
    /(?:^|\n)\s*香港承销商\s*\n([\s\S]{0,5000}?)(?=\n\s*(?:法律顾问|核数师|申报会计师|行业顾问|收款银行|合规顾问|独立非执行董事))/,
  ]);
  if (!blockMatch) return [];
  const companyPattern =
    /有限公司|Limited|LIMITED|Corporation|CORPORATION|Securities|SECURITIES/;
  return [...new Set(
    blockMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length <= 120 && companyPattern.test(line))
      .map(
        (line) =>
          line
            .split(/\s{2,}/)
            .find((segment) => companyPattern.test(segment)) || line,
      )
      .map(cleanEntityName),
  )].slice(0, 30);
}

function cleanEntityName(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1")
    .trim();
}

function extractEmbeddedArray(text, key) {
  const keyIndex = text.indexOf(`"${key}":[`);
  if (keyIndex < 0) return null;
  const start = text.indexOf("[", keyIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) {
      return JSON.parse(text.slice(start, index + 1));
    }
  }
  return null;
}

function parseMetric(value) {
  const cleaned = String(value ?? "").replace(/[,%x+]/gi, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanMetric(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true" ||
    String(value) === "是"
  );
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function splitIPOEntities(value) {
  return String(value || "")
    .split(/[、,，/]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildGroupedIPOStats(records, getGroups) {
  const groups = new Map();
  for (const record of records) {
    for (const group of getGroups(record)) {
      if (!group) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(record);
    }
  }

  return [...groups.entries()]
    .map(([name, rows]) => ({
      name,
      sampleCount: rows.length,
      winRate:
        (rows.filter((row) => row.firstDayChange > 0).length / rows.length) *
        100,
      averageFirstDay: average(rows.map((row) => row.firstDayChange)),
    }))
    .filter((row) => row.sampleCount >= 2)
    .sort((a, b) => b.sampleCount - a.sampleCount);
}

function quantile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function metricRange(records, key, min, max, lowPercentile = 0.1, highPercentile = 0.9) {
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  if (!values.length) return null;
  const normalize = (value) =>
    Number(clamp(value, min, max).toFixed(Math.abs(value) < 10 ? 1 : 0));
  return {
    low: normalize(quantile(values, lowPercentile)),
    mid: normalize(quantile(values, 0.5)),
    high: normalize(quantile(values, highPercentile)),
  };
}

function rate(numerator, denominator) {
  return denominator ? (numerator / denominator) * 100 : null;
}

function buildIPOModelValidation(completed) {
  const sorted = completed
    .slice()
    .sort((a, b) => a.listingDate.localeCompare(b.listingDate));
  const prior = [];
  const tests = [];
  const greyResiduals = [];
  const firstDayResiduals = [];
  const fiveDayResiduals = [];
  const greyCalibrated = [];
  const firstDayCalibrated = [];
  const fiveDayCalibrated = [];
  for (const record of sorted) {
    if (prior.length >= 20) {
      const estimate = buildIPOEstimate(record, prior);
      tests.push({ estimate, record });
      if (
        estimate.greyMarketChange &&
        Number.isFinite(record.greyMarketChange)
      ) {
        if (greyResiduals.length >= 10) {
          const halfWidth = quantile(greyResiduals, 0.9);
          greyCalibrated.push({
            covered:
              record.greyMarketChange >=
                estimate.greyMarketChange.mid - halfWidth &&
              record.greyMarketChange <=
                estimate.greyMarketChange.mid + halfWidth,
          });
        }
        greyResiduals.push(
          Math.abs(
            record.greyMarketChange - estimate.greyMarketChange.mid,
          ),
        );
      }
      if (
        estimate.firstDayChange &&
        Number.isFinite(record.firstDayChange)
      ) {
        if (firstDayResiduals.length >= 10) {
          const halfWidth = quantile(firstDayResiduals, 0.9);
          firstDayCalibrated.push({
            covered:
              record.firstDayChange >=
                estimate.firstDayChange.mid - halfWidth &&
              record.firstDayChange <=
                estimate.firstDayChange.mid + halfWidth,
          });
        }
        firstDayResiduals.push(
          Math.abs(record.firstDayChange - estimate.firstDayChange.mid),
        );
      }
      if (
        estimate.fiveDayChange &&
        Number.isFinite(record.fiveDayChange)
      ) {
        if (fiveDayResiduals.length >= 10) {
          const halfWidth = quantile(fiveDayResiduals, 0.9);
          fiveDayCalibrated.push({
            covered:
              record.fiveDayChange >=
                estimate.fiveDayChange.mid - halfWidth &&
              record.fiveDayChange <=
                estimate.fiveDayChange.mid + halfWidth,
          });
        }
        fiveDayResiduals.push(
          Math.abs(record.fiveDayChange - estimate.fiveDayChange.mid),
        );
      }
    }
    prior.push(record);
  }
  const greyTests = tests.filter(
    ({ estimate, record }) =>
      estimate.greyMarketChange &&
      Number.isFinite(record.greyMarketChange),
  );
  const firstDayTests = tests.filter(
    ({ estimate, record }) =>
      estimate.firstDayChange &&
      Number.isFinite(record.firstDayChange),
  );
  const fiveDayTests = tests.filter(
    ({ estimate, record }) =>
      estimate.fiveDayChange &&
      Number.isFinite(record.fiveDayChange),
  );
  const sameDirection = (value, midpoint) =>
    (value > 0 && midpoint > 0) ||
    (value <= 0 && midpoint <= 0);
  const meanAbsoluteError = (rows, key) =>
    average(
      rows.map(({ estimate, record }) =>
        Math.abs(record[key] - estimate[key].mid),
      ),
    );

  const validation = {
    algorithmVersion: "ipo-nearest-20-2026-07-v1",
    method:
      "按上市日期滚动验证，只使用当时之前发行与认购特征最接近的 20 只新股，并只用此前预测误差校准区间",
    interval: "基于此前绝对误差第 90 分位的滚动校准区间",
    releaseThresholds: {
      minimumFiveDaySamples: 50,
      minimumIntervalCoverage: 80,
      minimumDirectionAccuracy: 65,
      maximumMeanAbsoluteError: 25,
      maximumCalibrationHalfWidth: 35,
    },
    sampleCount: tests.length,
    greyMarket: {
      sampleCount: greyCalibrated.length,
      intervalCoverage: rate(
        greyCalibrated.filter((row) => row.covered).length,
        greyCalibrated.length,
      ),
      directionAccuracy: rate(
        greyTests.filter(({ estimate, record }) =>
          sameDirection(
            record.greyMarketChange,
            estimate.greyMarketChange.mid,
          ),
        ).length,
        greyTests.length,
      ),
      meanAbsoluteError: meanAbsoluteError(greyTests, "greyMarketChange"),
      calibrationHalfWidth: quantile(greyResiduals, 0.9),
    },
    firstDay: {
      sampleCount: firstDayCalibrated.length,
      intervalCoverage: rate(
        firstDayCalibrated.filter((row) => row.covered).length,
        firstDayCalibrated.length,
      ),
      directionAccuracy: rate(
        firstDayTests.filter(({ estimate, record }) =>
          sameDirection(record.firstDayChange, estimate.firstDayChange.mid),
        ).length,
        firstDayTests.length,
      ),
      meanAbsoluteError: meanAbsoluteError(firstDayTests, "firstDayChange"),
      calibrationHalfWidth: quantile(firstDayResiduals, 0.9),
    },
    fiveDay: {
      sampleCount: fiveDayCalibrated.length,
      intervalCoverage: rate(
        fiveDayCalibrated.filter((row) => row.covered).length,
        fiveDayCalibrated.length,
      ),
      directionAccuracy: rate(
        fiveDayTests.filter(({ estimate, record }) =>
          sameDirection(record.fiveDayChange, estimate.fiveDayChange.mid),
        ).length,
        fiveDayTests.length,
      ),
      meanAbsoluteError: meanAbsoluteError(fiveDayTests, "fiveDayChange"),
      calibrationHalfWidth: quantile(fiveDayResiduals, 0.9),
    },
  };
  const thresholds = validation.releaseThresholds;
  const metricReady = (metric) =>
    metric.intervalCoverage >= thresholds.minimumIntervalCoverage &&
    metric.directionAccuracy >= thresholds.minimumDirectionAccuracy &&
    metric.meanAbsoluteError <= thresholds.maximumMeanAbsoluteError &&
    metric.calibrationHalfWidth <= thresholds.maximumCalibrationHalfWidth;
  validation.releaseReady =
    validation.fiveDay.sampleCount >= thresholds.minimumFiveDaySamples &&
    metricReady(validation.greyMarket) &&
    metricReady(validation.firstDay) &&
    metricReady(validation.fiveDay);
  return validation;
}

function calibrateIPOEstimate(estimate, validation) {
  const calibrate = (range, metric) => {
    if (!range || !Number.isFinite(metric?.calibrationHalfWidth)) return range;
    return {
      low: Number(clamp(range.mid - metric.calibrationHalfWidth, -80, 300).toFixed(1)),
      mid: range.mid,
      high: Number(clamp(range.mid + metric.calibrationHalfWidth, -80, 300).toFixed(1)),
    };
  };
  return {
    ...estimate,
    intervalPercent: 90,
    greyMarketChange: calibrate(
      estimate.greyMarketChange,
      validation.greyMarket,
    ),
    firstDayChange: calibrate(
      estimate.firstDayChange,
      validation.firstDay,
    ),
    fiveDayChange: calibrate(
      estimate.fiveDayChange,
      validation.fiveDay,
    ),
  };
}

function ipoRuleResult(id, name, rows, baselineWinRate, note) {
  const winRate = rows.length
    ? (rows.filter((row) => row.firstDayChange > 0).length / rows.length) * 100
    : null;
  return {
    id,
    name,
    sampleCount: rows.length,
    winRate,
    accuracy: winRate,
    averageFirstDay: average(rows.map((row) => row.firstDayChange)),
    lift: Number.isFinite(winRate) ? winRate - baselineWinRate : null,
    verified: rows.length >= 5,
    note,
  };
}

function ipoIndustryKey(value) {
  const industry = value || "";
  const known = [
    "半导体",
    "机器人",
    "人工智能",
    "生物医药",
    "医疗",
    "消费电子",
    "汽车",
    "食品",
    "化工",
    "软件",
    "物流",
    "新能源",
  ];
  return known.find((name) => industry.includes(name)) || industry.split("/")[0]?.trim();
}

function buildUserIPOBacktest(completed) {
  const baselineWinRate =
    (completed.filter((record) => record.firstDayChange > 0).length /
      completed.length) *
    100;
  const industryHistory = new Map();
  const strongIndustryRows = [];
  for (const record of completed
    .slice()
    .sort((a, b) => a.listingDate.localeCompare(b.listingDate))) {
    const industry = ipoIndustryKey(record.industry);
    const priorRows = industryHistory.get(industry) || [];
    if (priorRows.length >= 3) {
      const priorWinRate =
        (priorRows.filter((peer) => peer.firstDayChange > 0).length /
          priorRows.length) *
        100;
      if (priorWinRate >= baselineWinRate) strongIndustryRows.push(record);
    }
    priorRows.push(record);
    industryHistory.set(industry, priorRows);
  }
  const knownSponsors = completed.filter((record) =>
    Number.isFinite(record.sponsorCount),
  );
  const completeSubscriptionRows = completed.filter(
    (record) =>
      Number.isFinite(record.offerPrice) &&
      Number.isFinite(record.approxSubscriptionAmount),
  );
  const highPriceThreshold = quantile(
    completeSubscriptionRows.map((record) => record.offerPrice),
    0.75,
  );
  const lowSubscriptionAmountThreshold = quantile(
    completeSubscriptionRows.map((record) => record.approxSubscriptionAmount),
    0.5,
  );
  const highPriceLowSubscriptionRows = completeSubscriptionRows.filter(
    (record) =>
      record.offerPrice >= highPriceThreshold &&
      record.approxSubscriptionAmount <= lowSubscriptionAmountThreshold,
  );
  const favorableIndustryCodes = new Set(
    strongIndustryRows.map((record) => record.stockCode),
  );
  const rules = [
    ipoRuleResult(
      "industry",
      "所属行业首日上涨占比高",
      strongIndustryRows,
      baselineWinRate,
      "严格按上市日期只使用此前同行业至少 3 只样本；本轮未提升命中率，暂不纳入融合分。",
    ),
    ipoRuleResult(
      "few-sponsors",
      "单一保荐人",
      knownSponsors.filter((record) => record.sponsorCount === 1),
      baselineWinRate,
      "现有样本不支持“越少越好”，暂不纳入加分；历史源仅完整覆盖保荐人，不等同于全部承销商。",
    ),
    ipoRuleResult(
      "livermore",
      "利弗莫尔证券参与",
      knownSponsors.filter((record) => record.hasLivermore),
      baselineWinRate,
      "历史源未提供完整承销商名单，当前样本无法验证，保留为待观察条件。",
    ),
    ipoRuleResult(
      "oversubscription",
      "公开认购至少 100 倍",
      completed.filter((record) => record.publicOversubscription >= 100),
      baselineWinRate,
      "认购越热的方向得到支持；100 倍是本轮样本中兼顾覆盖率和提升幅度的保守门槛。",
    ),
    ipoRuleResult(
      "non-ah",
      "避开 A+H",
      completed.filter((record) => !record.isAH),
      baselineWinRate,
      "非 A+H 样本的首日均值明显更高，但上涨率提升较小，作为风险扣分而非一票否决。",
    ),
    ipoRuleResult(
      "avoid-huatai",
      "避开华泰保荐",
      knownSponsors.filter((record) => !record.hasHuatai),
      baselineWinRate,
      "华泰样本数量较少，当前结果只适合作为风险提醒。",
    ),
    ipoRuleResult(
      "high-price-low-subscription",
      "高定价且公开认购总额低",
      highPriceLowSubscriptionRows,
      baselineWinRate,
      "公开认购总额按公开发售手数 × 每手股数 × 发售价 × 认购倍数近似计算；本轮未提升命中率，暂不纳入融合分。",
    ),
  ];

  // Historical review only. It keeps the user's IPO rules explicit without
  // claiming that post-subscription figures were available before subscription.
  const scoreRecord = (record) => {
    let score = 0;
    if (record.publicOversubscription >= 1000) score += 3;
    else if (record.publicOversubscription >= 100) score += 2;
    else if (record.publicOversubscription >= 20) score += 1;
    else score -= 1;
    if (favorableIndustryCodes.has(record.stockCode)) score += 1;
    score += record.isAH ? -1 : 1;
    if (Number.isFinite(record.sponsorCount)) {
      if (record.hasHuatai) score -= 2;
      else if (record.sponsorCount <= 2) score += 1;
    }
    if (record.hasLivermore) score += 1;
    if (
      record.offerPrice >= highPriceThreshold &&
      record.approxSubscriptionAmount <= lowSubscriptionAmountThreshold
    ) {
      score -= 2;
    }
    return score;
  };
  const reviews = completed.map((record) => {
    const score = scoreRecord(record);
    const verdict = score >= 4 ? "值得打" : score >= 1 ? "谨慎打" : "不建议";
    return {
      stockCode: record.stockCode,
      verdict,
      greyMarketChange: record.greyMarketChange,
      firstDayChange: record.firstDayChange,
      fiveDayChange: record.fiveDayChange,
    };
  });
  const tiers = [
    {
      id: "strong",
      name: "值得打",
      rows: completed.filter((record) => scoreRecord(record) >= 4),
    },
    {
      id: "watch",
      name: "谨慎打",
      rows: completed.filter((record) => {
        const score = scoreRecord(record);
        return score >= 1 && score < 4;
      }),
    },
    {
      id: "avoid",
      name: "不建议",
      rows: completed.filter((record) => scoreRecord(record) < 1),
    },
  ].map((tier) => ({
    id: tier.id,
    name: tier.name,
    sampleCount: tier.rows.length,
    winRate:
      (tier.rows.filter((record) => record.firstDayChange > 0).length /
        tier.rows.length) *
      100,
    averageFirstDay: average(
      tier.rows.map((record) => record.firstDayChange),
    ),
  }));

  return {
    baselineWinRate,
    sampleCount: completed.length,
    thresholds: {
      highPrice: highPriceThreshold,
      lowSubscriptionAmount: lowSubscriptionAmountThreshold,
      oversubscription: 100,
    },
    rules,
    reviews,
    tiers,
    methodology:
      "首日涨幅大于 0 视为上涨。规则展示命中该条件样本的上涨率，不把同一只股票计入自身行业胜率；结果未计手续费、融资利息和配售差异。",
  };
}

function buildCurrentIPOStrategy(listing, backtest, modelEstimate) {
  if (listing.allotmentUrl) {
    return {
      score: 0,
      verdict: "申购已结束",
      action: "港交所已发布配发结果，申购窗口结束，仅保留为历史回顾。",
      positiveSignals: [],
      riskSignals: [],
      neutralSignals: ["不能使用事后认购或配发信息补写申购结论"],
      predictionGuard: {
        predictionReliable: false,
        positiveDownside: false,
      },
      algorithmVersion: "user-strategy-2026-07-v2",
    };
  }
  // 招股期、招股价和一手股数缺一不可。缺字段时宁可不输出申购判断，
  // 避免把解析不完整的公告误当成可执行机会。
  const missingCoreFields = [
    !listing.prospectusUrl && "招股章程",
    !listing.offerPrice && "招股价",
    !listing.boardLot && "一手股数",
    !listing.offerDeadline && "申购截止时间",
  ].filter(Boolean);
  if (missingCoreFields.length) {
    return {
      score: 0,
      verdict: "待核验",
      action: `缺少${missingCoreFields.join("、")}，暂不提供申购结论。`,
      positiveSignals: [],
      riskSignals: ["核心招股字段未齐全"],
      neutralSignals: ["等待港交所文件稳定披露后再核验"],
      predictionGuard: {
        predictionReliable: false,
        positiveDownside: false,
      },
      algorithmVersion: "user-strategy-2026-07-v3",
    };
  }
  const userBacktest = backtest.userStrategy;
  const positiveSignals = [];
  const riskSignals = [];
  const neutralSignals = [];
  let score = 52;
  const industry = ipoIndustryKey(listing.industry);
  const industryStat = backtest.industryStats.find(
    (stat) =>
      stat.name === industry ||
      stat.name.includes(industry) ||
      industry.includes(stat.name),
  );
  if (industryStat?.sampleCount >= 3) {
    if (industryStat.winRate >= userBacktest.baselineWinRate) {
      neutralSignals.push(
        `同行业 ${industryStat.sampleCount} 只样本首日上涨率 ${industryStat.winRate.toFixed(0)}%`,
      );
    } else {
      neutralSignals.push(
        `同行业样本首日上涨率仅 ${industryStat.winRate.toFixed(0)}%`,
      );
    }
  } else {
    neutralSignals.push("同行业有效样本不足 3 只");
  }
  if (Number.isFinite(listing.publicOversubscription)) {
    if (listing.publicOversubscription >= 1000) {
      score += 16;
      positiveSignals.push(`公开认购 ${listing.publicOversubscription.toFixed(0)} 倍`);
    } else if (listing.publicOversubscription >= 100) {
      score += 10;
      positiveSignals.push(`公开认购 ${listing.publicOversubscription.toFixed(0)} 倍`);
    } else {
      score -= 8;
      riskSignals.push(`公开认购仅 ${listing.publicOversubscription.toFixed(1)} 倍`);
    }
  } else {
    neutralSignals.push("公开认购倍数尚未确认");
  }
  if (listing.isAH) {
    score -= 10;
    riskSignals.push("A+H 股，按回测作风险扣分");
  } else {
    score += 4;
    positiveSignals.push("非 A+H");
  }
  if (listing.sponsorNames?.length) {
    if (listing.hasHuatai) {
      score -= 12;
      riskSignals.push("华泰参与保荐");
    } else {
      score += 4;
      positiveSignals.push("未发现华泰参与保荐");
    }
    neutralSignals.push(
      `${listing.sponsorNames.length} 家保荐人；“越少越好”未通过本轮回测，不加分`,
    );
  } else {
    neutralSignals.push("保荐人字段尚未完整识别");
  }
  if (listing.hasLivermore) {
    positiveSignals.push("发现利弗莫尔证券参与");
    neutralSignals.push("利弗莫尔规则缺少历史承销商覆盖，暂不计入分数");
  }
  const { highPrice, lowSubscriptionAmount } = userBacktest.thresholds;
  if (
    Number.isFinite(listing.offerPriceValue) &&
    Number.isFinite(listing.approxSubscriptionAmount) &&
    listing.offerPriceValue >= highPrice &&
    listing.approxSubscriptionAmount <= lowSubscriptionAmount
  ) {
    neutralSignals.push("符合高定价、低公开认购总额；本轮回测未提高命中率，暂不加分");
  }
  if (Number.isFinite(listing.cornerstonePercent)) {
    score += Math.min(6, listing.cornerstonePercent / 5);
  }
  score = Math.round(clamp(score, 15, 95));
  const validation = backtest.modelValidation;
  const predictionReliable =
    modelEstimate?.publishable &&
    validation?.greyMarket?.intervalCoverage >= 70 &&
    validation?.firstDay?.intervalCoverage >= 70;
  const positiveDownside =
    modelEstimate?.greyMarketChange?.low > 0 &&
    modelEstimate?.firstDayChange?.low > 0;
  const verdict =
    score >= 76 && predictionReliable && positiveDownside
      ? "值得打"
      : score >= 60
        ? "谨慎打"
        : "不建议";
  return {
    score,
    verdict,
    action:
      verdict === "值得打"
        ? "可考虑小仓申购，上市前仍需复核估值和最终配发。"
        : verdict === "谨慎打"
          ? "先观察认购热度和配发结果，不追求融资重仓。"
          : "当前风险信号更多，暂不申购。",
    positiveSignals,
    riskSignals,
    neutralSignals,
    predictionGuard: {
      predictionReliable,
      positiveDownside,
    },
    algorithmVersion: "user-strategy-2026-07-v1",
  };
}

function ipoSponsorAliases(value) {
  const text = value || "";
  const aliases = [
    ["中国国际金融", "中金公司"],
    ["中信", "中信证券"],
    ["国泰君安", "国泰海通"],
    ["海通", "海通国际"],
    ["华泰", "华泰"],
    ["汇丰", "汇丰"],
    ["摩根大通", "摩根大通"],
    ["高盛", "高盛"],
    ["德意志", "德意志银行"],
    ["建银国际", "建银国际"],
  ];
  return aliases
    .filter(([legalName]) => text.includes(legalName))
    .map(([, shortName]) => shortName);
}

function ipoFeatureValue(listing, key) {
  const aliases = {
    offerPrice: ["offerPrice", "offerPriceValue"],
    publicOversubscription: ["publicOversubscription"],
    cornerstonePercent: ["cornerstonePercent"],
  };
  for (const alias of aliases[key] || [key]) {
    if (Number.isFinite(listing?.[alias])) return Number(listing[alias]);
  }
  return null;
}

function buildIPONearestPool(listing, completed, size = 20) {
  if (completed.length < size) return [];
  const featureKeys = [
    "publicOversubscription",
    "offerPrice",
    "cornerstonePercent",
  ];
  const scales = Object.fromEntries(
    featureKeys.map((key) => {
      const values = completed
        .map((record) => ipoFeatureValue(record, key))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      if (values.length < 5) return [key, null];
      const low = quantile(values, 0.1);
      const high = quantile(values, 0.9);
      const logarithmic = key === "publicOversubscription";
      return [
        key,
        {
          logarithmic,
          range: logarithmic
            ? Math.max(Math.log1p(high) - Math.log1p(low), 0.1)
            : Math.max(high - low, 1),
        },
      ];
    }),
  );
  const targetIndustry = ipoIndustryKey(listing.industry);
  const ranked = completed
    .map((record) => {
      let distance = 0;
      let comparableFeatures = 0;
      for (const key of featureKeys) {
        const scale = scales[key];
        const target = ipoFeatureValue(listing, key);
        const candidate = ipoFeatureValue(record, key);
        if (!scale || !Number.isFinite(target) || !Number.isFinite(candidate)) {
          continue;
        }
        const left = scale.logarithmic ? Math.log1p(target) : target;
        const right = scale.logarithmic ? Math.log1p(candidate) : candidate;
        distance += Math.abs(left - right) / scale.range;
        comparableFeatures += 1;
      }
      if (targetIndustry && ipoIndustryKey(record.industry) === targetIndustry) {
        distance -= 0.75;
      }
      if (
        typeof listing.isAH === "boolean" &&
        typeof record.isAH === "boolean" &&
        listing.isAH === record.isAH
      ) {
        distance -= 0.25;
      }
      return {
        record,
        distance: comparableFeatures ? distance / comparableFeatures : 99,
      };
    })
    .sort((left, right) => left.distance - right.distance);
  return ranked.slice(0, size).map((entry) => entry.record);
}

function buildIPOEstimate(listing, completed) {
  const industryKey = ipoIndustryKey(listing.industry);
  const sponsorAliases = ipoSponsorAliases(listing.sponsor || listing.sponsors);
  const industryPool = industryKey
    ? completed.filter((record) => ipoIndustryKey(record.industry) === industryKey)
    : [];
  const sponsorPool = sponsorAliases.length
    ? completed.filter((record) =>
        sponsorAliases.some((alias) => record.sponsors.includes(alias)),
      )
    : [];
  const combinedPool = completed.filter(
    (record) =>
      industryKey &&
      ipoIndustryKey(record.industry) === industryKey &&
      sponsorAliases.some((alias) => record.sponsors.includes(alias)),
  );
  const mergedPool = [
    ...new Map(
      [...industryPool, ...sponsorPool].map((record) => [
        `${record.stockCode}:${record.listingDate}`,
        record,
      ]),
    ).values(),
  ];
  const nearestPool = buildIPONearestPool(listing, completed);
  const pool =
    nearestPool.length >= 20
      ? nearestPool
      : combinedPool.length >= 5
      ? combinedPool
      : industryPool.length >= 5
        ? industryPool
        : sponsorPool.length >= 5
          ? sponsorPool
          : mergedPool.length >= 5
            ? mergedPool
            : completed;
  const basis =
    pool === nearestPool
      ? "发行与认购特征最接近的 20 只历史新股"
      : pool === combinedPool
      ? "同行业且同保荐人"
      : pool === industryPool
        ? "同行业"
        : pool === sponsorPool
          ? "同保荐人"
          : pool === mergedPool
            ? "同行业或同保荐人"
            : "2026 年全部已上市样本";

  return {
    sampleCount: pool.length,
    basis,
    intervalPercent: 80,
    subscriptionMultiple: metricRange(
      pool,
      "publicOversubscription",
      0,
      20_000,
    ),
    oneLotWinRate: metricRange(pool, "oneLotRate", 0.1, 100),
    greyMarketChange: metricRange(pool, "greyMarketChange", -80, 300),
    firstDayChange: metricRange(pool, "firstDayChange", -80, 300),
    fiveDayChange: metricRange(pool, "fiveDayChange", -80, 300),
  };
}

function compactDate(value) {
  return String(value || "").replaceAll("-", "");
}

function addCalendarDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeIPOTradingRows(rows, listingDate) {
  return rows
    .map((row) => ({ date: row.date, close: Number(row.close) }))
    .filter(
      (row) =>
        row.date >= listingDate &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        Number.isFinite(row.close) &&
        row.close > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchEastmoneyIPOTradingRows(stockCode, listingDate) {
  const endDate = addCalendarDays(listingDate, 30);
  if (!endDate) return [];
  const query = new URLSearchParams({
    secid: `116.${stockCode}`,
    klt: "101",
    fqt: "0",
    beg: compactDate(listingDate),
    end: compactDate(endDate),
    lmt: "20",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56",
  });
  const payload = await fetchJson(
    `${SOURCE_URLS.eastmoneyHistory}?${query}`,
    { timeoutMs: 10_000 },
  );
  return normalizeIPOTradingRows(
    (payload.data?.klines || []).map((line) => {
      const [date, , close] = String(line).split(",");
      return { date, close };
    }),
    listingDate,
  );
}

async function fetchTencentIPOTradingRows(stockCode, listingDate) {
  const endDate = addCalendarDays(listingDate, 30);
  if (!endDate) return [];
  const symbol = `hk${stockCode}`;
  const query = new URLSearchParams({
    param: `${symbol},day,${listingDate},${endDate},20,qfq`,
  });
  const payload = await fetchJson(
    `${SOURCE_URLS.tencentHistory}?${query}`,
    {
      timeoutMs: 10_000,
      headers: { Referer: "https://finance.qq.com/" },
    },
  );
  return normalizeIPOTradingRows(
    (payload.data?.[symbol]?.day || []).map((row) => ({
      date: row[0],
      close: row[2],
    })),
    listingDate,
  );
}

async function fetchIPOFifthTradingDay(record) {
  if (
    !record.listingDate ||
    !Number.isFinite(record.offerPrice) ||
    record.offerPrice <= 0
  ) {
    return null;
  }
  let rows = [];
  let source = "东方财富港股日线";
  try {
    rows = await fetchEastmoneyIPOTradingRows(
      record.stockCode,
      record.listingDate,
    );
  } catch {
    // The independent fallback below keeps an upstream outage from becoming
    // an invented historical value.
  }
  if (rows.length < 5) {
    try {
      rows = await fetchTencentIPOTradingRows(
        record.stockCode,
        record.listingDate,
      );
      source = "腾讯港股日线";
    } catch {
      return null;
    }
  }
  const fifthSession = rows[4];
  if (!fifthSession) return null;
  return {
    fiveDayChange: Number(
      (((fifthSession.close - record.offerPrice) / record.offerPrice) * 100).toFixed(2),
    ),
    fiveDayClose: Number(fifthSession.close.toFixed(3)),
    fiveDayDate: fifthSession.date,
    fiveDaySource: source,
  };
}

async function enrichIPOFifthTradingDays(records) {
  const enriched = records.slice();
  const candidates = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        !Number.isFinite(record.fiveDayChange) &&
        Number.isFinite(record.firstDayChange),
    );
  const batchSize = 8;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const results = await Promise.all(
      batch.map(({ record }) => fetchIPOFifthTradingDay(record)),
    );
    results.forEach((result, index) => {
      if (!result) return;
      const target = batch[index];
      enriched[target.index] = { ...target.record, ...result };
    });
  }
  return enriched;
}

async function fetchIPOHistoryData() {
  const html = await fetchText(SOURCE_URLS.ipoHistory, {
    timeoutMs: 20_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    },
  });
  let records = null;
  for (const match of html.matchAll(
    /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g,
  )) {
    try {
      const chunk = JSON.parse(match[1])?.[1] || "";
      records = extractEmbeddedArray(chunk, "records");
      if (records?.length) break;
    } catch {
      // Other React flight chunks may not contain the IPO record payload.
    }
  }
  if (!records?.length) throw new Error("IPO history payload unavailable");

  const normalized = records.map((record) => ({
    stockCode: String(record.stock_code || "").padStart(5, "0"),
    name: toSimplifiedChinese(record.stock_name || ""),
    listingDate: record.listing_date?.replaceAll("/", "-") || null,
    offerPrice: parseMetric(record.offer_price),
    boardLotAmount: parseMetric(record.board_lot_amount),
    boardLotShares: parseMetric(record.board_lot_shares),
    globalOfferShares: parseMetric(record.global_offer_shares),
    publicOfferLots: parseMetric(record.public_offer_lots),
    cornerstonePercent: parseMetric(record.cornerstone_pct),
    publicOversubscription: parseMetric(record.public_oversubscription),
    oneLotRate: parseMetric(record.lucky_rate_1_lot),
    greyMarketChange: parseMetric(record.grey_market_change),
    firstDayChange: parseMetric(record.first_day_change),
    fiveDayChange: parseMetric(
      record.five_day_change ??
        record.first_week_change ??
        record.week_change,
    ),
    oneLotPnl: parseMetric(record.one_lot_pnl),
    industry: toSimplifiedChinese(record.industry || ""),
    sponsors: toSimplifiedChinese(record.sponsors || ""),
    isAH: parseBooleanMetric(record.is_ah),
  })).map((record) => {
    const sponsorNames = splitIPOEntities(record.sponsors);
    const approxSubscriptionAmount =
      Number.isFinite(record.offerPrice) &&
      Number.isFinite(record.publicOfferLots) &&
      Number.isFinite(record.boardLotShares) &&
      Number.isFinite(record.publicOversubscription)
        ? record.offerPrice *
          record.publicOfferLots *
          record.boardLotShares *
          record.publicOversubscription
        : null;
    return {
      ...record,
      sponsorNames,
      sponsorCount: sponsorNames.length || null,
      hasHuatai: /华泰/.test(record.sponsors),
      hasLivermore: /利弗莫尔|Livermore/i.test(record.sponsors),
      approxSubscriptionAmount,
    };
  });
  const historyEnriched = await enrichIPOFifthTradingDays(normalized);
  const completed = historyEnriched.filter((record) =>
    Number.isFinite(record.firstDayChange),
  );
  if (!completed.length) throw new Error("No completed IPO history returned");

  const sponsorStats = buildGroupedIPOStats(completed, (record) =>
    record.sponsorNames,
  );
  const industryStats = buildGroupedIPOStats(completed, (record) => [
    record.industry.split("/")[0]?.trim(),
  ]);
  const userStrategy = buildUserIPOBacktest(completed);
  const modelValidation = buildIPOModelValidation(completed);

  return {
    source: {
      name: "虾投港股 IPO 历史聚合",
      url: SOURCE_URLS.ipoHistory,
      tier: "第三方历史聚合",
    },
    sampleCount: completed.length,
    firstDayWinRate:
      (completed.filter((record) => record.firstDayChange > 0).length /
        completed.length) *
      100,
    averageFirstDay: average(
      completed.map((record) => record.firstDayChange),
    ),
    averageGreyMarket: average(
      completed.map((record) => record.greyMarketChange),
    ),
    recent: completed.slice(0, 12),
    completed,
    sponsorStats,
    industryStats,
    userStrategy,
    modelValidation,
    current: historyEnriched.map((record) => ({
      stockCode: record.stockCode,
      industry: record.industry,
      offerPriceValue: record.offerPrice,
      globalOfferShares: record.globalOfferShares,
      boardLotShares: record.boardLotShares,
      publicOfferLots: record.publicOfferLots,
      publicOversubscription: record.publicOversubscription,
      approxSubscriptionAmount: record.approxSubscriptionAmount,
      cornerstonePercent: record.cornerstonePercent,
      isAH: record.isAH,
      historySponsorNames: record.sponsorNames,
      hasHuatai: record.hasHuatai,
      hasLivermore: record.hasLivermore,
    })),
  };
}

function extractCornerstoneData(text) {
  const sectionMatch = text.match(
    /\n\s*基石投资者\s*\n[\s\S]{0,120}\n?\s*基石配售/,
  );
  if (!sectionMatch) {
    return {
      cornerstoneInvestors: [],
      cornerstoneAmount: null,
      cornerstonePercent: null,
    };
  }

  const sectionStart = sectionMatch.index || 0;
  const section = text.slice(sectionStart, sectionStart + 28_000);
  const compact = section.replace(/\s+/g, "");
  const amountMatch = [...compact.matchAll(/约?([\d,.]+)(百万|亿)?港元/g)][0];
  const percentMatch = compact.match(
    /约占[:：]?\(i\).*?发售股份(?:总数)?的([\d.]+)%/,
  );
  const tableStart = section.search(/下表载列基石配售的详情/);
  const tableEnd =
    tableStart >= 0 ? section.indexOf("总计", tableStart) : -1;
  const table =
    tableStart >= 0
      ? section.slice(tableStart, tableEnd > tableStart ? tableEnd : tableStart + 8000)
      : "";
  const cornerstoneInvestors = [...new Set(
    table
      .split("\n")
      .map((line) =>
        line.match(
          /^\s*(.+?)\s*(?:\.\s*){2,}(?:美元|人民币|港元)/,
        )?.[1],
      )
      .map((name) => (name ? cleanEntityName(name) : name))
      .filter(
        (name) =>
          name &&
          !/基于发售价|总投资额|基石投资者名称|总计/.test(name) &&
          name.length <= 80,
      ),
  )].slice(0, 12);
  if (!cornerstoneInvestors.length) {
    cornerstoneInvestors.push(
      ...[...new Set(
        [...section.matchAll(/（「([^」]{2,40})」）/g)]
          .map((match) => cleanEntityName(match[1]))
          .filter(
            (name) =>
              !/基石投资者|基石投资协议|基石配售|本公司|全球发售|最终客户|相关投资者|该等安排|场外掉期|合资格境内机构投资者|^QDII$/.test(name),
          ),
      )].slice(0, 12),
    );
  }

  return {
    cornerstoneInvestors,
    cornerstoneAmount: amountMatch
      ? `${amountMatch[1]}${amountMatch[2] || ""}港元`
      : null,
    cornerstonePercent: percentMatch ? Number(percentMatch[1]) : null,
  };
}

async function enrichHKEXProspectus(listing) {
  if (!listing.prospectusUrl) return listing;
  const buffer = await fetchBuffer(listing.prospectusUrl, {
    timeoutMs: 45_000,
    headers: { "User-Agent": "Mozilla/5.0 WangchaoResearch/0.2" },
  });
  let text = toSimplifiedChinese(
    await extractPdfText(buffer, Number.POSITIVE_INFINITY),
  ).replace(/\u00a0/g, " ");
  text = text.replace(
    /([\u3400-\u9fff])[ \t]{1,3}(?=[\u3400-\u9fff])/g,
    "$1",
  );
  const sponsorNames = extractSponsorNames(text);
  const underwriterNames = extractUnderwriterNames(text);

  return {
    ...listing,
    sponsorNames,
    sponsor: sponsorNames.join("、") || null,
    underwriterNames,
    ...extractCornerstoneData(text),
    prospectusExtracted: true,
  };
}

async function fetchHKEXData(options = {}) {
  const [listingHtml, scheduleHtml] = await Promise.all([
    fetchText(SOURCE_URLS.hkex, {
      headers: { "User-Agent": "Mozilla/5.0 WangchaoResearch/0.2" },
    }),
    fetchText(SOURCE_URLS.hkexSchedule, {
      headers: { "User-Agent": "Mozilla/5.0 WangchaoResearch/0.2" },
    }),
  ]);
  const schedule = parseHKEXSchedule(scheduleHtml);
  const baseListings = parseHKEXNewListings(listingHtml, schedule);
  const listings = [];
  for (let index = 0; index < baseListings.length; index += 4) {
    const batch = baseListings.slice(index, index + 4);
    const enriched = await Promise.allSettled(batch.map(enrichHKEXListing));
    listings.push(
      ...enriched.map((result, resultIndex) =>
        result.status === "fulfilled" ? result.value : batch[resultIndex],
      ),
    );
  }
  let backtest = null;
  if (options.deep) {
    for (let index = 0; index < listings.length; index += 2) {
      const batch = listings.slice(index, index + 2);
      const enriched = await Promise.allSettled(
        batch.map(enrichHKEXProspectus),
      );
      enriched.forEach((result, resultIndex) => {
        if (result.status === "fulfilled") {
          listings[index + resultIndex] = result.value;
        }
      });
    }
    try {
      backtest = await fetchIPOHistoryData();
      const currentRecords = new Map(
        backtest.current.map((record) => [record.stockCode, record]),
      );
      const historicalReviews = new Map(
        (backtest.userStrategy?.reviews || []).map((review) => [
          review.stockCode,
          review,
        ]),
      );
      listings.forEach((listing, index) => {
        const historyRecord = currentRecords.get(listing.rawCode);
        if (!historyRecord) return;
        const sponsorNames = listing.sponsorNames?.length
          ? listing.sponsorNames
          : historyRecord.historySponsorNames;
        const participantNames = [
          ...sponsorNames,
          ...(listing.underwriterNames || []),
        ];
        listings[index] = {
          ...listing,
          industry: historyRecord.industry || null,
          sponsorNames,
          sponsor: sponsorNames.join("、") || listing.sponsor || null,
          offerPriceValue: historyRecord.offerPriceValue,
          globalOfferShares: historyRecord.globalOfferShares,
          boardLotShares: historyRecord.boardLotShares,
          publicOfferLots: historyRecord.publicOfferLots,
          publicOversubscription: historyRecord.publicOversubscription,
          approxSubscriptionAmount:
            historyRecord.approxSubscriptionAmount,
          isAH: historyRecord.isAH,
          hasHuatai:
            participantNames.some((name) => /华泰/.test(name)) ||
            historyRecord.hasHuatai,
          hasLivermore:
            participantNames.some((name) =>
              /利弗莫尔|Livermore/i.test(name),
            ) || historyRecord.hasLivermore,
          cornerstonePercent:
            listing.cornerstonePercent ??
            historyRecord.cornerstonePercent ??
            null,
          historicalReview: historicalReviews.get(listing.rawCode) || null,
        };
      });
      listings.forEach((listing, index) => {
        const modelEstimate = calibrateIPOEstimate(
          buildIPOEstimate(listing, backtest.completed),
          backtest.modelValidation,
        );
        modelEstimate.publishable =
          modelEstimate.sampleCount >= 5 &&
          backtest.modelValidation.releaseReady;
        modelEstimate.confidence =
          modelEstimate.publishable && modelEstimate.sampleCount >= 20
            ? "中"
            : modelEstimate.publishable && modelEstimate.sampleCount >= 8
              ? "中低"
              : "低";
        listings[index] = {
          ...listing,
          modelEstimate,
          strategyAssessment: buildCurrentIPOStrategy(
            listing,
            backtest,
            modelEstimate,
          ),
        };
      });
    } catch {
      backtest = null;
    }
  }
  if (!listings.length) throw new Error("No HKEX IPO returned");

  const pendingCount = listings.filter((item) => !item.allotmentUrl).length;
  const temperature = Math.round(clamp(42 + pendingCount * 5, 20, 85));

  return {
    listings,
    temperature: {
      value: temperature,
      label: temperature >= 70 ? "偏热" : temperature >= 50 ? "中性" : "偏冷",
      hint: `港交所当前抓取到 ${pendingCount} 只尚未公布配发结果的新股——温度只反映新股供给活跃度，不代表收益`,
    },
    backtest,
  };
}

function findRecent13FFilings(submission) {
  const recent = submission.filings?.recent || {};
  const rows = (recent.form || []).map((form, index) => ({
    form,
    filingDate: recent.filingDate[index],
    reportDate: recent.reportDate[index],
    accessionNumber: recent.accessionNumber[index],
  }));
  const uniqueReports = new Set();

  return rows
    .filter((row) => row.form === "13F-HR")
    .filter((row) => {
      if (!row.reportDate || uniqueReports.has(row.reportDate)) return false;
      uniqueReports.add(row.reportDate);
      return true;
    })
    .slice(0, 2);
}

function readXmlTag(block, tag) {
  const match = block.match(
    new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"),
  );
  return match ? decodeHtml(match[1]) : "";
}

function parse13FInformationTable(xml) {
  const positions = [];
  for (const match of xml.matchAll(
    /<(?:\w+:)?infoTable[^>]*>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi,
  )) {
    const block = match[1];
    const cusip = readXmlTag(block, "cusip").toUpperCase();
    const value = Number(readXmlTag(block, "value").replace(/,/g, ""));
    if (!cusip || !Number.isFinite(value)) continue;

    positions.push({
      cusip,
      issuer: readXmlTag(block, "nameOfIssuer"),
      title: readXmlTag(block, "titleOfClass"),
      putCall: readXmlTag(block, "putCall"),
      shares: Number(readXmlTag(block, "sshPrnamt").replace(/,/g, "")) || 0,
      value,
    });
  }

  const aggregate = new Map();
  for (const position of positions) {
    const key = `${position.cusip}:${position.putCall || "SH"}`;
    const current = aggregate.get(key);
    if (current) {
      current.value += position.value;
      current.shares += position.shares;
    } else {
      aggregate.set(key, { ...position });
    }
  }

  return [...aggregate.values()];
}

async function fetch13FTable(cik, filing) {
  const accession = filing.accessionNumber.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/`;
  const index = await fetchJson(`${base}index.json`, { timeoutMs: 15_000 });
  const xmlName = index.directory?.item
    ?.map((item) => item.name)
    .find(
      (name) =>
        name.toLowerCase().endsWith(".xml") &&
        !name.toLowerCase().includes("primary"),
    );
  if (!xmlName) throw new Error("13F information table missing");

  return parse13FInformationTable(
    await fetchText(`${base}${xmlName}`, { timeoutMs: 20_000 }),
  );
}

function changeLabel(current, previous) {
  if (!previous) return { type: "new", label: "新进" };
  if (!previous.shares || !current.shares) return { type: "same", label: "持有" };
  const change = ((current.shares - previous.shares) / previous.shares) * 100;
  if (Math.abs(change) < 1) return { type: "same", label: "基本不变" };
  return {
    type: change > 0 ? "up" : "down",
    label: `${change > 0 ? "增持" : "减持"} ${change > 0 ? "+" : ""}${change.toFixed(0)}%`,
  };
}

function buildManagerResult(manager, filings, latest, previous) {
  const previousMap = new Map(
    previous.map((position) => [
      `${position.cusip}:${position.putCall || "SH"}`,
      position,
    ]),
  );
  const totalValue = latest.reduce((sum, position) => sum + position.value, 0);
  const holdings = latest
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((position) => {
      const key = `${position.cusip}:${position.putCall || "SH"}`;
      const change = changeLabel(position, previousMap.get(key));
      const ticker = CUSIP_TICKERS[position.cusip] || position.issuer;
      return {
        ticker,
        issuer: position.issuer,
        weight: totalValue ? (position.value / totalValue) * 100 : 0,
        value: position.value,
        shares: position.shares,
        putCall: position.putCall || null,
        changeType: change.type,
        changeLabel: change.label,
      };
    });

  const latestKeys = new Set(
    latest.map((position) => `${position.cusip}:${position.putCall || "SH"}`),
  );
  const sold = previous
    .filter(
      (position) =>
        !latestKeys.has(`${position.cusip}:${position.putCall || "SH"}`),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((position) => ({
      ticker: CUSIP_TICKERS[position.cusip] || position.issuer,
      issuer: position.issuer,
    }));

  return {
    id: manager.id,
    name: manager.name,
    reportDate: filings[0].reportDate,
    filingDate: filings[0].filingDate,
    previousReportDate: filings[1]?.reportDate || null,
    portfolioValue: totalValue,
    holdings,
    sold,
    source: "SEC EDGAR 13F",
    sourceUrl: `https://www.sec.gov/edgar/browse/?CIK=${Number(manager.cik)}`,
    isLive: true,
  };
}

async function fetchManager13F(manager) {
  const submission = await fetchJson(
    `${SOURCE_URLS.sec}CIK${manager.cik}.json`,
    { timeoutMs: 15_000 },
  );
  const filings = findRecent13FFilings(submission);
  if (!filings.length) throw new Error("No 13F filing");

  const [latest, previous = []] = await Promise.all([
    fetch13FTable(manager.cik, filings[0]),
    filings[1] ? fetch13FTable(manager.cik, filings[1]) : Promise.resolve([]),
  ]);
  return buildManagerResult(manager, filings, latest, previous);
}

async function fetchSECManagers() {
  const results = new Map();
  for (let index = 0; index < MANAGERS.length; index += 4) {
    const batch = MANAGERS.slice(index, index + 4);
    const settled = await Promise.allSettled(batch.map(fetchManager13F));
    settled.forEach((result, resultIndex) => {
      results.set(batch[resultIndex].id, result);
    });
  }
  const failedManagers = MANAGERS.filter(
    (manager) => results.get(manager.id)?.status !== "fulfilled",
  );
  if (failedManagers.length) {
    const retried = await Promise.allSettled(
      failedManagers.map(fetchManager13F),
    );
    retried.forEach((result, index) => {
      results.set(failedManagers[index].id, result);
    });
  }
  const managers = MANAGERS.map((manager) => results.get(manager.id))
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  if (!managers.length) {
    const reasons = MANAGERS.map((manager) => {
      const result = results.get(manager.id);
      return result?.status === "rejected"
        ? `${manager.id}: ${result.reason?.message || result.reason}`
        : null;
    })
      .filter(Boolean)
      .join("; ");
    throw new Error(`No SEC 13F returned (${reasons})`);
  }
  return managers;
}

function resultOrNull(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function sourceStatus(id, name, url, result) {
  return {
    id,
    name,
    url,
    ok: result.status === "fulfilled",
    error:
      result.status === "rejected"
        ? String(result.reason?.message || result.reason)
        : null,
  };
}

function buildStrategyHealth(hk, us) {
  const validation = hk?.backtest?.modelValidation;
  const hkReleaseReady = Boolean(validation?.releaseReady);
  return {
    hk: {
      releaseReady: hkReleaseReady,
      status: hkReleaseReady ? "validated" : "not_ready",
      note: hkReleaseReady
        ? "暗盘与首日区间已通过滚动覆盖率和误差宽度门槛。"
        : "暗盘和首日的历史绝对误差仍过大，当前不发布具体涨幅。最终认购倍数在申购截止后才完整可见，不能被当成提前申购信号。",
      sampleCount: validation?.sampleCount || 0,
    },
    us: {
      releaseReady: false,
      status: "not_ready",
      note: "美股正在按交易日保存财务、热度、价格和信号快照；样本不足或未完成人工复核前，只保留研究筛选，不发布盈利结论。",
      eligibleCount: (us?.fundamentals || []).filter(
        (row) => row.qualityEligible && row.qualityMatchCount >= 2,
      ).length,
    },
  };
}

export async function fetchLiveData(options = {}) {
  const startedAt = Date.now();
  const [usResult, hkResult, secResult] = await Promise.allSettled([
    fetchUSMarketData(),
    fetchHKEXData({ deep: Boolean(options.deepHK) }),
    fetchSECManagers(),
  ]);
  const sources = [
    sourceStatus(
      "yahoo",
      "Yahoo Finance 公共行情",
      "https://finance.yahoo.com/",
      usResult,
    ),
    {
      id: "nasdaq",
      name: "Nasdaq 公司财务数据",
      url: "https://www.nasdaq.com/market-activity/stocks",
      ok:
        usResult.status === "fulfilled" &&
        Boolean(usResult.value?.fundamentals?.length),
      error:
        usResult.status === "fulfilled" &&
        !usResult.value?.fundamentals?.length
          ? "No Nasdaq fundamental returned"
          : null,
    },
    sourceStatus(
      "hkex",
      "香港交易所新上市资料",
      SOURCE_URLS.hkex,
      hkResult,
    ),
    sourceStatus(
      "sec",
      "SEC EDGAR 13F",
      "https://www.sec.gov/edgar/search/",
      secResult,
    ),
  ];
  const successfulSources = sources.filter((source) => source.ok).length;
  const us = resultOrNull(usResult);
  const hk = resultOrNull(hkResult);
  const investors = resultOrNull(secResult);

  return {
    status:
      successfulSources === sources.length
        ? "live"
        : successfulSources
          ? "partial"
          : "unavailable",
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sources,
    us,
    hk,
    investors,
    strategyHealth: buildStrategyHealth(hk, us),
  };
}

export function sanitizePublicData(payload) {
  if (!payload) return payload;
  const backtest = payload.hk?.backtest;
  return {
    ...payload,
    hk: payload.hk
      ? {
          ...payload.hk,
          listings: (payload.hk.listings || []).map((listing) => ({
            ...listing,
            strategyAssessment: listing.strategyAssessment
              ? {
                  verdict: listing.strategyAssessment.verdict,
                  action: listing.strategyAssessment.action,
                }
              : null,
            historicalReview: listing.historicalReview
              ? {
                  verdict: listing.historicalReview.verdict,
                  greyMarketChange: listing.historicalReview.greyMarketChange,
                  firstDayChange: listing.historicalReview.firstDayChange,
                  fiveDayChange: listing.historicalReview.fiveDayChange,
                }
              : null,
            modelEstimate: listing.modelEstimate
              ? {
                  sampleCount: listing.modelEstimate.sampleCount,
                  intervalPercent: listing.modelEstimate.intervalPercent,
                  subscriptionMultiple:
                    listing.modelEstimate.subscriptionMultiple,
                  oneLotWinRate: listing.modelEstimate.oneLotWinRate,
                  greyMarketChange: listing.modelEstimate.publishable
                    ? listing.modelEstimate.greyMarketChange
                    : null,
                  firstDayChange: listing.modelEstimate.publishable
                    ? listing.modelEstimate.firstDayChange
                    : null,
                  fiveDayChange: listing.modelEstimate.publishable
                    ? listing.modelEstimate.fiveDayChange
                    : null,
                  publishable: listing.modelEstimate.publishable,
                  confidence: listing.modelEstimate.confidence,
                }
              : null,
          })),
          backtest: backtest
            ? {
                source: backtest.source,
                sampleCount: backtest.sampleCount,
                firstDayWinRate: backtest.firstDayWinRate,
                averageFirstDay: backtest.averageFirstDay,
                averageGreyMarket: backtest.averageGreyMarket,
                recent: backtest.recent,
                modelValidation: backtest.modelValidation,
              }
            : null,
        }
      : null,
  };
}

export const dataSourceUrls = SOURCE_URLS;
