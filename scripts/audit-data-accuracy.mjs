import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const miniDir = path.join(rootDir, "miniprogram");

const snapshot = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "live-snapshot.json"), "utf8"));
const bundledSnapshot = require(path.join(miniDir, "data", "live-snapshot.js"));
const { sanitizeSnapshot } = require(path.join(rootDir, "cloudfunctions", "aurum-data", "sanitize.js"));
const { getHistoricalDividendYield } = require(path.join(miniDir, "utils", "historical-dividend-yield.js"));
const { yieldImpliedPlan, US_NO_GROSS_MARGIN, US_BANK_SYMBOLS, A_BANK_CODES, isABankCode, cleanUsGrossMargin } = require(path.join(miniDir, "utils", "market-lenses.js"));
const { allItems, findItem, usPoolItems } = require(path.join(miniDir, "utils", "answers.js"));
const { scoreForItem } = require(path.join(miniDir, "utils", "strategy-score.js"));
const { buildStrategySignal } = require(path.join(miniDir, "utils", "strategy-signals.js"));
const { domesticGoldClose, historicalGoldSeries } = require(path.join(miniDir, "utils", "gold-series.js"));
const { goldParity } = require(path.join(miniDir, "utils", "gold-parity.js"));
const { buildGuruOverlapRows } = require(path.join(miniDir, "utils", "guru-overlap.js"));
const { buildGuruTrend } = require(path.join(miniDir, "utils", "guru-trend.js"));
const { formatFilingLine } = require(path.join(miniDir, "utils", "us-filings.js"));

const POISON_RE = /(?:^|[^a-zA-Z])(undefined|NaN|Infinity)(?:$|[^a-zA-Z])/;
const DUP_DAY_RE = /(\b\d{2}-\d{2})、\1\b/;

function scanPoisonStrings(node, trail = "root") {
  if (node == null) return;
  if (typeof node === "string") {
    if (node.startsWith("data:image/")) return;
    assert(!POISON_RE.test(node), `渲染文本出现非法字面量 (${trail}): ${node}`);
    assert(!/\bnull\b/.test(node), `渲染文本出现裸 null (${trail}): ${node}`);
    assert(!DUP_DAY_RE.test(node), `渲染文本出现同日重复日期 (${trail}): ${node}`);
    return;
  }
  if (typeof node === "number") {
    assert(Number.isFinite(node), `渲染数值出现非有限数 (${trail}): ${node}`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, idx) => scanPoisonStrings(child, `${trail}[${idx}]`));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "raw") continue;
      scanPoisonStrings(v, `${trail}.${k}`);
    }
  }
}

globalThis.wx = {
  getStorageSync: () => null,
  setStorageSync: () => {},
  nextTick: (fn) => fn(),
  setNavigationBarTitle: () => {},
  stopPullDownRefresh: () => {},
  pageScrollTo: () => {},
  showToast: () => {},
  showModal: () => {},
  createSelectorQuery: () => ({
    in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }),
  }),
  getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390 }),
};
globalThis.getApp = () => ({ globalData: {} });

function loadPageFactory(pageRelPath) {
  let capturedConfig = null;
  const prevPage = globalThis.Page;
  globalThis.Page = (cfg) => { capturedConfig = cfg; };
  try {
    const abs = path.join(miniDir, pageRelPath);
    delete require.cache[require.resolve(abs)];
    require(abs);
  } finally {
    globalThis.Page = prevPage;
  }
  assert(capturedConfig, `未能加载页面配置: ${pageRelPath}`);
  return capturedConfig;
}

function instantiatePage(config) {
  const instance = Object.create(config);
  instance.data = JSON.parse(JSON.stringify(config.data || {}));
  instance.setData = function setData(patch, cb) {
    Object.assign(this.data, patch);
    if (typeof cb === "function") cb();
  };
  return instance;
}

// 1. Sanitize & snapshot structural consistency
const cleanSnap = sanitizeSnapshot(snapshot, Date.parse(snapshot.updatedAt) + 60_000);
assert.equal(bundledSnapshot.updatedAt, snapshot.updatedAt, "小程序离线快照 updatedAt 必须与 data/live-snapshot.json 同步");

