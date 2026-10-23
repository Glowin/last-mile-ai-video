/** INTERNAL SANDBOX CLI, never an HTTP route. Load secrets from an external
 * environment yourself. This script never opens credential files.
 * node --import tsx src/server/billing/sandbox-smoke.ts inspect --output /private/path/schema.json
 * node --import tsx src/server/billing/sandbox-smoke.ts seed --output /private/path/result.json
 * node --import tsx src/server/billing/sandbox-smoke.ts checkout --user-id UUID --request-id UUID --output /private/path/result.json
 * node --import tsx src/server/billing/sandbox-smoke.ts reconcile --order-id UUID --output /private/path/result.json
 * node --import tsx src/server/billing/sandbox-smoke.ts refund-diagnose --order-id UUID --output /private/path/diagnosis.json
 * node --import tsx src/server/billing/sandbox-smoke.ts refund --user-id UUID --order-id UUID --output /private/path/result.json
 * Output parent must exist, be owned by the caller, and mode 0700. Output is
 * created exclusively mode 0600 outside the repository. It may contain a
 * checkout bearer token: do not publish it or echo it to logs.
 */
import { WaffoPancake } from "@waffo/pancake-ts";
import { inspectPancakeSchema } from "./pancake-query";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { database, closeDatabase } from "../db";
import { users } from "../schema";
import { billingOrders } from "./schema";
import { billingOptionsFromEnvironment } from "./config";
import { BillingError, BillingService } from "./service";
import { PancakeError, PancakeBillingProvider, safePancakeDiagnosticCode } from "./pancake";

export async function sandboxSmoke(action: string, args: { userId?: string; requestId?: string; orderId?: string }) {
  if (process.env.BILLING_TEST_ENABLED !== "true") throw new Error("SANDBOX_NOT_ENABLED");
  if (action === "inspect") {
    if (process.env.BILLING_DEPLOYMENT_MODE !== "isolated-test" || !process.env.PANCAKE_TEST_MERCHANT_ID || !process.env.PANCAKE_TEST_PRIVATE_KEY)
      throw new Error("SANDBOX_CONFIG_REQUIRED");
    // Schema-only authenticated read: no database, user, checkout or webhook key.
    return inspectPancakeSchema(new WaffoPancake({ environment: "test",
      merchantId: process.env.PANCAKE_TEST_MERCHANT_ID, privateKey: process.env.PANCAKE_TEST_PRIVATE_KEY }));
  }
  const options = billingOptionsFromEnvironment(); // validates separate deployment + database + pinned test key scope
  const service = new BillingService(options);
  const db = database();
  // Verify the live connection, not merely the configured URL or a caller flag.
  const { sql } = await import("drizzle-orm");
  const [scope] = await db.execute(sql`SELECT current_database() AS name, current_user AS role`);
  if (!/^[a-z0-9_]+_billing_sandbox$/.test(String(scope.name)) || !/^[a-z0-9_]+_billing_test$/.test(String(scope.role)))
    throw new Error("SANDBOX_DATABASE_SCOPE_MISMATCH");
  if (action === "seed") {
    const id = randomUUID();
    await db.insert(users).values({ id, googleSub: `sandbox-smoke-${id}`, email: `${id}@example.invalid` });
    return { userId: id, requestId: randomUUID(), environment: "test" };
  }
  if (action === "refund-diagnose") {
    const [order] = await db.select().from(billingOrders).where(eq(billingOrders.id, z.uuid().parse(args.orderId)));
    const provider = options.providers?.pancake;
    if (!order || order.environment !== "test" || order.provider !== "pancake" || !order.providerPaymentId ||
      !order.refundRequestId || !order.paidAmountMinor || !(provider instanceof PancakeBillingProvider) || order.merchantAccountId !== provider.merchantAccountId)
      throw new Error("SANDBOX_REFUND_DIAGNOSTIC_ORDER_REQUIRED");
    return provider.client.diagnoseRefund({ orderId: order.id, userId: order.userId,
      paymentId: order.providerPaymentId, requestId: order.refundRequestId, amountMinor: order.paidAmountMinor, currency: order.currency });
  }
  if (action === "reconcile") return service.reconcile(z.uuid().parse(args.orderId));
  const userId = z.uuid().parse(args.userId);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("SANDBOX_USER_NOT_FOUND");
  if (action === "checkout") return service.checkout(user, { productId: "credits-starter", provider: "pancake", requestId: z.uuid().parse(args.requestId) });
  if (action === "refund") return service.requestRefund(userId, z.uuid().parse(args.orderId));
  throw new Error("SANDBOX_UNKNOWN_ACTION");
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "user-id": { type: "string" }, "request-id": { type: "string" }, "order-id": { type: "string" }, output: { type: "string" },
  } });
  if (!values.output || positionals.length !== 1) throw new Error("SANDBOX_ARGUMENTS_REQUIRED");
  const output = resolve(values.output);
  if (output.includes("/.vibefriends/")) throw new Error("SANDBOX_OUTPUT_PATH_REJECTED");
  const parent = await realpath(dirname(output));
  const repo = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
  const rel = relative(repo, parent);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("SANDBOX_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY");
  const permissions = await stat(parent);
  if ((permissions.mode & 0o777) !== 0o700 || permissions.uid !== process.getuid?.()) throw new Error("SANDBOX_OUTPUT_DIRECTORY_NOT_PRIVATE");
  // Reserve output before any SDK mutation. No symlinks or overwrites.
  const file = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const result = await sandboxSmoke(positionals[0], { userId: values["user-id"], requestId: values["request-id"], orderId: values["order-id"] });
    await file.writeFile(JSON.stringify(result, null, 2));
    process.stdout.write("Sandbox operation completed; inspect the private output file. This is not payment or delivery acceptance.\n");
  } finally { await file.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Never print SDK errors/responses, URLs, keys, DSNs or account details.
    process.stderr.write(error instanceof BillingError || error instanceof PancakeError ? `${error.code}\n` : `${safePancakeDiagnosticCode(error)}\n`);
    process.exitCode = 1;
  }).finally(closeDatabase);
}
