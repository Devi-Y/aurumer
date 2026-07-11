import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readUSSnapshotHistory } from "../lib/us-snapshot-history.mjs";

const auditPath = resolve("data/strategy-audit.json");
const historyPath = resolve("data/us-signal-snapshots.json");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const history = await readUSSnapshotHistory(historyPath);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(audit.version === 1, "策略审计版本不正确");
assert(audit.autoApply === false, "策略候选不允许自动发布到用户页面");
assert(Array.isArray(audit.us?.candidates) && audit.us.candidates.length >= 4, "策略候选不足");
assert(audit.us.snapshotDays === history.days.length, "策略审计与交易日快照不同步");
assert(audit.hk && Number.isFinite(audit.hk.sampleCount), "港股审计摘要缺失");
assert(audit.hk.fiveDaySampleCount >= 50, "港股五日真实校准样本不足 50");
assert(Boolean(audit.hk.algorithmVersion), "港股审计缺少算法版本");
assert(audit.usTechnical?.autoApply === false, "美股技术候选不允许自动发布");
assert(audit.usTechnical?.universe?.length === 7, "美股技术回测必须覆盖七姐妹");
assert(audit.usTechnical?.candidates?.length >= 4, "美股技术价格候选不足");

console.log(
  JSON.stringify(
    {
      autoApply: audit.autoApply,
      candidateForReview: audit.us.candidateForReview,
      hkFiveDaySamples: audit.hk.fiveDaySampleCount,
      snapshotDays: audit.us.snapshotDays,
      status: audit.us.status,
      technicalStatus: audit.usTechnical.status,
      technicalCandidateForReview: audit.usTechnical.candidateForReview,
      technicalHistoryDays: audit.usTechnical.historyDays,
      technicalBestValidation: [...audit.usTechnical.candidates]
        .sort(
          (left, right) =>
            (right.validation.averageNetReturn ?? -Infinity) -
            (left.validation.averageNetReturn ?? -Infinity),
        )
        .slice(0, 3)
        .map((candidate) => ({
          id: candidate.id,
          samples: candidate.validation.sampleCount,
          winRate: candidate.validation.winRate,
          averageNetReturn: candidate.validation.averageNetReturn,
          profitFactor: candidate.validation.profitFactor,
          eligibleForReview: candidate.eligibleForReview,
        })),
    },
    null,
    2,
  ),
);