// 2. A-Share 20-stock accuracy & yieldImpliedPlan math
const aFundMap = new Map((snapshot.aShare?.fundamentals || []).map((f) => [f.code, f]));
assert.equal(snapshot.aShare.quotes.length, 20, "A股行情池应完整包含 20 只股票");
for (const q of snapshot.aShare.quotes) {
  const f = aFundMap.get(q.code);
  assert(f, `A股 ${q.code} 缺少对应财务分红记录`);
  if (isABankCode(q.code)) {
    assert(
      f.freeCashFlow == null && f.cashConversion == null && f.operatingCashFlow == null,
      `商业银行 ${q.code} 吸收客户存款计入经营现金流，不得展示失真的工业自由现金流或现金利润比`,
    );
  }
  const hy = getHistoricalDividendYield({ ...q, financials: f });
  assert(hy && hy.dividendPerShare > 0 && hy.yieldPercent > 0, `A股 ${q.code} 无法算出已核验历史股息率`);
  assert(
    Math.abs(Number(q.currentDividendYield) - hy.yieldPercent) <= 0.06,
    `A股 ${q.code} 快照股息率 (${q.currentDividendYield}%) 与真实分红折算 (${hy.yieldPercent.toFixed(2)}%) 偏离过大`,
  );
  const freshRaw = {
    ...q,
    financials: f,
    historicalDividendYield: hy,
    priceAsOf: snapshot.updatedAt.slice(0, 10),
  };
  const plan = yieldImpliedPlan(freshRaw);
  assert(plan, `A股 ${q.code} 在新鲜行情下应生成有效分红回推区间`);
  assert(plan.addPrice > 0 && plan.trimPrice > plan.addPrice, `A股 ${q.code} 参考低位价 (${plan.addPrice}) 必须低于高位价 (${plan.trimPrice})`);
  assert(Math.abs(plan.dps - hy.dividendPerShare) < 1e-6, `A股 ${q.code} 回推区间每股分红必须等于真实已实施分红`);
  const expectedZone = plan.price <= plan.addPrice ? "add" : (plan.price >= plan.trimPrice ? "trim" : "hold");
  assert.equal(plan.zone, expectedZone, `A股 ${q.code} 区间状态 (${plan.zone}) 与现价位置 (${expectedZone}) 不一致`);
  const sig = buildStrategySignal({ market: "a", id: q.code, raw: freshRaw });
  scanPoisonStrings(sig, `aShareSignal(${q.code})`);
}
for (const fund of snapshot.aShare.funds || []) {
  if (fund.dataStatus === "live") {
    assert(!fund.fallbackReason, `红利基金 ${fund.code} 状态为 live 时不应残留旧 fallbackReason`);
  }
}

// 3. US 30-stock accuracy, financial gross-margin guard, pricePlan order & filings dedup
assert.equal(snapshot.us.stocks.length, 30, "美股池应包含 30 只标的");
for (const f of snapshot.us.fundamentals) {
  if (US_NO_GROSS_MARGIN.has(f.symbol)) {
    assert.equal(f.grossMargin, null, `金融/支付/保险标的 ${f.symbol} 不得展示失真或不可比毛利率`);
    assert.equal(cleanUsGrossMargin(f.symbol, 82.7), null, `cleanUsGrossMargin(${f.symbol}, 82.7) 必须返回 null`);
  }
  if (US_BANK_SYMBOLS.has(f.symbol)) {
    assert.equal(f.operatingCashFlow, null, `商业银行 ${f.symbol} 不得展示存贷款口径的经营现金流`);
  }
  if (f.symbol === "BRK.B") {
    assert(f.targetPrice == null || Number(f.targetPrice) < 5000, "BRK.B 不得混入 BRK.A 的数十万美元目标价");
  }
}
const sleeveFile = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "sleeve-quotes.json"), "utf8"));
assert.equal((sleeveFile.quotes || []).length, 5, "美股核心与收息 ETF 基准应完整包含 5 只标的");
for (const sym of ["VOO", "JEPQ", "SCHD", "O", "SGOV"]) {
  const hit = sleeveFile.quotes.find((x) => x.symbol === sym);
  assert(hit && Number(hit.price) > 0, `美股基准 ETF ${sym} 价格缺失或无效`);
}
for (const s of cleanSnap.us.stocks) {
  assert(Number(s.price) > 0, `美股 ${s.symbol} 价格无效`);
  if (s.pricePlan) {
    assert(
      s.pricePlan.stop > 0 && s.pricePlan.stop < s.pricePlan.buy && s.pricePlan.buy < s.pricePlan.sell[0],
      `美股 ${s.symbol} 参考价顺序必须满足 stop < buy < sell[0]`,
    );
  }
}
const dupFilingText = formatFilingLine([
  { filingDate: "2026-11-25", form: "6-K", labels: ["境外发行人公告"] },
  { filingDate: "2026-11-25", form: "6-K", labels: ["境外发行人公告"] },
], 3);
assert.equal(dupFilingText, "11-25 境外发行人公告", "同日多份同类 SEC 公告日期必须去重");

