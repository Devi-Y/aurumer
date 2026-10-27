import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMiniFreshness } from "./check-mini-freshness.mjs";
import { checkPublicSnapshot } from "./check-snapshot-freshness.mjs";

// 纯内存验收：不抓取远端、不修改随包或公开快照、不创建运维 Issue。
const now = Date.parse("2026-10-27T08:00:00.000Z");
const hour = 3_600_000;
const batch = (hoursAgo) => ({
  updatedAt: new Date(now - hoursAgo * hour).toISOString(), status: "live",
  sources: [{ id: "official-fixture", url: "https://example.invalid/source" }],
  us: { stocks: Array(30).fill({}) }, aShare: { quotes: Array(20).fill({}) }, investors: Array(9).fill({}),
});
const inspect = (snapshot, options = {}) => checkPublicSnapshot({
  now, dataMode: "historical-reference",
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(snapshot) }),
  ...options,
});

test("historical uploads retain old dated batches while other modes preserve the 36-working-hour boundary", () => {
  const old = batch(24 * 60);
  const before = JSON.stringify(old);
  assert.match(checkMiniFreshness(old, { dataMode: "historical-reference", now }), /历史批次日期检查通过/);
  assert.throws(() => checkMiniFreshness(old, { dataMode: "t-plus-one", now }), /超过 36 个工作小时/);
  assert.equal(JSON.stringify(old), before);
});

test("all upload modes reject missing, malformed, impossible and future batch timestamps", () => {
  for (const dataMode of ["historical-reference", "t-plus-one"]) {
    for (const updatedAt of [null, "bad-time", "2026-02-30T00:00:00Z", "2026-10-27T09:00:00Z"]) {
      assert.throws(() => checkMiniFreshness({ updatedAt }, { dataMode, now }), /有效 updatedAt|时间在未来/);
    }
  }
});

test("historical watchdog reports a weekly batch delay without requesting daily quotes", async () => {
  const recent = await inspect(batch(6 * 24));
  assert.equal(recent.ok, true);
  assert.ok(recent.facts.some((fact) => fact.includes("168 自然小时")));
  const delayed = await inspect(batch(8 * 24));
  assert.equal(delayed.ok, false);
  assert.ok(delayed.problems.some((problem) => problem.includes("168 自然小时")));
  const otherMode = await inspect(batch(6 * 24), { dataMode: "t-plus-one" });
  assert.equal(otherMode.ok, false);
  assert.ok(otherMode.problems.some((problem) => problem.includes("36 工作小时")));
});

test("health checks still reject source loss, future dates, HTTP errors and invalid payloads", async () => {
  const missingSource = batch(12); missingSource.sources = [];
  assert.ok((await inspect(missingSource)).problems.some((problem) => problem.includes("来源清单")));
  assert.ok((await inspect(batch(-0.01))).problems.some((problem) => problem.includes("在未来")));
  const invalidTime = batch(12); invalidTime.updatedAt = "2026-02-30T00:00:00Z";
  assert.ok((await inspect(invalidTime)).problems.some((problem) => problem.includes("updatedAt")));
  assert.equal((await inspect(null)).ok, false);
  const http = await inspect(null, { fetchImpl: async () => ({ ok: false, status: 503, text: async () => "unavailable" }) });
  assert.ok(http.problems.some((problem) => problem.includes("HTTP 503")));
  const failed = await inspect(null, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.ok(failed.problems.some((problem) => problem.includes("拉取对外快照失败")));
  const json = await inspect(null, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => "invalid-json" }) });
  assert.ok(json.problems.some((problem) => problem.includes("不是合法 JSON")));
});
