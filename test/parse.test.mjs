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

test("parseGrokBilling treats omitted weekly percent as 0", () => {
  const parsed = parseGrokBilling({
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-17T09:34:57.639Z" },
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.windows[0].utilization, 0);
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
  const packages = parseZaiTokenPackages({
    code: 200,
    rows: [
      { resourcePackageName: "体验包", tokenBalance: 5000000, tokensMagnitude: 5000000, status: "EFFECTIVE" },
      { resourcePackageName: "已过期", tokenBalance: 20, tokensMagnitude: 20, status: "EXPIRED" },
      { tokenBalance: 100, tokensMagnitude: 100, status: "EFFECTIVE" },
    ],
  });
  assert.equal(packages.length, 2);
  assert.equal(packages[0].remaining, 5000000);
  assert.equal(packages[0].total, 5000000);
  assert.equal(packages[1].remaining, 100);
});

test("zaiRouteFor maps providers to hosts and key refs", () => {
  assert.equal(zaiRouteFor("zai-coding-cn").base, "https://open.bigmodel.cn");
  assert.equal(zaiRouteFor("zai-coding-cn").keyRef, "ZAI_CODING_CN_API_KEY");
  assert.equal(zaiRouteFor("zai").base, "https://api.z.ai");
  assert.equal(zaiRouteFor("deepseek-official"), null);
});
