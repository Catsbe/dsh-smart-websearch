import { makeSearchProvider, makeFetchProvider, searchBing, searchDdgLite } from "../lib/engines.js";
import { ProxyAgent } from "undici";

const cfg = { bingMarket: "", perEngineTimeoutMs: 8000, searchBudgetMs: 12000, hedgeMs: 3000, fetchTimeoutMs: 8000, fetchMaxBytes: 5000000, fetchMaxChars: 100000 };
const PROXY = "http://127.0.0.1:7897";

function show(label, sources) {
  console.log(`\n[${label}] ${sources.length} results`);
  for (const s of sources.slice(0, 3)) console.log(`  - ${(s.title || "").slice(0, 60)} | ${s.url}`);
}

// 1) Bing direct (primary)
try {
  const t0 = Date.now();
  const s = await searchBing("DeepSeek Harness plugin", 8, {}, undefined, cfg);
  show(`bing EN direct ${Date.now() - t0}ms`, s);
} catch (e) { console.log("\n[bing EN] ERROR:", e.message); }

try {
  const t0 = Date.now();
  const s = await searchBing("postgresql 命令行 安装", 8, {}, undefined, cfg);
  show(`bing ZH direct ${Date.now() - t0}ms`, s);
} catch (e) { console.log("\n[bing ZH] ERROR:", e.message); }

// 2) DDG-lite: try direct, then via proxy
try {
  const t0 = Date.now();
  const s = await searchDdgLite("deepseek harness", 6, {}, undefined, cfg, undefined);
  show(`ddg-lite DIRECT ${Date.now() - t0}ms`, s);
} catch (e) { console.log("\n[ddg-lite direct] ERROR:", e.message); }

try {
  const agent = new ProxyAgent(PROXY);
  const t0 = Date.now();
  const s = await searchDdgLite("deepseek harness", 6, {}, undefined, cfg, agent);
  show(`ddg-lite via PROXY ${Date.now() - t0}ms`, s);
} catch (e) { console.log("\n[ddg-lite proxy] ERROR:", e.message); }

// 3) Full search provider (hedged bing->ddg), both via proxy (real configured scenario)
try {
  const provider = makeSearchProvider({ cfg, engines: ["bing", "ddg-lite"], maxResults: 8, proxyAgent: new ProxyAgent(PROXY) });
  for (const q of ["what is model context protocol", "postgresql 命令行 安装"]) {
    const t0 = Date.now();
    const r = await provider.search({ query: q, maxResults: 6 }, undefined);
    show(`provider.search "${q}" ${Date.now() - t0}ms`, r.sources);
  }
} catch (e) { console.log("\n[provider.search] ERROR:", e.message); }

// 4) Fetch provider (direct) on a stable page
try {
  const fp = makeFetchProvider({ cfg, proxyAgent: null });
  const t0 = Date.now();
  const r = await fp.fetch({ url: "https://example.com/" }, undefined);
  console.log(`\n[fetch example.com ${Date.now() - t0}ms] status=${r.statusCode} kind=${r.body.kind} chars=${r.body.content.length} truncated=${r.truncated}`);
  console.log("  body head:", r.body.content.replace(/\s+/g, " ").slice(0, 100));
} catch (e) { console.log("\n[fetch] ERROR:", e.message); }

console.log("\nLIVE TEST DONE");
