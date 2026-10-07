import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the shipped client with controlled transport, time and session projection hooks.
function client({ hidden = false } = {}) {
  let state; let component; let effect; let dependencies; let cleanup; let exports;
  let sessionId = "session-a"; let selection = { next: { provider: "xai", model: "grok" } };
  let now = 0; let timerId = 0;
  const timers = new Map(); const listeners = new Map(); const requests = [];
  const document = {
    visibilityState: hidden ? "hidden" : "visible", getElementById: () => ({}), head: {},
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const timeout = (callback, delay, interval = false) => {
    const id = ++timerId; timers.set(id, { callback, at: now + delay, delay, interval }); return id;
  };
  const React = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useState(seed) { state ??= seed(); return [state, (value) => { state = typeof value === "function" ? value(state) : value; }]; },
    useEffect(callback, next) {
      if (!dependencies || next.some((value, i) => value !== dependencies[i])) { effect = callback; dependencies = next; }
    },
  };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(module) { exports = module.factory(() => React); } } }, document,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, signal: options?.signal,
      resolve: (body, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json: async () => body }), reject })),
    setTimeout: timeout, clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => timeout(callback, delay, true), clearInterval: (id) => timers.delete(id),
    AbortController, Date,
  });
  const props = () => ({ sessionId, useProjection(key, selector) {
    assert.equal(key, "modelSelection"); return selector ? selector(selection) : selection;
  } });
  exports.apply({ slots: {
    inject(_slot, callback) { callback(); },
    register(_meta, render) {
      const supplied = props(); const element = render(supplied);
      assert.equal(element.props.sessionId, supplied.sessionId);
      assert.equal(element.props.useProjection, supplied.useProjection);
      component = element.type;
    },
  } });
  function render(nextSessionId = sessionId) { sessionId = nextSessionId; return component(props()); }
  function commit() { if (effect) { cleanup?.(); const next = effect; effect = null; cleanup = next(); } }
  render(); commit();
  return {
    requests, state: () => state, render, commit,
    changeModel(provider, model) { selection = { next: { provider, model } }; const tree = render(); commit(); return tree; },
    visibility(value) { document.visibilityState = value; listeners.get("visibilitychange")?.(); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due; now = timer.at;
        if (timer.interval) timer.at += timer.delay; else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
    dispose() { cleanup?.(); cleanup = undefined; },
    listenerCount: () => listeners.size,
  };
}
const tick = () => new Promise(setImmediate);
const quota = (amount) => ({ ok: true, isSupported: true, windows: [{ key: "weekly", label: "7d", utilization: amount }] });
const text = (tree) => tree == null ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.children);

test("polling stays serial and accepts a response slower than its polling period", async () => {
  const c = client();
  c.advance(6000);
  assert.equal(c.requests.length, 1);
  c.requests[0].resolve(quota(72)); await tick();
  assert.equal(c.state().res.windows[0].utilization, 72);
  c.advance(2000); assert.equal(c.requests.length, 2); c.dispose();
});

test("client request failure clears previous quota and displays an error", async () => {
  const c = client();
  c.requests[0].resolve(quota(11)); await tick();
  c.advance(2000); c.requests[1].reject(new Error("offline")); await tick();
  assert.equal(c.state().res.windows, undefined);
  assert.match(text(c.render()), /查询失败/); c.dispose();
});

test("switching sessions hides old data, aborts old request and ignores its late response", async () => {
  const c = client();
  assert.equal(c.render("session-b"), null); c.commit();
  assert.equal(c.requests[0].signal?.aborted, true);
  assert.match(c.requests[1].url, /sessionId=session-b/);
  c.requests[1].resolve(quota(72)); await tick();
  c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.state().res.windows[0].utilization, 72); c.dispose();
});

test("switching sessions immediately hides an already displayed readout", async () => {
  const c = client(); c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.render("session-b"), null); c.commit(); c.dispose();
});

test("unmounted client aborts and ignores in-flight responses", async () => {
  const c = client(); c.dispose();
  assert.equal(c.requests[0].signal?.aborted, true);
  c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.state().res, null); assert.equal(c.listenerCount(), 0);
  c.advance(60000); assert.equal(c.requests.length, 1);
});

test("hidden tabs send no requests and becoming visible refreshes immediately", async () => {
  const c = client({ hidden: true });
  c.advance(60000); assert.equal(c.requests.length, 0);
  c.visibility("visible"); assert.equal(c.requests.length, 1);
  c.visibility("hidden"); assert.equal(c.requests[0].signal.aborted, true);
  c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.state().res, null); c.advance(60000); assert.equal(c.requests.length, 1);
  c.visibility("visible"); assert.equal(c.requests.length, 2); c.dispose();
});

