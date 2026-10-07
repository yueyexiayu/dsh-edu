window.__ModuleLoader__.load({
  id: "dsh-edu",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var inject = ["slots"];
    var STYLE_ID = "dsh-edu-style";
    var API_PATH = "/api/dsh-edu";

    var cssText =
      ".deu-readout { display: inline-flex; align-items: center; gap: 10px; font-size: 11px; line-height: 1.5; " +
      "color: var(--dsw-alias-label-secondary); white-space: nowrap; user-select: none; } " +
      ".deu-readout__item { display: inline-flex; align-items: center; gap: 4px; } " +
      ".deu-readout__pct { font-weight: 600; font-variant-numeric: tabular-nums; } " +
      ".deu-pct-ok { color: var(--dsw-alias-state-success-primary); } " +
      ".deu-pct-warn { color: #d97706; } " +
      ".deu-pct-crit { color: var(--dsw-alias-state-error-primary); } " +
      ".deu-readout--error { color: var(--dsw-alias-state-error-primary); } " +
      ".deu-readout__ago { color: var(--dsw-alias-label-secondary); }";

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

    function pctClass(u) {
      var v = numeric(u);
      if (v !== v) return "deu-pct-ok";
      if (v >= 90) return "deu-pct-crit";
      if (v >= 70) return "deu-pct-warn";
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
      var ago = agoStr(res.queriedAt);
      if (ago) items.push(React.createElement("span", { key: "ago", className: "deu-readout__item deu-readout__ago" }, ago));
      return React.createElement("span", { className: "deu-readout", title: tip.join("\n") }, items);
    }

    function QuotaReadout(res) {
      if (res.balance) return BalanceReadout(res);
      var wins = res.windows;
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
      var items = wins.map(function (win) {
        var cd = countdownStr(win.resetsAt);
        return React.createElement(
          "span",
          { key: win.key, className: "deu-readout__item" },
          win.label + " ",
          React.createElement("span", { className: "deu-readout__pct " + pctClass(win.utilization) }, fmtPct(win.utilization)),
          cd ? " " + cd : "",
        );
      });
      var ago = agoStr(res.queriedAt);
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
            setView({ res: res, forSession: sessionId, forModel: model });
            if (!visible()) return;
            var delay = res.ok && res.isSupported === false ? 30000 : 2000;
            if (res.ok && Number.isFinite(res.retryAfterMs) && res.retryAfterMs > delay) {
              delay = Math.min(res.retryAfterMs, 180000);
            }
            timer = setTimeout(load, delay);
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
            }, 20000);
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

    function apply(ctx) {
      ensureStyle();
      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-edu", order: 10, label: "账号限额" },
          function (props) {
            return React.createElement(StatusReadout, { sessionId: props.sessionId, useProjection: props.useProjection });
          },
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
