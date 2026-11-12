window.__ModuleLoader__.load({
  id: "dsh-edu",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var inject = ["slots"];
    var STYLE_ID = "dsh-edu-style";
    var API_PATH = "/api/dsh-edu";
    var CLIENT_REQUEST_TIMEOUT_MS = 65000;
    var MODEL_SOURCES = [
      { id: "codex", label: "Codex" },
      { id: "grok", label: "Grok" },
      { id: "opencodeGo", label: "OpenCode Go" },
      { id: "deepseek", label: "DeepSeek" },
      { id: "zai", label: "智谱" },
    ];

    var cssText =
      ".deu-readout { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; line-height: 1.5; " +
      "font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); " +
      "color: var(--dsw-alias-label-secondary); white-space: nowrap; user-select: none; } " +
      ".deu-readout__item { display: inline-flex; align-items: center; gap: 4px; } " +
      ".deu-readout__model { color: var(--dsw-alias-label-primary); font-weight: 600; } " +
      ".deu-readout__pct { font-weight: 600; font-variant-numeric: tabular-nums; } " +
      ".deu-pct-ok { color: var(--dsw-alias-state-success-primary); } " +
      ".deu-pct-warn { color: var(--dsw-alias-state-warn-secondary, var(--dsw-alias-state-warn-label)); } " +
      ".deu-pct-crit { color: var(--dsw-alias-state-error-primary); } " +
      ".deu-readout--error { color: var(--dsw-alias-state-error-primary); } " +
      ".deu-readout__ago { color: var(--dsw-alias-label-secondary); } " +
      ".deu-settings { margin: 18px 0; color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.5; } " +
      ".deu-settings h3 { margin: 0 0 8px; font-size: 16px; font-weight: 650; letter-spacing: -.02em; } " +
      ".deu-settings h4 { margin: 0; font-size: 14px; font-weight: 650; } " +
      ".deu-settings p { margin: 8px 0 13px; } " +
      ".deu-settings-note { color: var(--dsw-alias-label-secondary); font-size: 13px; } " +
      ".deu-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 14px 0 18px; } " +
      ".deu-settings-models { display: grid; gap: 10px; margin: 14px 0 18px; } " +
      ".deu-settings-model { padding: 14px; border: 1px solid var(--dsw-alias-border-l3, #d9dce1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #f8f9fb); } " +
      ".deu-settings-model-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; } " +
      ".deu-settings-platform-meta { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 12px; } " +
      ".deu-settings-platform-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 10px; } " +
      ".deu-settings-model-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; } " +
      ".deu-settings-custom-grid { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l3, #d9dce1); } " +
      ".deu-settings-empty { padding: 18px; border: 1px dashed var(--dsw-alias-border-l3, #d9dce1); border-radius: 14px; color: var(--dsw-alias-label-secondary); } " +
      ".deu-settings-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; } " +
      ".deu-settings-field-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 550; } " +
      ".deu-settings input[type='text'], .deu-settings input[type='number'], .deu-settings input[type='url'], .deu-settings select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--dsw-alias-border-l3, #d9dce1); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); color: inherit; font: inherit; padding: 8px 10px; } " +
      ".deu-settings input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary, #007aff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #007aff) 20%, transparent); } " +
      ".deu-settings-check { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 13px; } " +
      ".deu-settings-add { margin: 18px 0; padding: 14px; border: 1px dashed var(--dsw-alias-border-l3, #d9dce1); border-radius: 14px; } " +
      ".deu-settings-add h4 { margin-bottom: 10px; } " +
      ".deu-settings-add-row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto; align-items: center; gap: 9px; } " +
      ".deu-settings-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; } " +
      ".deu-settings button { border: 1px solid var(--dsw-alias-border-l3, #d9dce1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #f8f9fb); color: inherit; font: inherit; font-weight: 550; padding: 8px 13px; cursor: pointer; } " +
      ".deu-settings button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #eceff4); } " +
      ".deu-settings button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #007aff); outline-offset: 2px; } " +
      ".deu-settings button:disabled { opacity: .48; cursor: default; } " +
      ".deu-settings button.deu-settings-delete { color: var(--dsw-alias-state-error-primary, #c53b47); } " +
      ".deu-settings-error { color: var(--dsw-alias-state-error-primary, #c53b47); font-size: 13px; } " +
      "@media (max-width: 640px) { .deu-settings-grid, .deu-settings-model-grid, .deu-settings-add-row { grid-template-columns: 1fr; } .deu-settings-model-head { align-items: flex-start; } .deu-settings-platform-actions { justify-content: flex-start; } }";

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = cssText;
      document.head.appendChild(style);
    }

    function countdownStr(resetsAt) {
      if (!resetsAt) return null;
      var t = Date.parse(resetsAt);
      if (t !== t) return null;
      var diffMs = t - Date.now();
      if (diffMs <= 0) return null;
      var hours = Math.floor(diffMs / 3600000);
      var minutes = Math.floor((diffMs % 3600000) / 60000);
      if (hours > 24) return Math.floor(hours / 24) + "d" + (hours % 24) + "h";
      if (hours > 0) return hours + "h" + minutes + "m";
      return minutes + "m";
    }

    function agoStr(queriedAt) {
      if (!queriedAt) return null;
      var diff = Math.floor((Date.now() - queriedAt) / 1000);
      if (diff < 60) return "刚刚";
      if (diff < 3600) return Math.floor(diff / 60) + "分钟前";
      if (diff < 86400) return Math.floor(diff / 3600) + "小时前";
      return Math.floor(diff / 86400) + "天前";
    }

    function numeric(value) {
      if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return NaN;
      var n = Number(value);
      return Number.isFinite(n) ? n : NaN;
    }

    function pctClass(u, display) {
      var v = numeric(u);
      if (v !== v) return "deu-pct-ok";
      var warning = display && Number.isFinite(display.warningPercent) ? display.warningPercent : 70;
      var critical = display && Number.isFinite(display.criticalPercent) ? display.criticalPercent : 90;
      if (v >= critical) return "deu-pct-crit";
      if (v >= warning) return "deu-pct-warn";
      return "deu-pct-ok";
    }

    function fmtPct(u) {
      var v = numeric(u);
      return v === v ? Math.round(v) + "%" : "—";
    }

    function fmtTime(iso) {
      try {
        var d = new Date(iso);
        return d.getTime() !== d.getTime() ? iso : d.toLocaleString();
      } catch {
        return iso;
      }
    }

    function currencySymbol(code) {
      if (code === "CNY") return "¥";
      if (code === "USD") return "$";
      return (code || "") + " ";
    }

    function fmtMoney(n) {
      var v = numeric(n);
      return v === v ? v.toFixed(2) : "—";
    }

    function fmtTokens(n) {
      var v = numeric(n);
      if (v !== v) return "—";
      if (v >= 1e8) return (v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1) + "亿";
      if (v >= 1e4) return (v / 1e4).toFixed(v % 1e4 === 0 ? 0 : 1) + "万";
      return String(Math.round(v));
    }

    function BalanceReadout(res) {
      var bal = res.balance;
      var display = res.display || {};
      if (!bal) {
        return React.createElement(
          "span",
          { className: "deu-readout deu-readout--error", title: res.error || "余额不可用" },
          res.error || "余额不可用",
        );
      }
      var tip = [];
      if (bal.toppedUp !== null && bal.toppedUp !== undefined) tip.push("充值 " + currencySymbol(bal.currency) + fmtMoney(bal.toppedUp));
      if (bal.granted !== null && bal.granted !== undefined) tip.push("赠金 " + currencySymbol(bal.currency) + fmtMoney(bal.granted));
      if (bal.frozen !== null && bal.frozen !== undefined && bal.frozen > 0) tip.push("冻结 " + currencySymbol(bal.currency) + fmtMoney(bal.frozen));
      if (bal.spent !== null && bal.spent !== undefined) tip.push("累计消费 " + currencySymbol(bal.currency) + fmtMoney(bal.spent));
      if (Array.isArray(bal.packages)) {
        for (var p = 0; p < bal.packages.length; p++) {
          var pkg = bal.packages[p];
          tip.push(pkg.name + " 剩余 " + fmtTokens(pkg.remaining));
        }
      }
      if (bal.available === false) tip.push("当前余额不足以继续调用");
      var total = numeric(bal.total);
      var cls = bal.available === false || total <= 0 ? "deu-pct-crit" : total < 5 ? "deu-pct-warn" : "deu-pct-ok";
      var packageFailure = bal.packages === null;
      if (packageFailure) tip.push(res.warning || "资源包查询失败");
      var items = [
        display.label ? React.createElement("span", { key: "model", className: "deu-readout__item deu-readout__model" }, display.label) : null,
        React.createElement(
          "span",
          { key: "bal", className: "deu-readout__item" },
          "余额 ",
          React.createElement("span", { className: "deu-readout__pct " + cls }, currencySymbol(bal.currency) + fmtMoney(bal.total)),
        ),
      ];
      if (packageFailure) items.push(React.createElement(
        "span", { key: "packages-error", className: "deu-readout__item deu-pct-warn", title: res.warning || "资源包查询失败" }, "资源包查询失败",
      ));
      var ago = display.showQueriedAt === false ? null : agoStr(res.queriedAt);
      if (ago) items.push(React.createElement("span", { key: "ago", className: "deu-readout__item deu-readout__ago" }, ago));
      return React.createElement("span", { className: "deu-readout", title: tip.join("\n") }, items);
    }

    function QuotaReadout(res) {
      if (res.balance) return BalanceReadout(res);
      var wins = res.windows;
      var display = res.display || {};
      if (!wins || !wins.length) {
        return React.createElement(
          "span",
          { className: "deu-readout deu-readout--error", title: res.error || "用量不可用" },
          res.error || "用量不可用",
        );
      }
      var tip = [];
      if (res.planType) tip.push("套餐 " + res.planType);
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        tip.push(w.label + "：已用 " + fmtPct(w.utilization) + (w.resetsAt ? "，重置 " + fmtTime(w.resetsAt) : ""));
      }
      var items = display.label ? [React.createElement("span", { key: "model", className: "deu-readout__item deu-readout__model" }, display.label)] : [];
      items = items.concat(wins.map(function (win) {
        var cd = display.showResetCountdown === false ? null : countdownStr(win.resetsAt);
        return React.createElement(
          "span",
          { key: win.key, className: "deu-readout__item" },
          win.label + " ",
          React.createElement("span", { className: "deu-readout__pct " + pctClass(win.utilization, display) }, fmtPct(win.utilization)),
          cd ? " " + cd : "",
        );
      }));
      var ago = display.showQueriedAt === false ? null : agoStr(res.queriedAt);
      if (ago) items.push(React.createElement("span", { key: "ago", className: "deu-readout__item deu-readout__ago" }, ago));
      return React.createElement("span", { className: "deu-readout", title: tip.join("\n") }, items);
    }

    function modelKey(projection) {
      var next = projection && projection.next;
      return next ? JSON.stringify([next.provider, next.model]) : "";
    }

    function seedView(sid, model) {
      return { res: null, forSession: sid, forModel: model };
    }

    function hasSuccessfulReading(res) {
      if (!res || res.ok !== true || res.isSupported === false) return false;
      if (res.balance && typeof res.balance === "object") return true;
      return Array.isArray(res.windows) && res.windows.length > 0;
    }

    function authEnded(res) {
      var error = res && typeof res.error === "string" ? res.error : "";
      return error.indexOf("未登录") !== -1 || error.indexOf("已过期") !== -1;
    }

    function epochChanged(previous, next) {
      if (!next || !Number.isFinite(next.credentialEpoch)) return false;
      return !!(previous && Number.isFinite(previous.credentialEpoch) && next.credentialEpoch !== previous.credentialEpoch);
    }

    function nextDelay(res) {
      var configured = numeric(res && res.refreshAfterMs);
      var delay = configured === configured && configured >= 1000
        ? configured
        : res && res.ok && res.isSupported === false ? 30000 : 2000;
      if (hasSuccessfulReading(res)) return delay;
      if (res && res.ok && Number.isFinite(res.retryAfterMs) && res.retryAfterMs > delay) {
        return Math.min(res.retryAfterMs, 180000);
      }
      return delay;
    }

    function StatusReadout(props) {
      var sessionId = props.sessionId ? String(props.sessionId) : "";
      // Session-scoped slots supply this public, key-addressed observable hook.
      var model = props.useProjection("modelSelection", modelKey);
      var viewState = React.useState(function () {
        return seedView(sessionId, model);
      });
      var view = viewState[0];
      var setView = viewState[1];

      React.useEffect(
        function () {
          var alive = true;
          var timer = null;
          var active = null;
          setView(seedView(sessionId, model));

          function visible() {
            return document.visibilityState !== "hidden";
          }
          function stop() {
            clearTimeout(timer);
            timer = null;
            if (active) {
              var old = active;
              active = null;
              clearTimeout(old.timeout);
              old.controller.abort();
            }
          }
          function finish(request, res) {
            if (!alive || active !== request) return;
            clearTimeout(request.timeout);
            active = null;
            setView(function (prev) {
              var previous = prev && prev.res;
              var replacement = res;
              if (previous && hasSuccessfulReading(previous) && (authEnded(res) || epochChanged(previous, res))) {
                replacement = Object.assign({}, res);
              }
              return { res: replacement, forSession: sessionId, forModel: model };
            });
            if (!visible()) return;
            timer = setTimeout(load, nextDelay(res));
          }
          function failed(request, message) {
            finish(request, { ok: false, error: message || "额度查询失败，正在重试" });
          }
          function load() {
            timer = null;
            if (!alive || !visible() || active) return;
            var request = { controller: new AbortController(), timeout: null };
            active = request;
            request.timeout = setTimeout(function () {
              failed(request, "额度查询超时，正在重试");
              request.controller.abort();
            }, CLIENT_REQUEST_TIMEOUT_MS);
            var qs = sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : "";
            try {
              fetch(API_PATH + qs, { signal: request.controller.signal })
                .then(function (r) {
                  if (!r.ok) throw new Error("HTTP " + r.status);
                  return r.json();
                })
                .then(function (res) {
                  if (res && res.ok === true) finish(request, res);
                  else failed(request, res && typeof res.error === "string" && res.error ? res.error : null);
                })
                .catch(function () { failed(request); });
            } catch {
              failed(request);
            }
          }
          function visibilityChanged() {
            stop();
            if (visible()) load();
          }
          document.addEventListener("visibilitychange", visibilityChanged);
          load();
          return function () {
            alive = false;
            stop();
            document.removeEventListener("visibilitychange", visibilityChanged);
          };
        },
        [sessionId, model],
      );

      if (view.forSession !== sessionId || view.forModel !== model || !view.res) return null;
      if (view.res.ok && view.res.isSupported === false) return null;
      return QuotaReadout(view.res);
    }

    function cloneSettings(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function apiRequest(path, options) {
      var init = Object.assign({ cache: "no-store" }, options || {});
      if (init.signal && typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        init.signal = AbortSignal.any([init.signal, AbortSignal.timeout(20000)]);
      }
      return fetch(API_PATH + path, init).then(function (response) {
        return response.json().catch(function () {
          throw new Error("设置响应不是有效 JSON（HTTP " + response.status + "）");
        }).then(function (body) {
          if (!response.ok || !body || body.ok !== true) {
            var error = new Error(body && body.error ? body.error : "设置请求失败（HTTP " + response.status + "）");
            error.status = response.status;
            throw error;
          }
          return body;
        });
      });
    }

    function settingsRequest(options) { return apiRequest("/settings", options); }

    function SettingsPage(props) {
      var draftState = React.useState(null), draft = draftState[0], setDraft = draftState[1];
      var savedState = React.useState(null), saved = savedState[0], setSaved = savedState[1];
      var revisionState = React.useState(null), revision = revisionState[0], setRevision = revisionState[1];
      var pendingState = React.useState(false), pending = pendingState[0], setPending = pendingState[1];
      var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
      var noticeState = React.useState(""), notice = noticeState[0], setNotice = noticeState[1];
      var conflictState = React.useState(false), conflict = conflictState[0], setConflict = conflictState[1];
      var providersState = React.useState(null), providers = providersState[0], setProviders = providersState[1];
      var providersErrorState = React.useState(""), providersError = providersErrorState[0], setProvidersError = providersErrorState[1];
      var addAdapterState = React.useState(""), addAdapter = addAdapterState[0], setAddAdapter = addAdapterState[1];
      var addProviderState = React.useState(""), addProvider = addProviderState[0], setAddProvider = addProviderState[1];
      var draftRef = React.useRef(null);
      var savedRef = React.useRef(null);
      var revisionRef = React.useRef(null);
      var pendingRef = React.useRef(false);
      var syncBusyRef = React.useRef(false);
      draftRef.current = draft;
      savedRef.current = saved;
      revisionRef.current = revision;
      pendingRef.current = pending;

      function accept(body) {
        setDraft(cloneSettings(body.settings));
        setSaved(cloneSettings(body.settings));
        setRevision(body.revision);
        setConflict(false);
      }

      function load() {
        setPending(true); setError(""); setNotice("");
        return settingsRequest()
          .then(accept)
          .catch(function (reason) { setError(reason.message); })
          .finally(function () { setPending(false); });
      }

      React.useEffect(function () {
        var controller = new AbortController();
        setPending(true);
        settingsRequest({ signal: controller.signal })
          .then(function (body) { if (!controller.signal.aborted) accept(body); })
          .catch(function (reason) { if (!controller.signal.aborted) setError(reason.message); })
          .finally(function () { if (!controller.signal.aborted) setPending(false); });
        return function () { controller.abort(); };
      }, []);

      React.useEffect(function () {
        var controller = new AbortController();
        var timer = setInterval(function () {
          if (pendingRef.current || syncBusyRef.current || !savedRef.current
            || JSON.stringify(draftRef.current) !== JSON.stringify(savedRef.current)) return;
          syncBusyRef.current = true;
          settingsRequest({ signal: controller.signal }).then(function (body) {
            if (controller.signal.aborted || body.revision === revisionRef.current) return;
            accept(body);
            setNotice("模型平台设置已从其他窗口同步。");
          }).catch(function () {}).finally(function () { syncBusyRef.current = false; });
        }, 3000);
        return function () { controller.abort(); clearInterval(timer); };
      }, []);

      function edit(key, value) {
        setDraft(function (current) { return Object.assign({}, current, { [key]: value }); });
        setError(""); setNotice("");
      }

      function editPlatform(id, key, value) {
        setDraft(function (current) {
          var platforms = current.platforms.map(function (item) {
            return item.id === id ? Object.assign({}, item, { [key]: value }) : item;
          });
          return Object.assign({}, current, { platforms: platforms });
        });
        setError(""); setNotice("");
      }

      function removePlatform(id) {
        setDraft(function (current) { return Object.assign({}, current, { platforms: current.platforms.filter(function (item) { return item.id !== id; }) }); });
        setError(""); setNotice("");
      }

      function loadProviders() {
        if (providers !== null) return;
        setProvidersError("");
        apiRequest("/platforms").then(function (body) {
          setProviders(Array.isArray(body.providers) ? body.providers : []);
        }).catch(function (reason) { setProvidersError(reason.message); setProviders([]); });
      }

      function addPlatform() {
        if (!draft || pending || !addAdapter) return;
        var source = MODEL_SOURCES.find(function (item) { return item.id === addAdapter; });
        var stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        var item = source ? {
          id: source.id, label: source.label, adapter: source.id, provider: "", enabled: true,
          warningPercent: 70, criticalPercent: 90, showResetCountdown: true, showQueriedAt: true,
          endpoint: "", auth: "bearer", totalPath: "", currencyPath: "", currency: "CNY",
        } : {
          id: "balance-" + stamp, label: addProvider || "自定义平台", adapter: "balance", provider: addProvider,
          enabled: true, warningPercent: 70, criticalPercent: 90, showResetCountdown: true, showQueriedAt: true,
          endpoint: "", auth: "bearer", totalPath: "data.balance", currencyPath: "data.currency", currency: "CNY",
        };
        setDraft(function (current) { return Object.assign({}, current, { platforms: current.platforms.concat([item]) }); });
        setAddAdapter(""); setAddProvider(""); setError(""); setNotice("新增平台尚未保存。");
      }

      function save(event) {
        event.preventDefault();
        if (!draft || pending || conflict) return;
        setPending(true); setError(""); setNotice("");
        settingsRequest({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ settings: draft, revision: revision }),
        }).then(function (body) {
          accept(body);
          setNotice("模型平台设置已保存，真实查询会使用新配置。");
        }).catch(function (reason) {
          if (reason.status === 409) {
            setConflict(true);
            setError("设置已在其他位置更改。请重新加载后再保存；重新加载会丢弃当前修改。");
          } else setError(reason.message);
        }).finally(function () { setPending(false); });
      }

      var dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
      function field(label, control) {
        return React.createElement("label", { className: "deu-settings-field" },
          React.createElement("span", { className: "deu-settings-field-label" }, label), control);
      }
      function numberField(label, key, min, max) {
        return field(label, React.createElement("input", {
          "data-setting": key,
          type: "number", min: min, max: max, step: 1, value: draft[key], disabled: pending,
          onChange: function (event) { edit(key, event.target.value === "" ? "" : Number(event.target.value)); },
        }));
      }

      if (props && props.view && props.view !== "page") return null;
      return React.createElement("section", { className: "deu-settings", "aria-label": "额度" },
        React.createElement("h3", null, "额度"),
        React.createElement("p", { className: "deu-settings-note" }, "为 DSH 已配置的模型平台添加额度监测。内置平台使用现有真实额度接口；自定义余额平台绑定 provider 并使用该路由的 API Key 发起真实 HTTPS 请求。DSH 的模型选择、密钥和请求参数仍由官方模型设置管理。"),
        error ? React.createElement("p", { role: "alert", className: "deu-settings-error" }, error) : null,
        notice ? React.createElement("p", { role: "status" }, notice) : null,
        !draft ? React.createElement("div", null,
          React.createElement("p", { role: "status" }, pending ? "正在读取模型平台…" : "模型平台设置暂不可用。"),
          !pending && error ? React.createElement("button", { type: "button", onClick: load }, "重新加载") : null,
        ) : React.createElement("form", { onSubmit: save },
          React.createElement("div", { className: "deu-settings-grid" },
            numberField("有读数时的刷新间隔（毫秒）", "pollIntervalMs", 1000, 60000),
            numberField("未支持模型的刷新间隔（毫秒）", "idlePollIntervalMs", 5000, 300000),
            numberField("成功读数缓存（毫秒）", "cacheTtlMs", 10000, 1800000),
            numberField("单次上游请求超时（毫秒）", "requestTimeoutMs", 1000, 30000),
          ),
          React.createElement("div", { className: "deu-settings-add" },
            React.createElement("h4", null, "添加模型平台"),
            React.createElement("div", { className: "deu-settings-add-row" },
              React.createElement("select", {
                "data-action": "add-adapter", value: addAdapter, disabled: pending,
                onChange: function (event) {
                  var value = event.target.value; setAddAdapter(value); setAddProvider("");
                  if (value === "balance") loadProviders();
                },
              },
                React.createElement("option", { value: "" }, "选择平台类型…"),
                MODEL_SOURCES.filter(function (source) { return !draft.platforms.some(function (item) { return item.adapter === source.id; }); }).map(function (source) {
                  return React.createElement("option", { key: source.id, value: source.id }, source.label + "（内置）");
                }),
                React.createElement("option", { value: "balance" }, "自定义余额平台"),
              ),
              addAdapter === "balance" ? React.createElement("input", {
                "data-setting": "new-provider", type: "text", list: "deu-provider-options", value: addProvider,
                disabled: pending, placeholder: providers === null ? "读取 DSH 平台中…" : "DSH provider ID",
                onChange: function (event) { setAddProvider(event.target.value); },
              }) : null,
              React.createElement("button", {
                type: "button", "data-action": "add-platform", onClick: addPlatform,
                disabled: pending || !addAdapter || (addAdapter === "balance" && !addProvider.trim()),
              }, "添加"),
            ),
            providersError ? React.createElement("p", { role: "alert", className: "deu-settings-error" }, "DSH 平台目录不可用，可手动输入 provider ID。" + providersError) : null,
            React.createElement("p", { className: "deu-settings-note" }, "自定义平台仅发送真实 HTTPS 请求，API Key 从 DSH 当前 provider 路由读取，不会写入本插件设置或发送到浏览器。"),
          ),
          React.createElement("div", { className: "deu-settings-models" }, draft.platforms.length ? draft.platforms.map(function (item) {
            var builtin = MODEL_SOURCES.find(function (source) { return source.id === item.adapter; });
            return React.createElement("article", { className: "deu-settings-model", key: item.id, "data-platform-id": item.id },
              React.createElement("div", { className: "deu-settings-model-head" },
                React.createElement("div", null,
                  React.createElement("h4", null, item.label),
                  React.createElement("div", { className: "deu-settings-platform-meta" }, builtin ? "内置真实额度接口" : "真实余额接口 · " + item.provider),
                ),
                React.createElement("div", { className: "deu-settings-platform-actions" },
                  React.createElement("label", { className: "deu-settings-check" },
                    React.createElement("input", {
                      "data-setting": "enabled",
                      type: "checkbox", checked: item.enabled, disabled: pending,
                      onChange: function (event) { editPlatform(item.id, "enabled", event.target.checked); },
                    }), "显示并查询"),
                  React.createElement("button", {
                    type: "button", className: "deu-settings-delete", "data-action": "delete-platform",
                    "data-platform-id": item.id, disabled: pending, onClick: function () { removePlatform(item.id); },
                  }, "删除平台"),
                ),
              ),
              React.createElement("div", { className: "deu-settings-model-grid" },
                field("显示名称", React.createElement("input", {
                  "data-setting": "label",
                  type: "text", maxLength: 24, value: item.label, disabled: pending,
                  onChange: function (event) { editPlatform(item.id, "label", event.target.value); },
                })),
                builtin ? field("提醒阈值（%）", React.createElement("input", {
                  "data-setting": "warningPercent",
                  type: "number", min: 0, max: 99.9, step: 0.1, value: item.warningPercent, disabled: pending,
                  onChange: function (event) { editPlatform(item.id, "warningPercent", event.target.value === "" ? "" : Number(event.target.value)); },
                })) : null,
                builtin ? field("严重阈值（%）", React.createElement("input", {
                  "data-setting": "criticalPercent",
                  type: "number", min: 0.1, max: 100, step: 0.1, value: item.criticalPercent, disabled: pending,
                  onChange: function (event) { editPlatform(item.id, "criticalPercent", event.target.value === "" ? "" : Number(event.target.value)); },
                })) : null,
                React.createElement("div", { className: "deu-settings-field" },
                  React.createElement("span", { className: "deu-settings-field-label" }, "读数显示"),
                  builtin ? React.createElement("label", { className: "deu-settings-check" },
                    React.createElement("input", {
                      "data-setting": "showResetCountdown",
                      type: "checkbox", checked: item.showResetCountdown, disabled: pending,
                      onChange: function (event) { editPlatform(item.id, "showResetCountdown", event.target.checked); },
                    }), "重置倒计时") : null,
                  React.createElement("label", { className: "deu-settings-check" },
                    React.createElement("input", {
                      "data-setting": "showQueriedAt",
                      type: "checkbox", checked: item.showQueriedAt, disabled: pending,
                      onChange: function (event) { editPlatform(item.id, "showQueriedAt", event.target.checked); },
                    }), "刷新时间"),
                ),
              ),
              builtin ? null : React.createElement("div", { className: "deu-settings-model-grid deu-settings-custom-grid" },
                field("DSH provider ID", React.createElement("input", {
                  "data-setting": "provider",
                  type: "text", list: "deu-provider-options", value: item.provider, disabled: pending,
                  placeholder: "例如 openrouter",
                  onChange: function (event) { editPlatform(item.id, "provider", event.target.value); },
                })),
                field("余额接口（HTTPS）", React.createElement("input", {
                  "data-setting": "endpoint",
                  type: "url", value: item.endpoint, disabled: pending,
                  placeholder: "https://api.example.com/v1/balance",
                  onChange: function (event) { editPlatform(item.id, "endpoint", event.target.value); },
                })),
                field("认证方式", React.createElement("select", {
                  "data-setting": "auth", value: item.auth, disabled: pending,
                  onChange: function (event) { editPlatform(item.id, "auth", event.target.value); },
                }, React.createElement("option", { value: "bearer" }, "Authorization: Bearer"), React.createElement("option", { value: "x-api-key" }, "x-api-key"))),
                field("余额 JSON 路径", React.createElement("input", {
                  "data-setting": "totalPath", type: "text", value: item.totalPath, disabled: pending,
                  placeholder: "data.balance",
                  onChange: function (event) { editPlatform(item.id, "totalPath", event.target.value); },
                })),
                field("币种 JSON 路径（可选）", React.createElement("input", {
                  "data-setting": "currencyPath", type: "text", value: item.currencyPath, disabled: pending,
                  placeholder: "data.currency",
                  onChange: function (event) { editPlatform(item.id, "currencyPath", event.target.value); },
                })),
                field("固定币种", React.createElement("input", {
                  "data-setting": "currency", type: "text", maxLength: 8, value: item.currency, disabled: pending,
                  onChange: function (event) { editPlatform(item.id, "currency", event.target.value); },
                })),
              ),
            );
          }) : React.createElement("p", { className: "deu-settings-empty" }, "还没有模型平台。可从下方添加内置平台或自定义余额平台。")),
          React.createElement("datalist", { id: "deu-provider-options" }, (providers || []).filter(function (provider) {
            return !draft.platforms.some(function (item) { return item.adapter === "balance" && item.provider === provider.id; });
          }).map(function (provider) {
            return React.createElement("option", { key: provider.id, value: provider.id }, provider.name + (provider.live ? " · 已加载" : ""));
          })),
          React.createElement("p", { className: "deu-settings-note" }, "额度百分比平台的提醒阈值必须低于严重阈值；余额平台按实际金额显示。删除或关闭平台后，本插件不再查询或显示对应额度；保存设置会立即失效旧缓存，并跟随账号和模型切换重新查询。"),
          React.createElement("div", { className: "deu-settings-actions" },
            React.createElement("button", { type: "submit", disabled: pending || !dirty || conflict }, pending ? "处理中…" : "保存平台设置"),
            React.createElement("button", { type: "button", disabled: pending || !dirty, onClick: function () { setDraft(cloneSettings(saved)); setError(""); setNotice(""); } }, "撤销更改"),
            conflict ? React.createElement("button", { type: "button", disabled: pending, onClick: load }, "重新加载设置") : null,
          ),
        ),
      );
    }

    function apply(ctx) {
      ensureStyle();
      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-edu", order: 10, label: "额度" },
          function (props) {
            return React.createElement(StatusReadout, { sessionId: props.sessionId, useProjection: props.useProjection });
          },
        );
      });
      ctx.slots.inject("plugins.bundle.config", function () {
        return ctx.slots.register({ name: "plugins.bundle.config", key: "dsh-edu" }, SettingsPage);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
