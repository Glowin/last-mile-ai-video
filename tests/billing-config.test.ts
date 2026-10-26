import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { billingOptionsFromEnvironment, productionBillingRelease } from "../src/server/billing/config";
import { BillingError, BillingService } from "../src/server/billing/service";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", BILLING_TEST_ENABLED: "true", BILLING_DEPLOYMENT_MODE: "isolated-test",
    BILLING_TEST_APP_ORIGIN: "https://localhost:3443", APP_URL: "https://localhost:3443",
    DATABASE_URL: "postgresql://fixture_billing_test@127.0.0.1/fixture_billing_sandbox",
    PANCAKE_TEST_MERCHANT_ID: "MER_2D5F8G3H1K4M6N9P0Q7R8S", PANCAKE_TEST_STORE_ID: "STO_3bVzrkD0FJjFdZNLk8Ualx", PANCAKE_TEST_PRODUCT_ID: "PROD_3kF9mNpQrStUvWxYz1A2bC",
    PANCAKE_TEST_PRIVATE_KEY: keys.privateKey, PANCAKE_TEST_PLATFORM_PUBLIC_KEY: keys.publicKey };
}
test("default price is public but no environment variable enables live collection", () => {
  const service = new BillingService(billingOptionsFromEnvironment({ NODE_ENV: "test", BILLING_LIVE_ENABLED: "true" }));
  const catalog = service.catalog();
  assert.equal(catalog.checkoutEnabled, false); assert.equal(catalog.environment, null);
  assert.equal(catalog.products.length, 1); assert.equal(catalog.products[0].price?.amountMinor, 1900);
  assert.equal(catalog.products[0].credits, 150); assert.equal(catalog.products[0].purchaseType, "one_time");
  assert.equal(catalog.products[0].taxBehavior, "exclusive"); assert.equal(catalog.products[0].expiresAt, null);
  assert.equal(catalog.products[0].refundWindowDays, 14);
});
test("server-only test registration requires isolated database/role/origin and explicit platform public key", () => {
  const options = billingOptionsFromEnvironment(environment());
  assert.equal(options.providers?.pancake?.environment, "test");
  assert.equal(typeof options.assertIsolation, "function");
  const catalog = new BillingService(options).catalog();
  assert.equal(catalog.environment, "test"); assert.equal(catalog.checkoutEnabled, true);
  for (const override of [
    { BILLING_DEPLOYMENT_MODE: "production" }, { DATABASE_URL: "postgresql://fixture@127.0.0.1/production" },
    { DATABASE_URL: "postgresql://fixture_billing_test@127.0.0.1/production" },
    { DATABASE_URL: "postgresql://fixture@127.0.0.1/fixture_billing_sandbox" },
    { APP_URL: "https://different.invalid" }, { APP_URL: "http://localhost:3443" },
    { PANCAKE_TEST_PLATFORM_PUBLIC_KEY: "", WAFFO_WEBHOOK_PUBLIC_KEY: keys.publicKey },
    { PANCAKE_TEST_PRODUCT_ID: "" },
  ]) assert.throws(() => billingOptionsFromEnvironment({ ...environment(), ...override }));
});

// No real credentials, network, database or checkout in these release-policy tests.
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Network forbidden in billing config tests"); }; });
after(() => { globalThis.fetch = originalFetch; });
const approvedFixture = Object.freeze({ liveSalesApproved: true });
const liveKeys = generateKeyPairSync("rsa", { modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
function liveEnvironment(): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", BILLING_LIVE_ENABLED: "true", BILLING_DEPLOYMENT_MODE: "production",
    BILLING_LIVE_APP_ORIGIN: "https://billing.example.invalid", APP_URL: "https://billing.example.invalid",
    DATABASE_URL: "postgresql://fixture_live@127.0.0.1/fixture_live",
    PANCAKE_LIVE_MERCHANT_ID: "MER_3D5F8G3H1K4M6N9P0Q7R8S", PANCAKE_LIVE_STORE_ID: "STO_4bVzrkD0FJjFdZNLk8Ualx",
    PANCAKE_LIVE_PRODUCT_ID: "PROD_4kF9mNpQrStUvWxYz1A2bC", PANCAKE_LIVE_PRIVATE_KEY: liveKeys.privateKey,
    PANCAKE_LIVE_PLATFORM_PUBLIC_KEY: liveKeys.publicKey };
}
const user = { id: randomUUID(), googleSub: "offline-fixture", email: "fixture@example.invalid",
  name: null, invitedAt: null, ageConfirmedAt: null, agePolicyVersion: null, createdAt: new Date() };
const checkoutInput = { productId: "starter-pack", provider: "pancake" as const, requestId: randomUUID() };
const billingCode = (code: string) => (e: unknown) => e instanceof BillingError && e.code === code;

