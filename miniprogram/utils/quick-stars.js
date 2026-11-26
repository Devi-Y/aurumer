"use strict";

/**
 * 零登录门槛本机星标工具（借鉴雪球/同花顺自选直达，纯存本机 Storage，0 账号负担）。
 */
const STAR_STORAGE_KEY = "aurum_quick_stars_v1";
const MAX_STARS = 24;

function readRawStars() {
  try {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return [];
    const raw = wx.getStorageSync(STAR_STORAGE_KEY);
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch (err) {
    return [];
  }
}

function writeRawStars(list) {
  const clean = (Array.isArray(list) ? list : []).slice(0, MAX_STARS);
  try {
    if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      wx.setStorageSync(STAR_STORAGE_KEY, clean);
    }
  } catch (err) {
    // 忽略本机存储写满等极端异常
  }
  return clean;
}

function starKey(market, id) {
  return `${String(market || "").trim()}:${String(id || "").trim()}`;
}

function listQuickStars() {
  return readRawStars().filter((item) => item && item.market && item.id && item.name);
}

function isQuickStarred(market, id) {
  const target = starKey(market, id);
  return listQuickStars().some((item) => starKey(item.market, item.id) === target);
}

function toggleQuickStar({ market, id, name, code = "" } = {}) {
  if (!market || !id || !name) return { starred: false, list: listQuickStars() };
  const target = starKey(market, id);
  const current = listQuickStars();
  const exists = current.some((item) => starKey(item.market, item.id) === target);
  if (exists) {
    const next = writeRawStars(current.filter((item) => starKey(item.market, item.id) !== target));
    return { starred: false, list: next };
  }
  const entry = {
    key: target,
    market: String(market),
    id: String(id),
    name: String(name).slice(0, 16),
    code: String(code || "").slice(0, 16),
    savedAt: Date.now(),
  };
  const next = writeRawStars([entry, ...current]);
  return { starred: true, list: next };
}

module.exports = {
  listQuickStars,
  isQuickStarred,
  toggleQuickStar,
};