// 4. HK IPO entryFee math, cornerstone noise guard & open count accuracy
const HK_NOISE_RE = /^(禁售期|国际财务报告准则|国际会计准则理事会|补充协议|配发结果公告|历史财务资料|以公允价值计量.*)$/u;
for (const l of snapshot.hk.listings || []) {
  const lotNum = Number(String(l.boardLot || "").replace(/,/g, "").trim());
  const hiPrice = Number(l.priceHigh || String(l.offerPrice || "").match(/(\d+(?:\.\d+)?)/)?.[1]);
  if (Number.isFinite(lotNum) && lotNum > 0 && Number.isFinite(hiPrice) && hiPrice > 0 && Number.isFinite(Number(l.entryFee))) {
    const expectedFee = hiPrice * lotNum * 1.010085;
    assert(
      Math.abs(Number(l.entryFee) - expectedFee) <= 2.5,
      `港股 ${l.code} 一手入场费 (${l.entryFee}) 与公式复算 (${expectedFee.toFixed(2)}) 偏差过大`,
    );
  }
  for (const cs of l.cornerstoneInvestors || []) {
    assert(!HK_NOISE_RE.test(String(cs).trim()), `港股 ${l.code} 基石投资者混入法律噪声词: ${cs}`);
  }
}

// 5. Gold domestic metadata sync, parity formula & score consistency
const domSeries = historicalGoldSeries(snapshot, "domestic");
assert.equal(
  domSeries.rows.length,
  snapshot.gold.history.domestic.length,
  "上金所国内金序列长度必须与 historyMeta.domestic 对齐，不得因元数据滞后被误拒",
);
const domClose = domesticGoldClose(snapshot);
assert(domClose && domClose.asOf === snapshot.gold.quotes.domestic.asOf, "黄金页国内金收盘日期必须与快照最新上金所日期一致");
const goldTrack = findItem(snapshot, "gold", "track");
assert.equal(
  scoreForItem(goldTrack).score,
  Math.round(Number(snapshot.gold.answer.score)),
  "黄金观察分不得重复叠加半年分位加减分",
);
const parity = goldParity({ quotes: { ...snapshot.gold.quotes, domestic: domClose } });
assert(parity && Number.isFinite(parity.parity) && Math.abs(parity.premium) < 15, "国内外金价折算克价与折溢价应在合理范围");

// 6. Smart Money cross-market overlap, report labels & option swap direction
const overlaps = buildGuruOverlapRows(snapshot);
const overlapNames = new Set(overlaps.map((r) => r.name));
for (const expectedName of ["腾讯控股", "阿里巴巴", "台积电", "谷歌"]) {
  assert(overlapNames.has(expectedName), `跨市场机构共同重仓应正确识别并聚合「${expectedName}」`);
}
for (const row of overlaps) {
  const holderIds = row.holders.map((h) => h.id);
  assert.equal(new Set(holderIds).size, holderIds.length, `共同重仓标的 ${row.name} 不得将同一家机构重复计数`);
}
const trend = buildGuruTrend(snapshot);
for (const cutRow of [...trend.cuts, ...trend.split]) {
  for (const cutter of cutRow.cutters) {
    if (cutter.type === "exit") {
      const inv = snapshot.investors.find((i) => i.id === cutter.id);
      const stillLong = (inv?.holdings || []).some(
        (h) => String(h.ticker || "").trim().toUpperCase() === cutRow.symbol && String(h.putCall || "").toLowerCase() !== "put",
      );
      assert(!stillLong, `机构 ${cutter.id} 仍持有 ${cutRow.symbol} 正股或看涨期权，不得误标为清仓退出`);
    }
  }
}
for (const guruItem of allItems(snapshot, "guru")) {
  scanPoisonStrings(guruItem, `guruItem(${guruItem.id})`);
  if (guruItem.group !== "overlap" && !guruItem.raw?.isLive) {
    for (const h of guruItem.raw?.holdings || []) {
      assert.notEqual(h.changeLabel, "变化待核验", `非13F定期报告组合 ${guruItem.id} 不应把正常披露显示为「变化待核验」`);
    }
    const repDate = String(guruItem.raw?.reportDate || "");
    const srcName = String(guruItem.raw?.profile?.sourceName || "");
    if (/-09-30$/.test(repDate)) {
      assert(!srcName.includes("一季报"), `组合 ${guruItem.id} 报告期为 ${repDate}，来源名称不得写死「一季报」`);
    }
  }
}

