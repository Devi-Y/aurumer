// 方案 A：国内已备案自有域名静态 JSON / CDN 极速通道（类似问岳直连架构）。
// 仅当 config/runtime.js 显式配置了已备案 HTTPS 的 snapshotCdnUrl 时启用；
// 未配置或网络异常时自动无缝回退 aurum-data 云函数与随包离线快照，零单点风险。
const CDN_TIMEOUT_MS = 2500;
let cachedEtag = "";

function isValidCdnUrl(url) {
  return typeof url === "string" && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(url.trim());
}

function fetchSnapshotFromCdn(url, { force = false, clientUpdatedAt = "", clientRevisionAt = "" } = {}) {
  if (!isValidCdnUrl(url)) return Promise.resolve(null);
  if (typeof wx === "undefined" || !wx || typeof wx.request !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const header = { accept: "application/json" };
    if (!force && cachedEtag) header["If-None-Match"] = cachedEtag;
    const targetUrl = force ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
    wx.request({
      url: targetUrl,
      method: "GET",
      timeout: CDN_TIMEOUT_MS,
      header,
      dataType: "json",
      success(res) {
        const code = Number(res && res.statusCode);
        const resHeaders = (res && res.header) || {};
        const nextEtag = resHeaders.ETag || resHeaders.etag || "";
        if (nextEtag) cachedEtag = String(nextEtag);
        if (code === 304) {
          resolve({
            ok: true,
            unchanged: true,
            updatedAt: clientUpdatedAt,
            revisionAt: clientRevisionAt || clientUpdatedAt,
            cache: "cdn-304",
          });
          return;
        }
        if (code === 200 && res.data && typeof res.data === "object") {
          resolve({
            ok: true,
            data: res.data,
            updatedAt: res.data.updatedAt,
            revisionAt: res.data.revisionAt || res.data.updatedAt,
            cache: "cdn",
          });
          return;
        }
        resolve(null);
      },
      fail() {
        resolve(null);
      },
    });
  });
}

module.exports = {
  isValidCdnUrl,
  fetchSnapshotFromCdn,
};
