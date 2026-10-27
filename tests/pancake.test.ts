import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { TaxCategory } from "@waffo/pancake-ts";
import { PancakeError, PancakeClient, PancakeBillingProvider, pancakeDisplayAmount, pancakeMinorAmount,
  verifyPancakePaymentEvidence, safePancakeDiagnosticCode, type PancakeOptions } from "../src/server/billing/pancake";
import { defaultProviders, type CheckoutCommand } from "../src/server/billing/providers";

// Offline protocol tests: actual npm SDK plus documented merchant refund REST.
// Signature checks run on serialized requests at the fetch boundary, not a mock SDK.
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

function harness(overrides: Partial<PancakeOptions> = {}, mutateResponse?: (path: string, data: any, body: any, headers: Headers) => any) {
  const calls: { path: string; headers: Headers; body: any; raw: string; method: string | undefined; redirect: RequestRedirect | undefined }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.waffo.ai");
    const headers = new Headers(init?.headers), raw = String(init?.body);
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-environment"), null);
    assert.equal(headers.get("x-store-slug"), null);
    const timestamp = headers.get("x-timestamp")!;
    assert.match(timestamp, /^\d+$/);
    assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) < 5);
    const canonical = `${init?.method}\n${url.pathname}\n${timestamp}\n${createHash("sha256").update(raw).digest("base64")}`;
    assert.equal(verify("RSA-SHA256", Buffer.from(canonical), merchant.publicKey,
      Buffer.from(headers.get("x-signature")!, "base64")), true, "wire request RSA signature");
    assert.equal(headers.get("x-merchant-id"), merchantId);
    calls.push({ path: url.pathname, headers, body: JSON.parse(raw), raw, method: init?.method, redirect: init?.redirect });
    let data: any;
    if (url.pathname === "/v1/actions/auth/issue-session-token")
      data = { token: "offline-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else if (url.pathname === "/v1/actions/checkout/create-session")
      data = { sessionId, checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    else if (url.pathname === "/v1/graphql") data = {};
    else if (url.pathname === "/v1/actions/refund-ticket/create-ticket") data = { ticket: {
      id: "TKT_fixture", status: "processing", subjectId: JSON.parse(raw).paymentId,
      refundTicketMerchantExternalId: JSON.parse(raw).refundTicketMerchantExternalId,
    } };
    else throw new Error("Unexpected SDK endpoint");
    const response = mutateResponse ? mutateResponse(url.pathname, data, JSON.parse(raw), headers) : data;
    return response instanceof Response ? response : Response.json({ data: response });
  };
  const options: PancakeOptions = { ...scope, merchantId, privateKey: merchant.privateKey,
    successUrl: "https://example.com/billing/return",
    products: [{ productId: command.productId, providerProductId, priceVersion: command.priceVersion,
      amountMinor: 2900, currency: "USD", credits: 80, taxCategory: TaxCategory.SaaS }],
    getOrderCreatedAt: async () => new Date(Date.now() - 60_000), fetch: transport, ...overrides };
  const client = new PancakeClient(options);
  return { client, calls, options };
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
    { sessionId: "" }, { sessionId: "cs_not-a-uuid" }, { expiresAt: "not-a-date" },
    { checkoutUrl: `http://pancake.waffo.ai/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://pancake.waffo.ai.evil.invalid/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://user@pancake.waffo.ai/store/fixture/checkout/${sessionId}` },
    { checkoutUrl: `https://pancake.waffo.ai:8443/store/fixture/checkout/${sessionId}` },
  ]) {
    const { client } = harness({}, (path, data) => path.endsWith("create-session") ? { ...data, ...change } : data);
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_INVALID_CHECKOUT_RESPONSE"));
  }
});

