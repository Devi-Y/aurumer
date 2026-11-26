import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const moduleUrl = new URL("../miniprogram/pages/list/index.js", import.meta.url);
const localRequire = createRequire(moduleUrl);
const snapshot = JSON.parse(readFileSync(new URL("../data/live-snapshot.json", import.meta.url), "utf8"));
const { allItems, aShareDividendStability } = localRequire("../../utils/answers");
let page;
const context = {
  require(name) {
    if (name === "../../data/store") return { loadSnapshot(callback) { callback(snapshot, "历史资料", { kind: "fresh" }); } };
    return localRequire(name);
  },
  Page(value) { page = value; },
  wx: { setNavigationBarTitle() {} },
  console,
};
vm.runInNewContext(readFileSync(moduleUrl, "utf8"), context);

function render(group) {
  page.data = { ...page.data, market: "a", group };
  page.setData = function (updates) { Object.assign(this.data, updates); };
  page.refresh();
  return page.data;
}

test("A-share lists display their actual ranking metrics and historical dates", () => {
  const source = allItems(snapshot, "a");
  for (const lens of ["stable5", "yield5"]) {
    const result = render(lens);
    const ranked = source.filter((item) => item.lensRank?.[lens]).sort((a, b) => a.lensRank[lens] - b.lensRank[lens]);
    assert.equal(result.items.length, ranked.length);
    assert.equal(result.items.length, 5);
    result.items.forEach((row, i) => {
      assert.equal(row.id, ranked[i].id);
      assert.equal(row.badge, "");
      assert.equal(row.researchScoreLabel, "");
      assert.equal(row.strategyLabel, "");
      if (lens === "stable5") assert.equal(row.metricLabel, `稳定性 ${aShareDividendStability(ranked[i].raw)}分`);
      else {
        const historical = ranked[i].raw.historicalDividendYield;
        assert.equal(row.metricLabel, `历史股息率 ${historical.yieldPercent.toFixed(2)}%`);
        assert.match(row.fact, new RegExp(`${historical.year}年分红`));
        assert.ok(row.fact.includes(historical.priceAsOf));
      }
    });
    assert.doesNotMatch(result.groupHelp, /可持续股息率|参考买卖价|高息待核/);
    assert.ok(result.filters.every((filter) => !/优等|稳健|高息待核|底仓|短持/.test(filter.label)));
  }
});

test("missing historical yield never falls back to the legacy estimate", () => {
  const source = readFileSync(moduleUrl, "utf8");
  const isolated = { ...context, Page() {} };
  vm.runInNewContext(`${source}\nglobalThis.testMetric = comparisonMetric;`, isolated);
  assert.equal(isolated.testMetric({ raw: { currentDividendYield: 88, historicalDividendYield: null } }, "a", "yield5"), null);
});
