import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { TaxCategory, WaffoPancakeError, ErrorLayer } from "@waffo/pancake-ts";
import { PancakeError, PancakeClient, pancakeDisplayAmount, pancakeMinorAmount,
  verifyPancakePaymentEvidence, safePancakeDiagnosticCode, type PancakeOptions } from "../src/server/billing/pancake";
import { defaultProviders, type CheckoutCommand } from "../src/server/billing/providers";

// Offline protocol/client tests using the ACTUAL npm SDK, not sandbox acceptance.
// Fresh local RSA keys are unrelated to Waffo or any project credentials.
const keys = () => generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const platform = keys(), merchant = keys(), otherPlatform = keys();
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Real network forbidden in Pancake tests"); }; });
after(() => { globalThis.fetch = originalFetch; });
const orderId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "650e8400-e29b-41d4-a716-446655440001";
const sessionId = "cs_750e8400-e29b-41d4-a716-446655440002";
const storeId = "STO_3bVzrkD0FJjFdZNLk8Ualx";
const merchantId = "MER_2D5F8G3H1K4M6N9P0Q7R8S";
const providerProductId = "PROD_3kF9mNpQrStUvWxYz1A2bC";
const metadata = {
  kakareel_schema: "one-time-v1", kakareel_order_id: orderId, kakareel_user_id: userId,
  kakareel_product_id: "fixture-pack", kakareel_provider_product_id: providerProductId,
  kakareel_price_version: "fixture-v1",
};
const scope = { environment: "test" as const, storeId, platformPublicKey: platform.publicKey };
const command: CheckoutCommand = { orderId, userId, buyerEmail: "customer@example.com", productId: "fixture-pack",
  providerProductId, priceVersion: "fixture-v1", amountMinor: 2900, currency: "USD", credits: 80, idempotencyKey: orderId };

// Source: https://docs.waffo.ai/api-reference/webhooks#event-details (2026-10-21)
// Field vocabulary and money blocks are official structures. Local adaptations:
// test mode/current timestamp; merchant identity/external UUID/metadata are the
// documented checkout echoes. The full-success amount replaces the official
// prorated-payment example. None of these fixtures came from a sandbox purchase.
function paymentFixture(): Record<string, any> {
  return { id: "PAY_6eYCunG3IMmIgcQOnaXdoA", timestamp: new Date().toISOString(),
    eventType: "order.completed", eventId: "PAY_6eYCunG3IMmIgcQOnaXdoA", storeId, storeName: "My Store", mode: "test",
    data: { orderId: "ORD_5dXBtmF2HLlHfbPNm0Wcnz", orderStatus: "completed", buyerEmail: "customer@example.com",
      merchantProvidedBuyerIdentity: userId, orderMerchantExternalId: orderId,
      currency: "USD", orderMetadata: { ...metadata }, productMetadata: {},
      chargedAmount: "31.90", amount: "31.90", taxAmount: "2.90", taxRate: 10, taxName: "Consumption Tax",
      subtotal: "29.00", total: "31.90", listPrice: { total: "31.90", subtotal: "29.00", taxAmount: "2.90", taxRate: 10, taxName: "Consumption Tax" },
      productName: "Pro Plan", paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", paymentStatus: "succeeded",
      paymentMethod: "card", paymentLast4: "4242", paymentDate: "2026-03-10" } };
}
function refundFixture(): Record<string, any> {
  const f = paymentFixture();
  f.id = f.eventId = "REF_4cWAtlE1GKkGebONl9Xbnx";
  f.eventType = "refund.succeeded";
  delete f.data.chargedAmount;
  f.data.originalPayment = f.data.listPrice;
  delete f.data.listPrice;
  Object.assign(f.data, { refundedAmount: "31.90", originalChargedAmount: "31.90", taxAmount: "0.00",
    refundTicketMerchantExternalId: "REF-2026-00891", refundStatus: "succeeded",
    refundReason: "Customer requested refund", refundCreatedAt: "2026-03-12T09:15:00.000Z" });
  return f;
}
function signedRaw(raw: string | Uint8Array, timestamp = Date.now(), privateKey = platform.privateKey) {
  const rawBody = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
  const v1 = sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]), privateKey).toString("base64");
  return { rawBody, headers: new Headers({ "X-Waffo-Signature": `t=${timestamp},v1=${v1}` }) };
}
const signed = (f = paymentFixture()) => signedRaw(JSON.stringify(f));
const errorCode = (code: string) => (error: unknown) => error instanceof PancakeError && error.code === code;

