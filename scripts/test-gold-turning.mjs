import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const snapshot = require("../data/live-snapshot.json");
const { goldTurningViews, buildDailyAnswers } = require("../miniprogram/utils/daily-answers.js");
const { goldTurningPoint } = require("../miniprogram/utils/market-lenses.js");

const clone = (value) => structuredClone(value);

test("real international and SGE series retain independent turning dates and actual windows", () => {
  const before = JSON.stringify(snapshot.gold);
  const views = goldTurningViews(snapshot.gold);
  for (const view of views) {
    const expected = goldTurningPoint(snapshot.gold.history[view.key], snapshot.gold.quotes[view.key]?.price);
    assert.deepEqual(view.turn, expected);
    assert.match(view.summary, new RegExp(view.label));
    assert.match(view.detail, new RegExp(`${expected.days}个收盘日`));
    assert.match(view.detail, /观察窗口\d{4}-\d{2}-\d{2}至\d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(view.detail, /半年/);
  }
  const card = buildDailyAnswers(snapshot, "gold").find((row) => row.id === "gold-turn");
  assert.match(card.answer, /国际金/);
  assert.match(card.answer, /人民币金/);
  assert.match(card.modal, /人民币金/);
  assert.equal(JSON.stringify(snapshot.gold), before, "presentation must not mutate quote times or scores");
});

test("short domestic series stays explicitly unavailable without suppressing international facts", () => {
  const gold = clone(snapshot.gold);
  gold.history.domestic = gold.history.domestic.slice(-59);
  const views = goldTurningViews(gold);
  assert.ok(views[0].turn);
  assert.equal(views[1].turn, null);
  assert.match(views[1].summary, /人民币金样本不足60个收盘日/);
  assert.doesNotMatch(views[1].detail, /半年|走强|走弱/);
});

test("an unobserved crossing is limited to comparable days, not the entire history window", () => {
  const gold = clone(snapshot.gold);
  gold.history.domestic = gold.history.domestic.slice(-74).map((row, index) => ({ ...row, close: 800 + index }));
  const view = goldTurningViews(gold)[1];
  assert.equal(view.turn.crossDate, "");
  assert.match(view.summary, /窗口内未见穿越/);
  assert.match(view.detail, /可比较的15个交易日/);
  assert.doesNotMatch(view.detail, /半年/);
});

test("opposite market directions remain distinct on the daily card", () => {
  const data = clone(snapshot);
  data.gold.history.international = data.gold.history.international.map((row, index) => ({ ...row, close: 5000 - index }));
  data.gold.history.domestic = data.gold.history.domestic.map((row, index) => ({ ...row, close: 800 + index }));
  const views = goldTurningViews(data.gold);
  assert.notEqual(views[0].turn.above, views[1].turn.above);
  const card = buildDailyAnswers(data, "gold").find((row) => row.id === "gold-turn");
  assert.match(card.answer, /国际金.*走弱/);
  assert.match(card.answer, /人民币金.*走强/);
  assert.equal(card.tone, "muted");
});
