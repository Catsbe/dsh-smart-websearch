import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── stub undici (controllable fetch) so the engine layer runs without network ──
const nm = path.join(here, "node_modules", "undici");
fs.mkdirSync(nm, { recursive: true });
fs.writeFileSync(path.join(nm, "package.json"), JSON.stringify({ name: "undici", version: "0.0.0-test", type: "module", main: "index.js" }));
fs.writeFileSync(path.join(nm, "index.js"), `let h = async () => { throw new Error("no handler"); };
export function setHandler(fn){ h = fn; }
export async function fetch(url, opts){ return h(url, opts); }
export class ProxyAgent { constructor(u){ this.u = u; } }
`);
fs.copyFileSync(path.join(here, "..", "lib", "engines.js"), path.join(here, "_engines.mjs"));
const { setHandler } = await import("./node_modules/undici/index.js");
const { searchBing, searchDdgLite, makeSearchProvider, makeFetchProvider } = await import("./_engines.mjs");

const cfg = { bingMarket: "", perEngineTimeoutMs: 8000, searchBudgetMs: 12000, hedgeMs: 50, fetchTimeoutMs: 8000, fetchMaxBytes: 5000000, fetchMaxChars: 100 };

// fake Response builders
const htmlRes = (html, status = 200) => ({ ok: status < 400, status, url: "https://x/", text: async () => html, headers: { get: () => "text/html; charset=utf-8" }, body: null });
function streamRes(content, contentType, status = 200) {
  const bytes = new TextEncoder().encode(content);
  return { ok: status < 400, status, url: "https://x/final", headers: { get: (k) => k.toLowerCase() === "content-type" ? contentType : null },
    body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; }, async cancel() {} }; } } };
}

const bingHtml = (items) => `<html><body><ol id="b_results">${items.map(([t, u, s]) =>
  `<li class="b_algo"><h2><a href="${u}">${t}</a></h2><p>${s}</p></li>`).join("")}</ol></body></html>`;
const ddgHtml = (items) => `<html><body><table>${items.map(([t, u, s]) =>
  `<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(u)}&rut=x">${t}</a></td></tr><tr><td class="result-snippet">${s}</td></tr>`).join("")}</table></body></html>`;

let passed = 0;
const ok = (c, l) => { assert.ok(c, l); passed++; console.log("  ✓", l); };

// T1 bing parsing + ck/a unwrap
console.log("T1 bing parsing");
{
  const ck = "https://www.bing.com/ck/a?u=a1" + Buffer.from("https://example.com/real").toString("base64url");
  setHandler(async () => htmlRes(bingHtml([["Example Title", ck, "A snippet about postgresql install"]])));
  const s = await searchBing("postgresql install", 8, {}, undefined, cfg);
  ok(s.length === 1, "one result");
  ok(s[0].url === "https://example.com/real", "ck/a unwrapped to real URL");
  ok(s[0].title === "Example Title", "title parsed");
}

// T2 relevance guard: reject unrelated SERP, accept relevant (incl CJK intent words)
console.log("T2 relevance guard");
{
  setHandler(async () => htmlRes(bingHtml([["豆包快捷键", "https://a.com", "豆包"], ["知乎荒原", "https://b.com", "知乎"]])));
  const garbage = await searchBing("postgresql 命令行 安装", 8, {}, undefined, cfg);
  ok(garbage.length === 0, "unrelated SERP rejected (0 results)");
  setHandler(async () => htmlRes(bingHtml([["PostgreSQL Official", "https://postgresql.org", "database"], ["PostgreSQL Downloads", "https://postgresql.org/download", "install"]])));
  const good = await searchBing("postgresql 命令行 安装", 8, {}, undefined, cfg);
  ok(good.length === 2, "relevant results accepted despite CJK intent words not in English titles");
}

// T3 ddg parsing + uddg decode
console.log("T3 ddg-lite parsing");
{
  setHandler(async () => htmlRes(ddgHtml([["MCP Intro", "https://modelcontextprotocol.io/intro", "MCP is a standard"]])));
  const s = await searchDdgLite("model context protocol", 8, {}, undefined, cfg, undefined);
  ok(s.length === 1 && s[0].url === "https://modelcontextprotocol.io/intro", "uddg decoded");
  ok(s[0].title === "MCP Intro", "ddg title parsed");
}

// T4 hedge fallback: bing returns 0 -> ddg succeeds
console.log("T4 hedged fallback");
{
  setHandler(async (url) => {
    if (String(url).includes("bing.com")) return htmlRes(bingHtml([])); // 0 results
    return htmlRes(ddgHtml([["Fallback Result", "https://fallback.example", "works"]]));
  });
  // proxyAgent truthy so the overseas chain includes bing-www + ddg (ddg requires a proxy).
  const provider = makeSearchProvider({ cfg, engines: ["bing", "ddg-lite"], maxResults: 8, proxyAgent: {} });
  const r = await provider.search({ query: "something", maxResults: 5 }, undefined);
  ok(r.sources.length === 1 && r.sources[0].url === "https://fallback.example", "fell back to ddg when bing empty");
}

// T5 fetch provider: shape, char cap, binary reject
console.log("T5 fetch provider");
{
  const fp = makeFetchProvider({ cfg, proxyAgent: null });
  setHandler(async () => streamRes("<html>" + "x".repeat(500) + "</html>", "text/html"));
  const r = await fp.fetch({ url: "https://example.com/" }, undefined);
  ok(r.statusCode === 200 && r.body.kind === "html", "html kind + status");
  ok(r.body.content.length <= 100 && r.truncated === true, "char cap + truncated flag");
  setHandler(async () => streamRes("binary", "application/octet-stream"));
  let threw = false;
  try { await fp.fetch({ url: "https://example.com/bin" }, undefined); } catch { threw = true; }
  ok(threw, "binary content-type rejected");
  let badUrl = false;
  try { await fp.fetch({ url: "ftp://example.com/" }, undefined); } catch { badUrl = true; }
  ok(badUrl, "non-http scheme rejected");
}

// T6 search cache: identical query hits cache
console.log("T6 search cache");
{
  setHandler(async () => htmlRes(bingHtml([["Cache Test", "https://cache.example", "cached result about cache test"]])));
  const provider = makeSearchProvider({ cfg: { ...cfg, cacheTtlMs: 300000 }, engines: ["bing"], maxResults: 8, proxyAgent: null });
  const r1 = await provider.search({ query: "cache test query", maxResults: 5 }, undefined);
  const r2 = await provider.search({ query: "cache test query", maxResults: 5 }, undefined);
  ok(r1.sources.length === 1, "first search returns result");
  ok(r2.cached === true, "second identical search hits cache");
}

console.log(`\nALL ${passed} ASSERTIONS PASSED`);
