# Aurumer.com 最后一步

当前域名的权威 DNS 在火山引擎：

- `ns1.volcengine-dns.com`
- `ns2.volcengine-dns.com`

请在火山引擎 DNS 控制台添加以下记录：

| 主机记录 | 类型 | 记录值 |
| --- | --- | --- |
| `@` | `A` | `185.199.108.153` |
| `@` | `A` | `185.199.109.153` |
| `@` | `A` | `185.199.110.153` |
| `@` | `A` | `185.199.111.153` |
| `www` | `CNAME` | `devi-y.github.io` |

不要填写本机看到的 `198.18.x.x`，那是代理使用的虚拟地址，不是公网网站地址。

保存后告诉 Codex“DNS 已完成”。Codex 将继续自动完成：

1. 验证公共 DNS；
2. 绑定 GitHub Pages 自定义域名；
3. 等待并开启 HTTPS；
4. 把小程序公开域名切换到 `https://aurumer.com`；
5. 重新执行网页、H5、小程序和分享链接验收。

随时可运行以下命令检查状态：

```bash
cd /Users/y/aurumer-pages
npm run check:domain
```
