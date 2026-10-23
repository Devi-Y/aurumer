import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const events = require("../miniprogram/utils/us-event-facts.js");
const { sanitizeSnapshot } = require("../cloudfunctions/aurum-data/sanitize.js");
const { allItems, findItem } = require("../miniprogram/utils/answers.js");
const { buildDailyAnswers } = require("../miniprogram/utils/daily-answers.js");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1326801/000132680126000123/meta-20261020.htm";
const exhibitUrl = sourceUrl.replace("meta-20261020.htm", "ex991.htm");
const checkedAt = new Date().toISOString();
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const fact = (symbol = "META") => ({ symbol, state: "verified", scope: "recent-event-filings", eventKind: "quarterly_earnings",
  sourceUrl, filingDate: day, eventDate: day, period: { end: day }, fetchedAt: checkedAt, checkedAt,
  priceCausation: "not_established", facts: [{ summary: "公司披露季度营收与下一季指引（测试样本）。",
    sourceUrl: exhibitUrl, documentSha256: "a".repeat(64), metrics: [] }] });

function snapshot() {
  const data = JSON.parse(read("data/live-snapshot.json"));
  data.us.eventFacts = { META: fact() };
  data.us.stocks.forEach((stock, index) => { stock.heatScore = stock.symbol === "META" ? 1000 : 900 - index; });
  return data;
}

function pageFunctions(path, names) {
  const context = { require: createRequire(new URL(`../${path}`, import.meta.url)), Page() {}, console,
    wx: {}, getApp() { return {}; } };
  vm.runInNewContext(`${read(path)}\nglobalThis.testApi = {${names.join(",")}};`, context);
  return context.testApi;
}

test("verified event survives public sanitization with dates, source and hash", () => {
  const publicData = sanitizeSnapshot(snapshot());
  const event = publicData.us.eventFacts.META;
  assert.equal(event.state, "verified");
  assert.equal(event.eventDate, day);
  assert.equal(event.fetchedAt, checkedAt);
  assert.equal(event.facts[0].sourceUrl, exhibitUrl);
  assert.equal(event.facts[0].documentSha256, "a".repeat(64));
  assert.match(events.eventSummary(publicData, "META"), /公司披露季度营收/);
  assert.equal(events.eventSources(publicData, "META").length, 2);
});

test("unknown, missing, incomplete and cross-accession data never become facts or no-event claims", () => {
  const invalid = [undefined, { ...fact(), state: "unknown" }, { ...fact(), eventDate: null },
    { ...fact(), fetchedAt: null }, { ...fact(), symbol: "AMD" },
    { ...fact(), sourceUrl: "https://example.com/fake.htm" },
    { ...fact(), facts: [{ ...fact().facts[0], sourceUrl: exhibitUrl.replace("000132680126000123", "000132680126000124") }] },
    { ...fact(), facts: [{ ...fact().facts[0], documentSha256: null }] },
    { ...fact(), priceCausation: "established" }];
  for (const item of invalid) {
    const data = { us: { eventFacts: { META: item } } };
    assert.equal(events.eventSummary(data, "META"), "近期公司事件待核验");
    assert.deepEqual(events.eventSources(data, "META"), []);
    assert.equal(events.eventFactFor(data, "META").facts.length, 0);
  }
});

test("newer check preserves actual fetch/event dates and qualifiers", () => {
  const data = { us: { eventFacts: { META: { ...fact(), fetchedAt: new Date(Date.now() - 3600000).toISOString(),
    facts: [{ ...fact().facts[0], summary: "未经审计初步估计；下一季营收为管理层预测。" }] } } } };
  const event = events.eventFactFor(data, "META");
  assert.equal(event.state, "verified");
  assert.notEqual(event.fetchedAt, event.checkedAt);
  assert.equal(event.eventDate, day);
  assert.match(events.eventSummary(data, "META"), /未经审计初步估计.*管理层预测/);
});

test("native heat ranking includes a hottest Mag7 and both native views show the fact", () => {
  const data = snapshot();
  assert.equal(allItems(data, "us").filter((item) => item.group === "hot")[0].code, "META");
  const { buildUsModule } = pageFunctions("miniprogram/pages/section/index.js", ["buildUsModule"]);
  const view = buildUsModule(data);
  assert.equal(view.hotList[0].code, "META");
  assert.equal(view.hotList[0].event, "公布季度业绩");
  assert.equal(view.sevenList.find((item) => item.code === "META").event, "公布季度业绩");
  assert.doesNotMatch(view.hotHint, /不含七姐妹/);
  const template = read("miniprogram/pages/section/index.wxml");
  assert.equal((template.match(/class="us-event-line">\{\{item.event\}\}/g) || []).length, 2);
});