// 7. Full Mini Program Section & Detail page rendering verification across all 5 markets
const sectionConfig = loadPageFactory("pages/section/index.js");
for (const market of ["hk", "us", "a", "gold", "guru"]) {
  const page = instantiatePage(sectionConfig);
  page.onLoad({ market });
  scanPoisonStrings(page.data, `section(${market})`);
  const textDump = JSON.stringify(page.data);
  assert(!textDump.includes("伦敦现货") && !textDump.includes("伦敦金"), `栏目页 ${market} 不得将纽约期金误标为伦敦金`);
  assert(!textDump.includes("回本年数") && !textDump.includes("回本约"), `栏目页 ${market} 不得将市盈率误标为回本年数`);
  if (market === "hk") {
    const todayIso = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const realOpen = (page.data.hkApplyList || []).filter((r) => !r.closed && r.deadlineOffset != null && r.deadlineOffset >= 0);
    if (realOpen.length && page.data.sectionAnswerBar.includes("招股中")) {
      assert(
        page.data.sectionAnswerBar.includes(`招股中 ${realOpen.length} 只`),
        `港股结论条在招只数必须精确等于实际未截止只数 (${realOpen.length})，实际: ${page.data.sectionAnswerBar}`,
      );
    }
    for (const row of page.data.hkApplyList || []) {
      const rawListing = (snapshot.hk.listings || []).find((l) => String(l.code || "").replace(/\.HK$/i, "") === String(row.id));
      if (rawListing?.listingDate && rawListing.listingDate < todayIso && row.scheduleLine) {
        assert(!row.scheduleLine.includes("预计上市"), `已过原定上市日的 ${row.code} 不得继续显示「预计上市」: ${row.scheduleLine}`);
      }
    }
  }
    if (market === "a") {
    page.switchASubTab({ currentTarget: { dataset: { id: "calendar" } } });
    scanPoisonStrings(page.data, "section(a:calendar)");
    for (const m of page.data.aCalendarMonths || []) {
      if (m.count > 0) {
        page.selectACalendarMonth({ currentTarget: { dataset: { month: m.month } } });
        for (const r of page.data.aCalendarRows || []) {
          if (["601398", "601288", "601088"].includes(String(r.id))) {
            assert.notEqual(r.freqLabel, "一年3派", `${r.name} 半年报+年报派息不得因跨年窗口重复被误标为「一年3派」`);
          }
        }
      }
    }
  }
  if (market === "us") {
    assert.equal((page.data.usEtfList || []).length, 5, "美股栏目必须加载 5 只宽基与收息 ETF 基准");
    page.switchUsSubTab({ currentTarget: { dataset: { id: "all" } } });
    assert(page.data.usSectorDonut && page.data.usSectorDonut.src.startsWith("data:image/svg+xml;base64,"), "美股全部30只必须渲染行业分布环图");
  }
  if (market === "gold") {
    const p180 = Number(snapshot.gold?.quotes?.international?.percentile180);
    if (Number.isFinite(p180) && p180 <= 25) {
      assert(!page.data.sectionAnswerBar.includes("偏高"), `国际金处于 ${p180}% 历史低分位时，结论条不得自相矛盾显示「偏高」: ${page.data.sectionAnswerBar}`);
      assert(!String(page.data.goldQuotes?.[0]?.verdictBadge || "").includes("偏高"), "国际金低分位卡片不得误标为偏高区");
    }
  }
}

