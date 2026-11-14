/**
 * Auto-detection of local HTTP proxy endpoints for dsh-smart-websearch.
 *
 * Resolution order when `proxyUrl` is blank / "auto":
 *   1. Standard environment variables (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY)
 *   2. Windows Internet Settings registry proxy (when ProxyEnable = 1)
 *   3. Fast parallel TCP probe of common local proxy ports on 127.0.0.1
 *   4. Configurable fallback default port (default 7890)
 *
 * Results are cached briefly so searches/fetches don't re-probe on every call.
 * @license Apache-2.0
 */
import net from "node:net";
import { execFile } from "node:child_process";

/** Common local HTTP proxy ports ordered by prevalence. */
export const COMMON_PROXY_PORTS = [
  { port: 7897, label: "Clash Verge / Mihomo" },
  { port: 7890, label: "Clash / ClashX / CFW" },
  { port: 10809, label: "v2rayN (HTTP)" },
  { port: 1081, label: "ShadowsocksR / Brook" },
  { port: 1080, label: "Generic Local Proxy" },
  { port: 20171, label: "v2rayA (HTTP)" },
  { port: 33210, label: "Sing-box / NekoBox" },
  { port: 8888, label: "Charles / Local HTTP" },
  { port: 8080, label: "HTTP Proxy (8080)" },
];

/** Normalize user-supplied proxy input ("7897", "127.0.0.1:7897", "http://...") into a valid http(s) URL or null. */
export function normalizeProxyInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "auto") return null;
  if (s.toLowerCase() === "none" || s.toLowerCase() === "direct" || s.toLowerCase() === "off") {
    return "DIRECT";
  }
  if (/^\d{2,5}$/.test(s)) {
    const port = Number(s);
    if (port >= 1 && port <= 65535) return `http://127.0.0.1:${port}`;
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
  } catch {
    return null;
  }
  return null;
}

/** Read HTTP(S) proxy from process environment. */
export function detectEnvProxy() {
  const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  for (const k of keys) {
    const val = process.env[k];
    if (!val) continue;
    const norm = normalizeProxyInput(val);
    if (norm && norm !== "DIRECT") return { url: norm, source: `env:${k}` };
  }
  return null;
}

/** Parse Windows `ProxyServer` value like `127.0.0.1:7890` or `http=127.0.0.1:7890;https=127.0.0.1:7890`. */
export function parseWindowsProxyServer(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!s.includes("=")) return normalizeProxyInput(s);
  const parts = s.split(";").map((p) => p.trim()).filter(Boolean);
  const map = new Map();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  for (const key of ["https", "http"]) {
    const hit = map.get(key);
    const norm = normalizeProxyInput(hit);
    if (norm && norm !== "DIRECT") return norm;
  }
  return null;
}

/** Query Windows Internet Settings registry when running on win32. */
export function detectWindowsSystemProxy(timeoutMs = 600) {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) { resolve(null); return; }
        const enabled = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
        if (!enabled || Number.parseInt(enabled[1], 16) !== 1) { resolve(null); return; }
        const server = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(stdout);
        const url = parseWindowsProxyServer(server?.[1]);
        resolve(url ? { url, source: "windows-system-proxy" } : null);
      },
    );
  });
}

/** Fast TCP connect probe against 127.0.0.1:port. */
export function probeLocalPort(port, timeoutMs = 150) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Probe all common local proxy ports in parallel; returns sorted list of open ports + first winner. */
export async function probeCommonProxyPorts(ports = COMMON_PROXY_PORTS, timeoutMs = 150) {
  const checks = await Promise.all(
    ports.map(async (entry) => ({
      ...entry,
      url: `http://127.0.0.1:${entry.port}`,
      open: await probeLocalPort(entry.port, timeoutMs),
    })),
  );
  const firstOpen = checks.find((c) => c.open) ?? null;
  return { checks, firstOpen };
}

/**
 * Create a cached auto-resolving proxy resolver.
 * Never throws; returns `{ url: string | null, mode: string, source: string, openPorts?: Array }`.
 */
export function createProxyResolver({
  configuredProxy = "",
  defaultProxyPort = 7890,
  ttlMs = 30000,
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let inflight = null;

  const fallbackPort = Number.isInteger(defaultProxyPort) && defaultProxyPort >= 1 && defaultProxyPort <= 65535
    ? defaultProxyPort
    : 7890;

  async function detectNow() {
    const explicit = normalizeProxyInput(configuredProxy);
    if (explicit === "DIRECT") {
      return { url: null, mode: "direct", source: "configured:direct", openPorts: [] };
    }
    if (explicit) {
      return { url: explicit, mode: "manual", source: "configured:proxyUrl", openPorts: [] };
    }

    const env = detectEnvProxy();
    if (env) {
      return { url: env.url, mode: "auto", source: env.source, openPorts: [] };
    }

    const win = await detectWindowsSystemProxy();
    if (win) {
      return { url: win.url, mode: "auto", source: win.source, openPorts: [] };
    }

    const { checks, firstOpen } = await probeCommonProxyPorts();
    const openPorts = checks.filter((c) => c.open).map((c) => ({ port: c.port, label: c.label, url: c.url }));
    if (firstOpen) {
      return {
        url: firstOpen.url,
        mode: "auto",
        source: `port-probe:${firstOpen.port} (${firstOpen.label})`,
        openPorts,
        checks,
      };
    }

    // No listening port found: default to http://127.0.0.1:<fallbackPort> (e.g. 7890).
    // Fetch/search always falls back to direct when the default port refuses connections.
    return {
      url: `http://127.0.0.1:${fallbackPort}`,
      mode: "fallback-default",
      source: `default-port:${fallbackPort} (not listening; direct fallback active)`,
      openPorts,
      checks,
    };
  }

  return {
    async resolve(forceRefresh = false) {
      const now = Date.now();
      if (!forceRefresh && cached && now < expiresAt) return cached;
      if (!inflight || forceRefresh) {
        inflight = detectNow()
          .then((res) => {
            cached = res;
            expiresAt = Date.now() + ttlMs;
            return res;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    invalidate() {
      cached = null;
      expiresAt = 0;
    },
  };
}
