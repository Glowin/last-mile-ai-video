import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { billingOptionsFromEnvironment } from "../src/server/billing/config";
import { BillingService } from "../src/server/billing/service";
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
