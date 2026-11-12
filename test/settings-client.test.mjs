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
  let intervalCallback;
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
    useRef(seed) {
      const index = hookIndex++;
      hooks[index] ??= { ref: { current: seed } };
      return hooks[index].ref;
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
    setTimeout, clearTimeout,
    setInterval(callback) { intervalCallback = callback; return 1; },
    clearInterval() { intervalCallback = undefined; },
    AbortController, AbortSignal, Date,
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
    sync() { intervalCallback?.(); },
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

test("plugin listing names use the visible name while retaining the dsh-edu component id", () => {
  const zh = JSON.parse(readFileSync(new URL("../locale/zh.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../locale/en.json", import.meta.url), "utf8"));
  assert.equal(zh.meta.title, "额度");
  assert.equal(en.meta.title, "Usage");
});

test("plugin page edits and saves model parameters through the current revision", async () => {
  const client = settingsClient();
  client.render();
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, "/api/dsh-edu/settings");
  const initial = structuredClone(DEFAULT_SETTINGS);
  client.requests[0].resolve(response({ ok: true, settings: initial, revision: "r1" }));
  await tick();
  const loaded = client.render();
  assert.equal(nodes(loaded, (node) => node.type === "h3").map((node) => node.children[0]).join(""), "额度");

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
  const codex = sent.settings.platforms.find((platform) => platform.adapter === "codex");
  assert.equal(codex.warningPercent, 60);
  assert.equal(codex.label, "Codex 主账号");
  assert.equal(codex.showQueriedAt, false);
  request.resolve(response({ ok: true, settings: sent.settings, revision: "r2" }));
  await tick();
  const saved = client.render();
  assert.ok(nodes(saved, (node) => node.children?.includes?.("模型平台设置已保存，真实查询会使用新配置。")).length > 0);
});

test("plugin page adds a provider-backed platform and removes a built-in platform", async () => {
  const client = settingsClient();
  client.render();
  client.requests[0].resolve(response({ ok: true, settings: structuredClone(DEFAULT_SETTINGS), revision: "r1" }));
  await tick();
  let tree = client.render();
  const ordered = nodes(tree, (node) => node.type === "article" || node.props["data-action"] === "add-adapter");
  assert.equal(ordered[0].props["data-action"], "add-adapter");
  const addSelect = nodes(tree, (node) => node.props["data-action"] === "add-adapter")[0];
  addSelect.props.onChange({ target: { value: "balance" } });
  assert.equal(client.requests[1].url, "/api/dsh-edu/platforms");
  client.requests[1].resolve(response({ ok: true, providers: [{ id: "openrouter", name: "OpenRouter", live: true }] }));
  await tick();
  tree = client.render();
  const provider = nodes(tree, (node) => node.props["data-setting"] === "new-provider")[0];
  provider.props.onChange({ target: { value: "openrouter" } });
  tree = client.render();
  nodes(tree, (node) => node.props["data-action"] === "add-platform")[0].props.onClick();
  nodes(tree, (node) => node.props["data-action"] === "delete-platform" && node.props["data-platform-id"] === "zai")[0].props.onClick();
  tree = client.render();
  const cards = nodes(tree, (node) => node.props["data-platform-id"] && node.type === "article");
  assert.equal(cards.some((node) => node.props["data-platform-id"] === "zai"), false);
  assert.equal(cards.some((node) => node.props["data-platform-id"].startsWith("balance-")), true);
  nodes(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(client.requests.length, 3);
  const sent = JSON.parse(client.requests[2].options.body).settings;
  assert.equal(sent.platforms.some((platform) => platform.id === "zai"), false);
  const custom = sent.platforms.find((platform) => platform.provider === "openrouter");
  assert.equal(custom.adapter, "balance");
  assert.equal(custom.endpoint, "");
});

test("clean settings pages synchronize changes saved by another window", async () => {
  const client = settingsClient();
  client.render();
  const initial = structuredClone(DEFAULT_SETTINGS);
  client.requests[0].resolve(response({ ok: true, settings: initial, revision: "r1" }));
  await tick();
  client.render();
  client.sync();
  assert.equal(client.requests[1].url, "/api/dsh-edu/settings");
  const changed = structuredClone(initial);
  changed.platforms[0].label = "其他窗口修改";
  client.requests[1].resolve(response({ ok: true, settings: changed, revision: "r2" }));
  await tick();
  const tree = client.render();
  assert.ok(nodes(tree, (node) => node.props["data-setting"] === "label" && node.props.value === "其他窗口修改").length > 0);
  assert.ok(nodes(tree, (node) => node.children?.includes?.("模型平台设置已从其他窗口同步。")).length > 0);
});
