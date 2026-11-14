/**
 * Engine + fetch layer for dsh-smart-websearch. ZERO npm dependencies:
 * direct requests use the Node built-in fetch (Node >= 22.19); proxied requests
 * use a native HTTP CONNECT tunnel (node:http / node:tls / node:https) with
 * gzip/deflate/br decompression via node:zlib.
 * No cordis / schemastery imports either, so it is unit- and live-testable standalone.
 * Parsing adapted from dsh-free-search (MIT) with its hard-won guards preserved.
 * @license Apache-2.0
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { extractEmbeddedData, hasEmbeddedMarkers, pruneHtmlBoilerplate, visibleTextLength } from "./extract.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BING_URL = "https://www.bing.com/search";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
const ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";

/* ── error formatting & retry classification ── */
export function describeError(err) {
  if (!err) return "unknown error";
  const msg = err instanceof Error ? err.message : String(err);
  const parts = [msg];
  let cur = err instanceof Error ? err.cause : undefined;
  let depth = 0;
  while (cur && depth < 3) {
    const code = cur.code ? `${cur.code}: ` : "";
    const cm = cur instanceof Error ? cur.message : String(cur);
    if (cm && !parts.includes(cm)) parts.push(`${code}${cm}`);
    else if (cur.code && !parts.join(" ").includes(cur.code)) parts.push(String(cur.code));
    cur = cur instanceof Error ? cur.cause : undefined;
    depth++;
  }
  return parts.join(" <- ");
}

function isTransientNetworkError(err) {
  const full = describeError(err).toUpperCase();
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|SOCKET HANG UP|FETCH FAILED/.test(full);
}

/* ── parsing helpers ── */
function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function cleanSnippet(text, max = 300) {
  if (!text) return text;
  const cleaned = String(text).replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  let cut = max;
  const c = cleaned.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return cleaned.slice(0, cut);
}
function uniqueSources(sources, limit) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push({ url: s.url, ...(s.title ? { title: s.title } : {}), ...(s.snippet ? { snippet: cleanSnippet(s.snippet) } : {}) });
    }
    if (out.length >= limit) break;
  }
  return out;
}
function extractDdgUrl(rel) {
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  if (rel.startsWith("//")) return `https:${rel}`;
  return rel;
}
function extractBingUrl(href) {
  if (!href) return href;
  const url = decodeEntities(href);
  if (!/^https?:\/\/(www\.)?bing\.com\/ck\/a/i.test(url)) return href;
  try {
    const u = new URL(url).searchParams.get("u");
    if (!u) return href;
    const b64 = u.startsWith("a1") ? u.slice(2) : u;
    const decoded = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : href;
  } catch { return href; }
}
const STOP_WORDS = new Set(["what", "is", "are", "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "how", "why", "when", "where", "who", "which", "does", "do", "did", "can", "could", "with", "this", "that", "it", "as", "at", "by", "from", "be", "been", "was", "were", "i", "you", "we", "they", "he", "she", "my", "your", "their", "its", "not", "no", "yes", "vs", "via"]);
function queryOverlapTokens(query) {
  const tokens = new Set();
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 2) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  for (const word of String(query).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2 && !STOP_WORDS.has(word)) tokens.add(word);
  }
  return [...tokens];
}
function looksRelevant(query, sources) {
  const tokens = queryOverlapTokens(query);
  if (tokens.length === 0) return true;
  const strong = tokens.filter((t) => !/^\d+$/.test(t));
  const usable = strong.length > 0 ? strong : tokens;
  const matched = new Set();
  let relevant = 0;
  for (const s of sources) {
    const hay = `${s.title ?? ""} ${s.snippet ?? ""} ${s.url ?? ""}`.toLowerCase();
    const hits = usable.filter((t) => hay.includes(t.toLowerCase()));
    if (hits.length > 0) { relevant += 1; for (const h of hits) matched.add(h); }
  }
  const enoughSources = relevant >= Math.max(1, Math.ceil(sources.length / 3));
  return enoughSources && matched.size >= 1;
}

