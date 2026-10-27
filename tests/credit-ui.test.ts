import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, generationRequestId, billingMoney, paidGenerationAllowed, prepareStarterCheckout, starterCheckoutEnvironment, starterCheckoutProvider, usableGenerationQuote, IDENTITY_CHANGED_KEY, type GenerationQuote } from "../src/lib/api";
import { generationSchema } from "../src/server/input";
import { pendingRequestId } from "../src/lib/pending-request";
import { createHash } from "node:crypto";
import { STARTER_CREDIT_OFFER } from "../src/lib/credit-offer";
import { VIDEO_CREDIT_RATES, videoCredits } from "../src/lib/video-credit-rates";
import type { BillingCatalogResponse, BillingOrder, BillingSummaryResponse } from "../src/lib/billing";

function catalog(): BillingCatalogResponse & { providers: { id: "pancake"; available: boolean; environment: "test" | "live" }[] } {
  return { mode: "one-time-credits", environment: "live", checkoutEnabled: true,
    products: [{ id: "credits-starter", name: "Starter Pack", description: "", credits: 150,
      price: { amountMinor: 1900, currency: "USD" }, available: true,
      purchaseType: "one_time", taxBehavior: "exclusive", expiresAt: null, refundWindowDays: 14 }],
    providers: [{ id: "pancake", available: true, environment: "live" }] };
}
const quote: GenerationQuote = { quoteId: "quote-test", credits: 160, priceVersion: "video-test", available: true, expiresAt: "2026-10-23T12:05:00.000Z" };
const now = Date.parse("2026-10-23T12:00:00.000Z");
const summary: BillingSummaryResponse = { balanceCredits: 150, availableCredits: 150, reservedCredits: 0,
  testBalanceCredits: 1000, testAvailableCredits: 1000, testReservedCredits: 0,
  blocked: false, testBlocked: false, checkoutEnabled: false, generationChargingEnabled: true, previewAccess: false };

function browser() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const original = global.fetch;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  return { values, restore() {
    global.fetch = original;
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  } };
}

test("catalog is required and every sale gate fails closed", () => {
  assert.equal(starterCheckoutProvider(null), null);
  assert.equal(starterCheckoutProvider(catalog()), "pancake");
  for (const edit of [
    (c: BillingCatalogResponse) => { c.checkoutEnabled = false; },
    (c: BillingCatalogResponse) => { c.products[0].available = false; },
    (c: BillingCatalogResponse) => { c.providers[0].available = false; },
    (c: BillingCatalogResponse) => { c.products[0].credits = 149; },
    (c: BillingCatalogResponse) => { c.products[0].price!.amountMinor = 2000; },
    (c: BillingCatalogResponse) => { c.products[0].price!.currency = "EUR"; },
    (c: BillingCatalogResponse) => { c.products[0].id = "unpublished-sku"; },
  ]) {
    const value = catalog(); edit(value);
    assert.equal(starterCheckoutProvider(value), null);
  }
  assert.equal(STARTER_CREDIT_OFFER.expiresAfterDays, null);
});

test("160-credit quote cannot use the 150-credit starter balance or sandbox credits", () => {
  assert.equal(usableGenerationQuote(quote, now), true);
  assert.equal(paidGenerationAllowed(summary, quote, now), false);
  const sufficient = { ...summary, availableCredits: 160 };
  assert.equal(paidGenerationAllowed(sufficient, quote, now), true);
  assert.equal(paidGenerationAllowed({ ...sufficient, blocked: true }, quote, now), false);
  assert.equal(paidGenerationAllowed({ ...sufficient, generationChargingEnabled: false }, quote, now), false);
  assert.equal(paidGenerationAllowed(sufficient, quote, now + 300_000), false);
  assert.equal(paidGenerationAllowed(sufficient, { ...quote, available: false }, now), false);
  assert.equal(paidGenerationAllowed(sufficient, { ...quote, expiresAt: "invalid" }, now), false);
  assert.equal(paidGenerationAllowed(sufficient, { ...quote, credits: NaN }, now), false);
  assert.equal(paidGenerationAllowed(null, quote, now), false);
  assert.equal(videoCredits({ family: "seedance", mode: "image", resolution: "1080p", duration: 10 }), null);
  assert.equal(videoCredits({ family: "seedance", mode: "text", resolution: "480p", duration: 5 }), null);
});

test("unknown tax and paid amount are never displayed as zero", () => {
  assert.equal(billingMoney(null, "USD"), "Not confirmed");
  assert.equal(billingMoney(undefined, "USD"), "Not confirmed");
  assert.equal(billingMoney(0, "USD"), "$0.00");
  assert.equal(billingMoney(1900, "USD"), "$19.00");
  assert.equal(billingMoney(2052, "USD"), "$20.52");
});

