/**
 * Generic embedded-data extraction for JavaScript-rendered pages (SPA shells).
 *
 * ZERO npm dependencies, deterministic, no browser and no LLM: most modern SPAs
 * (Next.js App/Pages Router, Nuxt, Redux/Apollo-style state) already ship their
 * page data as JSON inside the HTML. This module recovers that JSON so the agent
 * gets the data in ONE fetch instead of hand-writing a scraper per site.
 *
 * When nothing embedded is found the caller keeps the plain shell + a notice
 * that explicitly suggests the fallback: write a short temporary script to probe
 * the site's JSON API, or try another source.
 *
 * Standalone-testable: no cordis / schemastery / engines imports.
 * @license Apache-2.0
 */

/** Markers whose presence means "this HTML probably carries embedded JSON data". */
const MARKERS = [
  "__NEXT_DATA__",
  "self.__next_f",
  "__NUXT__",
  "__INITIAL_STATE__",
  "__PRELOADED_STATE__",
  "__APOLLO_STATE__",
  "application/ld+json",
  "application/json",
];

/** State-assignment patterns recovered with a balanced-bracket scan. */
const ASSIGNMENT_NAMES = [
  "window.__INITIAL_STATE__",
  "__INITIAL_STATE__",
  "window.__PRELOADED_STATE__",
  "__PRELOADED_STATE__",
  "window.__APOLLO_STATE__",
  "__APOLLO_STATE__",
  "window.__NUXT__",
  "__NUXT__",
  "window.__data",
];

export function hasEmbeddedMarkers(html) {
  return MARKERS.some((m) => html.includes(m));
}

