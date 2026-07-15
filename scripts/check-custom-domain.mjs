const DOMAIN = "aurumer.com";
const WWW_DOMAIN = `www.${DOMAIN}`;
const GITHUB_TARGET = "devi-y.github.io.";
const GITHUB_APEX = new Set([
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
]);

async function resolveDns(name, type) {
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", name);
  endpoint.searchParams.set("type", type);
  const response = await fetch(endpoint, { headers: { accept: "application/dns-json" } });
  if (!response.ok) throw new Error(`DNS 查询失败：${response.status}`);
  const payload = await response.json();
  return (payload.Answer || [])
    .filter((answer) => answer.type === (type === "A" ? 1 : 5))
    .map((answer) => String(answer.data));
}

const [apexRecords, wwwRecords, pagesResponse] = await Promise.all([
  resolveDns(DOMAIN, "A"),
  resolveDns(WWW_DOMAIN, "CNAME"),
  fetch("https://api.github.com/repos/Devi-Y/aurumer/pages", {
    headers: { accept: "application/vnd.github+json", "user-agent": "aurum-domain-check" },
  }),
]);
const pages = pagesResponse.ok ? await pagesResponse.json() : {};
const apexReady = [...GITHUB_APEX].every((record) => apexRecords.includes(record));
const wwwReady = wwwRecords.some((record) => record.toLowerCase() === GITHUB_TARGET);
const pagesBound = pages.cname === DOMAIN;

console.log(JSON.stringify({
  domain: DOMAIN,
  dns: { apexRecords, apexReady, wwwRecords, wwwReady },
  githubPages: { cname: pages.cname || null, pagesBound, status: pages.status || "unknown" },
  nextStep: !apexReady || !wwwReady
    ? "请先在火山引擎 DNS 添加 4 条 @ A 记录和 1 条 www CNAME 记录，详见 DOMAIN_SETUP.md。"
    : !pagesBound
      ? "DNS 已就绪，可以由 Codex 绑定 GitHub Pages。"
      : "域名已完成绑定，等待 HTTPS 证书生效。",
}, null, 2));

if (!apexReady || !wwwReady || !pagesBound) process.exitCode = 2;
