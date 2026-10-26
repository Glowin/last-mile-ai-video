import { createPublicKey } from "node:crypto";
import { TaxCategory } from "@waffo/pancake-ts";
import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { defaultCatalog } from "./catalog";
import { PancakeBillingProvider, PancakeError } from "./pancake";
import { billingOrders } from "./schema";
import type { BillingOptions } from "./service";

/** Change only in an explicitly approved release after operational acceptance.
 * This is server code, never an environment variable or request option. */
export type BillingReleaseApproval = Readonly<{ liveSalesApproved: boolean }>;
export const productionBillingRelease: BillingReleaseApproval = Object.freeze({ liveSalesApproved: false });

// The dashboard supplies single-line base64 DER SPKI. Convert only that exact
// encoding; the adapter remains responsible for RSA type and minimum key size.
function platformPublicKey(value: string): string {
  const text = value.trim();
  if (/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(text)) return text;
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) || !text)
      throw new Error();
    const der = Buffer.from(text, "base64");
    if (der.toString("base64") !== text) throw new Error();
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    // Reject trailing bytes or a different ASN.1 encoding accepted by OpenSSL.
    if (!key.export({ format: "der", type: "spki" }).equals(der)) throw new Error();
    return key.export({ format: "pem", type: "spki" }).toString();
  } catch { throw new PancakeError("PANCAKE_INVALID_PLATFORM_KEY"); }
}

/** Server-only runtime configuration. Never reads files or credential directories.
 * The second argument is an internal dependency-injection seam for offline tests;
 * application callers use the code-level productionBillingRelease above.
 * Sandbox and live registrations never fall back to each other's credentials.
 */
export function billingOptionsFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  releaseApproval: BillingReleaseApproval = productionBillingRelease,
): BillingOptions {
  const testRequested = env.BILLING_TEST_ENABLED === "true";
  const liveRequested = env.BILLING_LIVE_ENABLED === "true";
  const preparationRequested = env.BILLING_LIVE_PREPARATION_ENABLED === "true";
  if (testRequested && (liveRequested || preparationRequested)) throw new Error("BILLING_ENVIRONMENT_CONFLICT");
  if (!testRequested && !preparationRequested && !(liveRequested && releaseApproval.liveSalesApproved === true)) return {};
  const environment = testRequested ? "test" : "live";
  const isolationError = environment === "test" ? "BILLING_TEST_ISOLATION_REQUIRED" : "BILLING_LIVE_ISOLATION_REQUIRED";
  if (env.BILLING_DEPLOYMENT_MODE !== (testRequested ? "isolated-test" : "production")) throw new Error(isolationError);
  let db: URL, app: URL, databaseName: string, databaseRole: string;
  try {
    db = new URL(env.DATABASE_URL ?? ""); app = new URL(env.APP_URL ?? "");
    databaseName = decodeURIComponent(db.pathname.slice(1)); databaseRole = decodeURIComponent(db.username);
  } catch { throw new Error(isolationError); }
  if (!/^postgres(ql)?:$/.test(db.protocol) || !databaseName || !databaseRole || app.protocol !== "https:" ||
    app.username || app.password || app.origin !== env[testRequested ? "BILLING_TEST_APP_ORIGIN" : "BILLING_LIVE_APP_ORIGIN"])
    throw new Error(isolationError);
  if (testRequested
    ? !/^[a-z0-9_]+_billing_sandbox$/.test(databaseName) || !/^[a-z0-9_]+_billing_test$/.test(databaseRole)
    : /_billing_sandbox$/i.test(databaseName) || /_billing_test$/i.test(databaseRole))
    throw new Error(isolationError);
  const prefix = testRequested ? "PANCAKE_TEST_" : "PANCAKE_LIVE_";
  const required = (suffix: string) => {
    const name = prefix + suffix, value = env[name];
    if (!value?.trim()) throw new Error(`BILLING_CONFIG_MISSING:${name}`);
    return value;
  };
  const providerProductId = required("PRODUCT_ID");
  const pack = defaultCatalog[0];
  const adapter = new PancakeBillingProvider({ environment,
    merchantId: required("MERCHANT_ID"), storeId: required("STORE_ID"),
    privateKey: required("PRIVATE_KEY"), platformPublicKey: platformPublicKey(required("PLATFORM_PUBLIC_KEY")),
    successUrl: new URL("/billing/return", app).href,
    products: [{ productId: pack.id, providerProductId, priceVersion: pack.priceVersion,
      amountMinor: pack.amountMinor!, credits: pack.credits!, currency: "USD", taxCategory: TaxCategory.SaaS }],
    getOrderCreatedAt: async (id) => {
      const [order] = await database().select({ createdAt: billingOrders.createdAt }).from(billingOrders).where(eq(billingOrders.id, id));
      return order?.createdAt ?? null;
    },
  });
  // Preparation registers the same strictly scoped adapter for callbacks/query
  // recovery, but can never authorize checkout, even in a future approved release.
  // Refund requests retain BillingService's existing ownership/eligibility checks.
  return { salesEnabled: !preparationRequested, environment,
    releaseApproval: preparationRequested ? Object.freeze({ liveSalesApproved: false }) : releaseApproval,
    assertIsolation: async () => {
      const [scope] = await database().execute(sql`SELECT current_database() AS name, current_user AS role`);
      if (scope.name !== databaseName || scope.role !== databaseRole)
        throw new Error(testRequested ? "BILLING_TEST_DATABASE_SCOPE_MISMATCH" : "BILLING_LIVE_DATABASE_SCOPE_MISMATCH");
    }, providers: { pancake: adapter }, catalog: [{ ...pack, providerProducts: { pancake: { [environment]: providerProductId } } }] };
}