test("closed catalog never creates an order or a local checkout attempt", async () => {
  const state = browser();
  const calls: string[] = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return Response.json({ ...catalog(), checkoutEnabled: false });
  };
  try {
    await assert.rejects(prepareStarterCheckout("alice"), /Not yet on sale/);
    assert.deepEqual(calls, ["/api/billing/catalog"]);
    assert.equal(state.values.size, 0);
  } finally { state.restore(); }
});

test("checkout reuses uncertain requests, supports repeat purchases, and binds the owner", async () => {
  const state = browser();
  const requests: string[] = [];
  let lost = true;
  let orders: BillingOrder[] = [];
  global.fetch = async (url, init) => {
    if (url === "/api/billing/catalog") return Response.json(catalog());
    assert.equal((init?.headers as Record<string, string>)["X-KakaReel-Owner"], "alice");
    if (url === "/api/billing/orders") return Response.json({ orders });
    assert.equal(url, "/api/billing/checkout");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(Object.keys(body).sort(), ["productId", "provider", "requestId"]);
    assert.equal(body.productId, "credits-starter");
    requests.push(body.requestId);
    if (lost) { lost = false; throw new Error("Connection interrupted"); }
    return Response.json({ order: { id: "order-one" }, checkoutUrl: "https://checkout.example.test/order-one" });
  };
  try {
    await assert.rejects(prepareStarterCheckout("alice"), /Connection interrupted/);
    await prepareStarterCheckout("alice");
    assert.equal(requests[0], requests[1]);
    orders = [{ id: "order-one", status: "paid" } as BillingOrder];
    await prepareStarterCheckout("alice");
    assert.notEqual(requests[1], requests[2]);
  } finally { state.restore(); }
});

test("identity change during catalog lookup prevents checkout and order reads", async () => {
  const state = browser();
  const calls: string[] = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    state.values.set(IDENTITY_CHANGED_KEY, "bob");
    return Response.json(catalog());
  };
  try {
    await assert.rejects(prepareStarterCheckout("alice"), /account changed/);
    assert.deepEqual(calls, ["/api/billing/catalog"]);
    assert.equal([...state.values.keys()].some((key) => key.startsWith("kr_checkout:")), false);
  } finally { state.restore(); }
});

