/**
 * 从公开快照与关注清单生成「不能错过」的事件表。
 * 只产出时间与事实，不生成买卖指令。
 */
const { allItems } = require("./answers");

function parseDay(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    const time = Date.parse(text);
    if (Number.isNaN(time)) return null;
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayLabel(date) {
  if (!date) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysFromToday(date) {
  if (!date) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function urgency(offset) {
  if (offset == null) return "later";
  if (offset < 0) return "past";
  if (offset === 0) return "today";
  if (offset <= 3) return "soon";
  if (offset <= 14) return "week";
  return "later";
}

function urgencyLabel(kind) {
  return {
    today: "今天",
    soon: "3 天内",
    week: "两周内",
    later: "更晚",
    past: "已过",
  }[kind] || "";
}

function pushEvent(list, event) {
  if (!event || !event.date) return;
  const offset = daysFromToday(event.date);
  list.push({
    ...event,
    id: event.id || `${event.kind}-${event.code || event.title}-${dayLabel(event.date)}`,
    dateLabel: dayLabel(event.date),
    offset,
    urgency: urgency(offset),
    urgencyLabel: urgencyLabel(urgency(offset)),
    offsetLabel: offset == null
      ? ""
      : (offset === 0 ? "今天" : (offset > 0 ? `${offset} 天后` : `${Math.abs(offset)} 天前`)),
  });
}

function buildResearchEvents(snapshot, watchItems = []) {
  const events = [];
  if (!snapshot) return { upcoming: [], past: [], all: [] };

  (snapshot.hk && snapshot.hk.listings || []).forEach((item) => {
    const name = item.shortName || item.name || item.code || "港股新股";
    const code = item.code || item.rawCode || "";
    pushEvent(events, {
      kind: "hk-offer",
      market: "hk",
      marketLabel: "港股打新",
      title: `${name} 招股截止`,
      detail: item.entryFee != null ? `一手约 ${Math.round(Number(item.entryFee))} 港元` : "核对招股文件",
      code,
      date: parseDay(item.offerDeadline),
      source: item.source || "港交所公开文件",
      paywallHint: "开通后可把截止/上市日放进日历，并自动保存申购记录与上市后对照。",
    });
    pushEvent(events, {
      kind: "hk-listing",
      market: "hk",
      marketLabel: "港股打新",
      title: `${name} 上市日`,
      detail: "只复盘上市表现，不构成申购指令",
      code,
      date: parseDay(item.listingDate),
      source: item.source || "港交所公开文件",
      paywallHint: "开通后可在上市日提醒你回看申购记录与公开表现。",
    });
  });

  (snapshot.investors || []).forEach((item) => {
    const name = item.name || "机构";
    pushEvent(events, {
      kind: "13f",
      market: "investors",
      marketLabel: "聪明人持仓",
      title: `${name} 披露日`,
      detail: "13F/公开持仓有滞后，不可当实时跟仓信号",
      code: item.id || "",
      date: parseDay(item.filingDate),
      source: item.source || "SEC 13F / 公开披露",
      lagNote: "披露滞后，研究观察用",
      paywallHint: "开通后可追踪季度变化，并始终标注披露滞后。",
    });
  });

  // 关注里的港股若已有匹配，补充个人视角事件（避免重复 id）
  const seen = new Set(events.map((item) => item.id));
  (watchItems || []).forEach((watch) => {
    if (watch.market !== "hk") return;
    const list = allItems(snapshot, "hk") || [];
    const matched = list.find((entry) => {
      const code = String(watch.code || "").toUpperCase().replace(/\.HK$/i, "");
      return code && String(entry.code || "").toUpperCase().replace(/\.HK$/i, "") === code;
    });
    if (!matched) return;
    const raw = matched.raw || {};
    ["offerDeadline", "listingDate"].forEach((field) => {
      const kind = field === "offerDeadline" ? "hk-offer" : "hk-listing";
      const title = field === "offerDeadline"
        ? `${watch.name} 招股截止（关注）`
        : `${watch.name} 上市日（关注）`;
      const id = `${kind}-watch-${watch.id}`;
      if (seen.has(id)) return;
      pushEvent(events, {
        id,
        kind,
        market: "hk",
        marketLabel: "我的关注",
        title,
        detail: "来自你的关注清单",
        code: watch.code || "",
        date: parseDay(raw[field]),
        source: raw.source || "港交所公开文件",
        paywallHint: "开通后可把关注事件纳入每日日历摘要。",
      });
      seen.add(id);
    });
  });

  const sorted = events
    .filter((item) => item.date)
    .sort((a, b) => a.date - b.date);
  const upcoming = sorted.filter((item) => item.offset == null || item.offset >= 0);
  const past = sorted.filter((item) => item.offset != null && item.offset < 0).reverse();
  return {
    upcoming: upcoming.slice(0, 40),
    past: past.slice(0, 20),
    all: sorted,
    nextCount: upcoming.filter((item) => item.urgency === "today" || item.urgency === "soon").length,
  };
}

module.exports = {
  buildResearchEvents,
  dayLabel,
  parseDay,
};
