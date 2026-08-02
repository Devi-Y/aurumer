const MAX_PAGE_STACK = 10;
/** 已去掉底部 tabBar；保留空集合与 openTab API，避免旧调用方报错。 */
const TAB_PAGES = new Set();

function currentStack() {
  return typeof getCurrentPages === "function" ? getCurrentPages() || [] : [];
}

function routeOf(url) {
  return String(url || "").split("?")[0];
}

/**
 * 历史 tab 跳转入口：首页用 reLaunch，其余走普通页面栈。
 */
function openTab(url) {
  const target = routeOf(url);
  const query = String(url).includes("?") ? String(url).slice(String(url).indexOf("?") + 1) : "";
  if (target === "/pages/index/index") {
    wx.reLaunch({ url: target });
    return;
  }
  const full = query ? `${target}?${query}` : target;
  if (query) {
    try {
      wx.setStorageSync("aurum_tab_query", { target, query, at: Date.now() });
    } catch (error) {
      // storage 失败时仍跳转，只是丢预填参数。
    }
  }
  wx.navigateTo({
    url: full,
    fail: () => wx.redirectTo({ url: full }),
  });
}

function consumeTabQuery(expectedTarget) {
  try {
    const payload = wx.getStorageSync("aurum_tab_query");
    if (!payload || payload.target !== expectedTarget) return null;
    if (Date.now() - Number(payload.at || 0) > 60 * 1000) {
      wx.removeStorageSync("aurum_tab_query");
      return null;
    }
    wx.removeStorageSync("aurum_tab_query");
    const params = {};
    String(payload.query || "").split("&").forEach((pair) => {
      if (!pair) return;
      const [key, ...rest] = pair.split("=");
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("=") || "");
    });
    return params;
  } catch (error) {
    return null;
  }
}

/**
 * 会员页与工作台互相跳转。两边都用 navigateTo 的话，来回切换会不断往页面栈里压新页，
 * 到第 10 层时微信直接拒绝跳转，用户看到的现象是"点了没反应"，而且返回要按十几次。
 * 目标页已经在栈里就回退过去，接近上限时改用 redirectTo 顶替当前页。
 */
function openPage(url) {
  const target = routeOf(url);
  if (TAB_PAGES.has(target) || target === "/pages/index/index") {
    openTab(url);
    return;
  }
  const hasQuery = String(url).includes("?");
  const stack = currentStack();
  const index = stack.findIndex((page) => `/${page.route}` === target);

  // 带参数的跳转不能靠回退复用旧页面：navigateBack 不会重新触发 onLoad，
  // 新传的预填参数会被丢掉。
  if (!hasQuery && index >= 0 && index < stack.length - 1) {
    wx.navigateBack({ delta: stack.length - 1 - index });
    return;
  }
  if (stack.length >= MAX_PAGE_STACK - 1) {
    wx.redirectTo({ url });
    return;
  }
  wx.navigateTo({
    url,
    fail: () => wx.redirectTo({ url }),
  });
}

function goHome() {
  wx.reLaunch({ url: "/pages/index/index" });
}

module.exports = { openPage, openTab, goHome, consumeTabQuery, TAB_PAGES };