/* ── HTTP (zero-dependency: built-in fetch direct, native CONNECT tunnel via proxy) ── */
function combineSignals(signal, timeoutMs) {
  const list = [];
  if (signal) list.push(signal);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) list.push(AbortSignal.timeout(timeoutMs));
  return list.length ? AbortSignal.any(list) : undefined;
}
function abortError(signal) {
  return signal?.reason ?? new Error("aborted");
}
function onAbort(signal, fn) {
  if (!signal) return () => {};
  if (signal.aborted) { fn(); return () => {}; }
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}

/** Open a CONNECT tunnel through an HTTP proxy; resolves the raw socket. */
function connectTunnel(proxyUrl, host, port, signal) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = new URL(proxyUrl); } catch { reject(new Error(`smart-websearch: invalid proxyUrl "${proxyUrl}"`)); return; }
    if (p.protocol !== "http:" && p.protocol !== "https:") {
      reject(new Error(`smart-websearch: unsupported proxy protocol (${p.protocol}); use an http:// proxy`));
      return;
    }
    const headers = { Host: `${host}:${port}` };
    if (p.username) {
      headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString("base64");
    }
    const req = (p.protocol === "https:" ? https : http).request({
      host: p.hostname,
      port: Number(p.port) || (p.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${host}:${port}`,
      headers,
    });
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; off(); fn(arg); } };
    const off = onAbort(signal, () => {
      const err = abortError(signal);
      req.destroy(err);
      done(reject, err);
    });
    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        done(reject, new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }
      done(resolve, socket);
    });
    req.once("error", (e) => done(reject, e));
    req.end();
  });
}

function wrapDecompressedStream(res, contentEncoding) {
  const enc = String(contentEncoding ?? "").trim().toLowerCase();
  if (!enc || enc === "identity") return Readable.toWeb(res);
  let decoder = null;
  if (enc === "gzip" || enc === "x-gzip") decoder = zlib.createGunzip();
  else if (enc === "deflate") decoder = zlib.createInflate();
  else if (enc === "br") decoder = zlib.createBrotliDecompress();
  if (!decoder) return Readable.toWeb(res);
  res.pipe(decoder);
  res.on("error", (e) => decoder.destroy(e));
  return Readable.toWeb(decoder);
}

/** One proxied request (no redirect handling). Returns a web Response. */
function proxyRequestOnce(urlStr, { headers, signal, proxyUrl }) {
  const u = new URL(urlStr);
  const secure = u.protocol === "https:";
  const port = Number(u.port) || (secure ? 443 : 80);
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeSocket = null;
    let activeReq = null;
    const offGlobal = onAbort(signal, () => {
      const err = abortError(signal);
      try { activeReq?.destroy(err); } catch {}
      try { activeSocket?.destroy(err); } catch {}
      if (!settled) { settled = true; reject(err); }
    });
    const done = (fn, arg) => {
      if (!settled) {
        settled = true;
        fn(arg);
      }
    };
    const start = (socket) => {
      if (signal?.aborted) {
        try { socket?.destroy(); } catch {}
        done(reject, abortError(signal));
        return;
      }
      const reqHeaders = { "Accept-Encoding": "gzip, deflate, br", ...headers };
      const opts = {
        method: "GET",
        headers: reqHeaders,
        ...(secure
          ? { host: u.hostname, port, path: u.pathname + u.search, createConnection: () => socket }
          : (() => {
            const p = new URL(proxyUrl);
            return { host: p.hostname, port: Number(p.port) || 80, path: urlStr, headers: { ...reqHeaders, Host: u.host } };
          })()),
      };
      const req = (secure ? https : http).request(opts, (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          if (Array.isArray(v)) { for (const x of v) h.append(k, String(x)); } else h.append(k, String(v));
        }
        const status = res.statusCode ?? 502;
        const ce = res.headers["content-encoding"];
        const body = status === 204 || status === 205 || status === 304 ? null : wrapDecompressedStream(res, ce);
        // Clean up global abort listener once stream completes or closes
        res.once("close", offGlobal);
        res.once("end", offGlobal);
        done(resolve, new Response(body, { status, headers: h, url: urlStr }));
      });
      activeReq = req;
      req.once("error", (e) => {
        offGlobal();
        done(reject, e);
      });
      req.end();
    };
    if (secure) {
      connectTunnel(proxyUrl, u.hostname, port, signal).then((raw) => {
        if (settled || signal?.aborted) { raw.destroy(); done(reject, abortError(signal)); return; }
        const t = tls.connect({ socket: raw, servername: u.hostname, ALPNProtocols: ["http/1.1"] });
        activeSocket = t;
        t.once("secureConnect", () => { start(t); });
        t.once("error", (e) => { offGlobal(); done(reject, e); });
      }).catch((e) => { offGlobal(); done(reject, e); });
    } else {
      start(null);
    }
  });
}

/** Proxied fetch with redirect handling; returns a web Response like built-in fetch. */
async function proxyFetch(urlStr, { headers, signal, proxyUrl, redirect }) {
  let current = urlStr;
  for (let i = 0; i < 6; i++) {
    const res = await proxyRequestOnce(current, { headers, signal, proxyUrl });
    if (redirect === "manual") return res;
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("smart-websearch: too many redirects");
}

/** Unified GET: built-in fetch when direct, native CONNECT tunnel when proxied. */
function httpFetch(url, { signal, timeoutMs, headers, proxy, redirect = "follow" }) {
  const sig = combineSignals(signal, timeoutMs);
  if (!proxy) return fetch(url, { signal: sig, headers, redirect });
  return proxyFetch(url, { headers, signal: sig, proxyUrl: proxy, redirect });
}

async function fetchHtml(url, { signal, timeoutMs, acceptLang, proxy }) {
  const res = await httpFetch(url, {
    signal, timeoutMs, proxy,
    headers: {
      "User-Agent": UA,
      "Accept-Language": acceptLang ?? ACCEPT_LANG,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
  return await res.text();
}

/* ── engines ── */
async function tryBing(query, maxResults, opts, signal, cfg, host, proxy, acceptLang) {
  try {
    const params = new URLSearchParams({ q: query });
    if (cfg.bingMarket) params.set("mkt", cfg.bingMarket);
    params.set("adlt", opts?.safeSearch === "strict" ? "strict" : opts?.safeSearch === "moderate" ? "moderate" : "off");
    const html = await fetchHtml(`${host}?${params}`, { signal, timeoutMs: cfg.perEngineTimeoutMs, acceptLang, proxy });
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
    const sources = [];
    for (const block of blocks) {
      const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
      const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (!hrefMatch) continue;
      sources.push({
        url: extractBingUrl(hrefMatch[1]),
        ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
        ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}),
      });
    }
    if (sources.length > 0 && !looksRelevant(query, sources)) return [];
    return uniqueSources(sources, maxResults);
  } catch {
    return [];
  }
}

export async function searchBing(query, maxResults, opts, signal, cfg, proxy) {
  const cjk = /[\u4e00-\u9fff]/.test(query);
  const directHost = cfg.bingDirectHost || "https://cn.bing.com/search";
  const proxyHost = cfg.bingProxyHost || BING_URL;
  const paths = cjk
    ? [{ host: directHost, proxy: undefined, lang: "zh-CN,zh;q=0.9" },
       ...(proxy ? [{ host: proxyHost, proxy, lang: ACCEPT_LANG }] : [])]
    : [...(proxy ? [{ host: proxyHost, proxy, lang: "en-US,en;q=0.9" }] : []),
       { host: directHost, proxy: undefined, lang: ACCEPT_LANG }];
  for (const p of paths) {
    const sources = await tryBing(query, maxResults, opts, signal, cfg, p.host, p.proxy, p.lang);
    if (sources.length > 0) return sources;
  }
  return [];
}

export async function searchDdgLite(query, maxResults, opts, signal, cfg, proxy) {
  const params = new URLSearchParams({ q: query });
  params.set("adlt", opts?.safeSearch === "strict" ? "1" : opts?.safeSearch === "moderate" ? "0" : "-1");
  const days = opts?.timeRange?.days;
  if (Number.isFinite(days)) params.set("df", days <= 1 ? "d" : days <= 7 ? "w" : days <= 31 ? "m" : "y");
  const html = await fetchHtml(`${DDG_LITE_URL}?${params}`, { signal, timeoutMs: cfg.perEngineTimeoutMs, proxy });
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({ url, ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}), ...(snippet ? { snippet: stripTags(snippet) } : {}) });
  }
  return uniqueSources(sources, maxResults);
}

/* ── hedged fallback orchestration ── */
export async function searchWithHedge(engineFns, { budgetMs, hedgeMs, signal }) {
  const deadline = Date.now() + budgetMs;
  let launched = 0;
  const settled = [];
  const inflight = new Set();
  let wake = null;
  const wakeUp = () => { const f = wake; wake = null; if (f) f(); };

  const launch = () => {
    if (launched >= engineFns.length) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const { name: eng, fn } = engineFns[launched++];
    const controller = new AbortController();
    const eff = AbortSignal.any([...(signal ? [signal] : []), controller.signal, AbortSignal.timeout(remaining)]);
    const task = { name: eng, controller };
    inflight.add(task);
    Promise.resolve().then(() => fn(eff)).then(
      (sources) => { inflight.delete(task); settled.push({ name: eng, ok: true, sources }); wakeUp(); },
      (error) => { inflight.delete(task); settled.push({ name: eng, ok: false, error }); wakeUp(); },
    );
    return true;
  };

  const takeNext = async () => {
    if (settled.length > 0) return settled.shift();
    if (inflight.size === 0) return null;
    const timer = hedgeMs > 0 && launched < engineFns.length ? setTimeout(() => launch(), hedgeMs) : null;
    try {
      return await new Promise((resolve) => { wake = () => resolve(settled.shift() ?? null); });
    } finally { if (timer !== null) clearTimeout(timer); }
  };

  launch();
  const errors = [];
  for (;;) {
    const rec = await takeNext();
    if (rec === null) {
      if (launched < engineFns.length) { if (Date.now() >= deadline) break; launch(); continue; }
      break;
    }
    if (rec.ok && rec.sources.length > 0) {
      for (const t of inflight) { try { t.controller.abort(); } catch {} }
      return { sources: rec.sources, engine: rec.name };
    }
    if (!rec.ok) errors.push(`${rec.name}: ${describeError(rec.error)}`);
    if (inflight.size === 0 && launched < engineFns.length) { if (Date.now() >= deadline) break; launch(); }
  }
  throw new Error(`smart-websearch: no results (${errors.join("; ") || "all engines returned 0"})`);
}

/* ── Baidu engine (domestic, direct; strong for Chinese niche/new-term queries) ── */
async function resolveRedirect(url, signal, timeoutMs) {
  try {
    let current = url;
    for (let i = 0; i < 3; i++) {
      const res = await httpFetch(current, { signal, timeoutMs, redirect: "manual", headers: { "User-Agent": UA } });
      await res.body?.cancel().catch(() => {});
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString();
        if (!/baidu\.com\/link\?/.test(current)) return current;
      } else return current !== url ? current : null;
    }
    return current !== url ? current : null;
  } catch { return null; }
}
export async function searchBaidu(query, maxResults, opts, signal, cfg) {
  try {
    const host = cfg.baiduHost || "https://www.baidu.com/s";
    const html = await fetchHtml(`${host}?${new URLSearchParams({ wd: query })}`, { signal, timeoutMs: cfg.perEngineTimeoutMs, acceptLang: "zh-CN,zh;q=0.9" });
    const containers = html.match(/<div[^>]*class="result c-container[^"]*"[\s\S]*?(?=<div[^>]*class="result c-container|<div id="page|$)/g) ?? [];
    const items = [];
    for (const c of containers) {
      const h3 = c.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!h3) continue;
      const snip = c.match(/class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/) || c.match(/<span[^>]*class="[^"]*c-color-text[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      items.push({ url: decodeEntities(h3[1]), title: stripTags(h3[2]), ...(snip ? { snippet: stripTags(snip[1]) } : {}) });
    }
    const top = items.slice(0, maxResults);
    await Promise.all(top.map(async (it) => {
      if (/baidu\.com\/link\?/.test(it.url)) {
        const real = await resolveRedirect(it.url, signal, 4000);
        if (real) it.url = real;
      }
    }));
    if (top.length > 0 && !looksRelevant(query, top)) return [];
    return uniqueSources(top, maxResults);
  } catch { return []; }
}

/* ── domestic-host detection (for fetch routing) ── */
const DOMESTIC_SUFFIXES = [".cn", ".com.cn", ".net.cn", ".org.cn", ".gov.cn", ".edu.cn"];
const DOMESTIC_DOMAINS = [
  "aliyun.com", "aliyuncs.com", "alibabacloud.com", "baidu.com", "bdstatic.com",
  "qianwenai.com", "qoder.cn", "doubao.com", "volces.com", "bytedance.com",
  "feishu.cn", "dingtalk.com", "taobao.com", "tmall.com", "jd.com", "qq.com",
  "bilibili.com", "zhihu.com", "csdn.net", "runoob.com", "jianshu.com",
  "cnblogs.com", "51cto.com", "oschina.net", "gitee.com", "gitcode.com",
  "deepseek.com", "modelscope.cn", "163.com", "126.com", "sina.com.cn",
  "sohu.com", "ifeng.com", "people.com.cn", "xinhuanet.com", "llmrates.ai",
  "juejin.cn", "yuque.com", "huaweicloud.com", "cloud.tencent.com",
  "tencentcloud.com", "sspai.com", "segmentfault.com", "infoq.cn",
  "npmmirror.com", "xiaohongshu.com", "douban.com", "weibo.com",
];
export function isDomesticHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (DOMESTIC_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return DOMESTIC_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

/* ── search provider factory ── */
export function makeSearchProvider({ cfg, engines, maxResults, proxy = null, resolveProxy }) {
  const getProxy = typeof resolveProxy === "function" ? resolveProxy : async () => ({ url: proxy || null });
  const cache = new Map();
  const cacheTtl = cfg.cacheTtlMs > 0 ? cfg.cacheTtlMs : 0;
  const cacheMax = cfg.cacheMaxEntries > 0 ? cfg.cacheMaxEntries : 50;
  const cacheKey = (q, n) => q.toLowerCase().replace(/\s+/g, " ").trim() + "|" + n;
  return {
    id: "smart-websearch",
    title: "Smart WebSearch (Bing + Baidu + DDG)",
    description: "Language-aware: CJK -> cn.bing/Baidu direct then proxy; overseas -> proxy Bing/DDG. Hedged, auto-proxy, cached.",
    available: () => true,
    ready: () => true,
    async search(request, signal) {
      const query = String(request?.query ?? "").trim();
      if (!query) throw new Error("smart-websearch: empty query");
      const limit = request?.maxResults > 0 ? request.maxResults : maxResults;
      const key = cacheKey(query, limit);
      if (cacheTtl > 0) {
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) return { sources: hit.sources, truncated: false, cached: true };
      }
      const proxyInfo = await getProxy();
      const pa = proxyInfo?.url || undefined;
      const has = (id) => (engines ?? ["bing", "baidu", "ddg-lite"]).includes(id);
      const directHost = cfg.bingDirectHost || "https://cn.bing.com/search";
      const proxyHost = cfg.bingProxyHost || BING_URL;
      const cjk = /[\u4e00-\u9fff]/.test(query);
      const bingCn = has("bing") ? { name: "bing-cn", fn: (sig) => tryBing(query, limit, request, sig, cfg, directHost, undefined, "zh-CN,zh;q=0.9") } : null;
      const bingWww = has("bing") && pa ? { name: "bing-www", fn: (sig) => tryBing(query, limit, request, sig, cfg, proxyHost, pa, "en-US,en;q=0.9") } : null;
      const baidu = has("baidu") ? { name: "baidu", fn: (sig) => searchBaidu(query, limit, request, sig, cfg) } : null;
      const ddg = has("ddg-lite") && pa ? { name: "ddg", fn: (sig) => searchDdgLite(query, limit, request, sig, cfg, pa) } : null;
      const chain = (cjk ? [bingCn, baidu, bingWww, ddg] : [bingWww, ddg, baidu, bingCn]).filter(Boolean);
      if (chain.length === 0) throw new Error("smart-websearch: no engines configured");
      const { sources } = await searchWithHedge(chain, { budgetMs: cfg.searchBudgetMs, hedgeMs: cfg.hedgeMs, signal });
      if (sources.length > 0 && cacheTtl > 0) {
        cache.set(key, { sources, expires: Date.now() + cacheTtl });
        if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
      }
      return { sources, truncated: false };
    },
  };
}

/* ── smart fetch provider ── */
function classifyContentType(ct) {
  const t = String(ct || "").toLowerCase();
  if (/html|xhtml/.test(t)) return "html";
  if (/^text\/|json|xml|javascript|csv/.test(t)) return "text";
  return undefined;
}

function parseCharset(contentType, rawBytes) {
  const m = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  if (m?.[1]) return m[1].trim().toLowerCase();
  // Peek first 2KB as ASCII for HTML <meta charset="..."> or <meta http-equiv="Content-Type" content="...; charset=...">
  if (rawBytes && rawBytes.length > 0) {
    const head = new TextDecoder("latin1").decode(rawBytes.subarray(0, 2048));
    const meta1 = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(head);
    if (meta1?.[1]) return meta1[1].trim().toLowerCase();
  }
  return "utf-8";
}

function decodeBodyBytes(bytes, contentType) {
  const charset = parseCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(res, maxBytes) {
  if (res.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0, truncatedByBytes = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncatedByBytes = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return { bytes, truncatedByBytes };
}

function isRetryableStatus(status) {
  return status === 403 || status === 429 || status === 502 || status === 503 || status === 504;
}

export function makeFetchProvider({ cfg, proxy = null, resolveProxy }) {
  const getProxy = typeof resolveProxy === "function" ? resolveProxy : async () => ({ url: proxy || null });
  return {
    id: "smart-webfetch",
    title: "Smart WebFetch",
    description: "Bounded HTTP(S) fetch with auto-detected proxy, failover, boilerplate pruning, and SPA JSON recovery.",
    available: () => true,
    ready: () => true,
    async fetch(request, signal) {
      const raw = String(request?.url ?? "");
      let u;
      try { u = new URL(raw); } catch { throw new Error("smart-webfetch: invalid URL"); }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("smart-webfetch: only http/https URLs are supported");
      if (u.username || u.password) throw new Error("smart-webfetch: URLs with embedded credentials are not allowed");
      if (raw.length > 2048) throw new Error("smart-webfetch: URL exceeds 2048 characters");

      const proxyInfo = await getProxy();
      const proxy = proxyInfo?.url || null;
      const domestic = isDomesticHost(u.hostname);
      const paths = domestic
        ? [{ useProxy: false }, ...(proxy ? [{ useProxy: true }] : [])]
        : [...(proxy ? [{ useProxy: true }] : []), { useProxy: false }];

      const errors = [];
      let fallbackResult = null;

      for (let i = 0; i < paths.length; i++) {
        const { useProxy } = paths[i];
        const hasNextPath = i + 1 < paths.length;
        const routeLabel = useProxy ? `proxy(${proxy})` : "direct";
        // When another path exists, cap Path 1 to at most 12s so failover still has time.
        const attemptTimeoutMs = hasNextPath ? Math.min(cfg.fetchTimeoutMs, 12000) : cfg.fetchTimeoutMs;
        const maxTries = 2;

        for (let attempt = 0; attempt < maxTries; attempt++) {
          if (signal?.aborted) break;
          try {
            const res = await httpFetch(raw, {
              signal,
              timeoutMs: attemptTimeoutMs,
              proxy: useProxy ? proxy : undefined,
              headers: {
                "User-Agent": UA,
                "Accept-Language": ACCEPT_LANG,
                "Accept": "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
              },
            });
            const ct = res.headers.get("content-type");
            const kind = classifyContentType(ct);
            if (!kind) {
              await res.body?.cancel().catch(() => {});
              throw new Error(`unsupported content-type (${ct || "none"})`);
            }
            const { bytes, truncatedByBytes } = await readCapped(res, cfg.fetchMaxBytes);
            const decoded = decodeBodyBytes(bytes, ct);

            // SPA embedded-data recovery on full HTML before char cap (status < 400).
            if (kind === "html" && cfg.spaExtraction !== false && res.status < 400 && decoded.length > 5000) {
              const probe = decoded.length > 2000000 ? decoded.slice(0, 2000000) : decoded;
              const textLen = visibleTextLength(probe);
              const shell = textLen < 120 || (textLen < 3000 && hasEmbeddedMarkers(probe));
              if (shell) {
                const ex = extractEmbeddedData(decoded, { maxChars: cfg.spaMaxChars > 0 ? cfg.spaMaxChars : 40000 });
                if (ex.found) {
                  const capped = ex.text.length > cfg.fetchMaxChars;
                  const content = capped ? ex.text.slice(0, cfg.fetchMaxChars) : ex.text;
                  return { url: res.url || raw, statusCode: res.status, body: { kind: "text", content }, truncated: truncatedByBytes || capped };
                }
              }
            }

            // Lightweight boilerplate pruning on normal large HTML pages (cuts nav/footer token waste).
            const cleanedHtml = kind === "html" && cfg.boilerplatePruning !== false && res.status < 400
              ? pruneHtmlBoilerplate(decoded)
              : decoded;

            const truncatedByChars = cleanedHtml.length > cfg.fetchMaxChars;
            let content = truncatedByChars ? cleanedHtml.slice(0, cfg.fetchMaxChars) : cleanedHtml;
            if (kind === "html" && content.length > 5000) {
              const textLen = visibleTextLength(content);
              if (textLen < 120) {
                content += `\n<p><em>[smart-webfetch: this page appears JavaScript-rendered; little static text was retrieved and no embedded JSON data was found. Try the site's docs/API or another source, or write a short temporary script (e.g. Python + requests) to probe its JSON API.]</em></p>`;
              }
            }

            const result = {
              url: res.url || raw,
              statusCode: res.status,
              body: { kind, content },
              truncated: truncatedByBytes || truncatedByChars,
            };

            // If a WAF/CDN returned 403/429/502/503/504 and we have a fallback route, keep this as backup and try next route.
            if (hasNextPath && isRetryableStatus(res.status)) {
              fallbackResult = result;
              errors.push(`${routeLabel}: HTTP ${res.status}`);
              break;
            }
            return result;
          } catch (e) {
            const detail = describeError(e);
            // Retry once on transient network drop only when no outer abort occurred
            const canRetry = attempt === 0 && !signal?.aborted && isTransientNetworkError(e) && !/ECONNREFUSED/i.test(detail);
            if (canRetry) {
              await new Promise((r) => setTimeout(r, 250));
              continue;
            }
            errors.push(`${routeLabel}: ${detail}`);
            break;
          }
        }
      }

      if (fallbackResult) return fallbackResult;
      throw new Error(`smart-webfetch: failed for ${raw} [${errors.join(" | ")}]`);
    },
  };
}