test("complete live configuration and env approval lookalikes cannot override the shipped OFF release", () => {
  assert.equal(productionBillingRelease.liveSalesApproved, false);
  assert.equal(Object.isFrozen(productionBillingRelease), true);
  const defaultCatalog = new BillingService(billingOptionsFromEnvironment({ NODE_ENV: "production" })).catalog();
  for (const NODE_ENV of ["production", "test", "development"] as const) {
    const options = billingOptionsFromEnvironment({ ...liveEnvironment(), NODE_ENV,
      BILLING_LIVE_SALES_APPROVED: "true", BILLING_PRODUCTION_APPROVED: "true",
      GENERATION_CHARGING_ENABLED: "true", NEXT_PUBLIC_BILLING_LIVE_ENABLED: "true" });
    assert.deepEqual(options, {});
    assert.deepEqual(new BillingService(options).catalog(), defaultCatalog);
  }
  assert.equal(defaultCatalog.checkoutEnabled, false);
  assert.equal(defaultCatalog.products[0].price?.currency, "USD");
  assert.deepEqual(billingOptionsFromEnvironment({ NODE_ENV: "production" }, approvedFixture), {}, "approval alone is not a runtime request");
});

test("internal approved live fixture registers only the live product and passes checkout gates up to the DB boundary", async () => {
  const options = billingOptionsFromEnvironment(liveEnvironment(), approvedFixture);
  assert.equal(options.environment, "live");
  assert.equal(options.providers?.pancake?.environment, "live");
  assert.equal(options.providers?.pancake?.merchantAccountId, "STO_4bVzrkD0FJjFdZNLk8Ualx");
  assert.equal(options.providers?.pancake?.capabilities.subscriptions, false);
  assert.deepEqual(options.catalog?.[0].providerProducts, { pancake: { live: "PROD_4kF9mNpQrStUvWxYz1A2bC" } });
  assert.equal(typeof options.assertIsolation, "function");
  let isolationCalls = 0;
  const boundary = new Error("OFFLINE_DATABASE_BOUNDARY");
  const service = new BillingService({ ...options, assertIsolation: async () => { isolationCalls++; throw boundary; } });
  const catalog = service.catalog();
  assert.equal(catalog.environment, "live"); assert.equal(catalog.checkoutEnabled, true);
  assert.deepEqual(catalog.products[0].price, { amountMinor: 1900, currency: "USD" });
  assert.equal(catalog.products[0].credits, 150); assert.equal(catalog.products[0].purchaseType, "one_time");
  await assert.rejects(service.checkout(user, { ...checkoutInput, productId: catalog.products[0].id }), (e) => e === boundary);
  assert.equal(isolationCalls, 1, "allowed path reaches isolation; it does not create a payment or access a database");
});

test("service separately denies live checkout without approval or with runtime sales disabled", async () => {
  const options = billingOptionsFromEnvironment(liveEnvironment(), approvedFixture);
  let isolationCalls = 0;
  for (const override of [{ releaseApproval: undefined }, { releaseApproval: productionBillingRelease }, { salesEnabled: false }]) {
    const service = new BillingService({ ...options, ...override, assertIsolation: async () => { isolationCalls++; } });
    assert.equal(service.catalog().checkoutEnabled, false);
    await assert.rejects(service.checkout(user, checkoutInput), billingCode("SALES_DISABLED"));
  }
  assert.equal(isolationCalls, 0, "rejection precedes database access");
});

test("live requires production scope and every live value, never test or generic credential fallbacks", () => {
  const live = liveEnvironment(), sandbox = environment();
  for (const name of ["MERCHANT_ID", "STORE_ID", "PRODUCT_ID", "PRIVATE_KEY", "PLATFORM_PUBLIC_KEY"]) {
    assert.throws(() => billingOptionsFromEnvironment({ ...sandbox, ...live, BILLING_TEST_ENABLED: "false",
      [`PANCAKE_LIVE_${name}`]: "", WAFFO_WEBHOOK_PUBLIC_KEY: keys.publicKey }, approvedFixture),
    new RegExp(`BILLING_CONFIG_MISSING:PANCAKE_LIVE_${name}`));
    assert.throws(() => billingOptionsFromEnvironment({ ...live, ...sandbox, BILLING_LIVE_ENABLED: "false",
      [`PANCAKE_TEST_${name}`]: "" }, approvedFixture), new RegExp(`BILLING_CONFIG_MISSING:PANCAKE_TEST_${name}`));
  }
  for (const override of [
    { BILLING_DEPLOYMENT_MODE: "isolated-test" }, { BILLING_DEPLOYMENT_MODE: "" },
    { DATABASE_URL: sandbox.DATABASE_URL },
    { DATABASE_URL: "postgresql://fixture_live@127.0.0.1/fixture_billing_sandbox" },
    { DATABASE_URL: "postgresql://fixture_billing_test@127.0.0.1/fixture_live" },
    { DATABASE_URL: "postgresql://fixture_live@127.0.0.1/fixture_billing_%73andbox" },
    { DATABASE_URL: "https://fixture_live@db.example.invalid/fixture_live" },
    { DATABASE_URL: "postgresql://127.0.0.1/fixture_live" },
    { APP_URL: "http://billing.example.invalid" }, { APP_URL: "https://other.example.invalid" },
    { APP_URL: "https://user:password@billing.example.invalid" }, { BILLING_LIVE_APP_ORIGIN: "" },
  ]) assert.throws(() => billingOptionsFromEnvironment({ ...live, ...override }, approvedFixture), /BILLING_LIVE_ISOLATION_REQUIRED/);
  for (const approval of [approvedFixture, productionBillingRelease])
    assert.throws(() => billingOptionsFromEnvironment({ ...live, BILLING_TEST_ENABLED: "true" }, approval), /BILLING_ENVIRONMENT_CONFLICT/);
});

