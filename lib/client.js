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
      ".deu-readout__ago { color: var(--dsw-alias-label-secondary); } " +
      ".deu-readout__wrap--stale { opacity: 0.55; }";

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

    function pctClass(u) {
      var v = Number(u);
      if (v !== v) return "deu-pct-ok";
      if (v >= 90) return "deu-pct-crit";
      if (v >= 70) return "deu-pct-warn";
      return "deu-pct-ok";
    }

    function fmtPct(u) {
      var v = Number(u);
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
      var v = Number(n);
      return v === v ? v.toFixed(2) : "—";
    }

    function fmtTokens(n) {
      var v = Number(n);
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
      var cls = bal.available === false || Number(bal.total) <= 0 ? "deu-pct-crit" : Number(bal.total) < 5 ? "deu-pct-warn" : "deu-pct-ok";
      var items = [
        React.createElement(
          "span",
          { key: "bal", className: "deu-readout__item" },
          "余额 ",
          React.createElement("span", { className: "deu-readout__pct " + cls }, currencySymbol(bal.currency) + fmtMoney(bal.total)),
        ),
      ];
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

    function seedView(sid) {
      return { res: null, forSession: sid, fresh: false };
    }

    function StatusReadout(props) {
      var sessionId = props && props.sessionId ? String(props.sessionId) : "";
      var viewState = React.useState(function () {
        return seedView(sessionId);
      });
      var view = viewState[0];
      var setView = viewState[1];

      React.useEffect(
        function () {
          var alive = true;
          if (view.forSession !== sessionId) setView(seedView(sessionId));

          function load() {
            var qs = sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : "";
            fetch(API_PATH + qs)
              .then(function (r) {
                return r.json();
              })
              .then(function (res) {
                if (!alive) return;
                if (res && res.ok) {
                  setView({ res: res, forSession: sessionId, fresh: true });
                } else {
                  setView(function (prev) {
                    if (prev && prev.res && prev.res.isSupported) {
                      return { res: prev.res, forSession: prev.forSession, fresh: false };
                    }
                    return { res: null, forSession: sessionId, fresh: false };
                  });
                }
              })
              .catch(function () {
                if (!alive) return;
                setView(function (prev) {
                  if (prev && prev.res && prev.res.isSupported) {
                    return { res: prev.res, forSession: prev.forSession, fresh: false };
                  }
                  return { res: null, forSession: sessionId, fresh: false };
                });
              });
          }
          load();
          var timer = setInterval(load, 2000);
          return function () {
            alive = false;
            clearInterval(timer);
          };
        },
        [sessionId],
      );

      if (!view.res || !view.res.isSupported) return null;
      var readout = QuotaReadout(view.res);
      if (!view.fresh || view.forSession !== sessionId) {
        return React.createElement(
          "span",
          { className: "deu-readout__wrap deu-readout__wrap--stale", title: "缓存的读数，正在刷新…" },
          readout,
        );
      }
      return readout;
    }

    function apply(ctx) {
      ensureStyle();
      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-edu", order: 10, label: "账号限额" },
          function (props) {
            return React.createElement(StatusReadout, { sessionId: props && props.sessionId });
          },
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
