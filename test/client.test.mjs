import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the shipped client and its polling callbacks without a desktop account.
function client() {
  let state; let component; let effect; let poll; let exports;
  const requests = [];
  const React = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useState(seed) { state ??= seed(); return [state, (value) => { state = typeof value === "function" ? value(state) : value; }]; },
    useEffect(callback) { effect = callback; },
  };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(module) { exports = module.factory(() => React); } } },
    document: { getElementById: () => ({}), head: {} },
    fetch: () => new Promise((resolve, reject) => requests.push({ resolve: (body) => resolve({ json: async () => body }), reject })),
    setInterval(callback) { poll = callback; return 1; }, clearInterval() {}, Date,
  });
  exports.apply({ slots: {
    inject(_slot, callback) { callback(); },
    register(_meta, render) { component = render({ sessionId: "session-a" }).type; },
  } });
  component({ sessionId: "session-a" });
  const dispose = effect();
  return { requests, poll: () => poll(), state: () => state, render: (sessionId) => component({ sessionId }), dispose };
}
const tick = () => new Promise(setImmediate);
const quota = (amount) => ({ ok: true, isSupported: true, windows: [{ utilization: amount }] });

test("late client responses cannot replace a newer account readout", async () => {
  const c = client();
  c.poll();
  c.requests[1].resolve(quota(72));
  await tick();
  assert.equal(c.state().res.windows[0].utilization, 72);
  c.requests[0].resolve(quota(11));
  await tick();
  assert.equal(c.state().res.windows[0].utilization, 72);
  c.dispose();
});

test("client request failure clears previous quota and displays an error", async () => {
  const c = client();
  c.requests[0].resolve(quota(11));
  await tick();
  c.poll(); c.requests[1].reject(new Error("offline"));
  await tick();
  assert.equal(c.state().res.windows, undefined);
  assert.match(c.state().res.error, /查询失败/);
  c.dispose();
});

test("switching sessions immediately hides the previous readout", async () => {
  const c = client();
  c.requests[0].resolve(quota(11));
  await tick();
  assert.equal(c.render("session-b"), null);
  c.dispose();
});

test("unmounted client ignores in-flight responses", async () => {
  const c = client();
  c.dispose();
  c.requests[0].resolve(quota(11));
  await tick();
  assert.equal(c.state().res, null);
});
