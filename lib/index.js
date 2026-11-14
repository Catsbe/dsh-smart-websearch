/**
 * dsh-smart-websearch — smart web search + fetch provider for DeepSeek Harness.
 *
 * Registers two ctx.web providers (no extra tool schemas):
 *   - "smart-websearch": language-aware Bing + Baidu + DuckDuckGo-Lite, hedged, cached.
 *   - "smart-webfetch":  bounded HTTP(S) fetch, domestic-direct / overseas-proxy,
 *                        auto-detected proxy port, failover, boilerplate pruning, SPA JSON recovery.
 *
 * @license Apache-2.0
 */
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { makeSearchProvider, makeFetchProvider } from "./engines.js";
import { createProxyResolver } from "./proxy-detect.js";
import { mountSmartWebsearchRoutes } from "./routes.js";

export const name = "dsh-smart-websearch";
export const inject = ["web", "tools", "systemPrompt"];

const HYGIENE_GUIDANCE = [
  "Web-search hygiene (to avoid wasted searches and tokens):",
  "- Before calling web_search, check whether the answer is already in your context from an earlier search or fetched page. Do not re-search a topic you have already covered.",
  "- One well-chosen query usually suffices; avoid firing many near-identical query variants on the same topic.",
  "- If a fetched page is a JavaScript shell with little content, prefer the site's docs/API or a different source instead of retrying URL variants.",
  "- Once you have enough data to answer, stop searching and answer.",
].join("\n");

