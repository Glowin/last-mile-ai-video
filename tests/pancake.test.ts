import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { TaxCategory } from "@waffo/pancake-ts";
import { PancakeError, PancakeClient, pancakeDisplayAmount, pancakeMinorAmount,
  verifyPancakePaymentEvidence, type PancakeOptions } from "../src/server/billing/pancake";
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
      chargedAmount: "29.00", amount: "29.00", taxAmount: "2.90", taxRate: 10, taxName: "Consumption Tax",
      subtotal: "26.10", total: "29.00", listPrice: { total: "29.00", subtotal: "26.10", taxAmount: "2.90", taxRate: 10, taxName: "Consumption Tax" },
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
  Object.assign(f.data, { refundedAmount: "29.00", originalChargedAmount: "29.00", taxAmount: "0.00",
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

function harness(overrides: Partial<PancakeOptions> = {}, mutateResponse?: (path: string, data: any) => any) {
  const calls: { path: string; headers: Headers; body: any }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.waffo.ai");
    const headers = new Headers(init?.headers), raw = String(init?.body);
    const canonical = `POST\n${url.pathname}\n${headers.get("x-timestamp")}\n${createHash("sha256").update(raw).digest("base64")}`;
    assert.equal(verify("RSA-SHA256", Buffer.from(canonical), merchant.publicKey,
      Buffer.from(headers.get("x-signature")!, "base64")), true, "real SDK request RSA signature");
    assert.equal(headers.get("x-merchant-id"), merchantId);
    calls.push({ path: url.pathname, headers, body: JSON.parse(raw) });
    let data: any;
    if (url.pathname === "/v1/actions/auth/issue-session-token")
      data = { token: "offline-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else if (url.pathname === "/v1/actions/checkout/create-session")
      data = { sessionId, checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else throw new Error("Unexpected SDK endpoint");
    return Response.json({ data: mutateResponse ? mutateResponse(url.pathname, data) : data });
  };
  const client = new PancakeClient({ ...scope, merchantId, privateKey: merchant.privateKey,
    successUrl: "https://example.com/billing/return",
    products: [{ productId: command.productId, providerProductId, priceVersion: command.priceVersion,
      amountMinor: 2900, currency: "USD", credits: 80, taxCategory: TaxCategory.DigitalGoods }],
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
      assert.deepEqual(c.body.priceSnapshot, { amount: "29.00", taxCategory: "digital_goods", taxIncluded: true });
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
  assert.equal(e.kind, "payment.succeeded"); assert.equal(e.amountMinor, 2900);
  assert.deepEqual(e.price, { totalMinor: 2900, subtotalMinor: 2610, taxMinor: 290 });
  assert.equal("checkoutId" in e, false); assert.equal("merchantAccountId" in e, false);
  assert.deepEqual(client.verifyPaymentEvidence(input), e, "same delivery returns stable evidence; database owns deduplication");
  const f = paymentFixture(); f.id = "850e8400-e29b-41d4-a716-446655440003";
  assert.equal(client.verifyPaymentEvidence(signed(f)).paymentId, e.paymentId, "SDK-guide delivery UUID also accepted");
});

test("full refund identifies original payment, not the refund event ID; no partial/failed refunds", () => {
  const e = verifyPancakePaymentEvidence(signed(refundFixture()), scope);
  assert.equal(e.kind, "payment.refunded"); assert.equal(e.amountMinor, 2900);
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
  assert.equal(verifyPancakePaymentEvidence(signedRaw(pretty), scope).amountMinor, 2900);
});

test("timestamp replay policy covers delayed retry and rejects stale/future/forged header variants", () => {
  assert.equal(verifyPancakePaymentEvidence(signedRaw(JSON.stringify(paymentFixture()), Date.now() - 40 * 60_000), scope).amountMinor, 2900);
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
    raw.replace('"chargedAmount":"29.00"', '"chargedAmount":"28.00","chargedAmount":"29.00"'),
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
  assert.equal(e.amountMinor, 2900);
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