test("native details and answer cards prefer concrete facts over a filing category", () => {
  const data = snapshot();
  data.us.filings = [{ symbol: "META", filingDate: day, form: "8-K", labels: ["自愿披露"], sourceUrl }];
  const { detailView, buildSourceLinks } = pageFunctions("miniprogram/pages/detail/index.js", ["detailView", "buildSourceLinks"]);
  const view = detailView(findItem(data, "us", "META"), data);
  assert.match(view.dynamics.event, /公司披露季度营收/);
  assert.equal(view.dynamics.eventVerified, true);
  assert.ok(buildSourceLinks(findItem(data, "us", "META"), data).some((source) => source.url === exhibitUrl));
  const answers = buildDailyAnswers(data, "us");
  const hot = answers.find((card) => card.id === "us-hot");
  assert.match(hot.rows.body[0].note, /公司披露季度营收/);
  assert.match(hot.modal, /公司披露季度营收/);
  assert.match(answers.find((card) => card.id === "us-seven").modal, /公司披露季度营收/);
});

test("web top three use heat alone, include Mag7 and escape event text before HTML", () => {
  const html = read("index.html");
  const context = { AurumEventFacts: events, MAGNIFICENT_SEVEN: ["META"] };
  for (const name of ["stockHeatRank", "hotMarketPool", "getUSGroups", "stockEventSnapshot", "stockEventText", "eventHtml", "stockEventSection"]) {
    const functionText = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(functionText, `${name} must remain executable`);
    vm.runInNewContext(functionText, context);
  }
  context.US_STOCKS = [{ t: "META", heatScore: 100, qualityEligible: false },
    { t: "AMD", heatScore: 90, qualityEligible: true }, { t: "ARM", heatScore: 80, qualityEligible: true },
    { t: "SMCI", heatScore: 70, qualityEligible: true }];
  assert.equal(context.getUSGroups().find((group) => group.id === "hot").items[0].t, "META");
  const unsafe = fact(); unsafe.facts[0].summary = '<script>alert("test")</script>';
  const output = context.stockEventSection({ t: "META", eventFact: unsafe });
  assert.match(output, /&lt;script&gt;/);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /ex991.htm/);
  assert.match(output, /同期发生不代表涨跌原因/);
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script[1].trim() && !/^\s*\{/.test(script[1])) new vm.Script(script[1]);
  }
});

test("cloud, native and browser use identical fact validation", () => {
  const module = read("miniprogram/utils/us-event-facts.js");
  assert.equal(read("cloudfunctions/aurum-data/us-event-facts.js"), module);
  const browser = {};
  vm.runInNewContext(read("assets/us-event-facts.js"), browser);
  assert.equal(browser.AurumEventFacts.eventSummary(snapshot(), "META"), events.eventSummary(snapshot(), "META"));
  assert.match(read("scripts/audit-release-consistency.mjs"), /miniSnapshot\.us\?\.eventFacts/);
});

// Opt-in real captured evidence; no network or production writes in this test.
test("captured current Top3 facts survive sanitizer, native rows, details and original links",
  { skip: !process.env.WANGYUE_EVENT_FIXTURE }, () => {
    const raw = JSON.parse(readFileSync(process.env.WANGYUE_EVENT_FIXTURE, "utf8"));
    const data = sanitizeSnapshot(raw);
    const { buildUsModule } = pageFunctions("miniprogram/pages/section/index.js", ["buildUsModule"]);
    const { detailView, buildSourceLinks } = pageFunctions("miniprogram/pages/detail/index.js", ["detailView", "buildSourceLinks"]);
    const view = buildUsModule(data);
    assert.deepEqual(Array.from(view.hotList, (row) => row.code), ["META", "AMD", "ARM"]);
    const meta = view.hotList.find((row) => row.code === "META");
    const amd = view.hotList.find((row) => row.code === "AMD");
    assert.match(meta.event, /拟向股东派发新股.*尚未生效/);
    assert.equal(amd.event, "已签订收购协议");
    assert.equal(view.hotList.find((row) => row.code === "ARM").event, "");
    assert.match(view.sevenList.find((row) => row.code === "META").event, /尚未生效/);
    for (const symbol of ["META", "AMD", "ARM"]) {
      const item = findItem(data, "us", symbol);
      const detail = detailView(item, data);
      const event = data.us.eventFacts[symbol];
      assert.equal(detail.dynamics.event, events.eventSummary(data, symbol));
      assert.equal(detail.dynamics.eventVerified, symbol !== "ARM");
      if (event.state === "verified") {
        const sources = buildSourceLinks(item, data);
        assert.ok(sources.some((source) => source.url === event.facts[0].sourceUrl));
        assert.equal(detail.dynamics.event.includes(event.eventDate), true);
        assert.equal(data.us.stocks.find((stock) => stock.symbol === symbol).asOf,
          raw.us.stocks.find((stock) => stock.symbol === symbol).asOf);
      }
    }
    const hot = buildDailyAnswers(data, "us").find((card) => card.id === "us-hot");
    assert.match(hot.rows.body[0].note, /须待章程生效/);
    assert.match(hot.rows.body[1].note, /发行股数未定/);
    assert.equal(hot.rows.body[2].note, "近期公司事件待核验");
  });
