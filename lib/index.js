/**
 * dsh-smart-websearch — smart web search + fetch provider for DeepSeek Harness.
 *
 * Registers two ctx.web providers (no extra tool schemas):
 *   - "smart-websearch": language-aware Bing + Baidu + DuckDuckGo-Lite, hedged, cached.
 *   - "smart-webfetch":  bounded HTTP(S) fetch, domestic-direct / overseas-proxy.
 * The built-in web_search / web_fetch tools route through these once the profile sets
 * web.searchProvider=smart-websearch / web.fetchProvider=smart-webfetch.
 * Optional search-hygiene (default on): result cache, a near-duplicate-search advisory,
 * and a short system-prompt guidance section — all to curb redundant searches.
 *
 * Engine logic lives in ./engines.js (zero npm deps: built-in fetch + native
 * CONNECT proxy; standalone-testable).
 * @license Apache-2.0
 */
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { makeSearchProvider, makeFetchProvider } from "./engines.js";

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
  enabled: z.boolean().default(true),
  /** Engine ids available: "bing", "baidu", "ddg-lite". Routing is language-aware (CJK direct-first). */
  engines: z.array(z.string()).default(["bing", "baidu", "ddg-lite"]),
  /** Baidu search endpoint (domestic, direct). */
  baiduHost: z.string().default("https://www.baidu.com/s"),
  /** Optional proxy for all engines + fetch (e.g. http://127.0.0.1:7897). Recommended on networks where the direct egress gets degraded Bing SERPs. Empty = all direct. */
  proxyUrl: z.string().default(""),
  /** Only sent when non-empty; forcing zh-CN on overseas egress can return an empty SERP. */
  bingMarket: z.string().default(""),
  /** Domestic (CJK) queries use this host DIRECT (no proxy). cn.bing.com works on CN networks. */
  bingDirectHost: z.string().default("https://cn.bing.com/search"),
  /** Overseas queries use this host via proxy (full international results). */
  bingProxyHost: z.string().default("https://www.bing.com/search"),
  maxResults: z.number().default(8),
  perEngineTimeoutMs: z.number().default(8000),
  searchBudgetMs: z.number().default(12000),
  /** Start the next engine in parallel if the current one hasn't answered in this many ms. 0 = serial. */
  hedgeMs: z.number().default(3000),
  fetchTimeoutMs: z.number().default(8000),
  fetchMaxBytes: z.number().default(5000000),
  fetchMaxChars: z.number().default(100000),
  /** Search result cache TTL (ms). Repeated identical queries return instantly. 0 disables. */
  cacheTtlMs: z.number().default(300000),
  cacheMaxEntries: z.number().default(50),
  /** Append a gentle advisory when the model re-searches near-duplicate topics. */
  searchHygiene: z.boolean().default(true),
  /** Inject a system-prompt section nudging the model to avoid redundant searches. */
  hygieneGuidance: z.boolean().default(true),
  /** Generic SPA recovery: extract embedded JSON (Next.js/Nuxt/state/JSON-LD) from JS-shell pages. */
  spaExtraction: z.boolean().default(true),
  /** Output budget (chars) for the recovered embedded data. */
  spaMaxChars: z.number().default(40000),
});

export function apply(ctx, config) {
  if (config.enabled === false) return;
  const cfg = {
    bingMarket: String(config.bingMarket ?? "").trim(),
    bingDirectHost: String(config.bingDirectHost ?? "").trim() || "https://cn.bing.com/search",
    bingProxyHost: String(config.bingProxyHost ?? "").trim() || "https://www.bing.com/search",
    baiduHost: String(config.baiduHost ?? "").trim() || "https://www.baidu.com/s",
    perEngineTimeoutMs: config.perEngineTimeoutMs > 0 ? config.perEngineTimeoutMs : 8000,
    searchBudgetMs: config.searchBudgetMs > 0 ? config.searchBudgetMs : 12000,
    hedgeMs: config.hedgeMs >= 0 ? config.hedgeMs : 3000,
    fetchTimeoutMs: config.fetchTimeoutMs > 0 ? config.fetchTimeoutMs : 8000,
    fetchMaxBytes: config.fetchMaxBytes > 0 ? config.fetchMaxBytes : 5000000,
    fetchMaxChars: config.fetchMaxChars > 0 ? config.fetchMaxChars : 100000,
    cacheTtlMs: config.cacheTtlMs >= 0 ? config.cacheTtlMs : 300000,
    cacheMaxEntries: config.cacheMaxEntries > 0 ? config.cacheMaxEntries : 50,
    spaExtraction: config.spaExtraction !== false,
    spaMaxChars: config.spaMaxChars > 0 ? config.spaMaxChars : 40000,
  };
  const maxResults = config.maxResults > 0 ? config.maxResults : 8;
  const engines = (config.engines ?? ["bing", "baidu", "ddg-lite"]).filter((e) => e === "bing" || e === "baidu" || e === "ddg-lite");
  const proxy = String(config.proxyUrl ?? "").trim() || null;

  const searchProvider = makeSearchProvider({ cfg, engines, maxResults, proxy });
  const fetchProvider = makeFetchProvider({ cfg, proxy });

  ctx.effect(() => {
    const d1 = ctx.web.registerSearchProvider(searchProvider);
    const d2 = ctx.web.registerFetchProvider(fetchProvider);
    return () => { try { d1(); } catch {} try { d2(); } catch {} };
  }, "dsh-smart-websearch: web providers");

  // System-prompt guidance: nudge the model to avoid redundant searches.
  if (config.hygieneGuidance !== false) {
    ctx.systemPrompt.section({ name: "dsh-smart-websearch:hygiene", order: 10160, interpolate: false, text: HYGIENE_GUIDANCE });
  }

  // Runtime advisory: when the model re-searches near-duplicate topics, append a gentle note.
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
      let queries = [];
      const a = exec.arguments ?? {};
      queries = Array.isArray(a.queries) ? a.queries : (a.query ? [a.query] : []);
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
