# dsh-smart-websearch

> 让 [DeepSeek Harness](https://www.deepseek.com/harness/) 的联网搜索 **更快、更稳、不浪费**：智能分流 · 多引擎兜底 · 结果缓存 · 防重复搜索。

一个即插即用的 **web 搜索 / 网页抓取后端插件**。它不新增工具，而是接管 DSH 自带的 `web_search` / `web_fetch`，把这两个工具变得更适合真实网络环境（尤其是中国大陆网络），并抑制模型的无效重复搜索。

---

## 为什么需要它

DSH 自带 `web_search` / `web_fetch` 工具，但搜索后端要自己接。直接接免费搜索引擎，常见三个痛点：

1. **国际引擎直连被降级**：某些出口 IP 直连 `www.bing.com` 会返回与查询无关的垃圾结果；而 `cn.bing.com` 直连却正常。
2. **一刀切走代理**：让所有流量（含国内站点）都过代理，国内站点反而变慢、甚至失败。
3. **模型重复搜索**：拿到数据后仍反复搜同一主题的各种变体，白白烧 token 和时间。

`dsh-smart-websearch` 针对这三点做了系统性优化。

## 核心特性

| 特性 | 说明 |
|---|---|
| 🌐 **语言感知分流** | 中文查询走 `cn.bing` / 百度**直连**（免代理）；英文/海外查询走 `www.bing` / DDG **代理**。按查询语言自动选路。 |
| 🔀 **多引擎 hedge 兜底** | Bing + 百度 + DuckDuckGo-Lite；首引擎超时即并行起下一个，谁先返回用谁，单引擎 8s / 总预算 12s。 |
| ⚡ **结果缓存** | 同会话重复查询秒回（默认 5 分钟 TTL），不再重复联网。 |
| 🕸 **智能抓取** | 按域名判定：国内站直连、海外站代理，任一路失败自动兜底另一路；字节/字符上限、拒绝二进制、JS 空壳页提示。 |
| 🧹 **搜索卫生** | 检测到近似重复搜索时追加提醒"先用已有数据"；并注入简短系统引导，从源头减少无效搜索。只劝不拦。 |
| 🔒 **更新免疫** | 独立插件，不改 `dsh-free-search` 源码——后者一更新补丁就丢，本插件不受影响。 |

## 工作原理

插件向 `ctx.web` 注册两个提供方，**复用自带工具、零新增工具 schema**：

- `smart-websearch`：搜索提供方。按查询是否含中文选择引擎链——
  - 中文：`cn.bing 直连 → 百度直连 → www.bing 代理 → DDG 代理`
  - 英文：`www.bing 代理 → DDG 代理 → 百度/cn.bing 兜底`
- `smart-webfetch`：抓取提供方。按目标域名国内/海外决定直连或代理，失败兜底另一路。

**安装即自动接线（一键）**：插件的 bundle 补丁会自动把 `web.searchProvider` / `web.fetchProvider` 指向这两个提供方，无需手动改配置。

## 安装（一键）

需要 [`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)。克隆本仓库后：

```sh
dsh plugin --profile desktop add "link:<path-to-dsh-smart-websearch>"
```

装好即生效——自带 `web_search` / `web_fetch` 自动走本插件，**无需手动接线**。

**唯一可选配置**：海外搜索/抓取需要代理（国内搜索免代理）。在 profile 的 `cordis.patch.yml` 里加：

```yaml
- id: dsh-smart-websearch
  config:
    proxyUrl: "http://127.0.0.1:7897"   # 你的代理端口；不用海外可留空
```

> 想改用其它搜索提供方：在 profile 补丁里覆盖 `web` 行即可（profile 补丁优先于插件 bundle 补丁）。若仍装着 `dsh-free-search`，建议禁用以免混淆。

> **依赖说明**：`undici` 为普通 npm 依赖；`link:` 安装时若报 `Cannot find package 'undici'`，在插件目录建目录联接指向 profile 已有的 undici 即可（`file:` 安装则由 pnpm 正常装依赖）。`@deepseek-ai/*` 由 Harness 运行时提供。

## 配置项

```yaml
- id: dsh-smart-websearch
  config:
    enabled: true
    engines: [bing, baidu, ddg-lite]   # 可用引擎
    proxyUrl: ""                        # 海外引擎/抓取代理；留空=全直连
    bingDirectHost: "https://cn.bing.com/search"   # 国内直连主机
    bingProxyHost: "https://www.bing.com/search"   # 海外代理主机
    baiduHost: "https://www.baidu.com/s"
    bingMarket: ""                      # 留空不发 mkt（海外出口强制 zh-CN 会返回空 SERP）
    maxResults: 8
    perEngineTimeoutMs: 8000
    searchBudgetMs: 12000
    hedgeMs: 3000                       # 首引擎多久没回就并行起下一个；0=串行
    fetchTimeoutMs: 8000
    fetchMaxBytes: 5000000
    fetchMaxChars: 100000
    cacheTtlMs: 300000                  # 搜索缓存 TTL；0=关闭
    cacheMaxEntries: 50
    searchHygiene: true                 # 重复搜索提醒
    hygieneGuidance: true               # 系统引导段
```

## 实测效果

在同一台中国大陆网络机器上，对同一组"产品定价调研"提问做前后对比：

| 指标 | 优化前 | 优化后 |
|---|---:|---:|
| 单次网页抓取平均耗时 | ~2177ms | **~756ms（−65%）** |
| 搜索总耗时 | ~23s | **~11s（−50%）** |
| 搜索失败 | 首批整批失败 | **0 失败** |
| 计费 token（同类任务） | ~854k | **~553k（−35%）** |

> 数字来自真实会话日志统计，供参考；实际效果取决于网络与任务。

## 已知边界（如实说明）

- **JS 重渲染页面**：抓取不做浏览器渲染，SPA 定价页等可能只拿到骨架（会附提示引导换源）。这是"无浏览器、保持轻量"的取舍。
- **海外搜索/抓取仍需代理**：国内搜索已完全免代理；海外内容直连不可达，需配置 `proxyUrl`。
- **搜索卫生是"劝"不是"拦"**：对"模型铁了心要挖某个具体数字"的场景，软提醒作用有限。如需强制收敛，可自行扩展每轮搜索预算。
- 个别查询返回 SEO 站是搜索引擎结果质量问题，非本插件故障。

## 开发与测试

引擎层 `lib/engines.js` 仅依赖 `undici`，可独立测试：

```sh
node test/run.mjs        # 离线逻辑测试（stub undici，无需联网）
node test/live.mjs       # 真实引擎联网测试（需代理）
node test/routing.mjs    # 语言分流验证
```

## 许可

[Apache-2.0](LICENSE)。引擎解析部分参考了 MIT 许可的 `dsh-free-search`。