test("unsupported providers poll slowly but projection changes refresh without waiting", async () => {
  const c = client(); c.requests[0].resolve({ ok: true, isSupported: false }); await tick();
  assert.equal(c.render(), null);
  c.advance(29999); assert.equal(c.requests.length, 1);
  c.changeModel("deepseek", "deepseek-chat"); assert.equal(c.requests.length, 2); c.dispose();
});

test("unsupported providers retain a thirty-second polling fallback", async () => {
  const c = client(); c.requests[0].resolve({ ok: true, isSupported: false }); await tick();
  c.advance(30000); assert.equal(c.requests.length, 2); c.dispose();
});

test("model projection change hides the old quota before loading the new provider", async () => {
  const c = client(); c.requests[0].resolve(quota(11)); await tick();
  assert.match(text(c.render()), /11%/);
  assert.equal(c.changeModel("deepseek", "deepseek-chat"), null);
  assert.equal(c.requests.length, 2); c.dispose();
});

test("model change aborts old fetch and ignores its late response", async () => {
  const c = client(); c.changeModel("deepseek", "deepseek-chat");
  assert.equal(c.requests[0].signal.aborted, true);
  c.requests[1].resolve(quota(72)); await tick(); c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.state().res.windows[0].utilization, 72); c.dispose();
});

test("unrelated projection notifications do not restart polling", async () => {
  const c = client(); c.changeModel("xai", "grok");
  assert.equal(c.requests.length, 1); c.dispose();
});

test("HTTP failures remain errors even when their JSON claims success", async () => {
  const c = client(); c.requests[0].resolve(quota(11), 503); await tick();
  assert.match(text(c.render()), /查询失败/); assert.doesNotMatch(text(c.render()), /11%/); c.dispose();
});

test("structured failures remain visible without an isSupported flag", async () => {
  const c = client(); c.requests[0].resolve({ ok: false, error: "上游暂时不可用" }); await tick();
  assert.match(text(c.render()), /上游暂时不可用/); c.dispose();
});

test("hung requests time out visibly, retry serially and discard late replies", async () => {
  const c = client(); c.advance(20000); await tick();
  assert.match(text(c.render()), /超时/); assert.equal(c.requests[0].signal.aborted, true);
  c.advance(2000); assert.equal(c.requests.length, 2);
  c.requests[1].resolve(quota(72)); await tick(); c.requests[0].resolve(quota(11)); await tick();
  assert.equal(c.state().res.windows[0].utilization, 72); c.dispose();
});

test("partial resource-package failures keep cash visible and expose warning details", async () => {
  const c = client(); c.requests[0].resolve({ ok: true, isSupported: true, warning: "resource endpoint HTTP 503",
    state: "partial_retry", retryAfterMs: 30000, balance: { total: 12.5, currency: "CNY", packages: null } }); await tick();
  const tree = c.render(); assert.match(text(tree), /¥12\.50/); assert.match(text(tree), /资源包查询失败/);
  assert.match(tree.props.title, /HTTP 503/);
  c.advance(29999); assert.equal(c.requests.length, 1);
  c.advance(1); assert.equal(c.requests.length, 2); c.dispose();
});

test("an empty successful resource-package list is not a failure", async () => {
  const c = client(); c.requests[0].resolve({ ok: true, isSupported: true, balance: { total: 12, currency: "CNY", packages: [] } }); await tick();
  assert.doesNotMatch(text(c.render()), /失败/); c.dispose();
});

test("missing, boolean and nonfinite numbers never render as zero or Infinity", async () => {
  for (const value of [null, false, "", Infinity, undefined]) {
    const c = client(); c.requests[0].resolve(quota(value)); await tick();
    assert.match(text(c.render()), /—/); assert.doesNotMatch(text(c.render()), /0%|Infinity/); c.dispose();
    const balanceClient = client(); balanceClient.requests[0].resolve({ ok: true, isSupported: true,
      balance: { currency: "CNY", total: value, packages: [{ name: "包", remaining: value }] } }); await tick();
    assert.match(text(balanceClient.render()), /¥—/);
    assert.match(balanceClient.render().props.title, /包 剩余 —/); balanceClient.dispose();
  }
});

test("zero remains a valid displayed number", async () => {
  const c = client(); c.requests[0].resolve(quota(0)); await tick(); assert.match(text(c.render()), /0%/); c.dispose();
});
