# 望潮 Aurum｜方案 A：国内已备案自有域名直连提速手册

> 目标：复用你已 ICP 备案的国内域名（如问岳同主体的 `wenyue-sz.com` 阿里云服务器，或腾讯云 COS / 阿里云 OSS 绑定备案子域名），让小程序 **20~50ms 直连拉取公开快照**，跳过海外 GitHub Pages 与云函数冷启动；若 CDN 异常，2.5 秒内自动无感降级回 `aurum-data` 云函数。

## 三步上线（预计 3 分钟）

### 第 1 步：导出脱敏静态快照包
在公开镜像目录执行：
```bash
npm run export:cdn
```
脚本会自动把脱敏并压缩后的快照输出到 `dist/cdn/live-snapshot.json`（同时生成 `dist/cdn/meta.json` 含 SHA-256 指纹与体积）。

### 第 2 步：上传到已备案国内域名的静态目录
以复用现有阿里云 `wenyue-sz.com` Nginx 为例，把 `dist/cdn/live-snapshot.json` 同步到服务器 `/var/www/aurum/live-snapshot.json`，并在 Nginx 增加：
```nginx
location = /aurum/live-snapshot.json {
    alias /var/www/aurum/live-snapshot.json;
    default_type application/json;
    add_header Cache-Control "public, max-age=300, must-revalidate";
    etag on;
    gzip on;
    gzip_types application/json;
}
```
用浏览器或终端确认访问 `https://wenyue-sz.com/aurum/live-snapshot.json` 返回 `200 OK` 且响应头带 `ETag`。

### 第 3 步：在微信后台加白域名并填入小程序配置
1. 登录微信公众平台 → 开发管理 → 开发设置 → 服务器域名 → `request 合法域名` 添加：`https://wenyue-sz.com`（或你绑定的子域名如 `https://aurum.wenyue-sz.com`）。
2. 打开 [miniprogram/config/runtime.js](../miniprogram/config/runtime.js)，把 `snapshotCdnUrl` 改为：
   ```js
   snapshotCdnUrl: "https://wenyue-sz.com/aurum/live-snapshot.json",
   ```
3. 重新编译上传小程序即可生效；若想随时切回纯云函数模式，把 `snapshotCdnUrl` 改回 `""` 即可，零副作用。

## 省流与兜底机制（已在客户端内置）
- 首次拉取：HTTPS 直连拉取并缓存 `ETag` 到本机 `wx.setStorage`。
- 后续打开：自动带 `If-None-Match` 请求，数据未更新时服务器直接回 `304 Not Modified`（0 字节正文）。
- 故障兜底：2.5 秒超时、非 200/304 或 JSON 校验失败时，客户端自动无缝回退到 `aurum-data` 云函数与随包离线快照，用户无感知。
