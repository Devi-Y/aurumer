const MAX_PAGE_STACK = 10;

function currentStack() {
  return typeof getCurrentPages === "function" ? getCurrentPages() || [] : [];
}

/**
 * 会员页与工作台互相跳转。两边都用 navigateTo 的话，来回切换会不断往页面栈里压新页，
 * 到第 10 层时微信直接拒绝跳转，用户看到的现象是"点了没反应"，而且返回要按十几次。
 * 目标页已经在栈里就回退过去，接近上限时改用 redirectTo 顶替当前页。
 */
function openPage(url) {
  const target = String(url).split("?")[0];
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

module.exports = { openPage };