function harness(overrides: Partial<PancakeOptions> = {}, mutateResponse?: (path: string, data: any, body?: any) => any) {
  const calls: { path: string; headers: Headers; body: any }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.waffo.ai");
    const headers = new Headers(init?.headers), raw = String(init?.body);
    if (url.pathname.endsWith("refund-ticket/create-ticket")) {
      assert.equal(headers.get("authorization"), "Bearer offline-token");
      assert.equal(headers.get("x-environment"), "test");
    } else {
      const canonical = `POST\n${url.pathname}\n${headers.get("x-timestamp")}\n${createHash("sha256").update(raw).digest("base64")}`;
      assert.equal(verify("RSA-SHA256", Buffer.from(canonical), merchant.publicKey,
        Buffer.from(headers.get("x-signature")!, "base64")), true, "real SDK request RSA signature");
      assert.equal(headers.get("x-merchant-id"), merchantId);
    }
    calls.push({ path: url.pathname, headers, body: JSON.parse(raw) });
    let data: any;
    if (url.pathname === "/v1/actions/auth/issue-session-token")
      data = { token: "offline-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else if (url.pathname === "/v1/actions/checkout/create-session")
      data = { sessionId, checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else if (url.pathname === "/v1/graphql") data = {};
    else if (url.pathname === "/v1/actions/refund-ticket/create-ticket") data = { ticket: {
      id: "TKT_fixture", status: "pending", subjectId: JSON.parse(raw).paymentId,
      refundTicketMerchantExternalId: JSON.parse(raw).refundTicketMerchantExternalId,
    } };
    else throw new Error("Unexpected SDK endpoint");
    const response = mutateResponse ? mutateResponse(url.pathname, data, JSON.parse(raw)) : data;
    return response instanceof Response ? response : Response.json({ data: response });
  };
  const client = new PancakeClient({ ...scope, merchantId, privateKey: merchant.privateKey,
    successUrl: "https://example.com/billing/return",
    products: [{ productId: command.productId, providerProductId, priceVersion: command.priceVersion,
      amountMinor: 2900, currency: "USD", credits: 80, taxCategory: TaxCategory.SaaS }],
    getOrderCreatedAt: async () => new Date(Date.now() - 60_000), fetch: transport, ...overrides });
  return { client, calls };
}

test("actual SDK sends authenticated checkout, integer price and stable idempotency; no sale registration", async () => {
  const { client, calls } = harness();
  assert.equal(defaultProviders.pancake, undefined);
  assert.equal(client.environment, "test");
  assert.equal(client.merchantId, merchantId);
  assert.equal(client.storeId, storeId);
  const first = await client.createCheckout(command);
  const second = await client.createCheckout(command);
  assert.deepEqual(first, second); // transport fixture, NOT evidence of real platform deduplication
  assert.equal(first.sessionId, sessionId);
  assert.equal(first.checkoutUrl.endsWith("#token=offline-token"), true);
  assert.deepEqual(Object.keys(first).sort(), ["checkoutUrl", "sessionId"]);
  for (const c of calls) {
    if (c.path.endsWith("issue-session-token")) {
      assert.deepEqual(c.body, { productId: providerProductId, buyerIdentity: userId });
      assert.equal(c.headers.get("x-idempotency-key"), null);
    } else {
      assert.equal(c.headers.get("x-idempotency-key"), orderId);
      assert.equal(c.body.orderMerchantExternalId, orderId);
      assert.equal(c.body.buyerEmail, command.buyerEmail);
      assert.equal(c.body.buyerIdentity, undefined);
      assert.deepEqual(c.body.priceSnapshot, { amount: "29.00", taxCategory: "saas", taxIncluded: false });
      assert.deepEqual(c.body.metadata, metadata);
      assert.equal(c.body.withTrial, undefined);
      assert.equal(c.body.successUrl, `https://example.com/billing/return?orderId=${orderId}`);
    }
    // SDK environment is NOT sent on API-key calls; key determines environment.
    assert.equal(c.headers.get("x-environment"), null);
  }
});

test("checkout refuses unknown/old durable order age and changed snapshot before any request", async () => {
  for (const createdAt of [null, new Date(NaN), new Date(Date.now() + 60_000), new Date(Date.now() - 23 * 3_600_000)]) {
    const { client, calls } = harness({ getOrderCreatedAt: async () => createdAt });
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_CHECKOUT_RECONCILIATION_REQUIRED"));
    assert.equal(calls.length, 0);
  }
  for (const change of [{ amountMinor: 2899 }, { currency: "EUR" }, { credits: 81 }, { providerProductId: "PROD_other" },
    { productId: "other" }, { priceVersion: "other" }, { idempotencyKey: userId }]) {
    const { client, calls } = harness();
    await assert.rejects(client.createCheckout({ ...command, ...change }));
    assert.equal(calls.length, 0);
  }
});

test("lost response remains unconfirmed; retry uses exactly the same order key", async () => {
  const { client, calls } = harness({}, (path, data) => {
    if (path.endsWith("create-session") && calls.filter((c) => c.path.endsWith("create-session")).length === 1)
      throw new Error("offline lost response");
    return data;
  });
  await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_CHECKOUT_UNCONFIRMED"));
  await client.createCheckout(command);
  assert.deepEqual(calls.filter((c) => c.path.endsWith("create-session")).map((c) => c.headers.get("x-idempotency-key")), [orderId, orderId]);
});

test("checkout validates real SDK response shape and hosted URL", async () => {
  for (const change of [
    { sessionId: "" }, { expiresAt: "2020-01-01T00:00:00.000Z" },
    { checkoutUrl: `http://pancake.waffo.ai/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://pancake.waffo.ai.evil.invalid/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://user@pancake.waffo.ai/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://pancake.waffo.ai:8443/store/fixture/checkout/${sessionId}` },
  ]) {
    const { client } = harness({}, (path, data) => path.endsWith("create-session") ? { ...data, ...change } : data);
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_INVALID_CHECKOUT_RESPONSE"));
  }
});

test("exact decimal conversions cover supported currencies without rounding or coercion", () => {
  for (const c of ["USD", "EUR", "GBP", "HKD", "CNY"])
    for (const n of [1, 29, 2900, 2147483647]) assert.equal(pancakeMinorAmount(pancakeDisplayAmount(n, c), c), n);
  assert.equal(pancakeDisplayAmount(4500, "JPY"), "4500");
  assert.equal(pancakeMinorAmount("4500", "JPY"), 4500);
  for (const invalid of ["1e2", "1.001", "-1", "+1", "01.00", " 1.00", "1.", ".5", "NaN", "Infinity", "21474836.48"])
    assert.throws(() => pancakeMinorAmount(invalid, "USD"));
  for (const invalid of [0, -1, 1.1, NaN, Infinity, 2147483648]) assert.throws(() => pancakeDisplayAmount(invalid, "USD"));
  assert.throws(() => pancakeMinorAmount("1.00", "JPY"));
  assert.throws(() => pancakeMinorAmount("1", "BHD"));
});

test("signed official-shaped success is evidence, never a fabricated normalized checkout", async () => {
  const { client } = harness();
  const input = signed();
  const e = client.verifyPaymentEvidence(input);
  assert.equal(e.orderId, orderId); assert.equal(e.userId, userId);
  assert.equal(e.providerOrderId, "ORD_5dXBtmF2HLlHfbPNm0Wcnz");
  assert.equal(e.paymentId, "PAY_6eYCunG3IMmIgcQOnaXdoA");
  assert.equal(e.kind, "payment.succeeded"); assert.equal(e.amountMinor, 3190);
  assert.deepEqual(e.price, { totalMinor: 3190, subtotalMinor: 2900, taxMinor: 290 });
  assert.equal("checkoutId" in e, false); assert.equal("merchantAccountId" in e, false);
  assert.deepEqual(client.verifyPaymentEvidence(input), e, "same delivery returns stable evidence; database owns deduplication");
  const f = paymentFixture(); f.id = "850e8400-e29b-41d4-a716-446655440003";
  assert.equal(client.verifyPaymentEvidence(signed(f)).paymentId, e.paymentId, "SDK-guide delivery UUID also accepted");
});

test("full refund identifies original payment, not the refund event ID; no partial/failed refunds", () => {
  const e = verifyPancakePaymentEvidence(signed(refundFixture()), scope);
  assert.equal(e.kind, "payment.refunded"); assert.equal(e.amountMinor, 3190);
  assert.equal(e.businessEventId, "REF_4cWAtlE1GKkGebONl9Xbnx");
  assert.equal(e.paymentId, "PAY_6eYCunG3IMmIgcQOnaXdoA");
  for (const mutate of [
    (f: any) => { f.data.refundedAmount = f.data.amount = "10.00"; }, // official partial-refund example
    (f: any) => { delete f.data.originalChargedAmount; },
    (f: any) => { f.data.originalChargedAmount = "30.00"; },
    (f: any) => { delete f.data.refundedAmount; },
    (f: any) => { f.eventType = "refund.failed"; f.data.refundStatus = "failed"; },
    (f: any) => { f.data.refundStatus = "processing"; },
    (f: any) => { f.data.periodNumber = 1; }, // subscription charge refund
    (f: any) => { delete f.data.paymentId; },
  ]) { const f = refundFixture(); mutate(f); assert.throws(() => verifyPancakePaymentEvidence(signed(f), scope)); }
});

test("RSA verifies exact raw body; tampering, wrong key, malformed UTF-8 and oversize fail", () => {
  const input = signed();
  assert.throws(() => verifyPancakePaymentEvidence({ ...input, rawBody: Buffer.concat([input.rawBody, Buffer.from(" ")]) }, scope));
  assert.throws(() => verifyPancakePaymentEvidence(signedRaw(JSON.stringify(paymentFixture()), Date.now(), otherPlatform.privateKey), scope));
  assert.throws(() => verifyPancakePaymentEvidence(input, { ...scope, platformPublicKey: otherPlatform.publicKey }));
  assert.throws(() => verifyPancakePaymentEvidence({ ...input, headers: new Headers() }, scope));
  assert.throws(() => verifyPancakePaymentEvidence(signedRaw(Buffer.from([0xc3, 0x28])), scope));
  assert.throws(() => verifyPancakePaymentEvidence(signedRaw(" ".repeat(262145)), scope));
  const pretty = JSON.stringify(paymentFixture(), null, 2);
  assert.equal(verifyPancakePaymentEvidence(signedRaw(pretty), scope).amountMinor, 3190);
});

test("timestamp replay policy covers delayed retry and rejects stale/future/forged header variants", () => {
  assert.equal(verifyPancakePaymentEvidence(signedRaw(JSON.stringify(paymentFixture()), Date.now() - 40 * 60_000), scope).amountMinor, 3190);
  for (const age of [46 * 60_000, -61_000])
    assert.throws(() => verifyPancakePaymentEvidence(signedRaw(JSON.stringify(paymentFixture()), Date.now() - age), scope));
  for (const age of [46 * 60_000, -61_000]) {
    const f = paymentFixture(); f.timestamp = new Date(Date.now() - age).toISOString();
    assert.throws(() => verifyPancakePaymentEvidence(signed(f), scope));
  }
  for (const transform of [
    (s: string) => `${s},t=${Date.now()}`, (s: string) => `${s},${s.split(",")[1]}`,
    (s: string) => s.replace(/^t=\d+/, "t=Infinity"), (s: string) => s.replace(/^t=\d+/, "t=1e12"),
  ]) {
    const input = signed(); input.headers.set("X-Waffo-Signature", transform(input.headers.get("X-Waffo-Signature")!));
    assert.throws(() => verifyPancakePaymentEvidence(input, scope));
  }
});

test("wrong environment/store and merchant-vs-store confusion cannot pass scope validation", () => {
  for (const change of [{ mode: "prod" }, { mode: "live" }, { storeId: "STO_other" }, { storeId: merchantId }])
    assert.throws(() => verifyPancakePaymentEvidence(signed({ ...paymentFixture(), ...change }), scope));
  const live = paymentFixture(); live.mode = "prod";
  const liveInput = signedRaw(JSON.stringify(live), Date.now(), otherPlatform.privateKey);
  assert.equal(verifyPancakePaymentEvidence(liveInput, { ...scope, environment: "live", platformPublicKey: otherPlatform.publicKey }).environment, "live");
  assert.throws(() => verifyPancakePaymentEvidence(liveInput, scope));
  const input = signed(); input.headers.set("X-Waffo-Event", "refund.succeeded");
  assert.throws(() => verifyPancakePaymentEvidence(input, scope));
});

test("no fallback from missing actual amount/identity or unsupported/partial/authorized events", () => {
  const mutations = [
    (f: any) => { delete f.data.chargedAmount; }, (f: any) => { f.data.chargedAmount = 29; },
    (f: any) => { f.data.chargedAmount = "0.00"; }, (f: any) => { f.data.chargedAmount = "28.00"; },
    (f: any) => { f.data.amount = "30.00"; }, (f: any) => { f.data.listPrice.taxAmount = "4.00"; },
    (f: any) => { delete f.data.listPrice.taxAmount; },
    (f: any) => { delete f.data.listPrice; }, (f: any) => { f.data.currency = "usd"; },
    (f: any) => { delete f.data.merchantProvidedBuyerIdentity; },
    (f: any) => { f.data.merchantProvidedBuyerIdentity = orderId; },
    (f: any) => { f.data.orderMerchantExternalId = userId; },
    (f: any) => { delete f.data.orderMerchantExternalId; }, (f: any) => { delete f.data.orderMetadata; },
    (f: any) => { f.data.paymentStatus = "authorized"; }, (f: any) => { f.data.orderStatus = "pending"; },
    (f: any) => { f.eventType = "subscription.payment_succeeded"; },
    (f: any) => { f.eventType = "payment.failed"; }, (f: any) => { f.eventType = "checkout.canceled"; },
    (f: any) => { f.eventId = "PAY_other"; }, (f: any) => { delete f.data.paymentId; },
  ];
  for (const mutate of mutations) { const f = paymentFixture(); mutate(f); assert.throws(() => verifyPancakePaymentEvidence(signed(f), scope)); }
  const { client } = harness();
  const f = paymentFixture(); f.data.orderMetadata.kakareel_provider_product_id = "PROD_other";
  assert.throws(() => client.verifyPaymentEvidence(signed(f)), errorCode("PANCAKE_PRODUCT_SNAPSHOT_MISMATCH"));
  const wrongCurrency = paymentFixture(); wrongCurrency.data.currency = "EUR";
  assert.throws(() => client.verifyPaymentEvidence(signed(wrongCurrency)), errorCode("PANCAKE_PRODUCT_SNAPSHOT_MISMATCH"));
});

test("duplicate member names and mixed/invented schemas fail even with a valid RSA signature", () => {
  const raw = JSON.stringify(paymentFixture());
  for (const duplicate of [
    raw.replace('"mode":"test"', '"mode":"prod","mode":"test"'),
    raw.replace('"mode":"test"', '"mo\\u0064e":"test","mode":"test"'),
    raw.replace('"chargedAmount":"31.90"', '"chargedAmount":"28.00","chargedAmount":"31.90"'),
    raw.replace('"kakareel_schema":"one-time-v1"', '"kakareel_schema":"other","kakareel_schema":"one-time-v1"'),
  ]) assert.throws(() => verifyPancakePaymentEvidence(signedRaw(duplicate), scope), errorCode("PANCAKE_DUPLICATE_JSON_MEMBER"));
  for (const mutate of [
    (f: any) => { f.event = f.eventType; },
    (f: any) => { f.event = f.eventType; delete f.eventType; },
    (f: any) => { f.data.originalPayment = f.data.listPrice; },
  ]) { const f = paymentFixture(); mutate(f); assert.throws(() => verifyPancakePaymentEvidence(signed(f), scope)); }
});


test("opaque provider IDs, additive fields, and extensible signature headers remain valid", () => {
  const f = paymentFixture();
  f.id = "delivery:v2:123"; f.eventId = f.data.paymentId = "charge:v2:123";
  f.data.orderId = "order:v2:123";
  f.extra = { nested: [true, false, null, 42, { future: "value" }] };
  f.data.newField = "ignored"; f.data.periodNumber = null;
  f.data.orderMetadata.futureField = "ignored";
  f.data.listPrice.futureField = "ignored";
  const input = signed(f);
  const [t, sig] = input.headers.get("X-Waffo-Signature")!.split(",");
  input.headers.set("X-Waffo-Signature", `${sig}, ${t}, v2=future`);
  const e = verifyPancakePaymentEvidence(input, scope);
  assert.equal(e.paymentId, "charge:v2:123");
  assert.equal(e.amountMinor, 3190);
  assert.equal("futureField" in e.checkoutMetadata, false);
  assert.equal("extra" in e, false);
});


test("checkout return URL carries this server order and preserves unrelated query parameters", async () => {
  const { client, calls } = harness({ successUrl: "https://example.com/billing/return?lang=en&orderId=stale&orderId=duplicate" });
  await client.createCheckout(command);
  const returned = new URL(calls.find((c) => c.path.endsWith("create-session"))!.body.successUrl);
  assert.equal(returned.pathname, "/billing/return");
  assert.deepEqual(returned.searchParams.getAll("orderId"), [orderId]);
  assert.equal(returned.searchParams.get("lang"), "en");
  assert.equal(returned.searchParams.has("status"), false);
  assert.equal(returned.searchParams.has("success"), false);
});

function recoveryFixture(): any {
  return {
    onetimeOrders: [{ id: "ORD_5dXBtmF2HLlHfbPNm0Wcnz", status: "completed", orderMerchantExternalId: orderId,
      buyer: userId, scopeStore: storeId, testMode: true, metadata: JSON.stringify(metadata) }],
    payments: [{ id: "PAY_6eYCunG3IMmIgcQOnaXdoA", orderId: "ORD_5dXBtmF2HLlHfbPNm0Wcnz", status: "succeeded",
      orderMerchantExternalId: orderId, testMode: true, periodNumber: null, createdAt: "2026-10-01T00:00:00.000Z",
      snapshotAmountDetails: { subtotal: "29.00", taxAmount: "2.90", total: "31.90", currency: "USD" },
      pspAmountDetails: { amount: "31.90", currency: "USD" }, refunds: [] }],
  };
}
function recoveryHarness(data = recoveryFixture()) {
  return harness({}, (path, current, body) => {
    if (path !== "/v1/graphql") return current;
    assert.deepEqual(body.variables, { storeId, ref: orderId });
    assert.match(body.query, /pspAmountDetails \{ amount currency \}/);
    assert.match(body.query, /testMode/);
    assert.doesNotMatch(body.query, /scopeEnvironment|buyerIdentity/);
    return data;
  });
}
test("real SDK authenticated GraphQL recovers stale callbacks from actual receipt, scoped identity and metadata", async () => {
  const stale = paymentFixture(); stale.timestamp = "2026-01-01T00:00:00.000Z";
  assert.throws(() => verifyPancakePaymentEvidence(signed(stale), scope));
  const { client, calls } = recoveryHarness();
  const result = await client.reconcile(orderId);
  assert.equal(calls.length, 1); assert.ok(calls.every((c) => c.path === "/v1/graphql"));
  assert.equal(result.length, 1); assert.equal(result[0].evidenceType, "pancake");
  assert.equal(result[0].amountMinor, 3190); assert.equal(result[0].subtotalMinor, 2900);
  assert.equal(result[0].reviewReason, null); assert.equal(result[0].eventId, "PAY_6eYCunG3IMmIgcQOnaXdoA");
  assert.equal("checkoutId" in result[0], false);
});
test("query missing channel amount cannot substitute nonzero snapshot; missing scope/schema fails closed", async () => {
  const fixture = recoveryFixture(); fixture.payments[0].pspAmountDetails = null;
  const { client } = recoveryHarness(fixture);
  const [result] = await client.reconcile(orderId);
  assert.equal(result.amountMinor, null); assert.equal(result.totalMinor, 3190);
  assert.equal(result.reviewReason, "PANCAKE_MISSING_ACTUAL_AMOUNT");
  for (const change of [{ scopeStore: "STO_other" }, { testMode: false }, { buyer: orderId }]) {
    const f = recoveryFixture(); Object.assign(f.onetimeOrders[0], change);
    await assert.rejects(recoveryHarness(f).client.reconcile(orderId));
  }

});
test("query returns successful refunds before purchases; partial refund retains actual amount for review", async () => {
  for (const amount of ["31.90", "10.00"]) {
    const f = recoveryFixture();
    f.payments[0].refunds.push({ id: "RFD_fixture", paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", testMode: true, status: "succeeded", pspAmountDetails: { amount, currency: "USD" } });
    const results = await recoveryHarness(f).client.reconcile(orderId);
    assert.equal(results[0].kind, "payment.refunded"); assert.equal(results[1].kind, "payment.succeeded");
    assert.equal(results[0].reviewReason, amount === "31.90" ? null : "PANCAKE_PARTIAL_REFUND_REVIEW");
  }
});
test("bridge preserves signed incomplete or partial financial facts as review evidence; never invents receipt", async () => {
  const { client } = harness();
  const missing = paymentFixture(); delete missing.data.chargedAmount;
  const m = client.normalizeWebhook(signed(missing));
  assert.equal(m.amountMinor, null); assert.equal(m.reviewReason, "PANCAKE_MISSING_ACTUAL_AMOUNT");
  const partial = refundFixture(); partial.data.refundedAmount = partial.data.amount = "10.00";
  const p = client.normalizeWebhook(signed(partial));
  assert.equal(p.amountMinor, 1000); assert.equal(p.originalPaidAmountMinor, 3190);
  assert.equal(p.reviewReason, "PANCAKE_PARTIAL_REFUND_REVIEW");
});
test("pinned SDK submits real customer refund ticket with stable key and full paid amount; pending is not success", async () => {
  const { client, calls } = harness();
  const refundId = "650e8400-e29b-41d4-a716-446655440012";
  const result = await client.requestRefund({ orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190, currency: "USD", requestId: refundId });
  assert.equal(result.status, "pending"); assert.equal(result.ticketId, "TKT_fixture");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, { storeId, buyerIdentity: userId });
  assert.deepEqual(calls[1].body.requestedAmount, { amount: "31.90", currency: "USD" });
  assert.equal(calls[1].body.refundTicketMerchantExternalId, refundId);
  assert.equal(calls[1].headers.get("x-idempotency-key"), refundId);
});
test("refund ticket query distinguishes failure/rejection from ambiguous/executed status; no false success", async () => {
  const refundId = "650e8400-e29b-41d4-a716-446655440012";
  for (const [status, expected] of [["pending", "pending"], ["under_review", "pending"], ["approved", "processing"], ["processing", "processing"],
    ["succeeded", "processing"], ["rejected", "rejected"], ["failed", "failed"], ["returned", "unknown"], ["cancelled", "unknown"], ["future", "unknown"]]) {
    const { client } = harness({}, (path, data) => path !== "/v1/graphql" ? data : { refundTickets: [{ id: "TKT_fixture", subjectId: "PAY_6eYCunG3IMmIgcQOnaXdoA", status,
      refundTicketMerchantExternalId: refundId, versionData: { requestedAmount: { amount: "31.90", currency: "USD" } } }] });
    assert.equal((await client.reconcileRefund({ orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190, currency: "USD", requestId: refundId })).status, expected);
  }
});

test("refund diagnostics distinguish session, submission, and response validation without exposing SDK details", async () => {
  const command = { orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190, currency: "USD", requestId: "650e8400-e29b-41d4-a716-446655440012" };
  for (const [endpoint, expected] of [["issue-session-token", "PANCAKE_REFUND_SESSION_HTTP_403"], ["create-ticket", "PANCAKE_REFUND_SUBMISSION_HTTP_403"]]) {
    const { client } = harness({}, (path, data) => {
      if (path.endsWith(endpoint)) throw new WaffoPancakeError(403, [{ message: "sensitive-provider-details-must-not-escape", layer: ErrorLayer.Gateway }]);
      return data;
    });
    await assert.rejects(client.requestRefund(command), (error: unknown) => safePancakeDiagnosticCode(error) === expected);
  }
  const { client } = harness({}, (path, data) => path.endsWith("create-ticket") ? { ticket: { ...data.ticket, subjectId: "wrong" } } : data);
  await assert.rejects(client.requestRefund(command), (error: unknown) => safePancakeDiagnosticCode(error) === "PANCAKE_REFUND_RESPONSE_MISMATCH");
  assert.equal(safePancakeDiagnosticCode(new Error("sensitive-network-details")), "PANCAKE_TRANSPORT_UNCONFIRMED");
  assert.equal(safePancakeDiagnosticCode(new PancakeError("PRIVATE_DATA")), "PANCAKE_TRANSPORT_UNCONFIRMED");
});

test("non-2xx without SDK errors envelope remains an HTTP rejection, never a fabricated ticket; no retry", async () => {
  const { client, calls } = harness({}, (path, data) => path.endsWith("create-ticket")
    ? Response.json({ error: "private-gateway-message" }, { status: 403 }) : data);
  await assert.rejects(client.requestRefund({ orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190, currency: "USD", requestId: userId }),
    (error: unknown) => safePancakeDiagnosticCode(error) === "PANCAKE_REFUND_SUBMISSION_HTTP_403");
  assert.equal(calls.filter((c) => c.path.endsWith("create-ticket")).length, 1);
});

test("refund rejects malformed or expired session responses before submitting a ticket", async () => {
  const c = { orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 1900, currency: "USD", requestId: userId };
  const future = new Date(Date.now() + 300_000).toISOString();
  for (const response of [Response.json({}), null, {}, { token: "", expiresAt: future },
    { token: "   ", expiresAt: future }, { token: 123, expiresAt: future },
    { token: "offline-token" }, { token: "offline-token", expiresAt: "invalid" },
    { token: "offline-token", expiresAt: new Date(Date.now() - 60_000).toISOString() }]) {
    const { client, calls } = harness({}, (path, data) => path.endsWith("issue-session-token") ? response : data);
    await assert.rejects(client.requestRefund(c), (error: unknown) =>
      safePancakeDiagnosticCode(error) === "PANCAKE_REFUND_SESSION_RESPONSE_MISMATCH");
    assert.deepEqual(calls.map((call) => call.path), ["/v1/actions/auth/issue-session-token"]);
  }
});

test("refund diagnostics preserve SDK origin without claiming a server HTTP rejection", async () => {
  const { client, calls } = harness();
  await assert.rejects(client.requestRefund({ orderId, userId, paymentId: "invalid-private-payment-id",
    amountMinor: 1900, currency: "USD", requestId: userId }), (error: unknown) =>
    safePancakeDiagnosticCode(error) === "PANCAKE_REFUND_SUBMISSION_SDK_REPORTED_STATUS_400");
  // The real pinned SDK rejects this payment ID before its customer transport runs.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/actions/auth/issue-session-token");

  const malformed = harness({}, (path, data) => path.endsWith("create-ticket")
    ? new Response("private non-JSON response", { status: 200 }) : data);
  await assert.rejects(malformed.client.requestRefund({ orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA",
    amountMinor: 1900, currency: "USD", requestId: userId }), (error: unknown) =>
    safePancakeDiagnosticCode(error) === "PANCAKE_REFUND_SUBMISSION_SDK_REPORTED_STATUS_200");
  // SDK also uses layer=sdk for response decoding; that layer alone never proves no submission.
  assert.equal(malformed.calls.filter((call) => call.path.endsWith("create-ticket")).length, 1);
});

test("USD19 buyer refund uses the same identity as checkout and empty ticket query stays unknown", async () => {
  const c = { orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 1900, currency: "USD", requestId: userId };
  const { client, calls } = harness({}, (path, data) => path === "/v1/graphql" ? { refundTickets: [] } : data);
  await client.requestRefund(c);
  assert.deepEqual(calls[0].body, { storeId, buyerIdentity: userId });
  assert.deepEqual(calls[1].body.requestedAmount, { amount: "19.00", currency: "USD" });
  assert.equal(calls[1].body.paymentId, c.paymentId);
  assert.equal(calls[1].headers.get("authorization"), "Bearer offline-token");
  assert.equal(calls[1].headers.get("x-environment"), "test");
  assert.deepEqual(await client.reconcileRefund(c), { ticketId: null, status: "unknown" });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].path, "/v1/graphql");
});