test("provider and product environment mismatches reject checkout before isolation or payment calls", async () => {
  const live = billingOptionsFromEnvironment(liveEnvironment(), approvedFixture);
  const sandbox = billingOptionsFromEnvironment(environment());
  let isolationCalls = 0;
  for (const [selected, other] of [[live, sandbox], [sandbox, live]]) {
    const input = { ...checkoutInput, productId: selected.catalog![0].id };
    const assertIsolation = async () => { isolationCalls++; };
    const mismatchedProvider = new BillingService({ ...selected, providers: other.providers, assertIsolation });
    assert.equal(mismatchedProvider.catalog().checkoutEnabled, false);
    await assert.rejects(mismatchedProvider.checkout(user, input), billingCode("PROVIDER_ENVIRONMENT_MISMATCH"));
    const mismatchedProduct = new BillingService({ ...selected, catalog: other.catalog, assertIsolation });
    assert.equal(mismatchedProduct.catalog().checkoutEnabled, false);
    await assert.rejects(mismatchedProduct.checkout(user, input), billingCode("PRODUCT_UNAVAILABLE"));
  }
  assert.equal(isolationCalls, 0);
});

test("configured adapters accept their signed payment scope and reject the opposite mode or platform key", async () => {
  for (const [env, approval, signer, wrongSigner, mode] of [
    [liveEnvironment(), approvedFixture, liveKeys, keys, "prod"],
    [environment(), productionBillingRelease, keys, liveKeys, "test"],
  ] as const) {
    const options = billingOptionsFromEnvironment(env, approval);
    const adapter = options.providers!.pancake!, pack = options.catalog![0];
    const event = { id: "PAY_offline", timestamp: new Date().toISOString(), eventType: "order.completed",
      eventId: "PAY_offline", storeId: adapter.merchantAccountId, mode,
      data: { orderId: "ORD_offline", orderStatus: "completed", merchantProvidedBuyerIdentity: user.id,
        orderMerchantExternalId: randomUUID(), currency: "USD", chargedAmount: "19.00",
        listPrice: { subtotal: "19.00", taxAmount: "0.00", total: "19.00" },
        paymentId: "PAY_offline", paymentStatus: "succeeded", orderMetadata: {} } };
    event.data.orderMetadata = { kakareel_schema: "one-time-v1", kakareel_order_id: event.data.orderMerchantExternalId,
      kakareel_user_id: user.id, kakareel_product_id: pack.id,
      kakareel_provider_product_id: pack.providerProducts.pancake![adapter.environment], kakareel_price_version: pack.priceVersion };
    const signed = (value: typeof event, key = signer.privateKey) => {
      const rawBody = Buffer.from(JSON.stringify(value)), timestamp = String(Date.now());
      const signature = sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]), key).toString("base64");
      return { rawBody, headers: new Headers({ "X-Waffo-Signature": `t=${timestamp},v1=${signature}` }) };
    };
    const accepted = await adapter.verifyAndNormalizeWebhook(signed(event));
    assert.equal(accepted.environment, adapter.environment);
    assert.equal(accepted.amountMinor, 1900);
    await assert.rejects(adapter.verifyAndNormalizeWebhook(signed({ ...event, mode: mode === "prod" ? "test" : "prod" })));
    await assert.rejects(adapter.verifyAndNormalizeWebhook(signed(event, wrongSigner.privateKey)));
    const service = new BillingService({ ...options, assertIsolation: async () => {} });
    const wrongScope = signed({ ...event, mode: mode === "prod" ? "test" : "prod" });
    await assert.rejects(service.webhook("pancake", wrongScope.rawBody, wrongScope.headers), billingCode("INVALID_WEBHOOK"));
  }
});