const detailConfig = loadPageFactory("pages/detail/index.js");
const sampleTargets = [
  ...usPoolItems(snapshot).map((it) => ["us", it.id]),
  ...(snapshot.aShare.quotes || []).map((q) => ["a", q.code.replace(/\.(SH|SZ)$/i, "")]),
  ["a", "515180"],
  ...(snapshot.hk.listings || []).slice(0, 5).map((l) => ["hk", String(l.code || l.rawCode).replace(/\.HK$/i, "")]),
  ["gold", "track"],
  ...allItems(snapshot, "guru").filter((g) => g.group !== "overlap").map((g) => ["guru", g.id]),
];
for (const [market, id] of sampleTargets) {
  const dPage = instantiatePage(detailConfig);
  dPage.onLoad({ market, id });
  assert(dPage.data.ready, `详情页 ${market}:${id} 必须成功渲染`);
  scanPoisonStrings(dPage.data, `detail(${market}:${id})`);
  const dump = JSON.stringify(dPage.data.view);
  assert(!dump.includes("伦敦金") && !dump.includes("伦敦现货"), `详情页 ${market}:${id} 不得将纽约期金误标为伦敦金`);
  assert(!dump.includes("回本约") && !dump.includes("回本年数"), `详情页 ${market}:${id} 不得将市盈率误标为回本年数`);
  if (market === "us" && US_NO_GROSS_MARGIN.has(id)) {
    assert(!dump.includes("毛利率") && !dump.includes("毛利 "), `详情页 us:${id} 不得展示不可比或失真的毛利率`);
  }
  if (market === "a" && A_BANK_CODES.has(String(id).replace(/\.(SH|SZ)$/i, ""))) {
    assert(!dump.includes("自由现金流") && !dump.includes("现金利润比"), `商业银行详情页 a:${id} 不得展示客户存款失真的自由现金流或现金利润比`);
  }
}

// 9. Consult / Guide / Legal pages & Full-App Compliance Redline Scan
const guideConfig = loadPageFactory("pages/guide/index.js");
for (const topic of ["accounts", "info", "us-start", "hk-open", "a-open"]) {
  const gPage = instantiatePage(guideConfig);
  gPage.onLoad({ topic });
  scanPoisonStrings(gPage.data, `guide(${topic})`);
  assert.equal(gPage.data.lead, "", `指引页 ${topic} lead 应保持精简为空`);
  assert((gPage.data.sections || []).length >= 1, `指引页 ${topic} 不得为空白无规则说明页`);
}
const legalConfig = loadPageFactory("pages/legal/index.js");
const lPage = instantiatePage(legalConfig);
scanPoisonStrings(lPage.data, "legal");
assert.equal((lPage.data.sections || []).length, 7, "协议页应保持精简的 7 节折叠结构");

const ILLEGAL_PROMISE_RE = /稳赚不赔|保本保息|保本高息|必涨牛股|包中签|保证翻倍|内幕消息|带你暴富/;
function walkSourceFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "data" || ent.name === "node_modules") continue;
      walkSourceFiles(full, out);
    } else if (/\.(js|wxml)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}
for (const file of walkSourceFiles(miniDir)) {
  const content = fs.readFileSync(file, "utf8");
  assert(!ILLEGAL_PROMISE_RE.test(content), `文件 ${path.relative(rootDir, file)} 含有违规承诺敏感词`);
}

// 8. Web index.html & assets/dashboard.js static accuracy contracts
const webHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
assert(webHtml.includes("String(row.code||row.symbol||'')"), "网页端 index.html 必须兼容 row.code 绑定 A股财务数据");
assert(!webHtml.includes("<td>${x.recommendPrice}</td>"), "网页端 index.html 不得直接裸插可能为 null/undefined 的 recommendPrice");
assert(!webHtml.includes("<td>${x.dividendStability}</td>"), "网页端 index.html 不得直接裸插可能为 undefined 的 dividendStability");
assert(webHtml.includes("targetPrice:bogusTarget?null:rawData.targetPrice"), "网页端 index.html 必须拦截 BRK.B 混入的 BRK.A 异常目标价");

const dashboardJs = fs.readFileSync(path.join(rootDir, "assets", "dashboard.js"), "utf8");
assert(!/market === 'GOLD'[\s\S]{0,900}分红对照/.test(dashboardJs), "daily.html 黄金卡片不得误标「分红对照」");

console.log(`全站数据准确性自动化复核通过：已逐项校验 30只美股 · 20只A股+红利ETF · ${snapshot.hk.listings.length}只在列港股+${snapshot.hk.history.length}只历史新股 · 黄金双市场 · 15家聪明钱机构 · ${sampleTargets.length}个详情视图`);
