"use strict";

/**
 * 运维告警：自动任务 / warm / sync 失败时 POST 到 webhook。
 * 未配置 WANGCHAO_OPS_ALERT_WEBHOOK 时仅打日志，不抛错。
 */
function postOpsAlert(payload) {
  const url = String(process.env.WANGCHAO_OPS_ALERT_WEBHOOK || "").trim();
  const body = JSON.stringify({
    source: "望潮 aurum",
    at: new Date().toISOString(),
    ...payload,
  });
  console.error("[告警]", body);
  if (!url) return Promise.resolve({ sent: false, reason: "webhook_unset" });

  return new Promise((resolve) => {
    try {
      const target = new URL(url);
      const transport = target.protocol === "http:" ? require("node:http") : require("node:https");
      const req = transport.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Wangchao-Ops-Alert/1.0",
        },
        timeout: 5000,
      }, (res) => {
        res.resume();
        resolve({ sent: true, status: res.statusCode });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({ sent: false, reason: "timeout" });
      });
      req.on("error", (error) => resolve({ sent: false, reason: error.message }));
      req.write(body);
      req.end();
    } catch (error) {
      resolve({ sent: false, reason: error && error.message });
    }
  });
}

/** 同一进程内去重：同类告警 15 分钟内只发一次，避免 warm 刷屏；首次失败仍立即告警。 */
const recentAlerts = new Map();
const ALERT_DEDUP_MS = 15 * 60 * 1000;

async function alertOpsOnce(key, payload) {
  const now = Date.now();
  const last = recentAlerts.get(key) || 0;
  if (now - last < ALERT_DEDUP_MS) {
    console.error("[告警·抑制]", key, payload && payload.error);
    return { sent: false, reason: "deduped" };
  }
  recentAlerts.set(key, now);
  return postOpsAlert({ key, ...payload });
}

module.exports = { postOpsAlert, alertOpsOnce };
