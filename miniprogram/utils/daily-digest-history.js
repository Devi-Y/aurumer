/**
 * 今日重点详情页要展示"相较上次变化"。这不能用 change-center.js 那一套——
 * 那是用户主动加自选之后才追踪的复盘机制，跟首页免登录、不认自选股的要求对不上。
 * 这里退一步：只在这一台设备上，把上一次算出的结论存起来，下次同一条打开时跟它比对。
 * 换手机、清缓存、第一次用，都如实说"首次建立对照"，不编一句"较上次持平"。
 */
const STORAGE_KEY = "aurum_daily_digest_v1";
const VERSION = 1;

function readPrevious() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || raw.version !== VERSION || !raw.entries) return {};
    return raw.entries;
  } catch (error) {
    return {};
  }
}

function persist(entries) {
  try {
    wx.setStorageSync(STORAGE_KEY, { version: VERSION, entries, at: Date.now() });
  } catch (error) {
    // 写不进去只影响下一次的"较上次"对照，这一次的展示不受影响。
  }
}

function diffText(previousEntries, id, title, tone) {
  const prev = previousEntries ? previousEntries[id] : null;
  if (!prev) return "首次建立对照，暂无上次记录";
  if (prev.title === title && prev.tone === tone) return "较上次判断持平";
  return `较上次：${prev.title}`;
}

module.exports = { readPrevious, persist, diffText };
