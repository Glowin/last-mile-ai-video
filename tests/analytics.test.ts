import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirstTouch, parseFirstTouch, serializeFirstTouch, gaPageLocation, shouldReplaceFirstTouch,
  cleanParam, FIRST_TOUCH_MAX_AGE_SECONDS } from "../src/lib/attribution";
import { generationEventParams } from "../src/lib/analytics-client";
import { measurementProtocolConfig, mpBody, sendMeasurementProtocol } from "../src/server/analytics/measurement-protocol";
import { purchaseEvent, dispatchPaidPurchases } from "../src/server/analytics/purchases";
import { reportInput } from "../scripts/attribution-report";

const NOW = Date.UTC(2026, 9, 28, 4);

test("first touch keeps campaign tags, referral code, referrer host, path and click-ID type only", () => {
  const t = buildFirstTouch(
    "https://kakareel.com/pricing?utm_source=X&utm_medium=Social&utm_campaign=launch_oct&utm_content=a&utm_term=ai+video&ref=Friend1&gclid=SECRET-CLICK&token=abc&code=123#frag",
    "https://www.t.co/abc?x=1", NOW)!;
  assert.deepEqual(t, { v: 1, utm_source: "x", utm_medium: "social", utm_campaign: "launch_oct", utm_content: "a", utm_term: "ai video",
    ref: "friend1", referrer_host: "t.co", landing_path: "/pricing", click_id: "gclid", ts: Math.floor(NOW / 1000) });
  const raw = JSON.stringify(t);
  for (const secret of ["SECRET-CLICK", "abc", "123", "frag", "x=1"]) assert.ok(!raw.includes(secret), secret);
  // Own-site navigation is not a referral; emails are never kept.
  const own = buildFirstTouch("https://kakareel.com/?utm_source=me@example.com", "https://kakareel.com/create", NOW)!;
  assert.equal(own.referrer_host, null);
  assert.equal(own.utm_source, null);
  assert.equal(cleanParam("x".repeat(500))!.length, 100);
});

test("first-touch cookie parsing is strict and bounded", () => {
  const t = buildFirstTouch("https://kakareel.com/?utm_source=newsletter", "", NOW)!;
  assert.deepEqual(parseFirstTouch(serializeFirstTouch(t), NOW), t);
  assert.equal(parseFirstTouch("not-json", NOW), null);
  assert.equal(parseFirstTouch(encodeURIComponent(JSON.stringify({ ...t, v: 2 })), NOW), null);
  assert.equal(parseFirstTouch(encodeURIComponent(JSON.stringify({ ...t, ts: t.ts + 3 * 86400 })), NOW), null);
  assert.equal(parseFirstTouch(encodeURIComponent(JSON.stringify({ ...t, ts: t.ts - FIRST_TOUCH_MAX_AGE_SECONDS - 2 * 86400 })), NOW), null);
  assert.equal(parseFirstTouch("x".repeat(3000), NOW), null);
  const hostile = parseFirstTouch(encodeURIComponent(JSON.stringify({ ...t, referrer_host: "evil.com/<script>", click_id: "token",
    landing_path: "/a?token=1", email: "a@b.c", utm_campaign: { $ne: 1 } })), NOW)!;
  assert.equal(hostile.referrer_host, null);
  assert.equal(hostile.click_id, null);
  assert.equal(hostile.landing_path, "/a");
  assert.equal(hostile.utm_campaign, null);
  assert.ok(!("email" in hostile));
});

test("a direct first visit is upgraded by a later tagged visit, never the reverse", () => {
  const direct = buildFirstTouch("https://kakareel.com/", "", NOW)!;
  const tagged = buildFirstTouch("https://kakareel.com/?utm_source=x", "", NOW)!;
  const other = buildFirstTouch("https://kakareel.com/?utm_source=google", "", NOW)!;
  assert.equal(shouldReplaceFirstTouch(null, direct), true);
  assert.equal(shouldReplaceFirstTouch(direct, tagged), true);
  assert.equal(shouldReplaceFirstTouch(tagged, other), false);
  assert.equal(shouldReplaceFirstTouch(tagged, direct), false);
});

