/** Temporary TEST receiver. The host supplies environment variables; no env file
 * or credential file is read here. Run from the project with dependencies installed:
 *   node --import tsx scripts/pancake-webhook-sandbox.ts --port 8787
 * Or set PANCAKE_WEBHOOK_SANDBOX_PORT (default 8787); --port takes precedence.
 * Required: BILLING_TEST_ENABLED=true, BILLING_DEPLOYMENT_MODE=isolated-test,
 * BILLING_TEST_APP_ORIGIN, HTTPS APP_URL, isolated DATABASE_URL and all five
 * PANCAKE_TEST_* variables from .env.example. Actual DB/role are checked before
 * listening and again by BillingService for each webhook. No migrations run.
 * GET /health is liveness only after startup validation, not payment acceptance.
 * The main session owns the HTTPS tunnel, test webhook registration and checkout.
 * Register only order.completed/refund.succeeded, the existing adapter's events.
 * refund.failed is not supported by that parser and must not be subscribed here.
 * Dashboard sample events are not KakaReel orders and may correctly be rejected.
 * SIGINT/SIGTERM closes the listener and DB pool. Do not point at production.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { billingOptionsFromEnvironment } from "../src/server/billing/config";
import { BillingError, BillingService } from "../src/server/billing/service";
import { closeDatabase } from "../src/server/db";
import { startSandboxReceiver, type SandboxLog, type WebhookReply } from "./pancake-webhook-sandbox-http";

export async function startPancakeWebhookSandbox(port: number, log: SandboxLog = (line) => process.stdout.write(`${line}\n`)) {
  if (process.env.BILLING_TEST_ENABLED !== "true" || process.env.BILLING_DEPLOYMENT_MODE !== "isolated-test")
    throw new Error("SANDBOX_TEST_CONFIG_REQUIRED");
  const options = billingOptionsFromEnvironment();
  if (!options.assertIsolation || options.providers?.pancake?.environment !== "test")
    throw new Error("SANDBOX_TEST_CONFIG_REQUIRED");
  const service = new BillingService(options);
  try {
    const receiver = await startSandboxReceiver({ port, log, assertIsolation: options.assertIsolation,
      webhook: async (rawBody, headers): Promise<WebhookReply> => {
        try {
          // The actual production-code transaction entry, with its own per-call
          // DB isolation check. No JSON reserialization or alternate grant path.
          const result = await service.webhook("pancake", rawBody, headers);
          return { status: 200, outcome: result.outcome };
        } catch (error) {
          return { status: error instanceof BillingError ? error.status : 503 };
        }
      },
    });
    return { ...receiver, close: async () => { try { await receiver.close(); } finally { await closeDatabase(); } } };
  } catch (error) { await closeDatabase(); throw error; }
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: "string" } }, allowPositionals: false });
  const port = values.port ?? process.env.PANCAKE_WEBHOOK_SANDBOX_PORT ?? "8787";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("SANDBOX_INVALID_PORT");
  const receiver = await startPancakeWebhookSandbox(Number(port));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void receiver.close().then(() => process.stdout.write("sandbox_stopped\n"), () => {
      process.stderr.write("sandbox_shutdown_failed\n"); process.exitCode = 1;
    }).finally(() => { process.off("SIGINT", stop); process.off("SIGTERM", stop); });
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async () => {
    // Never print exception messages/stacks: config/driver errors may contain credentials.
    process.stderr.write("sandbox_start_failed: check isolated-test configuration, database/role, keys and loopback port\n");
    process.exitCode = 1;
    await closeDatabase().catch(() => {});
  });
}
