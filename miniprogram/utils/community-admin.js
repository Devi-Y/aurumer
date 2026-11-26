function joinedAtIso(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!d || !t) return "";
  const year = Number(d[1]), month = Number(d[2]), day = Number(d[3]), hour = Number(t[1]), minute = Number(t[2]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return "";
  const localTime = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(localTime);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return "";
  return new Date(localTime - 8 * 60 * 60 * 1000).toISOString();
}

function displayBeijing(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 16).replace("T", " ")}（北京时间）`;
}
module.exports = { joinedAtIso, displayBeijing };
