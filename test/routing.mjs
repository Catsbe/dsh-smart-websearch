import { makeSearchProvider } from "../lib/engines.js";
import { ProxyAgent } from "../node_modules/undici/index.js";
const cfg = { bingMarket: "", bingDirectHost: "https://cn.bing.com/search", bingProxyHost: "https://www.bing.com/search", perEngineTimeoutMs: 8000, searchBudgetMs: 12000, hedgeMs: 3000, fetchTimeoutMs: 8000, fetchMaxBytes: 5000000, fetchMaxChars: 100000 };
const PROXY = "http://127.0.0.1:7897";
const show = (l, s) => { console.log(`\n[${l}] ${s.length} results`); for (const x of s.slice(0, 3)) console.log("  -", (x.title || "").slice(0, 55), "|", x.url); };

// 1) DOMESTIC Chinese query WITHOUT proxy -> must work via cn.bing direct (no Clash)
try {
  const p = makeSearchProvider({ cfg, engines: ["bing"], maxResults: 6, proxyAgent: null });
  const t0 = Date.now();
  const r = await p.search({ query: "postgresql 命令行 安装", maxResults: 6 }, undefined);
  show(`ZH no-proxy ${Date.now() - t0}ms`, r.sources);
} catch (e) { console.log("\n[ZH no-proxy] ERROR:", e.message); }

// 2) OVERSEAS English query WITH proxy -> www.bing international
try {
  const p = makeSearchProvider({ cfg, engines: ["bing", "ddg-lite"], maxResults: 6, proxyAgent: new ProxyAgent(PROXY) });
  const t0 = Date.now();
  const r = await p.search({ query: "what is model context protocol", maxResults: 6 }, undefined);
  show(`EN with-proxy ${Date.now() - t0}ms`, r.sources);
} catch (e) { console.log("\n[EN with-proxy] ERROR:", e.message); }

console.log("\nROUTING TEST DONE");
