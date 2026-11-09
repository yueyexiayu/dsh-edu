import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DEFAULT_SETTINGS } from "../lib/settings.js";

const tick = () => new Promise(setImmediate);

function settingsClient() {
  let exports;
  let component;
  let hooks = [];
  let hookIndex = 0;
  const requests = [];
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useState(seed) {
      const index = hookIndex++;
      hooks[index] ??= { value: typeof seed === "function" ? seed() : seed };
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
      }];
    },
    useEffect(callback, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (!previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        previous?.cleanup?.();
        hooks[index] = { dependencies, cleanup: callback() };
      }
    },
  };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(entry) { exports = entry.factory(() => React); } } },
    document: { getElementById: () => ({}), head: {}, visibilityState: "visible" },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    setTimeout, clearTimeout, AbortController, AbortSignal, Date,
  });
  exports.apply({
    slots: {
      inject(name, callback) { if (name === "plugins.bundle.config") callback(); },
      register(meta, value) { if (meta.name === "plugins.bundle.config") component = value; },
    },
  });
  return {
    requests,
    render() { hookIndex = 0; return component({ view: "page" }); },
  };
}

function nodes(root, predicate, found = []) {
  if (Array.isArray(root)) {
    for (const value of root) nodes(value, predicate, found);
    return found;
  }
  if (!root || typeof root !== "object") return found;
  if (root.props && predicate(root)) found.push(root);
  for (const child of root.children || []) nodes(child, predicate, found);
  return found;
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("plugin page edits and saves model parameters through the current revision", async () => {
  const client = settingsClient();
  client.render();
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, "/api/dsh-edu/settings");
  const initial = structuredClone(DEFAULT_SETTINGS);
  client.requests[0].resolve(response({ ok: true, settings: initial, revision: "r1" }));
  await tick();
  const loaded = client.render();
  assert.match(nodes(loaded, (node) => node.type === "h3").map((node) => node.children[0]).join(""), /额度模型参数/);

  const poll = nodes(loaded, (node) => node.props["data-setting"] === "pollIntervalMs")[0];
  poll.props.onChange({ target: { value: "5000" } });
  const warning = nodes(loaded, (node) => node.props["data-setting"] === "warningPercent")[0];
  warning.props.onChange({ target: { value: "60" } });
  const label = nodes(loaded, (node) => node.props["data-setting"] === "label")[0];
  label.props.onChange({ target: { value: "Codex 主账号" } });
  const age = nodes(loaded, (node) => node.props["data-setting"] === "showQueriedAt")[0];
  age.props.onChange({ target: { checked: false } });
  const dirty = client.render();
  const form = nodes(dirty, (node) => node.type === "form")[0];
  form.props.onSubmit({ preventDefault() {} });
  assert.equal(client.requests.length, 2);
  const request = client.requests[1];
  assert.equal(request.options.method, "POST");
  const sent = JSON.parse(request.options.body);
  assert.equal(sent.revision, "r1");
  assert.equal(sent.settings.pollIntervalMs, 5000);
  assert.equal(sent.settings.models.codex.warningPercent, 60);
  assert.equal(sent.settings.models.codex.label, "Codex 主账号");
  assert.equal(sent.settings.models.codex.showQueriedAt, false);
  request.resolve(response({ ok: true, settings: sent.settings, revision: "r2" }));
  await tick();
  const saved = client.render();
  assert.ok(nodes(saved, (node) => node.children?.includes?.("模型读数参数已保存，后续查询会使用新设置。")).length > 0);
});
