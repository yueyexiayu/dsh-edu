import assert from "node:assert/strict";
import { test } from "node:test";
import {
  grokUserIdFromBody,
  isDeepSeekProvider,
  oauthAccessFromRecord,
  oauthFromRecord,
  parseDeepSeekBalance,
  parseGrokBilling,
  parseUsageBody,
  parseZaiAccountReport,
  parseZaiTokenPackages,
  toNum,
  windowName,
  zaiRouteFor,
} from "../lib/parse.js";

test("windowName maps 5h and weekly seconds", () => {
  assert.deepEqual(windowName(18000), { key: "5h", label: "5小时" });
  assert.deepEqual(windowName(604800), { key: "7d", label: "7天" });
});

test("parseUsageBody reads primary/secondary windows", () => {
  const parsed = parseUsageBody({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 12, reset_at: 1738300000, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 40, reset_at: 1738900000, limit_window_seconds: 604800 },
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.planType, "plus");
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].key, "5h");
  assert.equal(parsed.windows[0].utilization, 12);
  assert.equal(parsed.windows[1].key, "7d");
  assert.equal(parsed.windows[1].label, "7天");
  assert.equal(parsed.windows[0].resetsAt, new Date(1738300000 * 1000).toISOString());
});

test("parseUsageBody rejects missing windows", () => {
  const parsed = parseUsageBody({ rate_limit: {} });
  assert.equal(parsed.ok, false);
});

test("oauthFromRecord accepts accountId on the grant payload", () => {
  const oauth = oauthFromRecord({
    kind: "grant",
    payload: { type: "oauth", access: "tok", accountId: "acct-1" },
  });
  assert.equal(oauth.ok, true);
  assert.equal(oauth.accountId, "acct-1");
  assert.equal(oauth.access, "tok");
});

test("oauthFromRecord reports missing login", () => {
  const oauth = oauthFromRecord(undefined);
  assert.equal(oauth.ok, false);
});

test("parseGrokBilling reads SuperGrok weekly percent", () => {
  const parsed = parseGrokBilling({
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-09-10T09:34:57.639108+00:00",
        end: "2026-09-17T09:34:57.639108+00:00",
      },
      creditUsagePercent: 57,
      productUsage: [{ product: "GrokBuild", usagePercent: 57 }],
      billingPeriodEnd: "2026-09-17T09:34:57.639108+00:00",
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].key, "7d");
  assert.equal(parsed.windows[0].label, "7天");
  assert.equal(parsed.windows[0].utilization, 57);
  assert.equal(parsed.windows[0].resetsAt, new Date("2026-09-17T09:34:57.639108+00:00").toISOString());
});

test("parseGrokBilling rejects omitted weekly percent instead of inventing zero", () => {
  const parsed = parseGrokBilling({
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-17T09:34:57.639Z" },
    },
  });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /用量/);
});

test("parseGrokBilling falls back to GrokBuild productUsage", () => {
  const parsed = parseGrokBilling({
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-17T09:34:57.639Z" },
      productUsage: [{ product: "GrokBuild", usagePercent: 12 }],
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.windows[0].utilization, 12);
});

test("parseGrokBilling rejects missing config", () => {
  assert.equal(parseGrokBilling({}).ok, false);
});

test("grokUserIdFromBody reads userId", () => {
  assert.equal(grokUserIdFromBody({ userId: "user-1" }), "user-1");
  assert.equal(grokUserIdFromBody({}), null);
});

test("oauthAccessFromRecord reads Grok grant access", () => {
  const oauth = oauthAccessFromRecord({
    kind: "grant",
    payload: { type: "oauth", access: "tok" },
  }, "Grok");
  assert.equal(oauth.ok, true);
  assert.equal(oauth.access, "tok");
});

test("parseDeepSeekBalance prefers CNY total", () => {
  const parsed = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      { currency: "USD", total_balance: "1.00", granted_balance: "0.00", topped_up_balance: "1.00" },
      { currency: "CNY", total_balance: "16.09", granted_balance: "0.00", topped_up_balance: "16.09" },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.balance.currency, "CNY");
  assert.equal(parsed.balance.total, 16.09);
  assert.equal(parsed.balance.available, true);
  assert.equal(parsed.windows, null);
});