function refundDiagnosticFixture(): any {
  return { payment: { id: "PAY_6eYCunG3IMmIgcQOnaXdoA", status: "succeeded", testMode: true,
    orderMerchantExternalId: orderId, pspAmountDetails: { amount: "31.90", currency: "USD" },
    onetimeOrder: { storeId, testMode: true, merchantProvidedBuyerIdentity: userId, orderMerchantExternalId: orderId }, refunds: [] },
    byPayment: [], byReference: [] };
}
test("refund diagnostics use one authenticated query, expose only safe facts, and never submit or unfreeze", async () => {
  const c = { orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190, currency: "USD", requestId: userId };
  const fixture = refundDiagnosticFixture();
  const { client, calls } = harness({}, (path, data, body) => {
    if (path !== "/v1/graphql") throw new Error("Diagnosis may only query");
    assert.deepEqual(body.variables, { paymentId: c.paymentId, reference: c.requestId });
    return fixture;
  });
  const absent = await client.diagnoseRefund(c);
  assert.equal(absent.code, "PANCAKE_REFUND_NO_TICKET_OBSERVED");
  assert.equal(absent.automaticRetryAllowed, false);
  for (const secret of [orderId, userId, storeId, c.paymentId]) assert.equal(JSON.stringify(absent).includes(secret), false);
  fixture.byPayment.push({ id: "TKT_fixture", subjectId: c.paymentId, status: "pending", refundTicketMerchantExternalId: "another-reference" });
  assert.equal((await client.diagnoseRefund(c)).code, "PANCAKE_REFUND_OTHER_TICKET_OBSERVED");
  fixture.byPayment[0].refundTicketMerchantExternalId = c.requestId;
  fixture.byReference = fixture.byPayment;
  assert.equal((await client.diagnoseRefund(c)).code, "PANCAKE_REFUND_MATCHING_TICKET_OBSERVED");
  fixture.payment.testMode = false;
  assert.equal((await client.diagnoseRefund(c)).code, "PANCAKE_REFUND_DIAGNOSTIC_SCOPE_MISMATCH");
  assert.ok(calls.every((call) => call.path === "/v1/graphql"));
});
