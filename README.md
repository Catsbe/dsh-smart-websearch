# dsh-smart-websearch

> 让 [DeepSeek Harness](https://www.deepseek.com/harness/) 的联网搜索 **更快、更稳、不浪费**：智能分流 · 多引擎兜底 · 结果缓存 · 防重复搜索。

一个即插即用的 **web 搜索 / 网页抓取后端插件**。它不新增工具，而是接管 DSH 自带的 `web_search` / `web_fetch`，把这两个工具变得更适合真实网络环境（尤其是中国大陆网络），并抑制模型的无效重复搜索。

---

## 为什么需要它

DSH 自带 `web_search` / `web_fetch` 工具，但搜索后端要自己接。直接接免费搜索引擎，常见四个痛点：

1. **国际引擎直连被降级**：某些出口 IP 直连 `www.bing.com` 会返回与查询无关的垃圾结果；而 `cn.bing.com` 直连却正常。
2. **一刀切走代理或未配代理**：让所有流量都过代理，国内站点反而变慢；而忘了填 `proxyUrl` 时，海外站点直连极易报 `The operation was aborted due to timeout` 或 `fetch failed`。
3. **模型重复搜索**：拿到数据后仍反复搜同一主题的各种变体，白白烧 token 和时间。
4. **单次超时过短与网页噪声过多**：8 秒固定超时在海外文档/重定向站点下容易中断，且整页 HTML 的导航/页脚会占用大量上下文 token。

`dsh-smart-websearch` 针对这些痛点做了系统性优化。

## 核心特性

| 特性 | 说明 |
|---|---|
| 🌐 **语言感知分流** | 中文查询走 `cn.bing` / 百度**直连**（免代理）；英文/海外查询走 `www.bing` / DDG **代理**。按查询语言自动选路。 |
| 🔌 **代理自动探测与界面配置** | `proxyUrl` 留空时自动探测环境变量、Windows 系统代理与本机常见代理端口（`7897`、`7890`、`10809` 等），未命中时默认兜底 `7890` 并在连接失败时回退直连；提供 **设置 → 智能联网搜索** 图形化配置界面与端口一键检测。 |
| 🔀 **多引擎 hedge 兜底** | Bing + 百度 + DuckDuckGo-Lite；首引擎超时即并行起下一个，谁先返回用谁，单引擎默认 10s / 总预算 16s。 |
| ⚡ **结果缓存** | 同会话重复查询秒回（默认 5 分钟 TTL），不再重复联网。 |
| 🕸 **智能抓取与换路容错** | 按域名判定：国内站直连、海外站代理，任一路失败或遇到 `403/429/5xx` 自动兜底另一路；支持 `gzip/deflate/br` 解压、`charset` 编码识别、瞬断重试与完整 `err.cause` 诊断。 |
| 🧩 **正文去噪 + SPA 数据回收** | 大型普通 HTML 页面自动剔除 `<nav>/<footer>/<aside>/<svg>` 减少 token 浪费；JS 空壳页自动提取内嵌 JSON（Next.js flight / `__NEXT_DATA__` / JSON-LD / Nuxt / Redux 状态），**无需浏览器、无需临时爬虫脚本**，一次抓取拿到数据。 |
| 🧹 **搜索卫生** | 检测到近似重复搜索时追加提醒"先用已有数据"；并注入简短系统引导，从源头减少无效搜索。只劝不拦。 |
| 🔒 **更新免疫** | 独立插件，不改 `dsh-free-search` 源码——后者一更新补丁就丢，本插件不受影响。 |

## 工作原理

插件向 `ctx.web` 注册两个提供方，**复用自带工具、零新增工具 schema**：

- `smart-websearch`：搜索提供方。按查询是否含中文选择引擎链——
  - 中文：`cn.bing 直连 → 百度直连 → www.bing 代理 → DDG 代理`
  - 英文：`www.bing 代理 → DDG 代理 → 百度/cn.bing 兜底`
- `smart-webfetch`：抓取提供方。按目标域名国内/海外决定直连或代理，失败兜底另一路。**JS 空壳页自动走通用内嵌数据提取**（`lib/extract.js`，零依赖、确定性、无浏览器）：识别 Next.js App Router 的 `self.__next_f` flight 载荷、Pages Router 的 `__NEXT_DATA__`、JSON-LD、`<script type="application/json">`、`window.__INITIAL_STATE__` 等状态赋值，按块大小排序、预算内输出，并附上脚本里出现的 `/api/` 端点线索。提取在**完整 HTML**（字符截断之前）上进行，避免数据恰好落在截断点之后。

**安装即自动接线（一键）**：插件的 bundle 补丁会自动把 `web.searchProvider` / `web.fetchProvider` 指向这两个提供方，无需手动改配置。

## 安装（一键）

需要 [`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)。克隆本仓库后：

```sh
dsh plugin --profile desktop add "link:<path-to-dsh-smart-websearch>"
```

装好即生效——自带 `web_search` / `web_fetch` 自动走本插件，**无需手动接线**。

**代理配置说明（推荐阅读）**：
> **配置了本地代理端口后，海外搜索引擎（`www.bing.com` / DuckDuckGo）与海外网页抓取就会更快、更稳、结果更准确**；同时国内站点与中文查询仍自动走直连，不会变慢。

现在插件支持两种零门槛配置方式：
1. **自动检测（默认）**：`proxyUrl` 留空即可，插件会自动依次检测环境变量（`HTTPS_PROXY`/`HTTP_PROXY`）、Windows 系统代理以及本机常见代理端口（`7897` Clash Verge、`7890` Clash、`10809` v2rayN、`1081`、`1080`、`20171`、`33210`、`8888`、`8080`）；若均未开启，则兜底尝试 `defaultProxyPort`（默认 `7890`），并在端口未开启时快速回退直连。
2. **图形化设置界面**：打开 DSH **设置 → 智能联网搜索**，可实时查看探测到的本机开放端口、一键重测、快速填入常用端口或修改超时参数，并自动保存到当前 profile。

如需在 profile 的 `cordis.patch.yml` 里手动指定：

```yaml
- id: dsh-smart-websearch
  config:
    proxyUrl: "http://127.0.0.1:7897"   # 可填完整 URL 或端口号(如 7890)；留空=自动检测；填 direct=强制直连
    defaultProxyPort: 7890              # 未探测到端口时的默认兜底端口
```

> 想改用其它搜索提供方：在 profile 补丁里覆盖 `web` 行即可（profile 补丁优先于插件 bundle 补丁）。若仍装着 `dsh-free-search`，建议禁用以免混淆。

> **零 npm 依赖**（v0.1.1 起）：直连用 Node ≥22.19 内置 `fetch`，代理用原生 `node:http` CONNECT 隧道 + `node:tls` + `node:zlib` 实现，不再依赖 `undici`——`link:` / `file:` 安装都不会再出现 `Cannot find package 'undici'`。`@deepseek-ai/*` 由 Harness 运行时提供。

## 配置项

```yaml
- id: dsh-smart-websearch
  config:
    enabled: true
    engines: [bing, baidu, ddg-lite]   # 可用引擎
    proxyUrl: ""                        # 留空=自动探测代理端口；可填端口(7890)或 URL；direct=强制直连
    defaultProxyPort: 7890              # 未探测到活动代理时的默认兜底端口
    bingDirectHost: "https://cn.bing.com/search"   # 国内直连主机
    bingProxyHost: "https://www.bing.com/search"   # 海外代理主机
    baiduHost: "https://www.baidu.com/s"
    bingMarket: ""                      # 留空不发 mkt（海外出口强制 zh-CN 会返回空 SERP）
    maxResults: 8
    perEngineTimeoutMs: 10000
    searchBudgetMs: 16000
    hedgeMs: 3000                       # 首引擎多久没回就并行起下一个；0=串行
    fetchTimeoutMs: 20000               # 网页抓取单次超时（ms）
    fetchMaxBytes: 5000000
    fetchMaxChars: 100000
    spaExtraction: true                 # JS 空壳页通用内嵌数据提取（Next.js/Nuxt/JSON-LD/状态）
    spaMaxChars: 40000                  # 提取结果的输出预算（字符）
    boilerplatePruning: true            # 大型 HTML 网页自动剔除 nav/footer/aside 以节省 token
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

- **JS 重渲染页面**：抓取不做浏览器渲染。**数据内嵌在 HTML 里的 SPA（Next.js/Nuxt/状态注入，如 priceai.cc 这类比价站）现在会自动回收**；但数据完全靠加载后 XHR 拉取、HTML 里没有任何 JSON 的页面仍可能只拿到骨架——此时结果会附提示，引导换源或**临时写短脚本（如 Python + requests）直接打站点 JSON API**。这是"无浏览器、保持轻量"的取舍。
- **海外搜索/抓取仍需代理**：国内搜索已完全免代理；海外内容直连不可达，需配置 `proxyUrl`。
- **搜索卫生是"劝"不是"拦"**：对"模型铁了心要挖某个具体数字"的场景，软提醒作用有限。如需强制收敛，可自行扩展每轮搜索预算。
- 个别查询返回 SEO 站是搜索引擎结果质量问题，非本插件故障。

## 开发与测试

引擎层 `lib/engines.js` 零 npm 依赖（Node 内置模块），可独立测试：

```sh
node test/run.mjs        # 离线逻辑测试（stub 内置 fetch + 本地模拟代理，无需联网）
node test/live.mjs       # 真实引擎联网测试（需代理）
node test/routing.mjs    # 语言分流验证
```

## 版本记录

- **0.3.0**：
  - **代理自动探测 + 通用端口兜底**（`lib/proxy-detect.js`）：`proxyUrl` 留空时自动探测环境变量、Windows 系统代理与本机常见代理端口（`7897`/`7890`/`10809`/`1081`/`1080`/`20171`/`33210`/`8888`/`8080`），未命中时默认兜底 `7890`（`defaultProxyPort`）并在端口不可达时自动回退直连。
  - **新增图形化设置界面**（`client/client.js` + `lib/routes.js`）：在 **设置 → 智能联网搜索** 提供实时端口探测、一键快填常用端口、超时与提取开关配置，并附带代理加速说明；同步完善 `Config` schema 与 `locale/*.json`、`icon.svg`。
  - **解决频繁 `timeout` 与 `fetch failed`**：`fetchTimeoutMs` 提升至 `20000ms`（`perEngineTimeoutMs` `10000ms`、`searchBudgetMs` `16000ms`）；代理通道补全 `gzip/deflate/br` 解压与连接事件清理；遇到 `403/429/5xx` 自动换路、瞬断自动重试 1 次；`describeError()` 完整保留底层 `err.cause` 链路。
  - **编码与省 Token 优化**：支持 `Content-Type` 与 `<meta charset>` 编码识别；新增 `boilerplatePruning` 在大型 HTML 页面转 Markdown 前自动剔除导航/页脚/侧栏；扩充国内直连域名表。
- **0.2.1**：SPA 提取加状态码门槛——仅对 `statusCode < 400` 的页面执行；404/403 的 Next.js 空壳只带站点通用 flight 数据，不再浪费输出预算（实测 artificialanalysis.ai 404 页发现）。空壳兜底通知不受影响。
- **0.2.0**：新增通用 SPA 内嵌数据提取层 `lib/extract.js`（Next.js flight/`__NEXT_DATA__`、JSON-LD、`application/json` 脚本、`__INITIAL_STATE__`/`__NUXT__` 等状态赋值、`/api/` 端点线索），JS 空壳判定放宽到"可见文本 <3000 且含内嵌数据标记"，提取在完整 HTML 上进行；提取不到时提示临时脚本兜底。新增 `spaExtraction`/`spaMaxChars` 配置与 `test/extract.mjs`（含真实 priceai.cc 样本回归，可选）。
- **0.1.1**：修复 `link:` 安装报 `Cannot find package 'undici'` 的问题——根因是 pnpm `link:` 不安装被链接包的 npm 依赖。移除 undici，直连改用 Node 内置 fetch，代理改用原生 CONNECT 隧道，插件从此零 npm 依赖；离线测试新增本地模拟代理用例。
- **0.1.0**：首个版本（语言分流、多引擎 hedge、缓存、搜索卫生）。

## 许可

[Apache-2.0](LICENSE)。引擎解析部分参考了 MIT 许可的 `dsh-free-search`。