test("parseDeepSeekBalance rejects missing infos", () => {
  assert.equal(parseDeepSeekBalance({ is_available: false, balance_infos: [] }).ok, false);
});

test("isDeepSeekProvider matches official routes", () => {
  assert.equal(isDeepSeekProvider("deepseek-official"), true);
  assert.equal(isDeepSeekProvider("xai"), false);
});

test("parseZaiAccountReport reads cash balance", () => {
  const parsed = parseZaiAccountReport({
    code: 200,
    success: true,
    data: {
      balance: 25.14540873,
      availableBalance: 25.14540873,
      rechargeAmount: 40.0,
      giveAmount: 0.0,
      totalSpendAmount: 14.85459127,
      frozenBalance: 0.0,
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.balance.currency, "CNY");
  assert.equal(parsed.balance.total, 25.14540873);
  assert.equal(parsed.balance.toppedUp, 40.0);
  assert.equal(parsed.balance.granted, 0.0);
  assert.equal(parsed.balance.spent, 14.85459127);
  assert.equal(parsed.windows, null);
});

test("parseZaiAccountReport rejects business errors", () => {
  const parsed = parseZaiAccountReport({ code: 500, success: false, msg: "boom" });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "boom");
});

test("parseZaiTokenPackages keeps effective packages", () => {
  const parsed = parseZaiTokenPackages({
    code: 200,
    rows: [
      { resourcePackageName: "体验包", tokenBalance: 5000000, tokensMagnitude: 5000000, status: "EFFECTIVE" },
      { resourcePackageName: "已过期", tokenBalance: 20, tokensMagnitude: 20, status: "EXPIRED" },
      { tokenBalance: 100, tokensMagnitude: 100, status: "EFFECTIVE" },
    ],
  });
  assert.equal(parsed.ok, true);
  const { packages } = parsed;
  assert.equal(packages.length, 2);
  assert.equal(packages[0].remaining, 5000000);
  assert.equal(packages[0].total, 5000000);
  assert.equal(packages[1].remaining, 100);
});

test("toNum only accepts finite numbers and nonempty numeric strings", () => {
  for (const value of [false, true, [], [1], {}, { valueOf: () => 12 }, "", "   ", null, undefined, NaN, Infinity, -Infinity, "Infinity", "nope"]) {
    assert.equal(toNum(value), null, String(value));
  }
  for (const [value, expected] of [[0, 0], [-2.5, -2.5], [" 12.5 ", 12.5], ["1e3", 1000]]) {
    assert.equal(toNum(value), expected);
  }
});

function codexWindow(overrides = {}) {
  return { used_percent: 12, limit_window_seconds: 18000, reset_at: 1738300000, ...overrides };
}

function assertParseFailure(parse, body) {
  const parsed = parse(body);
  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.error, "string");
  assert.ok(parsed.error.length > 0);
}

const badNumbers = [false, [], {}, "   ", Infinity];

test("Codex validates percentages and does not hide one invalid window behind another", () => {
  for (const used_percent of [...badNumbers, -1, 101]) {
    assertParseFailure(parseUsageBody, { rate_limit: {
      primary_window: codexWindow({ used_percent }),
      secondary_window: codexWindow(),
    } });
  }
  for (const used_percent of [0, 100, "12.5"]) {
    assert.equal(parseUsageBody({ rate_limit: { primary_window: codexWindow({ used_percent }) } }).ok, true);
  }
});

test("Codex validates window length and optional reset timestamps without throwing", () => {
  for (const limit_window_seconds of [...badNumbers, null, undefined, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertParseFailure(parseUsageBody, { rate_limit: { primary_window: codexWindow({ limit_window_seconds }) } });
  }
  for (const reset_at of [...badNumbers, -1, 1e20, 8640000000001]) {
    assertParseFailure(parseUsageBody, { rate_limit: { primary_window: codexWindow({ reset_at }) } });
  }
  for (const reset_at of [undefined, null]) {
    const parsed = parseUsageBody({ rate_limit: { primary_window: codexWindow({ reset_at }) } });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.windows[0].resetsAt, null);
  }
  assert.equal(windowName(-1), null);
  assert.equal(windowName("toString"), null);
  assert.deepEqual(windowName(3600), { key: "1h", label: "1小时" });
});