/** Visible-text length after dropping scripts/styles/tags (the JS-shell heuristic). */
export function visibleTextLength(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Scan one balanced JSON value starting at `start` ('{' or '[').
 * String/escape aware; counts both bracket kinds so nested arrays/objects work.
 * @returns {string|null} the raw JSON text, or null when unbalanced.
 */
function scanBalanced(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** <script type="application/(ld+)json"> and <script id="__NEXT_DATA__"> blocks. */
function extractScriptJson(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2].trim();
    if (!body || (body[0] !== "{" && body[0] !== "[")) continue;
    const isNextData = /id\s*=\s*["']__NEXT_DATA__["']/i.test(attrs);
    const isLd = /type\s*=\s*["']application\/ld\+json["']/i.test(attrs);
    const isJson = /type\s*=\s*["']application\/json["']/i.test(attrs);
    if (!isNextData && !isLd && !isJson) continue;
    try {
      blocks.push({ label: isNextData ? "__NEXT_DATA__" : isLd ? "JSON-LD" : "script-json", value: JSON.parse(body) });
    } catch { /* not valid JSON — skip */ }
    if (blocks.length >= 40) break;
  }
  return blocks;
}

/**
 * Next.js App Router flight payload: concatenate every self.__next_f.push([1,"…"])
 * chunk, unescape, then keep the rows whose body is pure JSON (id:{…} / id:[…]).
 * Data-carrying rows (e.g. ["$","$L39",null,{initialData:{offers:[…]}}]) parse as
 * JSON and are kept whole; module imports (I[…]) and markers ($S…, H…) are skipped.
 */
function extractNextFlight(html) {
  let flight = "";
  const patterns = [
    /self\.__next_f\.push\(\s*\[\s*1\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\s*\)/g,
    /self\.__next_f\.push\(\s*\[\s*1\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        // Double-quoted chunks are already JSON-string body syntax. Single-quoted
        // JS chunks: unescape \' and escape bare " before borrowing JSON.parse.
        const body = re === patterns[0] ? m[1] : m[1].replace(/\\'/g, "'").replace(/"/g, '\\"');
        flight += JSON.parse(`"${body}"`);
      } catch { /* malformed chunk — skip */ }
    }
  }
  if (!flight) return [];
  const blocks = [];
  for (const row of flight.split("\n")) {
    const i = row.indexOf(":");
    if (i <= 0 || i > 12) continue;
    if (!/^[0-9a-f]+$/i.test(row.slice(0, i))) continue;
    const body = row.slice(i + 1);
    if (body[0] !== "{" && body[0] !== "[") continue;
    try {
      const value = JSON.parse(body);
      if (JSON.stringify(value).length < 40) continue;
      blocks.push({ label: `next-flight:${row.slice(0, i)}`, value });
    } catch { /* row is not pure JSON — skip */ }
    if (blocks.length >= 200) break;
  }
  return blocks;
}

/** window.__INITIAL_STATE__ = {…} style assignments (Redux/Apollo/Nuxt/data). */
function extractAssignments(html) {
  const blocks = [];
  for (const name of ASSIGNMENT_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}\\s*[:=]\\s*`, "g");
    let m;
    while ((m = re.exec(html)) !== null) {
      let i = m.index + m[0].length;
      while (i < html.length && /\s/.test(html[i])) i++;
      if (html[i] !== "{" && html[i] !== "[") continue;
      const raw = scanBalanced(html, i);
      if (!raw) continue;
      try {
        blocks.push({ label: name.replace(/^window\./, ""), value: JSON.parse(raw) });
      } catch { /* not strict JSON (JS object literal) — skip */ }
      if (blocks.length >= 40) break;
    }
  }
  return blocks;
}

/** Same-origin API endpoints mentioned in the HTML/scripts (fetch-next hints). */
function extractApiHints(html) {
  const re = /["'](\/api\/[^"'\s<>\\]{3,160}|https?:\/\/[^"'\s<>\\]*\/api\/[^"'\s<>\\]{3,160})["']/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null && seen.size < 10) seen.add(m[1]);
  return [...seen];
}

/**
 * Recover embedded JSON data from a JS-shell page.
 * @param {string} html full decoded HTML (not char-capped).
 * @param {{maxChars?: number}} opts total output budget (default 40000 chars).
 * @returns {{found: boolean, text: string, blockCount: number, omitted: number, apiHints: string[]}}
 *   `text` is model-ready: largest blocks first, each labeled, budget-bounded.
 */
export function extractEmbeddedData(html, { maxChars = 40000 } = {}) {
  const apiHints = extractApiHints(html);
  const raw = [...extractScriptJson(html), ...extractNextFlight(html), ...extractAssignments(html)];
  const seen = new Set();
  const uniq = [];
  for (const b of raw) {
    let text;
    try { text = JSON.stringify(b.value); } catch { continue; }
    if (!text || seen.has(text)) continue;
    seen.add(text);
    uniq.push({ label: b.label, text });
  }
  uniq.sort((a, b) => b.text.length - a.text.length);
  if (uniq.length === 0) return { found: false, text: "", blockCount: 0, omitted: 0, apiHints };

  const parts = [];
  let used = 0;
  let omitted = 0;
  for (const b of uniq) {
    const header = `\n=== ${b.label} (${b.text.length} chars) ===\n`;
    const room = maxChars - used - header.length;
    if (room <= 200) { omitted++; continue; }
    let body = b.text;
    if (body.length > room) {
      // Only the largest block is ever cut (it is emitted first); keep a marker.
      body = `${body.slice(0, room)}…[truncated, ${b.text.length - room} chars omitted]`;
    }
    parts.push(header + body);
    used += header.length + body.length;
  }
  const kinds = [...new Set(uniq.map((b) => b.label.split(":")[0]))].join(", ");
  let text = `[smart-webfetch: this page is JavaScript-rendered; recovered its embedded JSON data without a browser. Sources: ${kinds}. Largest blocks first.]`;
  text += parts.join("");
  if (omitted > 0) text += `\n[${omitted} smaller block(s) omitted by the output budget.]`;
  if (apiHints.length > 0) text += `\n[API endpoints seen in scripts: ${apiHints.join(" , ")}]`;
  text += "\n[If this data is insufficient, write a short temporary script (e.g. Python + requests) to call the site's JSON API directly, or try another source.]";
  return { found: true, text, blockCount: uniq.length, omitted, apiHints };
}
