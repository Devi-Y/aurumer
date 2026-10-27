#!/usr/bin/env node
// 对外快照的新鲜度看门狗。
//
// 存在的理由：2026-08-15 到 08-31 那次停更能躺 17 天没人发现，根因不是没有告警，
// 而是告警本身跟着一起死了——账号 8 月的 Actions 分钟数用超之后，引擎仓（私有）的
// refresh 和 notify 两个 job 都不再真正启动，「任务失败时开 Issue」这条链路从第一环
// 就断了。9 月 1 日额度按月重置，服务自己恢复，说明这是个会按月复发的问题。
//
// 排查时要认的信号（2026-09-03 复盘核实）：那段时间 Actions 里**有**失败记录，
// 而且每天 15~16 条，并不是空白。区别在于那些 job 的 steps 是 0 条、耗时约 3 秒——
// 这是「排队后被拒绝执行」的签名，不是代码跑挂了。看见这个形状先去查 Billing。
//
// 结论：告警不能和被监控的东西住在同一个会一起挂掉的地方。
// 这个脚本跑在公开仓 aurumer 里——公开仓的 Actions 分钟数免费、不受私有仓
// 计费状态影响，所以引擎仓整个趴下时它照样能喊。
//
// 它检的也是「有没有成功过」（快照的 updatedAt 有多旧），不是「有没有失败过」：
// 前者才是用户真正在意的性质，而且在「连运行记录都没产生」的情况下同样成立。

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validBatchTime } from "./check-mini-freshness.mjs";
const require = createRequire(import.meta.url);
const { weekdayAgeMs } = require("../miniprogram/utils/action-freshness.js");
const PRODUCT = require("../miniprogram/config/product.js");

const SNAPSHOT_URL =
  process.env.SNAPSHOT_URL || "https://devi-y.github.io/aurumer/data/live-snapshot.json";
const TIMEOUT_MS = 30000;

function hours(ms) {
  return ms / 3600000;
}

function fmt(n) {
  return Number(n).toFixed(1);
}

export async function checkPublicSnapshot({ snapshotUrl = SNAPSHOT_URL, fetchImpl = fetch, dataMode = PRODUCT.dataMode, now = Date.now(), maxAgeHours = Number(process.env.MAX_AGE_HOURS || (dataMode === "historical-reference" ? 7 * 24 : 36)) } = {}) {
  const problems = [];
  const facts = [];
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) problems.push("资料更新提示门槛必须是大于零的小时数");

  let response;
  let body;
  try {
    response = await fetchImpl(snapshotUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "cache-control": "no-cache" },
    });
    body = await response.text();
  } catch (error) {
    problems.push(`拉取对外快照失败：${error.message}`);
  }

  let snapshot = null;
  if (response && !response.ok) {
    problems.push(`对外快照返回 HTTP ${response.status}`);
  } else if (body) {
    try {
      snapshot = JSON.parse(body);
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        problems.push("对外快照缺少有效的数据对象");
        snapshot = null;
      }
    } catch (error) {
      problems.push(`对外快照不是合法 JSON：${error.message}`);
    }
  } else if (response) {
    problems.push("对外快照响应为空");
  }

  let ageHours = null;
  if (snapshot) {
    const updatedAt = snapshot.updatedAt || null;
    const parsed = validBatchTime(updatedAt);
    if (!Number.isFinite(parsed)) {
      problems.push(`对外快照缺少可解析的 updatedAt（当前值：${updatedAt ?? "无"}）`);
    } else {
      ageHours = hours(now - parsed);
      facts.push(`updatedAt = ${updatedAt}`);
      const historical = dataMode === "historical-reference";
      const checkedHours = historical ? ageHours : hours(weekdayAgeMs(updatedAt, now));
      const unit = historical ? "自然小时" : "工作小时";
      facts.push(`资料批次距今 = ${fmt(ageHours)} 小时；提示门槛 ${maxAgeHours} ${unit}`);
      if (historical) facts.push("历史走势参考；巡检核对资料与来源可用性，不要求盘中或每日新报价");
      if (checkedHours > maxAgeHours) {
        problems.push(
          `对外资料批次已有 ${fmt(checkedHours)} ${unit}，超过 ${maxAgeHours} ${unit}的资料更新提示门槛`,
        );
      }
      // 未来时间通常意味着生成机器的时钟不对，或者快照被手工改过。
      if (ageHours < 0) {
        problems.push(`对外快照的 updatedAt 在未来（${fmt(-ageHours)} 小时后）`);
      }
    }

    if (snapshot.status && snapshot.status !== "live") {
      problems.push(`对外快照状态不是 live：${snapshot.status}`);
    }
    if (!Array.isArray(snapshot.sources) || !snapshot.sources.some((source) => source && source.id && /^https?:\/\//.test(source.url || ""))) {
      problems.push("对外快照缺少可核查的来源清单");
    }

    // 停更时最先塌的就是这几块，顺手一起报出来，省得再去翻数据。
    const counts = {
      港股在售: (snapshot.hk?.listings || []).length,
      美股: (snapshot.us?.stocks || []).length,
      A股行情: (snapshot.aShare?.quotes || []).length,
      机构: (snapshot.investors || []).length,
    };
    facts.push(
      Object.entries(counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
    );
    if (counts.美股 < 30) problems.push(`对外快照美股不足 30 只（当前 ${counts.美股}）`);
    if (counts.A股行情 < 20) problems.push(`对外快照 A 股不足 20 只（当前 ${counts.A股行情}）`);
    if (counts.机构 < 9) problems.push(`对外快照机构不足 9 位（当前 ${counts.机构}）`);
  }

  return { ok: problems.length === 0, problems, facts, ageHours };
}

async function main() {
  const { ok, problems, facts, ageHours } = await checkPublicSnapshot();
  const lines = [
    `## 对外历史资料健康巡检 ${ok ? "✅ 正常" : "❌ 异常"}`,
    "",
    `检查地址：${SNAPSHOT_URL}`,
    "",
    ...facts.map((f) => `- ${f}`),
  ];
  if (!ok) {
    lines.push("", "### 问题", ...problems.map((p) => `- ${p}`));
  }
  const report = lines.join("\n");

  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `stale=${ok ? "false" : "true"}\n` +
        `age_hours=${ageHours === null ? "" : fmt(ageHours)}\n` +
        `detail<<EOF\n${problems.join("\n")}\nEOF\n`,
    );
  }

  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
