# 望潮微信小程序

小程序原生实现三级答案链路：

1. 首页只显示港股打新、美股投资、A股收息三个入口。
2. 二级只显示港股四类、美股三类、A股三类结论入口。
3. 三级显示具体标的的一句话结论、分数、排名和关键价格。

四级完整分析通过 `web-view` 打开同一套公开 H5 页面。网页、手机和小程序共用一份公开数据，不复制内部策略代码。

运行 `npm run sync:mini` 会把 `data/live-snapshot.json` 中允许公开的字段同步到 `miniprogram/data/live-snapshot.js`。小程序优先立即展示这份离线快照，再尝试拉取线上最新快照，网络失败时不会白屏。

正式发布前需要在微信公众平台完成两项人工配置：

1. 将本目录 `project.config.json` 的 `appid` 从 `touristappid` 换成正式小程序 AppID。
2. 为 `aurumer.com` 配好 DNS 并绑定 GitHub Pages 后，将 `miniprogram/config.js` 改为 `https://aurumer.com`，再把该域名同时加入“服务器域名（request 合法域名）”和“业务域名”。

在正式域名生效前，开发者工具可以关闭“不校验合法域名”进行预览。除上述微信平台权限配置外，代码可直接导入仓库根目录或 `miniprogram/` 目录。
