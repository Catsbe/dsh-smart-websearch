/**
 * dsh-smart-websearch browser half.
 *
 * Registers a Settings section ("智能联网搜索" / "Smart web search") so users can
 * inspect auto-detected local proxy ports, configure proxyUrl / defaultProxyPort /
 * timeouts, and read why configuring a proxy port accelerates overseas search & fetch.
 */
window.__ModuleLoader__.load({
  id: "dsh-smart-websearch",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const jsx = jsxRuntime.jsx;
    const jsxs = jsxRuntime.jsxs;

    const NS = "dsh-smart-websearch";

    const zh = {
      nav: "智能联网搜索",
      title: "智能联网搜索与网页抓取 (dsh-smart-websearch)",
      desc: "管理海外代理分流、自动端口探测、网页超时与省 Token 抓取策略。",
      proxyBannerTitle: "为什么建议配置本地代理端口？",
      proxyBannerBody:
        "配置了有效的本地代理端口（如 Clash 7890 / Clash Verge 7897 / v2rayN 10809）后，海外搜索引擎（www.bing / DuckDuckGo）与海外文档网页抓取将更快、更稳定、结果更准确；同时国内站点与中文检索仍保持直连，不会变慢。留空时插件会自动扫描本地常用代理端口，若都未开启则兜底尝试默认端口并在失败时回退直连。",
      statusHeading: "当前代理探测状态",
      activeProxy: "当前生效代理",
      detectSource: "命中来源",
      openPorts: "已探测到本机开放端口",
      noOpenPorts: "暂未探测到本机常见代理端口（海外请求将尝试默认端口并自动兜底直连）",
      probeNow: "立即重新检测",
      probing: "检测中…",
      proxyUrlLabel: "代理地址 (proxyUrl)",
      proxyUrlHint: "留空 = 自动检测；可填完整地址（如 http://127.0.0.1:7897）或仅填端口号（如 7890）；填 direct 强制禁用代理。",
      proxyPlaceholder: "留空自动检测，或输入 7890 / http://127.0.0.1:7897",
      quickFill: "快速填入：",
      autoMode: "自动检测",
      directOnly: "仅直连 (direct)",
      defaultPortLabel: "默认兜底端口 (defaultProxyPort)",
      defaultPortHint: "自动检测未发现任何环境变量/系统代理/开放端口时使用的本地默认端口（通用 Clash 为 7890，Clash Verge 为 7897）。",
      fetchTimeoutLabel: "网页抓取超时 (fetchTimeoutMs，毫秒)",
      fetchTimeoutHint: "单次 web_fetch 超时上限（推荐 15000–25000，原版 8000 易报 timeout）。",
      engineTimeoutLabel: "单引擎搜索超时 (perEngineTimeoutMs，毫秒)",
      searchBudgetLabel: "搜索总预算 (searchBudgetMs，毫秒)",
      spaExtractionLabel: "SPA 内嵌数据自动提取（Next.js / Nuxt / JSON-LD）",
      boilerplatePruningLabel: "网页正文去噪（自动剔除导航/页脚/侧边栏，显著节省 Token）",
      searchHygieneLabel: "重复搜索提醒（避免同一主题反复检索浪费 Token）",
      save: "保存配置",
      saving: "正在保存…",
      saved: "配置已保存并立即热重载生效。",
      loadFailed: "读取配置失败：",
      saveFailed: "保存失败：",
      refresh: "刷新",
      directLabel: "直连（无代理）",
    };

    const en = {
      nav: "Smart web search",
      title: "Smart web search & fetch (dsh-smart-websearch)",
      desc: "Configure overseas proxy routing, auto-detection, fetch timeouts, and token-saving extraction.",
      proxyBannerTitle: "Why configure a local proxy port?",
      proxyBannerBody:
        "Configuring a working local proxy port (e.g. Clash 7890, Clash Verge 7897, v2rayN 10809) makes overseas search (www.bing / DuckDuckGo) and overseas page fetching significantly faster, more reliable, and more accurate, while domestic sites remain direct. Leave blank to auto-detect; if none is open, the plugin tries the fallback port and falls back to direct.",
      statusHeading: "Current proxy detection",
      activeProxy: "Active proxy",
      detectSource: "Detection source",
      openPorts: "Open local proxy ports found",
      noOpenPorts: "No common local proxy ports detected (will try fallback port then direct)",
      probeNow: "Re-detect now",
      probing: "Probing…",
      proxyUrlLabel: "Proxy URL (proxyUrl)",
      proxyUrlHint: "Blank = auto-detect; accepts full URL (http://127.0.0.1:7897) or port number (7890); 'direct' disables proxy.",
      proxyPlaceholder: "Blank for auto-detect, or 7890 / http://127.0.0.1:7897",
      quickFill: "Quick fill:",
      autoMode: "Auto-detect",
      directOnly: "Direct only",
      defaultPortLabel: "Fallback proxy port (defaultProxyPort)",
      defaultPortHint: "Used when proxyUrl is blank and auto-detection finds no active proxy (default: 7890).",
      fetchTimeoutLabel: "Web fetch timeout (fetchTimeoutMs, ms)",
      fetchTimeoutHint: "Timeout per web_fetch request (recommended 15000–25000 ms).",
      engineTimeoutLabel: "Per-engine timeout (perEngineTimeoutMs, ms)",
      searchBudgetLabel: "Total search budget (searchBudgetMs, ms)",
      spaExtractionLabel: "Extract embedded SPA JSON (Next.js / Nuxt / JSON-LD)",
      boilerplatePruningLabel: "Prune HTML boilerplate (strip nav/footer/aside to save tokens)",
      searchHygieneLabel: "Search-hygiene reminders (curb duplicate searches)",
      save: "Save settings",
      saving: "Saving…",
      saved: "Settings saved and applied.",
      loadFailed: "Failed to load settings: ",
      saveFailed: "Failed to save: ",
      refresh: "Refresh",
      directLabel: "Direct (no proxy)",
    };

    const cardStyle = {
      border: "1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.22))",
      borderRadius: "10px",
      padding: "14px 16px",
      background: "var(--dsw-alias-bg-secondary, rgba(128,128,128,0.05))",
      marginBottom: "14px",
    };

    const inputStyle = {
      width: "100%",
      boxSizing: "border-box",
      padding: "8px 10px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.28))",
      background: "var(--dsw-alias-bg-primary, transparent)",
      color: "var(--dsw-alias-text-primary, inherit)",
      fontSize: "13px",
    };

    function btnStyle(primary, disabled) {
      return {
        padding: "7px 14px",
        borderRadius: "8px",
        border: primary ? "none" : "1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.28))",
        background: primary ? "var(--dsw-alias-accent, #2563EB)" : "transparent",
        color: primary ? "#FFFFFF" : "var(--dsw-alias-text-primary, inherit)",
        fontSize: "13px",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      };
    }

    function chipStyle(active) {
      return {
        padding: "4px 10px",
        borderRadius: "999px",
        border: active
          ? "1px solid var(--dsw-alias-accent, #2563EB)"
          : "1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.28))",
        background: active ? "rgba(37, 99, 235, 0.12)" : "transparent",
        color: "var(--dsw-alias-text-primary, inherit)",
        fontSize: "12px",
        cursor: "pointer",
      };
    }

    function SmartWebsearchSection({ t }) {
      const [loading, setLoading] = react.useState(true);
      const [probing, setProbing] = react.useState(false);
      const [saving, setSaving] = react.useState(false);
      const [notice, setNotice] = react.useState(null);
      const [detected, setDetected] = react.useState(null);
      const [form, setForm] = react.useState({
        proxyUrl: "",
        defaultProxyPort: "7890",
        fetchTimeoutMs: "20000",
        perEngineTimeoutMs: "10000",
        searchBudgetMs: "16000",
        spaExtraction: true,
        boilerplatePruning: true,
        searchHygiene: true,
      });

      const applyPayload = (data) => {
        if (data.detected) setDetected(data.detected);
        if (data.config) {
          setForm({
            proxyUrl: String(data.config.proxyUrl ?? ""),
            defaultProxyPort: String(data.config.defaultProxyPort ?? 7890),
            fetchTimeoutMs: String(data.config.fetchTimeoutMs ?? 20000),
            perEngineTimeoutMs: String(data.config.perEngineTimeoutMs ?? 10000),
            searchBudgetMs: String(data.config.searchBudgetMs ?? 16000),
            spaExtraction: data.config.spaExtraction !== false,
            boilerplatePruning: data.config.boilerplatePruning !== false,
            searchHygiene: data.config.searchHygiene !== false,
          });
        }
      };

      const load = async () => {
        setLoading(true);
        try {
          const res = await fetch("/dsh-smart-websearch/status", { credentials: "same-origin" });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          applyPayload(data);
        } catch (err) {
          setNotice({ kind: "error", text: `${t("loadFailed")}${err.message || err}` });
        } finally {
          setLoading(false);
        }
      };

      react.useEffect(() => { void load(); }, []);

      const handleProbe = async () => {
        setProbing(true);
        setNotice(null);
        try {
          const res = await fetch("/dsh-smart-websearch/probe", { method: "POST", credentials: "same-origin" });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (data.detected) setDetected(data.detected);
        } catch (err) {
          setNotice({ kind: "error", text: `${t("loadFailed")}${err.message || err}` });
        } finally {
          setProbing(false);
        }
      };

      const handleSave = async (ev) => {
        ev.preventDefault();
        setSaving(true);
        setNotice(null);
        try {
          const payload = {
            proxyUrl: form.proxyUrl.trim(),
            defaultProxyPort: Number(form.defaultProxyPort),
            fetchTimeoutMs: Number(form.fetchTimeoutMs),
            perEngineTimeoutMs: Number(form.perEngineTimeoutMs),
            searchBudgetMs: Number(form.searchBudgetMs),
            spaExtraction: Boolean(form.spaExtraction),
            boilerplatePruning: Boolean(form.boilerplatePruning),
            searchHygiene: Boolean(form.searchHygiene),
          };
          const res = await fetch("/dsh-smart-websearch/config", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          setNotice({ kind: "success", text: t("saved") });
          setTimeout(() => { void load(); }, 400);
        } catch (err) {
          setNotice({ kind: "error", text: `${t("saveFailed")}${err.message || err}` });
        } finally {
          setSaving(false);
        }
      };

      const openPorts = detected?.openPorts ?? [];
      const activeUrl = detected?.url || t("directLabel");

      return jsxs("div", {
        style: { maxWidth: "740px", fontSize: "13px", lineHeight: 1.55 },
        children: [
          jsxs("div", {
            style: { marginBottom: "14px" },
            children: [
              jsx("h3", { style: { margin: "0 0 4px 0", fontSize: "16px", fontWeight: 600 }, children: t("title") }),
              jsx("div", { style: { color: "var(--dsw-alias-text-secondary, #6b7280)" }, children: t("desc") }),
            ],
          }),

          jsxs("div", {
            style: {
              ...cardStyle,
              borderColor: "rgba(37, 99, 235, 0.35)",
              background: "rgba(37, 99, 235, 0.06)",
            },
            children: [
              jsx("div", { style: { fontWeight: 600, marginBottom: "4px" }, children: t("proxyBannerTitle") }),
              jsx("div", { style: { color: "var(--dsw-alias-text-secondary, inherit)" }, children: t("proxyBannerBody") }),
            ],
          }),

          jsxs("div", {
            style: cardStyle,
            children: [
              jsxs("div", {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px" },
                children: [
                  jsx("div", { style: { fontWeight: 600 }, children: t("statusHeading") }),
                  jsx("button", {
                    type: "button",
                    disabled: probing || loading,
                    onClick: handleProbe,
                    style: btnStyle(false, probing || loading),
                    children: probing ? t("probing") : t("probeNow"),
                  }),
                ],
              }),
              jsxs("div", {
                style: { display: "grid", gap: "4px" },
                children: [
                  jsxs("div", { children: [jsx("strong", { children: `${t("activeProxy")}: ` }), jsx("code", { children: activeUrl })] }),
                  jsxs("div", { children: [jsx("strong", { children: `${t("detectSource")}: ` }), jsx("span", { children: detected?.source || "—" })] }),
                  jsxs("div", {
                    style: { marginTop: "4px" },
                    children: [
                      jsx("strong", { children: `${t("openPorts")}: ` }),
                      openPorts.length > 0
                        ? openPorts.map((p) => jsx("span", {
                            style: {
                              display: "inline-block",
                              marginRight: "6px",
                              marginTop: "4px",
                              padding: "2px 8px",
                              borderRadius: "999px",
                              border: "1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.28))",
                              fontSize: "12px",
                            },
                            children: `${p.port} (${p.label})`,
                          }, p.port))
                        : jsx("span", { style: { color: "var(--dsw-alias-text-secondary, #6b7280)" }, children: t("noOpenPorts") }),
                    ],
                  }),
                ],
              }),
            ],
          }),

          notice ? jsx("div", {
            style: {
              ...cardStyle,
              borderColor: notice.kind === "error" ? "rgba(220, 38, 38, 0.45)" : "rgba(22, 163, 74, 0.45)",
              background: notice.kind === "error" ? "rgba(220, 38, 38, 0.08)" : "rgba(22, 163, 74, 0.08)",
            },
            children: notice.text,
          }) : null,

          jsxs("form", {
            onSubmit: handleSave,
            style: cardStyle,
            children: [
              jsxs("div", {
                style: { marginBottom: "14px" },
                children: [
                  jsx("label", { style: { display: "block", fontWeight: 600, marginBottom: "4px" }, children: t("proxyUrlLabel") }),
                  jsx("input", {
                    type: "text",
                    value: form.proxyUrl,
                    placeholder: t("proxyPlaceholder"),
                    onChange: (e) => setForm({ ...form, proxyUrl: e.target.value }),
                    style: inputStyle,
                  }),
                  jsx("div", {
                    style: { fontSize: "12px", color: "var(--dsw-alias-text-secondary, #6b7280)", marginTop: "4px" },
                    children: t("proxyUrlHint"),
                  }),
                  jsxs("div", {
                    style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "8px" },
                    children: [
                      jsx("span", { style: { fontSize: "12px", color: "var(--dsw-alias-text-secondary, #6b7280)" }, children: t("quickFill") }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl === ""), onClick: () => setForm({ ...form, proxyUrl: "" }), children: t("autoMode") }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl.includes(":7897")), onClick: () => setForm({ ...form, proxyUrl: "http://127.0.0.1:7897" }), children: "7897 (Clash Verge)" }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl.includes(":7890")), onClick: () => setForm({ ...form, proxyUrl: "http://127.0.0.1:7890" }), children: "7890 (Clash)" }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl.includes(":10809")), onClick: () => setForm({ ...form, proxyUrl: "http://127.0.0.1:10809" }), children: "10809 (v2rayN)" }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl.includes(":10808")), onClick: () => setForm({ ...form, proxyUrl: "http://127.0.0.1:10808" }), children: "10808" }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl.includes(":8080")), onClick: () => setForm({ ...form, proxyUrl: "http://127.0.0.1:8080" }), children: "8080" }),
                      jsx("button", { type: "button", style: chipStyle(form.proxyUrl === "direct"), onClick: () => setForm({ ...form, proxyUrl: "direct" }), children: t("directOnly") }),
                    ],
                  }),
                ],
              }),

              jsxs("div", {
                style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "14px" },
                children: [
                  jsxs("div", {
                    children: [
                      jsx("label", { style: { display: "block", fontWeight: 600, marginBottom: "4px" }, children: t("defaultPortLabel") }),
                      jsx("input", {
                        type: "number",
                        min: 1,
                        max: 65535,
                        value: form.defaultProxyPort,
                        onChange: (e) => setForm({ ...form, defaultProxyPort: e.target.value }),
                        style: inputStyle,
                      }),
                      jsx("div", { style: { fontSize: "12px", color: "var(--dsw-alias-text-secondary, #6b7280)", marginTop: "3px" }, children: t("defaultPortHint") }),
                    ],
                  }),
                  jsxs("div", {
                    children: [
                      jsx("label", { style: { display: "block", fontWeight: 600, marginBottom: "4px" }, children: t("fetchTimeoutLabel") }),
                      jsx("input", {
                        type: "number",
                        min: 1000,
                        max: 120000,
                        step: 1000,
                        value: form.fetchTimeoutMs,
                        onChange: (e) => setForm({ ...form, fetchTimeoutMs: e.target.value }),
                        style: inputStyle,
                      }),
                      jsx("div", { style: { fontSize: "12px", color: "var(--dsw-alias-text-secondary, #6b7280)", marginTop: "3px" }, children: t("fetchTimeoutHint") }),
                    ],
                  }),
                  jsxs("div", {
                    children: [
                      jsx("label", { style: { display: "block", fontWeight: 600, marginBottom: "4px" }, children: t("engineTimeoutLabel") }),
                      jsx("input", {
                        type: "number",
                        min: 1000,
                        max: 120000,
                        step: 1000,
                        value: form.perEngineTimeoutMs,
                        onChange: (e) => setForm({ ...form, perEngineTimeoutMs: e.target.value }),
                        style: inputStyle,
                      }),
                    ],
                  }),
                  jsxs("div", {
                    children: [
                      jsx("label", { style: { display: "block", fontWeight: 600, marginBottom: "4px" }, children: t("searchBudgetLabel") }),
                      jsx("input", {
                        type: "number",
                        min: 1000,
                        max: 120000,
                        step: 1000,
                        value: form.searchBudgetMs,
                        onChange: (e) => setForm({ ...form, searchBudgetMs: e.target.value }),
                        style: inputStyle,
                      }),
                    ],
                  }),
                ],
              }),

              jsxs("div", {
                style: { display: "grid", gap: "8px", marginBottom: "16px" },
                children: [
                  jsxs("label", {
                    style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
                    children: [
                      jsx("input", { type: "checkbox", checked: form.spaExtraction, onChange: (e) => setForm({ ...form, spaExtraction: e.target.checked }) }),
                      jsx("span", { children: t("spaExtractionLabel") }),
                    ],
                  }),
                  jsxs("label", {
                    style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
                    children: [
                      jsx("input", { type: "checkbox", checked: form.boilerplatePruning, onChange: (e) => setForm({ ...form, boilerplatePruning: e.target.checked }) }),
                      jsx("span", { children: t("boilerplatePruningLabel") }),
                    ],
                  }),
                  jsxs("label", {
                    style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
                    children: [
                      jsx("input", { type: "checkbox", checked: form.searchHygiene, onChange: (e) => setForm({ ...form, searchHygiene: e.target.checked }) }),
                      jsx("span", { children: t("searchHygieneLabel") }),
                    ],
                  }),
                ],
              }),

              jsxs("div", {
                style: { display: "flex", gap: "8px" },
                children: [
                  jsx("button", { type: "submit", disabled: saving || loading, style: btnStyle(true, saving || loading), children: saving ? t("saving") : t("save") }),
                  jsx("button", { type: "button", disabled: loading, onClick: load, style: btnStyle(false, loading), children: t("refresh") }),
                ],
              }),
            ],
          }),
        ],
      });
    }

    const name = "dsh-smart-websearch";
    const inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-smart-websearch: dictionaries");
      const t = ctx.locale.bind(NS);
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "smart-websearch",
        order: 62,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ t }),
      }, SmartWebsearchSection));
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