test("Grok rejects invalid explicit usage instead of falling back or clamping", () => {
  for (const creditUsagePercent of [...badNumbers, -1, 101]) {
    assertParseFailure(parseGrokBilling, { config: {
      creditUsagePercent,
      productUsage: [{ product: "GrokBuild", usagePercent: 20 }],
    } });
  }
  for (const usagePercent of [...badNumbers, -1, 101]) {
    assertParseFailure(parseGrokBilling, { config: { productUsage: [{ product: "GrokBuild", usagePercent }] } });
  }
  assert.equal(parseGrokBilling({ config: { creditUsagePercent: 0 } }).windows[0].utilization, 0);
});

test("Grok invalid reset dates are explicit failures, while missing reset is optional", () => {
  for (const end of ["not-a-date", "+999999-01-01T00:00:00Z", false, 1738300000]) {
    assertParseFailure(parseGrokBilling, { config: { creditUsagePercent: 5, currentPeriod: { end } } });
  }
  const parsed = parseGrokBilling({ config: { creditUsagePercent: 5 } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.windows[0].resetsAt, null);
});

test("cash balances reject invalid values but preserve legitimate debt", () => {
  for (const value of badNumbers) {
    assertParseFailure(parseDeepSeekBalance, { balance_infos: [{ total_balance: value }] });
    assertParseFailure(parseZaiAccountReport, { data: { availableBalance: value } });
    assertParseFailure(parseDeepSeekBalance, { balance_infos: [{ total_balance: 2, granted_balance: value }] });
    assertParseFailure(parseZaiAccountReport, { data: { availableBalance: 2, frozenBalance: value } });
  }
  assert.equal(parseDeepSeekBalance({ balance_infos: [{ total_balance: "-2.5", topped_up_balance: "-2.5" }] }).balance.total, -2.5);
  assert.equal(parseZaiAccountReport({ data: { availableBalance: "-2.5" } }).balance.total, -2.5);
  assertParseFailure(parseZaiAccountReport, { data: { availableBalance: 2, frozenBalance: -1 } });
  assertParseFailure(parseZaiAccountReport, { data: { availableBalance: 2, totalSpendAmount: -1 } });
});

test("ZAI packages distinguish an explicit empty list from missing or failed data", () => {
  assert.deepEqual(parseZaiTokenPackages({ code: 200, rows: [] }), { ok: true, packages: [] });
  for (const body of [null, [], {}, { rows: null }, { rows: {} }, { code: 500, rows: [] }, { success: false, rows: [] }]) {
    assertParseFailure(parseZaiTokenPackages, body);
  }
  assert.deepEqual(parseZaiTokenPackages({ success: false, msg: "业务失败", rows: [] }), { ok: false, error: "业务失败" });
});

test("ZAI packages do not silently discard malformed rows or impossible token counts", () => {
  for (const row of [null, [], {}, { status: false }, { status: "EFFECTIVE" }]) {
    assertParseFailure(parseZaiTokenPackages, { rows: [row] });
  }
  for (const tokenBalance of [...badNumbers, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertParseFailure(parseZaiTokenPackages, { rows: [{ status: "EFFECTIVE", tokenBalance }] });
  }
  for (const tokensMagnitude of [...badNumbers, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 9]) {
    assertParseFailure(parseZaiTokenPackages, { rows: [{ status: "EFFECTIVE", tokenBalance: 10, tokensMagnitude }] });
  }
  assert.deepEqual(parseZaiTokenPackages({ rows: [{ status: "EFFECTIVE", tokenBalance: "0" }] }), {
    ok: true, packages: [{ name: "Token 资源包", remaining: 0, total: null }],
  });
});

test("zaiRouteFor rejects inherited keys and coercible objects", () => {
  for (const provider of ["toString", "constructor", "__proto__", "hasOwnProperty", ["zai"], { toString: () => "zai" }]) {
    assert.equal(zaiRouteFor(provider), null);
  }
});

test("zaiRouteFor maps providers to hosts and key refs", () => {
  assert.equal(zaiRouteFor("zai-coding-cn").base, "https://open.bigmodel.cn");
  assert.equal(zaiRouteFor("zai-coding-cn").keyRef, "ZAI_CODING_CN_API_KEY");
  assert.equal(zaiRouteFor("zai").base, "https://api.z.ai");
  assert.equal(zaiRouteFor("deepseek-official"), null);
});
