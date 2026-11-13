import { makeSearchProvider, makeFetchProvider, searchBaidu, isDomesticHost } from "../lib/engines.js";
import { ProxyAgent } from "../node_modules/undici/index.js";
const cfg = { bingMarket: "", bingDirectHost: "https://cn.bing.com/search", bingProxyHost: "https://www.bing.com/search", baiduHost: "https://www.baidu.com/s", perEngineTimeoutMs: 8000, searchBudgetMs: 15000, hedgeMs: 2000, fetchTimeoutMs: 8000, fetchMaxBytes: 5000000, fetchMaxChars: 100000 };
const show = (l, s) => { console.log(`\n[${l}] ${s.length} results`); for (const x of s.slice(0, 3)) console.log("  -", (x.title || "").slice(0, 50), "|", x.url.slice(0, 70)); };

// 1) Baidu on the previously-failing niche CJK query
try { const t0 = Date.now(); const s = await searchBaidu("通义千问 token plan 购买", 6, {}, undefined, cfg); show(`baidu niche ${Date.now() - t0}ms`, s); }
catch (e) { console.log("\n[baidu] ERROR:", e.message); }

// 2) full provider, CJK, NO proxy (domestic path)
try { const p = makeSearchProvider({ cfg, engines: ["bing", "baidu", "ddg-lite"], maxResults: 6, proxyAgent: null });
  const t0 = Date.now(); const r = await p.search({ query: "Qoder 企业版 价格 席位", maxResults: 6 }, undefined); show(`provider CJK no-proxy ${Date.now() - t0}ms`, r.sources); }
catch (e) { console.log("\n[provider CJK] ERROR:", e.message); }

// 3) domestic host detection
console.log("\nisDomesticHost:", ["developer.aliyun.com", "qoder.cn", "www.baidu.com", "qoder.com", "docs.qoder.com", "npmjs.com"].map(h => `${h}=${isDomesticHost(h)}`).join(" "));

// 4) domestic fetch DIRECT (no proxy) — aliyun (failed before via proxy)
try { const fp = makeFetchProvider({ cfg, proxyAgent: null }); const t0 = Date.now();
  const r = await fp.fetch({ url: "https://developer.aliyun.com/article/1766233" }, undefined);
  console.log(`\n[fetch aliyun direct ${Date.now() - t0}ms] status=${r.statusCode} kind=${r.body.kind} chars=${r.body.content.length}`); }
catch (e) { console.log("\n[fetch aliyun] ERROR:", e.message); }

console.log("\nVERIFY DONE");