test("private live checkout uses the server request across retries and lost local storage", async () => {
  const state = browser();
  const requestId = "11111111-1111-4111-8111-111111111111";
  const attempts: string[] = [];
  global.fetch = async (url, init) => {
    assert.equal((init?.headers as Record<string, string>)["X-KakaReel-Owner"], "alice");
    if (url === "/api/billing/pilot") return Response.json({ catalog: catalog(), requestId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    if (url === "/api/billing/orders") return Response.json({ orders: [] });
    assert.equal(url, "/api/billing/checkout");
    attempts.push(JSON.parse(String(init?.body)).requestId);
    if (attempts.length === 1) throw new Error("Lost response");
    return Response.json({ order: { id: "pilot-order" }, checkoutUrl: "https://checkout.example.test/pilot" });
  };
  try {
    await assert.rejects(prepareStarterCheckout("alice", true), /Lost response/);
    state.values.clear();
    await prepareStarterCheckout("alice", true);
    assert.deepEqual(attempts, [requestId, requestId]);
  } finally { state.restore(); }
});

test("unavailable or expired private checkout cannot fall back to public checkout", async () => {
  const state = browser();
  try {
    for (const offer of [
      { catalog: null, requestId: null, expiresAt: null },
      { catalog: catalog(), requestId: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(0).toISOString() },
    ]) {
      const calls: string[] = [];
      global.fetch = async (url) => { calls.push(String(url)); return Response.json(offer); };
      await assert.rejects(prepareStarterCheckout("alice", true), /payment check is not available/);
      assert.deepEqual(calls, ["/api/billing/pilot"]);
    }
  } finally { state.restore(); }
});

test("refund and quote responses from a replaced account are discarded", async () => {
  const state = browser();
  try {
    for (const path of ["/billing/orders/order-one/refund", "/jobs/quote"]) {
      state.values.set(IDENTITY_CHANGED_KEY, "alice");
      let mutations = 0;
      global.fetch = async (_url, init) => {
        mutations++;
        assert.equal((init?.headers as Record<string, string>)["X-KakaReel-Owner"], "alice");
        state.values.set(IDENTITY_CHANGED_KEY, "bob");
        return Response.json({ refundStatus: "pending", ...quote });
      };
      await assert.rejects(api(path, { method: "POST", headers: { "X-KakaReel-Owner": "alice" }, body: "{}" }), /account changed/);
      assert.equal(mutations, 1);
    }
  } finally { state.restore(); }
});

test("pricing renders the actual eight rates, published offer and closed-sale state without effects", () => {
  const require = createRequire(import.meta.url);
  const previous = require.extensions[".css"];
  // SSR has no CSS loader. This replaces style tokens only, not React or product logic.
  require.extensions[".css"] = (module) => { module.exports = {}; };
  try {
    const { PricingPanel } = require("../src/components/pricing-panel.tsx");
    const html = renderToStaticMarkup(createElement(PricingPanel));
    assert.match(html, /US\$19/);
    assert.match(html, /applicable taxes/);
    assert.match(html, /150/);
    assert.match(html, /Not yet on sale/);
    assert.match(html, /No expiry/);
    assert.match(html, /No automatic renewal/);
    assert.match(html, /14-day refund/);
    assert.equal((html.match(/<tr>/g) ?? []).length, VIDEO_CREDIT_RATES.length + 1);
    for (const rate of VIDEO_CREDIT_RATES) assert.ok(html.includes(`<td>${rate.credits}</td>`));
    assert.match(html, /Image-to-video pricing is not yet verified/);
    assert.match(html, /Save completed videos to your device/);
  } finally {
    if (previous) require.extensions[".css"] = previous;
    else delete require.extensions[".css"];
  }
});

test("quote and submission use one stable request ID; refreshed quotes never create a new generation intent", async () => {
  const state = browser();
  const payload = { family: "seedance", mode: "text", prompt: "A bird in motion", duration: 5,
    resolution: "720p", ratio: "16:9", audio: false };
  try {
    const requestId = await generationRequestId("alice", payload, "paid");
    const quoteInput = generationSchema.parse({ ...payload, requestId });
    const retryRequestId = await generationRequestId("alice", payload, "paid");
    const submission = { ...payload, requestId: retryRequestId, billingMode: "paid", quoteId: "fresh-quote" };
    const { billingMode: _billing, quoteId: _quote, ...submittedInput } = submission;
    assert.deepEqual(generationSchema.parse(submittedInput), quoteInput);
    assert.equal(retryRequestId, requestId);
    assert.notEqual(await generationRequestId("bob", payload, "paid"), requestId);
    assert.notEqual(await generationRequestId("alice", { ...payload, audio: true }, "paid"), requestId);
  } finally { state.restore(); }
});

test("preview submission preserves an unacknowledged request from before paid mode was added", async () => {
  const state = browser();
  const payload = { family: "seedance", mode: "text", prompt: "A bird", duration: 5,
    resolution: "720p", ratio: "16:9", audio: false };
  try {
    const oldDigest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const previousRequest = pendingRequestId("guest", oldDigest);
    assert.equal(await generationRequestId("guest", payload, "preview"), previousRequest);
    assert.notEqual(await generationRequestId("guest", payload, "paid"), previousRequest);
  } finally { state.restore(); }
});

test("sandbox availability is identified separately from a live sale; unknown environments cannot checkout", () => {
  const value = catalog();
  value.providers[0].environment = "test";
  value.environment = "test";
  assert.equal(starterCheckoutEnvironment(value), "test");
  assert.equal(starterCheckoutProvider(value), "pancake");
  const unknown = { ...value, providers: [{ id: "pancake", available: true, environment: null }] } as BillingCatalogResponse;
  assert.equal(starterCheckoutEnvironment(unknown), null);
  assert.equal(starterCheckoutProvider(unknown), null);
});

test("rendered sandbox action says no real payment and never advertises an open sale", () => {
  const require = createRequire(import.meta.url);
  const previous = require.extensions[".css"];
  require.extensions[".css"] = (module) => { module.exports = {}; };
  try {
    const { StarterPackAction } = require("../src/components/pricing-panel.tsx");
    const value = catalog();
    value.environment = "test";
    value.providers[0].environment = "test";
    const html = renderToStaticMarkup(createElement(StarterPackAction, { catalog: value }));
    assert.match(html, /Test mode/);
    assert.match(html, /No real payment/);
    assert.match(html, /Not yet on sale/);
    assert.doesNotMatch(html, /Available to purchase/);
    assert.match(html, /View test checkout in your account/);
  } finally {
    if (previous) require.extensions[".css"] = previous;
    else delete require.extensions[".css"];
  }
});