function qTokens(q) {
  return new Set(String(q).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((t) => t.length >= 2));
}
function qSim(a, b) {
  const A = qTokens(a), B = qTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

export const Config = z.object({
  enabled: z.boolean().default(true)
    .description({ zh: "启用智能联网搜索与网页抓取提供方", en: "Enable smart web search and fetch providers" }),
  engines: z.array(z.string()).default(["bing", "baidu", "ddg-lite"])
    .description({ zh: "启用的搜索引擎：bing、baidu、ddg-lite", en: "Enabled search engines: bing, baidu, ddg-lite" }),
  proxyUrl: z.string().default("")
    .description({
      zh: "海外检索/抓取代理地址（如 http://127.0.0.1:7897 或直接填端口 7890）。配了这个代理端口，海外检索与海外网页抓取就会更快、更稳、更准确；留空则自动探测环境变量/系统代理/常用本地端口（7897、7890、10809 等），填 direct 强制全直连。",
      en: "HTTP proxy URL or port for overseas search & fetch (e.g. http://127.0.0.1:7897 or 7890). Configuring this proxy makes overseas search and page fetching faster, more reliable, and more accurate; leave blank to auto-detect, or set 'direct' to disable proxy.",
    }),
  defaultProxyPort: z.number().default(7890)
    .description({
      zh: "当 proxyUrl 留空且未探测到环境变量/系统代理/常见监听端口时的默认兜底代理端口（通用端口如 Clash 7890 / Clash Verge 7897）。连接失败会自动回退直连。",
      en: "Fallback localhost HTTP proxy port when proxyUrl is blank and auto-detection finds no active port (defaults to 7890; falls back to direct if closed).",
    }),
  baiduHost: z.string().default("https://www.baidu.com/s")
    .description({ zh: "百度搜索直连地址", en: "Baidu search endpoint" }),
  bingMarket: z.string().default("")
    .description({ zh: "Bing mkt 参数（留空由服务端自动判断，海外出口强制 zh-CN 可能返回空结果）", en: "Optional Bing market parameter (leave empty to auto-detect)" }),
  bingDirectHost: z.string().default("https://cn.bing.com/search")
    .description({ zh: "国内查询直连 Bing 地址", en: "Direct Bing endpoint for CJK queries" }),
  bingProxyHost: z.string().default("https://www.bing.com/search")
    .description({ zh: "海外查询代理 Bing 地址", en: "Proxied Bing endpoint for international queries" }),
  maxResults: z.number().default(8)
    .description({ zh: "单次搜索默认返回结果数", en: "Default max results per search" }),
  perEngineTimeoutMs: z.number().default(10000)
    .description({ zh: "单个搜索引擎超时时间（毫秒）", en: "Per-engine request timeout (ms)" }),
  searchBudgetMs: z.number().default(16000)
    .description({ zh: "多引擎 hedge 兜底总预算（毫秒）", en: "Total search budget across hedged engines (ms)" }),
  hedgeMs: z.number().default(3000)
    .description({ zh: "首引擎无响应多少毫秒后并行启动下一个引擎（0=纯串行）", en: "Delay before launching next engine in parallel (ms, 0=serial)" }),
  fetchTimeoutMs: z.number().default(20000)
    .description({ zh: "网页抓取单次超时时间（毫秒，建议 15000~25000 以减少 timeout）", en: "Web fetch timeout (ms)" }),
  fetchMaxBytes: z.number().default(5000000)
    .description({ zh: "单页最大读取字节数", en: "Maximum fetched response bytes" }),
  fetchMaxChars: z.number().default(100000)
    .description({ zh: "单页最大返回字符数", en: "Maximum returned characters per page" }),
  cacheTtlMs: z.number().default(300000)
    .description({ zh: "搜索结果缓存有效期（毫秒，0=关闭）", en: "Search cache TTL in ms (0=disabled)" }),
  cacheMaxEntries: z.number().default(50)
    .description({ zh: "最大缓存条数", en: "Maximum cached search queries" }),
  searchHygiene: z.boolean().default(true)
    .description({ zh: "重复相近搜索提醒（节省步数与 token）", en: "Warn on near-duplicate searches in a turn" }),
  hygieneGuidance: z.boolean().default(true)
    .description({ zh: "在系统提示词注入精简搜索引导", en: "Inject search-hygiene guidance section" }),
  spaExtraction: z.boolean().default(true)
    .description({ zh: "自动提取 SPA 空壳页内嵌 JSON 数据（Next.js/Nuxt/JSON-LD）", en: "Recover embedded JSON from JS-shell pages" }),
  spaMaxChars: z.number().default(40000)
    .description({ zh: "SPA 数据提取最大输出字符数", en: "Maximum chars for extracted SPA JSON" }),
  boilerplatePruning: z.boolean().default(true)
    .description({ zh: "网页正文去噪（抓取大型网页时剔除导航/页脚/侧栏以大幅节省 token）", en: "Strip nav/footer/aside boilerplate on large HTML pages to save tokens" }),
});

export function apply(ctx, config) {
  if (config.enabled === false) return;
  const cfg = {
    bingMarket: String(config.bingMarket ?? "").trim(),
    bingDirectHost: String(config.bingDirectHost ?? "").trim() || "https://cn.bing.com/search",
    bingProxyHost: String(config.bingProxyHost ?? "").trim() || "https://www.bing.com/search",
    baiduHost: String(config.baiduHost ?? "").trim() || "https://www.baidu.com/s",
    perEngineTimeoutMs: config.perEngineTimeoutMs > 0 ? config.perEngineTimeoutMs : 10000,
    searchBudgetMs: config.searchBudgetMs > 0 ? config.searchBudgetMs : 16000,
    hedgeMs: config.hedgeMs >= 0 ? config.hedgeMs : 3000,
    fetchTimeoutMs: config.fetchTimeoutMs > 0 ? config.fetchTimeoutMs : 20000,
    fetchMaxBytes: config.fetchMaxBytes > 0 ? config.fetchMaxBytes : 5000000,
    fetchMaxChars: config.fetchMaxChars > 0 ? config.fetchMaxChars : 100000,
    cacheTtlMs: config.cacheTtlMs >= 0 ? config.cacheTtlMs : 300000,
    cacheMaxEntries: config.cacheMaxEntries > 0 ? config.cacheMaxEntries : 50,
    spaExtraction: config.spaExtraction !== false,
    spaMaxChars: config.spaMaxChars > 0 ? config.spaMaxChars : 40000,
    boilerplatePruning: config.boilerplatePruning !== false,
  };
  const maxResults = config.maxResults > 0 ? config.maxResults : 8;
  const engines = (config.engines ?? ["bing", "baidu", "ddg-lite"]).filter((e) => e === "bing" || e === "baidu" || e === "ddg-lite");
  const rawProxy = String(config.proxyUrl ?? "").trim();
  const defaultProxyPort = Number.isInteger(config.defaultProxyPort) && config.defaultProxyPort >= 1 && config.defaultProxyPort <= 65535
    ? config.defaultProxyPort
    : 7890;

  const proxyResolver = createProxyResolver({
    configuredProxy: rawProxy,
    defaultProxyPort,
    ttlMs: 30000,
  });

  // Warm up proxy detection asynchronously so the first search/fetch is immediate.
  void proxyResolver.resolve(true).catch(() => {});

  const resolveProxy = () => proxyResolver.resolve(false);
  const searchProvider = makeSearchProvider({ cfg, engines, maxResults, resolveProxy });
  const fetchProvider = makeFetchProvider({ cfg, resolveProxy });

  ctx.effect(() => {
    const d1 = ctx.web.registerSearchProvider(searchProvider);
    const d2 = ctx.web.registerFetchProvider(fetchProvider);
    return () => { try { d1(); } catch {} try { d2(); } catch {} };
  }, "dsh-smart-websearch: web providers");

  // Optional HTTP routes for the Settings UI panel (inactive in headless/test contexts).
  ctx.inject(["webServer"], (host) => {
    host.effect(
      () => mountSmartWebsearchRoutes(host, {
        proxyResolver,
        getSnapshot: () => ({
          config: {
            proxyUrl: rawProxy,
            defaultProxyPort,
            fetchTimeoutMs: cfg.fetchTimeoutMs,
            perEngineTimeoutMs: cfg.perEngineTimeoutMs,
            searchBudgetMs: cfg.searchBudgetMs,
            spaExtraction: cfg.spaExtraction,
            boilerplatePruning: cfg.boilerplatePruning,
            searchHygiene: config.searchHygiene !== false,
            hygieneGuidance: config.hygieneGuidance !== false,
          },
        }),
      }),
      "dsh-smart-websearch: http routes",
    );
  });

  if (config.hygieneGuidance !== false) {
    ctx.systemPrompt.section({ name: "dsh-smart-websearch:hygiene", order: 10160, interpolate: false, text: HYGIENE_GUIDANCE });
  }

  if (config.searchHygiene !== false) {
    const states = new WeakMap();
    const stateOf = (agent) => {
      let s = states.get(agent);
      if (!s) { s = { queries: [], searches: 0, fetches: 0, lastAdvisory: 0 }; states.set(agent, s); }
      return s;
    };
    ctx.on("agent/pre-step", ({ agent, messages }, next) => {
      if (messages.some((m) => m.source?.kind === "user")) states.delete(agent);
      return next();
    });
    ctx.on("tools/post-execute", async (exec, _result, next) => {
      const downstream = await next();
      if (!exec.agent) return downstream;
      const s = stateOf(exec.agent);
      if (exec.name === "web_fetch") { s.fetches += 1; return downstream; }
      if (exec.name !== "web_search") return downstream;
      const a = exec.arguments ?? {};
      const queries = Array.isArray(a.queries) ? a.queries : (a.query ? [a.query] : []);
      s.searches += 1;
      let dupExample = null;
      for (const q of queries) {
        for (const prev of s.queries) { if (qSim(q, prev) >= 0.65) { dupExample = prev; break; } }
        if (dupExample) break;
      }
      for (const q of queries) s.queries.push(q);
      if (s.queries.length > 60) s.queries.splice(0, s.queries.length - 60);
      if (!dupExample || s.searches < 3 || (s.searches - s.lastAdvisory) < 3) return downstream;
      s.lastAdvisory = s.searches;
      const advisory = createUserMessage({
        content: [{ type: "text", text: `搜索提示：本轮已多次搜索相近主题（如 "${dupExample}"），并抓取了 ${s.fetches} 个页面。相关数据可能已在上下文中——请先利用已有结果作答，仅在确实需要新角度/新数据时再联网搜索，避免重复搜索同一主题。` }],
        source: { kind: "dsh-smart-websearch", form: "notice", summary: "search-hygiene" },
      });
      const additionalContexts = [advisory, ...(downstream.additionalContexts ?? [])];
      if (downstream.kind === "block") return { kind: "block", feedback: downstream.feedback, additionalContexts };
      return { ...downstream, additionalContexts };
    });
  }
}
