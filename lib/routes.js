/**
 * Same-origin HTTP routes bridging the dsh-smart-websearch Settings UI to the Host.
 * Persists configuration through `ctx.get("configEditor")` per DSH configuration policy.
 * @license Apache-2.0
 */
import { COMMON_PROXY_PORTS, normalizeProxyInput } from "./proxy-detect.js";

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    request.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolveBody({});
      try {
        resolveBody(JSON.parse(text));
      } catch (err) {
        reject(new Error(`invalid JSON: ${err.message}`));
      }
    });
    request.on("error", reject);
  });
}

function sanitizeConfigPatch(body) {
  const patch = {};
  if (typeof body.proxyUrl === "string") {
    const raw = body.proxyUrl.trim();
    if (raw === "" || raw.toLowerCase() === "auto") {
      patch.proxyUrl = "";
    } else if (["direct", "none", "off"].includes(raw.toLowerCase())) {
      patch.proxyUrl = "direct";
    } else {
      const normalized = normalizeProxyInput(raw);
      if (!normalized || normalized === "DIRECT") {
        throw Object.assign(new Error("代理地址格式无效，请填写如 http://127.0.0.1:7897 或端口号 7890"), { status: 400 });
      }
      patch.proxyUrl = normalized;
    }
  }
  if (body.defaultProxyPort !== undefined) {
    const port = Number(body.defaultProxyPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw Object.assign(new Error("默认代理端口必须是 1~65535 之间的整数"), { status: 400 });
    }
    patch.defaultProxyPort = port;
  }
  for (const key of ["fetchTimeoutMs", "perEngineTimeoutMs", "searchBudgetMs"]) {
    if (body[key] !== undefined) {
      const val = Number(body[key]);
      if (!Number.isFinite(val) || val < 1000 || val > 120000) {
        throw Object.assign(new Error(`${key} 必须在 1000~120000 毫秒之间`), { status: 400 });
      }
      patch[key] = Math.round(val);
    }
  }
  for (const key of ["spaExtraction", "boilerplatePruning", "searchHygiene", "hygieneGuidance"]) {
    if (typeof body[key] === "boolean") patch[key] = body[key];
  }
  return patch;
}

export function mountSmartWebsearchRoutes(host, { getSnapshot, proxyResolver }) {
  const disposers = [
    host.webServer.register({
      kind: "exact",
      path: "/dsh-smart-websearch/status",
      handler: async (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        try {
          const detected = await proxyResolver.resolve(false);
          sendJson(response, 200, {
            ok: true,
            ...getSnapshot(),
            detected,
            commonPorts: COMMON_PROXY_PORTS,
          });
        } catch (err) {
          sendJson(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-smart-websearch/probe",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!isSameOrigin(request)) {
          sendJson(response, 403, { ok: false, error: "untrusted origin" });
          return;
        }
        try {
          proxyResolver.invalidate();
          const detected = await proxyResolver.resolve(true);
          sendJson(response, 200, {
            ok: true,
            ...getSnapshot(),
            detected,
            commonPorts: COMMON_PROXY_PORTS,
          });
        } catch (err) {
          sendJson(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-smart-websearch/config",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!isSameOrigin(request)) {
          sendJson(response, 403, { ok: false, error: "untrusted origin" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const patch = sanitizeConfigPatch(body);
          const entry = host.fiber?.entry;
          const editor = host.get("configEditor");
          if (entry === undefined || editor === undefined) {
            sendJson(response, 400, { ok: false, error: "当前 profile 不支持通过 ConfigEditor 保存配置" });
            return;
          }
          await editor.edit(entry, (current) => ({ ...(current ?? {}), ...patch }));
          sendJson(response, 200, { ok: true, patch });
        } catch (err) {
          sendJson(response, typeof err?.status === "number" ? err.status : 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),
  ];
  return () => {
    for (const d of disposers) {
      try { d(); } catch {}
    }
  };
}