test("provider session IDs accept UUID-shaped hex without RFC variant/version constraints", async () => {
  // Synthetic identifiers: provider references are not our RFC UUID order IDs.
  const opaqueSession = "cs_12345678-abcd-0123-3456-123456789abc";
  const opaqueRenewal = "cs_87654321-dcba-f123-2345-cba987654321";
  const fresh = harness({}, (path, data) => path.endsWith("create-session")
    ? { ...data, sessionId: opaqueSession, checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${opaqueSession}` } : data);
  assert.equal((await fresh.client.createCheckout(command)).sessionId, opaqueSession);
  const renewed = renewalHarness({
    rootChange: checkoutReceipt(opaqueSession, new Date(Date.now() - 1000).toISOString()),
    renewalChange: checkoutReceipt(opaqueRenewal, new Date(Date.now() + 3_600_000).toISOString()),
  });
  const result = await renewed.client.createCheckout(command);
  assert.equal(result.sessionId, opaqueRenewal); assert.equal(result.replacesCheckoutId, opaqueSession);
  for (const malformed of ["cs_12345678-abcd-0123-3456-123456789abz", "cs_12345678-abcd-0123-3456-123456789ab",
    "cs_12345678abcd01233456123456789abc", `prefix-${opaqueSession}`]) {
    const invalid = renewalHarness({ rootChange: checkoutReceipt(malformed, new Date(Date.now() - 1000).toISOString()) });
    await assert.rejects(invalid.client.createCheckout(command), errorCode("PANCAKE_INVALID_CHECKOUT_RESPONSE"));
    assert.equal(invalid.calls.filter(c => c.path === "/v1/graphql").length, 0);
  }
});

const renewedSessionId = "cs_850e8400-e29b-41d4-a716-446655440003";
const checkoutReceipt = (id: string, expiresAt: string) => ({ sessionId: id,
  checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${id}`, expiresAt });
function renewalHarness(options: {
  queryResult?: unknown; rootChange?: Record<string, unknown>; renewalChange?: Record<string, unknown>;
  loseRenewalResponse?: boolean; environment?: "test" | "live"; store?: string;
} = {}) {
  let lost = false;
  const root = checkoutReceipt(sessionId, new Date(Date.now() - 1000).toISOString());
  const renewal = checkoutReceipt(renewedSessionId, new Date(Date.now() + 3_600_000).toISOString());
  return harness({ environment: options.environment ?? "test", storeId: options.store ?? storeId,
    getOrderCreatedAt: async () => new Date(Date.now() - 2 * 3_600_000) }, (path, data, body, headers) => {
    if (path === "/v1/graphql") {
      assert.deepEqual(body.variables, { storeId: options.store ?? storeId, ref: orderId });
      assert.doesNotMatch(body.query, /status\s*:/, "must query all order and payment states");
      return options.queryResult === undefined ? { onetimeOrders: [], payments: [] } : options.queryResult;
    }
    if (!path.endsWith("create-session")) return data;
    if (headers.get("x-idempotency-key") === orderId) return { ...root, ...options.rootChange };
    if (options.loseRenewalResponse && !lost) { lost = true; throw new Error("offline lost renewal response"); }
    return { ...renewal, ...options.renewalChange };
  });
}

test("expired checkout renews once under the same order with a stable scoped key, including provider retries", async () => {
  const { calls, options } = renewalHarness();
  const provider = new PancakeBillingProvider(options);
  const first = await provider.createCheckout(command), repeated = await provider.createCheckout(command);
  assert.deepEqual(first, repeated);
  assert.equal(first.checkoutId, renewedSessionId);
  assert.equal(first.replacesCheckoutId, sessionId);
  const sessions = calls.filter(c => c.path.endsWith("create-session"));
  const keys = sessions.map(c => c.headers.get("x-idempotency-key"));
  assert.equal(keys[0], orderId); assert.equal(keys[2], orderId);
  assert.match(keys[1]!, /^[0-9a-f]{64}$/); assert.equal(keys[1], keys[3]);
  assert.notEqual(keys[1], orderId);
  assert.ok(sessions.every(c => c.body.expiresInSeconds === 3600 && c.body.orderMerchantExternalId === orderId));
  assert.ok(sessions.every(c => JSON.stringify(c.body) === JSON.stringify(sessions[0].body)), "only the key changes");
  assert.equal(calls.filter(c => c.path === "/v1/graphql").length, 2);
  for (const variant of [{ environment: "live" as const }, { store: "STO_other" }]) {
    const scoped = renewalHarness(variant); await scoped.client.createCheckout(command);
    assert.notEqual(scoped.calls.filter(c => c.path.endsWith("create-session"))[1].headers.get("x-idempotency-key"), keys[1]);
  }
});

test("renewal rejects any provider record, missing arrays, GraphQL errors and unconfirmed query responses", async () => {
  const fixtures: unknown[] = [null, {}, { onetimeOrders: [] }, { payments: [] },
    { onetimeOrders: null, payments: [] }, { onetimeOrders: [], payments: {} },
    Response.json({ data: { onetimeOrders: [], payments: [] }, errors: [{ message: "offline query failed" }] }),
    Response.json({ data: { onetimeOrders: [], payments: [] } }, { status: 503 })];
  for (const status of ["pending", "failed", "canceled", "completed", "succeeded", "unknown"])
    for (const entity of ["onetimeOrders", "payments"])
      fixtures.push({ onetimeOrders: [], payments: [], [entity]: [{ id: "fixture", status }] });
  for (const queryResult of fixtures) {
    const { client, calls } = renewalHarness({ queryResult });
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_CHECKOUT_RENEWAL_BLOCKED"));
    assert.equal(calls.filter(c => c.path.endsWith("create-session")).length, 1, "no renewal write");
  }
});

test("malformed root receipts never authorize renewal and an expired replacement never recurses", async () => {
  for (const rootChange of [{ sessionId: "invalid" }, { expiresAt: "not-a-date" },
    { checkoutUrl: `https://attacker.invalid/checkout/${sessionId}` },
    { checkoutUrl: `https://pancake.waffo.ai/store/fixture/checkout/${renewedSessionId}` }]) {
    const { client, calls } = renewalHarness({ rootChange });
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_INVALID_CHECKOUT_RESPONSE"));
    assert.equal(calls.filter(c => c.path === "/v1/graphql").length, 0);
    assert.equal(calls.filter(c => c.path.endsWith("create-session")).length, 1);
  }
  const expired = renewalHarness({ renewalChange: { expiresAt: new Date(Date.now() - 1).toISOString() } });
  for (let i = 0; i < 2; i++)
    await assert.rejects(expired.client.createCheckout(command), errorCode("PANCAKE_CHECKOUT_RENEWAL_EXPIRED"));
  const keys = expired.calls.filter(c => c.path.endsWith("create-session")).map(c => c.headers.get("x-idempotency-key"));
  assert.equal(keys.length, 4); assert.equal(new Set(keys).size, 2, "no third session key");
  for (const renewalChange of [checkoutReceipt(sessionId, new Date(Date.now() + 1000).toISOString()),
    { checkoutUrl: "https://attacker.invalid/checkout" }, { expiresAt: "not-a-date" }]) {
    const { client } = renewalHarness({ renewalChange });
    await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_INVALID_CHECKOUT_RESPONSE"));
  }
});

test("lost renewal response retries the same replacement key and original checkout age cannot be reset", async () => {
  const { client, calls } = renewalHarness({ loseRenewalResponse: true });
  await assert.rejects(client.createCheckout(command), errorCode("PANCAKE_CHECKOUT_UNCONFIRMED"));
  const recovered = await client.createCheckout(command);
  assert.equal(recovered.sessionId, renewedSessionId); assert.equal(recovered.replacesCheckoutId, sessionId);
  const keys = calls.filter(c => c.path.endsWith("create-session")).map(c => c.headers.get("x-idempotency-key"));
  assert.deepEqual(keys, [orderId, keys[1], orderId, keys[1]]);
  const old = renewalHarness();
  const expiredAge = new PancakeClient({ ...old.options, getOrderCreatedAt: async () => new Date(Date.now() - 23 * 3_600_000) });
  await assert.rejects(expiredAge.createCheckout(command), errorCode("PANCAKE_CHECKOUT_RECONCILIATION_REQUIRED"));
  assert.equal(old.calls.length, 0);
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
const refundCommand = { orderId, userId, paymentId: "PAY_6eYCunG3IMmIgcQOnaXdoA", amountMinor: 3190,
  currency: "USD", requestId: "650e8400-e29b-41d4-a716-446655440012" };

test("merchant refund sends one signed POST with stable key and full paid amount; processing is not success", async () => {
  const { client, calls } = harness();
  assert.deepEqual(await client.requestRefund(refundCommand), { status: "processing", ticketId: "TKT_fixture" });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.path, "/v1/actions/refund-ticket/create-ticket");
  assert.equal(c.redirect, "error");
  assert.deepEqual(c.body, { paymentId: refundCommand.paymentId,
    reason: "Full unused credit pack refund within 14 days",
    requestedAmount: { amount: "31.90", currency: "USD" }, refundTicketMerchantExternalId: refundCommand.requestId });
  assert.equal(c.headers.get("x-idempotency-key"), refundCommand.requestId);
  // Independent negative controls: the signature binds method/path/time/body and key.
  const timestamp = c.headers.get("x-timestamp")!;
  const canonical = (method: string, path: string, time: string, raw: string) =>
    `${method}\n${path}\n${time}\n${createHash("sha256").update(raw).digest("base64")}`;
  const signature = Buffer.from(c.headers.get("x-signature")!, "base64");
  const valid = canonical(c.method!, c.path, timestamp, c.raw);
  assert.equal(verify("RSA-SHA256", Buffer.from(valid), merchant.publicKey, signature), true);
  for (const altered of [canonical("GET", c.path, timestamp, c.raw),
    canonical("POST", c.path + "-different", timestamp, c.raw),
    canonical("POST", c.path, String(Number(timestamp) + 1), c.raw),
    canonical("POST", c.path, timestamp, c.raw.replace("31.90", "19.00"))])
    assert.equal(verify("RSA-SHA256", Buffer.from(altered), merchant.publicKey, signature), false);
  assert.equal(verify("RSA-SHA256", Buffer.from(valid), otherPlatform.publicKey, signature), false);
});

test("merchant refund supports existing SDK key encodings without exposing key material", async () => {
  const pem = merchant.privateKey;
  for (const privateKey of [pem.replace(/\n/g, "\\n"),
    pem.replace(/-----[^\n]+-----/g, "").replace(/\s/g, "")]) {
    const { client, calls } = harness({ privateKey });
    assert.equal((await client.requestRefund(refundCommand)).status, "processing");
    assert.equal(calls.length, 1); // Harness cryptographically verifies each outgoing signature.
  }
});

test("refund ticket states never authorize cash reversal; query and submission agree", async () => {
  for (const [status, expected] of [["pending", "pending"], ["under_review", "pending"], ["approved", "processing"], ["processing", "processing"],
    ["succeeded", "processing"], ["rejected", "rejected"], ["failed", "failed"], ["returned", "unknown"], ["cancelled", "unknown"], ["future", "unknown"]]) {
    const ticket = { id: "TKT_fixture", subjectId: refundCommand.paymentId, status,
      refundTicketMerchantExternalId: refundCommand.requestId, versionData: { requestedAmount: { amount: "31.90", currency: "USD" } } };
    const { client } = harness({}, (path, data) => path === "/v1/graphql" ? { refundTickets: [ticket] }
      : path.endsWith("create-ticket") ? { ticket } : data);
    assert.equal((await client.requestRefund(refundCommand)).status, expected);
    assert.equal((await client.reconcileRefund(refundCommand)).status, expected);
  }
});

test("merchant refund validates identities, payment ID, amount and currency before any request", async () => {
  for (const change of [{ orderId: "private-invalid-id" }, { userId: "private-invalid-id" },
    { requestId: "private-invalid-id" }, { requestId: "x".repeat(129) }, { paymentId: "private-invalid-id" },
    { paymentId: "ORD_6eYCunG3IMmIgcQOnaXdoA" }, { amountMinor: 0 }, { amountMinor: -1 },
    { amountMinor: 19.5 }, { amountMinor: 2_147_483_648 }, { amountMinor: NaN }, { currency: "usd" }, { currency: "ZZZ" }]) {
    const { client, calls } = harness();
    await assert.rejects(client.requestRefund({ ...refundCommand, ...change }), errorCode("PANCAKE_REFUND_INVALID_COMMAND"));
    assert.equal(calls.length, 0);
  }
});

test("HTTP 403 remains a safe status for JSON, non-JSON and misleading success bodies; never retry", async () => {
  const secret = "private-provider-message-must-not-escape";
  for (const response of [Response.json({ errors: [{ message: secret, layer: "gateway" }] }, { status: 403 }),
    Response.json({ error: secret }, { status: 403 }), new Response(secret, { status: 403 }),
    Response.json({ data: { ticket: { id: "TKT_fixture", subjectId: refundCommand.paymentId,
      refundTicketMerchantExternalId: refundCommand.requestId, status: "succeeded" } } }, { status: 403 })]) {
    const { client, calls } = harness({}, () => response);
    await assert.rejects(client.requestRefund(refundCommand), (error: unknown) => {
      assert.ok(error instanceof PancakeError);
      assert.equal(safePancakeDiagnosticCode(error), "PANCAKE_REFUND_SUBMISSION_HTTP_403");
      assert.doesNotMatch(String(error) + JSON.stringify(error), /private-provider|gateway|PAY_|TKT_/);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("merchant refund does not retry server errors, redirects or transport failures", async () => {
  for (const status of [302, 409, 500, 503]) {
    const { client, calls } = harness({}, () => new Response("private-response", { status }));
    await assert.rejects(client.requestRefund(refundCommand), errorCode(`PANCAKE_REFUND_SUBMISSION_HTTP_${status}`));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "error");
  }
  const { client, calls } = harness({}, () => { throw new Error("private-network-details"); });
  await assert.rejects(client.requestRefund(refundCommand), errorCode("PANCAKE_REFUND_SUBMISSION_TRANSPORT_UNCONFIRMED"));
  assert.equal(calls.length, 1);
});

test("merchant refund rejects malformed, missing or mismatched envelopes without leaking response data", async () => {
  const valid = { id: "TKT_fixture", subjectId: refundCommand.paymentId,
    refundTicketMerchantExternalId: refundCommand.requestId, status: "processing" };
  for (const response of [new Response("private non-JSON response", { status: 200 }), Response.json({}),
    Response.json(null), Response.json({ data: null }), Response.json({ data: {} }),
    ...[{ id: "" }, { subjectId: "wrong" }, { refundTicketMerchantExternalId: "wrong" }, { status: null }]
      .map(change => Response.json({ data: { ticket: { ...valid, ...change } } }))]) {
    const { client, calls } = harness({}, () => response);
    await assert.rejects(client.requestRefund(refundCommand), errorCode("PANCAKE_REFUND_RESPONSE_MISMATCH"));
    assert.equal(calls.length, 1);
  }
  const { client, calls } = harness({}, () => Response.json({ data: { ticket: valid },
    errors: [{ message: "private-server-error", layer: "refund" }] }));
  await assert.rejects(client.requestRefund(refundCommand), (error: unknown) => {
    assert.equal(safePancakeDiagnosticCode(error), "PANCAKE_REFUND_SUBMISSION_API_ERROR");
    assert.doesNotMatch(String(error), /private-server-error/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(safePancakeDiagnosticCode(new Error("private-network-details")), "PANCAKE_TRANSPORT_UNCONFIRMED");
  assert.equal(safePancakeDiagnosticCode(new PancakeError("PRIVATE_DATA")), "PANCAKE_TRANSPORT_UNCONFIRMED");
});

test("USD19 merchant refund uses paid amount and empty ticket query stays unknown", async () => {
  const c = { ...refundCommand, amountMinor: 1900 };
  const { client, calls } = harness({}, (path, data) => path === "/v1/graphql" ? { refundTickets: [] } : data);
  await client.requestRefund(c);
  assert.deepEqual(calls[0].body.requestedAmount, { amount: "19.00", currency: "USD" });
  assert.equal(calls[0].body.paymentId, c.paymentId);
  assert.equal(calls[0].body.buyerIdentity, undefined);
  assert.deepEqual(await client.reconcileRefund(c), { ticketId: null, status: "unknown" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/v1/graphql");
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
