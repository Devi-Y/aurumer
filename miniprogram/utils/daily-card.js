/**
 * 微信群每日卡片文案：结论 + 风险边界，不含买卖指令。
 */
function buildDailyCard({ points = [], extraLines = [], asOf = "", holdingsReminder = null } = {}) {
  const lines = [
    "【望潮今日重点】",
    asOf ? `数据 ${asOf.replace(/^数据截至\s*/, "")}` : null,
    "",
  ];
  const extras = (extraLines || []).map((line) => String(line || "").trim()).filter(Boolean);
  if (extras.length) {
    extras.forEach((line) => lines.push(line));
  } else {
    (points || []).forEach((point) => {
      const label = String(point.label || "").trim();
      const value = String(point.value || "—").trim();
      if (!label) return;
      lines.push(`${label}：${value}`);
    });
  }
  if (holdingsReminder && holdingsReminder.triggered && holdingsReminder.text) {
    lines.push("");
    lines.push(`持仓对照：${String(holdingsReminder.text).slice(0, 48)}`);
  }
  lines.push("");
  lines.push("以上为研究观察，不是买卖建议；打开望潮查看依据与风险。");
  return lines.filter((line) => line !== null).join("\n");
}

module.exports = { buildDailyCard };
