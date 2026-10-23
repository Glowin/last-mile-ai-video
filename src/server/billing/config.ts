import { TaxCategory } from "@waffo/pancake-ts";
import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { defaultCatalog } from "./catalog";
import { PancakeBillingProvider } from "./pancake";
import { billingOrders } from "./schema";
import type { BillingOptions } from "./service";

/** Server-only runtime configuration. Never reads files or credential directories.
 * Provision the sandbox with its own database/role; it must not share production
 * auth users. The name + deployment gate prevents accidentally using the normal
 * application DSN. No environment option enables live sales.
 */
export function billingOptionsFromEnvironment(env: NodeJS.ProcessEnv = process.env): BillingOptions {
  if (env.BILLING_TEST_ENABLED !== "true") return {};
  if (env.BILLING_DEPLOYMENT_MODE !== "isolated-test") throw new Error("BILLING_TEST_ISOLATION_REQUIRED");
  let db: URL, app: URL;
  try { db = new URL(env.DATABASE_URL ?? ""); app = new URL(env.APP_URL ?? ""); }
  catch { throw new Error("BILLING_TEST_ISOLATION_REQUIRED"); }
  if (!/^\/[a-z0-9_]+_billing_sandbox$/.test(db.pathname) || !/^postgres(ql)?:$/.test(db.protocol) ||
    !/^[a-z0-9_]+_billing_test$/.test(decodeURIComponent(db.username)) || app.protocol !== "https:" ||
    app.username || app.password || app.origin !== env.BILLING_TEST_APP_ORIGIN)
    throw new Error("BILLING_TEST_ISOLATION_REQUIRED");
  const required = (name: string) => { const value = env[name]; if (!value?.trim()) throw new Error(`BILLING_CONFIG_MISSING:${name}`); return value; };
  const providerProductId = required("PANCAKE_TEST_PRODUCT_ID");
  const pack = defaultCatalog[0];
  const adapter = new PancakeBillingProvider({ environment: "test",
    merchantId: required("PANCAKE_TEST_MERCHANT_ID"), storeId: required("PANCAKE_TEST_STORE_ID"),
    privateKey: required("PANCAKE_TEST_PRIVATE_KEY"), platformPublicKey: required("PANCAKE_TEST_PLATFORM_PUBLIC_KEY"),
    successUrl: new URL("/billing/return", app).href,
    products: [{ productId: pack.id, providerProductId, priceVersion: pack.priceVersion,
      amountMinor: pack.amountMinor!, credits: pack.credits!, currency: "USD", taxCategory: TaxCategory.SaaS }],
    getOrderCreatedAt: async (id) => {
      const [order] = await database().select({ createdAt: billingOrders.createdAt }).from(billingOrders).where(eq(billingOrders.id, id));
      return order?.createdAt ?? null;
    },
  });
  return { salesEnabled: true, assertIsolation: async () => {
    const [scope] = await database().execute(sql`SELECT current_database() AS name, current_user AS role`);
    if (!/^[a-z0-9_]+_billing_sandbox$/.test(String(scope.name)) || !/^[a-z0-9_]+_billing_test$/.test(String(scope.role)))
      throw new Error("BILLING_TEST_DATABASE_SCOPE_MISMATCH");
  }, providers: { pancake: adapter }, catalog: [{ ...pack, providerProducts: { pancake: { test: providerProductId } } }] };
}