test("GA page_location keeps utm_* but drops tokens, codes, preview codes and fragments", () => {
  assert.equal(gaPageLocation("https://kakareel.com/create?utm_source=x&utm_campaign=Launch&code=SECRET&preview=P1&token=t&utm_id=7#a"),
    "https://kakareel.com/create?utm_source=x&utm_campaign=launch&utm_id=7");
  assert.equal(gaPageLocation("https://kakareel.com/billing/return?order=1&session_id=s"), "https://kakareel.com/billing/return");
});

test("generate_video params are an allowlist without the prompt", () => {
  const p = generationEventParams({ id: "j", family: "seedance", mode: "text", duration: 5, resolution: "720p",
    billingMode: "paid", credits: 30, prompt: "my private idea", image: "data:..." } as never);
  assert.deepEqual(p, { model: "seedance", generation_mode: "text", duration_seconds: 5, resolution: "720p", billing_mode: "paid", credits: 30 });
  assert.ok(!JSON.stringify(p).includes("private"));
});

test("Measurement Protocol is disabled unless GA_MEASUREMENT_ID and GA_API_SECRET are set", async () => {
  assert.equal(measurementProtocolConfig({}), null);
  assert.equal(measurementProtocolConfig({ GA_MEASUREMENT_ID: "G-ABC123" }), null);
  assert.equal(measurementProtocolConfig({ GA_API_SECRET: "fictional" }), null);
  assert.equal(measurementProtocolConfig({ GA_MEASUREMENT_ID: "UA-1", GA_API_SECRET: "fictional" }), null);
  assert.deepEqual(measurementProtocolConfig({ GA_MEASUREMENT_ID: "G-ABC123", GA_API_SECRET: "fictional", GA_MP_DEBUG: "true" }),
    { measurementId: "G-ABC123", apiSecret: "fictional", debugMode: true });
  const saved = { id: process.env.GA_MEASUREMENT_ID, secret: process.env.GA_API_SECRET };
  delete process.env.GA_MEASUREMENT_ID; delete process.env.GA_API_SECRET;
  try { assert.deepEqual(await dispatchPaidPurchases(), { disabled: true }); }
  finally {
    if (saved.id !== undefined) process.env.GA_MEASUREMENT_ID = saved.id;
    if (saved.secret !== undefined) process.env.GA_API_SECRET = saved.secret;
  }
});

test("purchase payload uses the order id, pre-tax value, USD and one item; ads signals denied", async () => {
  const event = purchaseEvent({ id: "0b8f7d1e-0000-4000-8000-000000000001", productId: "credits-starter", productName: "Starter Pack",
    subtotalMinor: 1900, taxMinor: 152, currency: "USD" });
  assert.deepEqual(event, { name: "purchase", params: { transaction_id: "0b8f7d1e-0000-4000-8000-000000000001", value: 19, currency: "USD", tax: 1.52,
    items: [{ item_id: "credits-starter", item_name: "Starter Pack", price: 19, quantity: 1 }] } });
  const config = { measurementId: "G-ABC123", apiSecret: "fictional-secret", debugMode: true };
  const body = mpBody("123.456", [event], config, 1_000);
  assert.equal(body.non_personalized_ads, true);
  assert.deepEqual(body.consent, { ad_user_data: "DENIED", ad_personalization: "DENIED" });
  assert.equal(body.events[0].params.debug_mode, 1);
  assert.equal(body.timestamp_micros, 1_000);
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => { calls.push({ url: String(url), body: String(init.body) }); return new Response(null, { status: 204 }); }) as typeof fetch;
  assert.equal(await sendMeasurementProtocol(config, "123.456", [event], { fetchImpl }), true);
  assert.equal(await sendMeasurementProtocol(config, "not-a-ga-id", [event], { fetchImpl }), false);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=G-ABC123&api_secret="));
  assert.ok(!calls[0].body.includes("fictional-secret"));
});

test("report CLI arguments are validated", () => {
  assert.equal(reportInput.parse({ from: "2026-10-01", to: "2026-10-28" }).tz, "Asia/Shanghai");
  assert.equal(reportInput.safeParse({ from: "2026-10-28", to: "2026-10-01" }).success, false);
  assert.equal(reportInput.safeParse({ from: "2026-10-01", to: "2026-10-28", tz: "Mars/Base" }).success, false);
  assert.equal(reportInput.safeParse({ from: "2026-10-01", to: "2026-10-28", group: "email" }).success, false);
});
