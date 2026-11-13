/**
 * Offline tests for the generic SPA embedded-data extraction layer (lib/extract.js)
 * and its integration into the smart-webfetch provider. Zero deps, no network:
 *   node test/extract.mjs
 * When the real priceai.cc fixtures exist in the workspace root they are used as
 * an extra end-to-end check; otherwise that section is skipped.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEmbeddedData, hasEmbeddedMarkers, visibleTextLength } from "../lib/extract.js";
import { makeFetchProvider } from "../lib/engines.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ok ${name}`);
}

/* ── synthetic fixtures ── */
const offers = { offers: [{ id: "a1", price: 5.14, store: "源头店" }, { id: "b2", price: 12.9, store: "分销店" }] };
const flightRow = `34:["$","$L39",null,${JSON.stringify({ productId: "gemini-pro-recharge", initialData: offers })}]`;
const flightChunk = JSON.stringify(`1:"$Sreact.fragment"\n${flightRow}\n`);
const nextShell = `<!DOCTYPE html><html><head><title>Shop</title></head><body><div id="__next"></div>`
  + `<script>self.__next_f.push([1,${flightChunk}])</script>`
  + `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Gemini Pro" })}</script>`
  + `<nav>首页 登录 注册 帮助 关于 联系 条款 隐私 导航 菜单 搜索 购物车 用户 中心 退出 设置 消息 通知 收藏 历史 订单 支付 客服 反馈</nav>`
  + `<!-- ${"x".repeat(6000)} -->`
  + `</body></html>`;

console.log("extract.js unit tests");
ok("markers + visible text", () => {
  assert.equal(hasEmbeddedMarkers(nextShell), true);
  assert.equal(hasEmbeddedMarkers("<html><body>plain article text</body></html>"), false);
  assert.ok(visibleTextLength(nextShell) < 3000);
});
ok("next-flight + JSON-LD recovery", () => {
  const ex = extractEmbeddedData(nextShell);
  assert.equal(ex.found, true);
  assert.ok(ex.text.includes('"price":5.14'), "offer price recovered");
  assert.ok(ex.text.includes("JSON-LD"), "JSON-LD labeled");
  assert.ok(ex.text.includes("next-flight:34"), "flight row labeled");
  assert.ok(ex.blockCount >= 2);
});
ok("__NEXT_DATA__ recovery", () => {
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: offers } })}</script></body></html>`;
  const ex = extractEmbeddedData(html);
  assert.equal(ex.found, true);
  assert.ok(ex.text.includes("__NEXT_DATA__"));
  assert.ok(ex.text.includes('"price":12.9'));
});
ok("__INITIAL_STATE__ assignment recovery", () => {
  const html = `<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({ cart: offers, nested: { s: "a{b}c\"d" } })};</script></body></html>`;
  const ex = extractEmbeddedData(html);
  assert.equal(ex.found, true);
  assert.ok(ex.text.includes('"price":5.14'));
});
ok("empty shell -> found=false", () => {
  const html = "<html><head><script src='/app.js'></script></head><body><div id='root'></div></body></html>";
  const ex = extractEmbeddedData(html);
  assert.equal(ex.found, false);
  assert.equal(ex.text, "");
});
ok("budget: largest block first, truncation marked", () => {
  const ex = extractEmbeddedData(nextShell, { maxChars: 300 });
  assert.equal(ex.found, true);
  assert.ok(ex.text.length < 900, "bounded output");
  assert.ok(ex.text.includes("truncated") || ex.omitted > 0);
});
ok("api hints", () => {
  const html = `<html><body><script>fetch("/api/v1/offers?x=1");var u="/api/v2/prices";</script></body></html>`;
  const ex = extractEmbeddedData(html);
  assert.ok(ex.apiHints.includes("/api/v1/offers?x=1"));
  assert.ok(ex.apiHints.includes("/api/v2/prices"));
});
ok("dedup identical blocks", () => {
  const dup = `<html><body><script type="application/json">${JSON.stringify(offers)}</script><script type="application/json">${JSON.stringify(offers)}</script></body></html>`;
  const ex = extractEmbeddedData(dup);
  assert.equal(ex.blockCount, 1);
});

/* ── provider integration (stubbed global fetch, no network) ── */
console.log("smart-webfetch integration");
const cfg = { fetchTimeoutMs: 5000, fetchMaxBytes: 5000000, fetchMaxChars: 100000, spaExtraction: true, spaMaxChars: 40000 };
const realFetch = globalThis.fetch;
function stubFetch(html, ct = "text/html; charset=utf-8") {
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { "content-type": ct } });
}
try {
  stubFetch(nextShell);
  const provider = makeFetchProvider({ cfg, proxy: null });
  const r1 = await provider.fetch({ url: "https://example.com/product" });
  assert.equal(r1.body.kind, "text");
  assert.ok(r1.body.content.includes('"price":5.14'));
  assert.ok(r1.body.content.includes("JavaScript-rendered"));
  passed++; console.log("  ok shell page -> extracted text body");

  stubFetch(nextShell);
  const off = makeFetchProvider({ cfg: { ...cfg, spaExtraction: false }, proxy: null });
  const r2 = await off.fetch({ url: "https://example.com/product" });
  assert.equal(r2.body.kind, "html");
  assert.ok(!r2.body.content.includes("recovered its embedded JSON"));
  passed++; console.log("  ok spaExtraction=false keeps raw html");

  const article = "<html><body>" + "<p>这是一篇正常的长文章，包含大量可见文本。</p>".repeat(200) + "</body></html>";
  stubFetch(article);
  const r3 = await provider.fetch({ url: "https://example.com/article" });
  assert.equal(r3.body.kind, "html");
  assert.ok(r3.body.content.includes("正常的长文章"));
  passed++; console.log("  ok normal article untouched");

  stubFetch(JSON.stringify(offers), "application/json");
  const r4 = await provider.fetch({ url: "https://example.com/api/offers" });
  assert.equal(r4.body.kind, "text");
  assert.ok(r4.body.content.includes('"price":5.14'));
  passed++; console.log("  ok json passthrough");

  globalThis.fetch = async () => new Response(nextShell, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const r5 = await provider.fetch({ url: "https://example.com/missing" });
  assert.equal(r5.statusCode, 404);
  assert.equal(r5.body.kind, "html");
  assert.ok(!r5.body.content.includes("recovered its embedded JSON"), "404 shell must not be extracted");
  passed++; console.log("  ok 404 shell skips extraction (status gate)");
} finally {
  globalThis.fetch = realFetch;
}

/* ── real-world fixtures (optional) ── */
const ws = path.resolve(here, "..", "..");
for (const name of ["priceai_gemini-pro-recharge.html", "priceai_gemini-pro-year.html"]) {
  const f = path.join(ws, name);
  if (!fs.existsSync(f)) { console.log(`skip real fixture ${name} (not present)`); continue; }
  const html = fs.readFileSync(f, "utf8");
  const ex = extractEmbeddedData(html);
  assert.equal(ex.found, true, `${name}: embedded data found`);
  assert.ok(/"price"\s*:\s*\d/.test(ex.text), `${name}: prices recovered`);
  assert.ok(ex.text.includes("offers"), `${name}: offers recovered`);
  passed++;
  console.log(`  ok real fixture ${name}: ${ex.blockCount} blocks, ${ex.text.length} chars, prices recovered`);
}

console.log(`\n${passed} assertions passed`);
