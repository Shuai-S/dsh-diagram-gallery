// dsh-diagram-gallery — client bundle.
//
// One surface: a `conversation.view` entry — the tab strip above the
// composer — showing the project diagram gallery.
//
// Hard rules learned in the field:
//   * NEVER call host-injected functions during render (props.useSession is a
//     hook; conditional calls change the hook count and unmount the whole
//     tree). Data probes run inside effects only; session scoping uses plain
//     property reads; anything else falls back to "show everything".
//   * An error boundary wraps the view and reports the failure to the host
//     half's diagnostics endpoint, so a blank tab can always be diagnosed.
//
// Bundle format: window.__ModuleLoader__.load({ id, factory }) — lazy-CJS,
// requires only `react`. No JSX, no build.

window.__ModuleLoader__.load({
  id: "dsh-diagram-gallery",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var reactModule = require("react");
    var react = reactModule && reactModule.default ? reactModule.default : reactModule;
    var createElement = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;
    var useRef = react.useRef;

    var VIEW_SLOT = "conversation.view";
    var VIEW_ID = "dsh-diagram-gallery:gallery";
    var VIEW_ORDER = 20;
    var VIEW_LABEL = "图示";
    var API_ORIGIN = "http://127.0.0.1:3988";

    var MERMAID_FIRST_LINE = /^(flowchart|sequenceDiagram|stateDiagram|graph\\s+(TD|TB|LR|RL)|classDiagram|erDiagram|gantt|mindmap|pie|journey|timeline|gitGraph|quadrantChart)\\b/;
    var CARD_SELECTOR = ".md-code-block";
    var CONTENT_SELECTOR = "[data-code-block-content]";

    var pluginCtx = null;

    var TEMPLATES = {
      architecture: { label: "架构图", text: "用 archify 生成一张架构图:展示系统的核心组件、主要路径与外部依赖,标出信任边界。范围:<在此填写系统或仓库,留空则分析当前工作区>;只保留 8–12 个核心组件,辅助信息放进说明卡片。" },
      workflow:     { label: "工作流", text: "用 archify 生成一张工作流图:参与者、执行顺序、分支与异常路径。<在此描述流程>" },
      sequence:     { label: "时序图", text: "用 archify 生成一张时序图:调用方、被调用方、返回与关键时序。<在此描述交互>" },
      dataflow:     { label: "数据流", text: "用 archify 生成一张数据流图:来源、转换、存储与边界。<在此描述数据管线>" },
      erd:          { label: "ER 图", text: "用 archify 生成一张 ER 图:每张表的字段及类型、主键/外键/唯一键,以及关系基数。<指明 schema 或模型文件>" },
      explainer:    { label: "一页讲清", text: "用 archify 把这个问题做成一页讲清:<在此填写问题>,结论先行,分栏配图。" }
    };

    // dsh design tokens; fallbacks only matter outside a dsh page.
    var BORDER = "var(--dsw-alias-border-l2, rgba(0,0,0,0.12))";
    var BORDER_L1 = "var(--dsw-alias-border-l1, rgba(0,0,0,0.06))";
    var LABEL_PRIMARY = "var(--dsw-alias-label-primary, #1b2434)";
    var LABEL_SECONDARY = "var(--dsw-alias-label-secondary, #6b6b70)";
    var LAYER = "var(--dsw-alias-bg-layer-1, transparent)";
    var ACCENT = "var(--dsw-alias-state-info-primary, #2f6fed)";

    function scanConversationMermaid() {
      var out = [];
      var cards = document.querySelectorAll(CARD_SELECTOR);
      for (var i = 0; i < cards.length; i++) {
        var el = cards[i];
        var content = el.querySelector(CONTENT_SELECTOR) || el;
        var text = (content.textContent || "").trim();
        if (!text || text.length > 40000) continue;
        if (!MERMAID_FIRST_LINE.test(text)) continue;
        var first = text.split("\n")[0].slice(0, 80);
        out.push({ id: "mmd:" + i, kind: "conv-mermaid", label: "会话 Mermaid · " + first, source: text, index: i, wsId: null, wsTitle: null, sublabel: "当前会话", file: null });
      }
      return out;
    }

    function reportDiagnostics(payload) {
      try {
        fetch(API_ORIGIN + "/api/debug-view-props", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(function () {});
      } catch (e) { /* diagnostics never break the view */ }
    }

    // Plain property reads only — no host function calls, no hooks.
    function probeSessionId(props) {
      if (!props || typeof props !== "object") return undefined;
      if (typeof props.sessionId === "string") return props.sessionId;
      var holders = ["binding", "scope", "scopeBinding", "sessionBinding"];
      for (var i = 0; i < holders.length; i++) {
        var h = props[holders[i]];
        if (h && typeof h === "object") {
          if (typeof h.key === "string" && h.key.indexOf("session-") === 0) return h.key;
          if (typeof h.sessionId === "string") return h.sessionId;
          if (typeof h.id === "string" && h.id.indexOf("session-") === 0) return h.id;
        }
      }
      if (props.session && typeof props.session === "object") {
        if (typeof props.session.id === "string") return props.session.id;
        if (typeof props.session.sessionId === "string") return props.session.sessionId;
      }
      return undefined;
    }

    // ── composer write (defensive; clipboard fallback) ────────────────────

    function trySetDraft(text, sessionId) {
      try {
        if (!sessionId) return false;
        var sessions = pluginCtx && typeof pluginCtx.get === "function" ? pluginCtx.get("sessions") : undefined;
        var conversation = pluginCtx && typeof pluginCtx.get === "function" ? pluginCtx.get("conversation") : undefined;
        if (!sessions || typeof sessions.scope !== "function") return false;
        var input = conversation && conversation.input && typeof conversation.input.for === "function" ? conversation.input.for(sessions.scope(sessionId)) : undefined;
        if (input && typeof input.setDraft === "function") {
          input.setDraft(text);
          return true;
        }
        return false;
      } catch (e) { return false; }
    }

    // ── composer width-handle suppression (mount-time only) ───────────────

    var suppressTimer = null;
    var suppressObserver = null;
    var suppressed = [];

    function runSuppression(rootEl) {
      try {
        if (!rootEl) return;
        var region = rootEl.getBoundingClientRect();
        var nodes = document.querySelectorAll('[class*="detailsResizeHandle"],[class*="esizeHandle"],[class*="idthHandle"],[class*="widthHandle"],[role="separator"],[class*="resiz"],[class*="handle"],[class*="Handle"],[class*="gutter"],[class*="divider"],[class*="splitter"]');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          if (el === rootEl || suppressed.indexOf(el) !== -1) continue;
          var st = null;
          try { st = getComputedStyle(el); } catch (e) { continue; }
          if (!st || st.cursor !== "col-resize") continue;
          var r = el.getBoundingClientRect();
          if (r.width > 18 || r.height < 60) continue;
          if (r.right < region.left || r.left > region.right || r.bottom < region.top || r.top > region.bottom) continue;
          el.__dsgPrevDisplay = el.style.display;
          el.style.display = "none";
          suppressed.push(el);
        }
      } catch (e) { /* never break the view over cosmetics */ }
    }

    function restoreSuppressed() {
      for (var i = 0; i < suppressed.length; i++) {
        var el = suppressed[i];
        try { el.style.display = el.__dsgPrevDisplay || ""; } catch (e) { /* ignore */ }
      }
      suppressed.length = 0;
    }

    function startHandleSuppression(rootEl) {
      stopHandleSuppression();
      runSuppression(rootEl);
      suppressTimer = setInterval(function () { runSuppression(rootEl); }, 800);
      if (typeof MutationObserver !== "undefined") {
        suppressObserver = new MutationObserver(function () { runSuppression(rootEl); });
        suppressObserver.observe(document.body, { childList: true, subtree: true });
      }
    }

    function stopHandleSuppression() {
      if (suppressTimer) { clearInterval(suppressTimer); suppressTimer = null; }
      if (suppressObserver) { suppressObserver.disconnect(); suppressObserver = null; }
      restoreSuppressed();
    }

    // ── components ───────────────────────────────────────────────────────

    function ListRow(props) {
      var d = props.item;
      var kindIcon = d.kind === "html" ? "▣" : d.kind === "conv-mermaid" || d.kind === "mermaid" ? "⌗" : "≡";
      return createElement("div", {
        onClick: function () { props.onSelect(d); },
        style: {
          padding: "7px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
          background: props.selected ? "var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04))" : "transparent",
          border: "1px solid " + (props.selected ? BORDER : "transparent")
        }
      },
        createElement("div", { style: { fontSize: 12.5, color: LABEL_PRIMARY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          createElement("span", { style: { color: ACCENT, marginRight: 6, fontFamily: "monospace" } }, kindIcon),
          d.label),
        createElement("div", { style: { fontSize: 11, color: LABEL_SECONDARY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 } },
          d.sublabel || d.wsTitle || ""));
    }

    function GalleryView(props) {
      var st = useState(null);
      var data = st[0], setData = st[1];
      var errSt = useState(null);
      var err = errSt[0], setErr = errSt[1];
      var selSt = useState(null);
      var selected = selSt[0], setSelected = selSt[1];
      var convSt = useState([]);
      var convMermaid = convSt[0], setConvMermaid = convSt[1];
      var loadingSt = useState(false);
      var loading = loadingSt[0], setLoading = loadingSt[1];
      var noticeSt = useState("");
      var notice = noticeSt[0], setNotice = noticeSt[1];
      var wsSelSt = useState(function () {
        try { return window.localStorage.getItem("dsg.workspace") || "auto"; } catch (e) { return "auto"; }
      });
      var wsSel = wsSelSt[0], setWsSel = wsSelSt[1];
      var rootRef = useRef(null);
      var sessionIdRef = useRef(undefined);

      // Session scoping: plain property probes only. Render never calls
      // host-injected functions — a useSession() attempt threw
      // "reading 'length'" inside host code and blanked the view.
      useEffect(function () {
        var sid = probeSessionId(props);
        sessionIdRef.current = sid;
        reportDiagnostics({
          type: "mount",
          keys: Object.keys(props || {}),
          shapes: Object.keys(props || {}).reduce(function (acc, k) {
            var v = props[k];
            acc[k] = typeof v === "function" ? "function" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
            return acc;
          }, {}),
          sessionId: sid || null,
          location: (typeof window !== "undefined" && window.location) ? window.location.href.slice(0, 300) : null
        });
      }, []);

      var refresh = useCallback(function () {
        setLoading(true);
        fetch(API_ORIGIN + "/api/diagrams")
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (j) { setData(j); setErr(null); })
          .catch(function (e) { setErr(e.message || String(e)); })
          .finally(function () { setLoading(false); });
        setConvMermaid(scanConversationMermaid());
      }, []);

      useEffect(function () {
        refresh();
        var el = rootRef.current;
        if (el) startHandleSuppression(el);
        return function () { stopHandleSuppression(); };
      }, [refresh]);

      var serverWs = data && data.workspaces ? data.workspaces : [];
      var sid = sessionIdRef.current;
      var probedWsId = null;
      for (var wi = 0; wi < serverWs.length; wi++) {
        if (serverWs[wi].sessionIds && serverWs[wi].sessionIds.indexOf(sid) !== -1) { probedWsId = serverWs[wi].id; break; }
      }
      // precedence: manual pick (persisted) > auto probe > everything
      var curWsId = null;
      var scopeMode = "all";
      if (wsSel === "auto") {
        if (probedWsId) { curWsId = probedWsId; scopeMode = "session"; }
      } else if (wsSel !== "all") {
        curWsId = wsSel; scopeMode = "manual";
      }

      var allRaw = (data && data.diagrams ? data.diagrams : []).map(function (d) {
        return { id: d.id, kind: d.kind, label: d.label, sublabel: (d.sublabel || "") + " · " + (d.wsTitle || ""), wsTitle: d.wsTitle, wsId: d.wsId || null, file: d.file, mtime: d.mtime };
      }).concat(convMermaid);
      // Conversation mermaid always belongs to the current session.
      var scoped = curWsId ? allRaw.filter(function (d) { return d.wsId === curWsId || d.kind === "conv-mermaid"; }) : allRaw;
      var all = scoped;

      var groups = [];
      var byWs = {};
      all.forEach(function (d) {
        var key = d.kind === "conv-mermaid" ? "本会话" : (d.wsTitle || "未知工作区");
        if (!byWs[key]) { byWs[key] = []; groups.push(key); }
        byWs[key].push(d);
      });

      var body;
      if (err) {
        body = createElement("div", { style: { padding: 24, color: LABEL_SECONDARY, fontSize: 13, lineHeight: 1.7 } },
          createElement("div", { style: { color: "var(--dsw-alias-label-warning, #c2500f)", marginBottom: 8 } }, "图示服务未连接(" + err + ")"),
          createElement("div", {}, "宿主服务应在 127.0.0.1:3988 提供 /api/diagrams。请确认插件已安装且 Harness 已重启。"),
          createElement("button", {
            onClick: refresh,
            style: { marginTop: 12, padding: "6px 14px", borderRadius: 8, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
          }, "重试"));
      } else if (selected) {
        var frame;
        if (selected.kind === "html") {
          frame = createElement("iframe", {
            src: API_ORIGIN + "/preview?path=" + encodeURIComponent(selected.file || ""),
            title: selected.label,
            style: { flex: "1 1 auto", width: "100%", border: "0", background: "var(--dsw-alias-bg-layer-1, #fff)", minHeight: 0 },
            sandbox: "allow-scripts allow-popups"
          });
        } else {
          frame = createElement("pre", {
            style: { flex: "1 1 auto", overflow: "auto", margin: 0, padding: 16, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: LABEL_PRIMARY, whiteSpace: "pre-wrap", minHeight: 0 }
          }, selected.source || ("(本地文件)" + (selected.file ? "\n" + selected.file : "")));
        }
        body = createElement("div", { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } },
          createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid " + BORDER_L1 } },
            createElement("div", { style: { fontSize: 13, fontWeight: 600, color: LABEL_PRIMARY, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, selected.label),
            selected.kind === "html" ? createElement("button", {
              onClick: function () { window.open(API_ORIGIN + "/preview?path=" + encodeURIComponent(selected.file || ""), "_blank"); },
              style: { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
            }, "浏览器打开") : null,
            selected.source ? createElement("button", {
              onClick: function () { navigator.clipboard && navigator.clipboard.writeText(selected.source); },
              style: { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
            }, "复制源码") : null,
            createElement("button", {
              onClick: function () { setSelected(null); },
              style: { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
            }, "返回列表")),
          frame);
      } else if (!all.length) {
        body = createElement("div", { style: { padding: 24, color: LABEL_SECONDARY, fontSize: 13, lineHeight: 1.7 } },
          "当前工作区还没有图示。用 archify 生成一张(对话里说「用 archify 画出…」),或把 .mmd/.mermaid 文件放进 docs/diagrams/。");
      } else {
        body = createElement("div", { style: { flex: "1 1 auto", overflow: "auto", padding: "10px 12px", minHeight: 0 } },
          groups.map(function (g) {
            return createElement("div", { key: g, style: { marginBottom: 14 } },
              createElement("div", { style: { fontSize: 11, color: LABEL_SECONDARY, textTransform: "uppercase", letterSpacing: "0.04em", margin: "6px 0" } }, g),
              byWs[g].map(function (d) {
                return createElement(ListRow, { key: d.id, item: d, selected: false, onSelect: setSelected });
              }));
          }));
      }

      var buttons = Object.keys(TEMPLATES).map(function (k) {
        return createElement("button", {
          key: k,
          onClick: function () {
            var t = TEMPLATES[k].text;
            var sidNow = sessionIdRef.current || probeSessionId(viewProps);
            if (trySetDraft(t, sidNow)) { setNotice(TEMPLATES[k].label + " · 已填入输入框,回车发送"); }
            else if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(t);
              setNotice(TEMPLATES[k].label + " · 已复制,粘贴到输入框发送");
            } else { setNotice(TEMPLATES[k].label + " · 复制失败"); }
            setTimeout(function () { setNotice(""); }, 2600);
          },
          style: { padding: "3px 10px", fontSize: 11.5, borderRadius: 999, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
        }, TEMPLATES[k].label);
      });

      return createElement("div", { ref: rootRef, style: { display: "flex", flexDirection: "column", height: "100%", background: LAYER, color: LABEL_PRIMARY, minHeight: 0 } },
        selected ? null : createElement("div", { style: { display: "flex", flexDirection: "column", borderBottom: "1px solid " + BORDER_L1 } },
          createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 4px" } },
            createElement("div", { style: { fontSize: 13, fontWeight: 600 } }, "项目图示"),
            createElement("select", {
              value: wsSel,
              onChange: function (ev) {
                try { window.localStorage.setItem("dsg.workspace", ev.target.value); } catch (e) { /* ignore */ }
                setWsSel(ev.target.value);
              },
              style: { fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY }
            },
              createElement("option", { value: "auto" }, "当前会话工作区" + (probedWsId ? "" : "(未识别)")),
              createElement("option", { value: "all" }, "全部工作区"),
              serverWs.map(function (w) {
                return createElement("option", { key: w.id, value: w.id }, w.title + (w.lastActivity ? " · 最近活跃" : ""));
              })),
            createElement("span", { style: { fontSize: 11, color: LABEL_SECONDARY } }, all.length ? all.length + " 项" + (loading ? " · 刷新中" : "") : (loading ? "加载中…" : "")),
            createElement("button", {
              onClick: refresh,
              style: { padding: "4px 12px", fontSize: 12, borderRadius: 6, border: "1px solid " + BORDER, background: "transparent", color: LABEL_PRIMARY, cursor: "pointer" }
            }, "刷新")),
          createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 12px 10px", flexWrap: "wrap" } },
            createElement("span", { style: { fontSize: 11, color: LABEL_SECONDARY } }, "生成:"),
            buttons,
            notice ? createElement("span", { style: { fontSize: 11.5, color: ACCENT } }, notice) : null)),
        body);
    }

    // ── registration ─────────────────────────────────────────────────────

    function apply(rawContext) {
      var ctx = rawContext;
      pluginCtx = rawContext;
      ctx.inject(["slots"], function (scope) {
        scope.effect(function () {
          var disposeView = scope.slots.inject(VIEW_SLOT, function () {
            return scope.slots.register(
              { name: VIEW_SLOT, id: VIEW_ID, order: VIEW_ORDER, label: function () { return VIEW_LABEL; } },
              GalleryErrorBoundary
            );
          });
          return function () {
            try { if (typeof disposeView === "function") disposeView(); } catch (e) { /* ignore */ }
          };
        }, "dsh-diagram-gallery: register conversation view");
      });
    }

    exports.apply = apply;
    exports.inject = [];

    // Error boundary as an ES5 prototype class (works inside the CJS factory).
    function GalleryErrorBoundary(props) {
      this.state = { error: null };
      this.props = props;
    }
    GalleryErrorBoundary.prototype = Object.create(react.Component.prototype);
    GalleryErrorBoundary.prototype.constructor = GalleryErrorBoundary;
    GalleryErrorBoundary.getDerivedStateFromError = function (error) {
      return { error: error && error.message ? error.message : String(error) };
    };
    GalleryErrorBoundary.prototype.componentDidCatch = function (error, info) {
      reportDiagnostics({
        type: "render-error",
        error: error && error.stack ? String(error.stack).slice(0, 2000) : String(error),
        componentStack: info && info.componentStack ? String(info.componentStack).slice(0, 1500) : null
      });
    };
    GalleryErrorBoundary.prototype.render = function () {
      if (this.state && this.state.error) {
        return createElement("div", { style: { padding: 24, fontSize: 13, lineHeight: 1.8, color: LABEL_SECONDARY } },
          createElement("div", { style: { color: "var(--dsw-alias-label-warning, #c2500f)", marginBottom: 8, fontWeight: 600 } }, "图示视图渲染出错(已上报诊断)"),
          createElement("pre", { style: { fontSize: 11, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace", color: LABEL_SECONDARY } }, this.state.error));
      }
      return createElement(GalleryView, this.props);
    };

    return module.exports;
  }
});
