import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { sql } from "drizzle-orm";
import { app as realApp } from "../src/server/app";
import { database, closeDatabase } from "../src/server/db";
import { users, authSessions } from "../src/server/schema";
import { issueSession } from "../src/server/auth";
import { migrate } from "../scripts/migrate.mjs";
import { createBillingModule, isBillingWebhookRequest } from "../src/server/billing/routes";
import type { BillingOptions } from "../src/server/billing/service";
import type { BillingProvider, CheckoutCommand, VerifiedPaymentEvent } from "../src/server/billing/providers";
import type { CreditPack } from "../src/server/billing/catalog";

const integration = !!process.env.BILLING_TEST_DATABASE_URL;
const originalFetch = global.fetch;
const legacyUser = randomUUID(), legacyJob = randomUUID();
const origin = "http://localhost:3000";
const testSecret = "billing-test-only-session-secret-32-characters";
const signatureKey = randomBytes(32); // Mock protocol only; not any real provider's signing implementation.
const pack = (id = "test-pack"): CreditPack => ({ id, name: "Test-only pack", description: "Fixture, not an approved price",
  priceVersion: "test-v1", credits: 80, amountMinor: 1250, currency: "USD", enabled: true,
  providerProducts: { pancake: { test: "test-provider-product" } } });
class MockProvider implements BillingProvider {
  readonly id = "pancake" as const;
  readonly environment = "test" as const;
  readonly merchantAccountId = "test-merchant";
  readonly checkoutHosts = ["checkout.example.invalid"];
  readonly capabilities = { hostedCheckout: true, fullRefundEvents: true, subscriptions: false } as const;
  configured = true;
  loseResponse = false;
  invalidUrl = false;
  calls = 0;
  commands = new Map<string, CheckoutCommand>();
  gate?: () => Promise<void>;
  isConfigured() { return this.configured; }
  async createCheckout(command: CheckoutCommand) {
    this.calls++;
    const existing = this.commands.get(command.idempotencyKey);
    if (existing) assert.deepEqual(command, existing, "provider retry must preserve its original snapshot and key");
    this.commands.set(command.idempotencyKey, command);
    if (this.gate) await this.gate();
    if (this.loseResponse) { this.loseResponse = false; throw new Error("Test-only lost checkout response"); }
    return { checkoutId: `checkout-${command.orderId}`,
      checkoutUrl: this.invalidUrl ? "https://attacker.example.invalid/" : `https://checkout.example.invalid/pay/${command.orderId}?token=test-only-transient` };
  }
  async verifyAndNormalizeWebhook({ rawBody, headers }: { rawBody: Uint8Array; headers: Headers }) {
    const timestamp = headers.get("x-test-timestamp") ?? "";
    const supplied = Buffer.from(headers.get("x-test-signature") ?? "", "hex");
    const expected = createHmac("sha256", signatureKey).update(timestamp + ".").update(rawBody).digest();
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid mock signature");
    return JSON.parse(Buffer.from(rawBody).toString()) as VerifiedPaymentEvent;
  }
}
function harness(options: BillingOptions = {}) {
  const app = new Hono().basePath("/api");
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !isBillingWebhookRequest(c.req.method, c.req.path)) {
      if (c.req.header("origin") !== origin || c.req.header("sec-fetch-site") === "cross-site")
        return c.json({ error: "Origin rejected" }, 403);
    }
    await next();
  });
  const module = createBillingModule(options);
  // Exact integration order: webhook router before the ordinary billing auth middleware.
  app.route("/billing/webhooks", module.webhookRoutes);
  app.route("/billing", module.routes);
  app.post("/preview-action", (c) => c.json({ ok: true }));
  return app;
}
function enabled(provider = new MockProvider()) {
  return { provider, app: harness({ salesEnabled: true, providers: { pancake: provider }, catalog: [pack(), pack("other-pack")] }) };
}
type TestApp = ReturnType<typeof harness>;
async function actor() {
  const id = randomUUID(), sessionId = randomUUID();
  await database().insert(users).values({ id, googleSub: `billing-fixture-${id}`, email: `${id}@example.invalid` });
  await database().insert(authSessions).values({ id: sessionId, userId: id, expiresAt: new Date(Date.now() + 86400_000) });
  const jwt = await new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: "HS256" }).setSubject(id)
    .setIssuer("kakareel").setAudience("kakareel-studio").setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode(testSecret));
  return { id, cookie: `kr_access=${jwt}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
function request(app: TestApp, who: Actor | undefined, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://localhost/api${path}`, { method,
    headers: { "Content-Type": "application/json", origin, ...(who ? { cookie: who.cookie, "X-KakaReel-Owner": who.id } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const input = (requestId = randomUUID()) => ({ productId: "test-pack", provider: "pancake", requestId });
async function checkout(app: TestApp, who: Actor, body = input()) {
  const response = await request(app, who, "/billing/checkout", "POST", body);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return (await response.json()).order as { id: string; amountMinor: number; currency: string; credits: number; status: string };
}
function event(provider: MockProvider, orderId: string, changes: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent {
  const command = provider.commands.get(orderId)!;
  assert.ok(command);
  return { eventId: randomUUID(), environment: "test", merchantAccountId: provider.merchantAccountId,
    orderId, userId: command.userId, productId: command.productId, providerProductId: command.providerProductId,
    checkoutId: `checkout-${orderId}`, paymentId: `payment-${orderId}`, kind: "payment.succeeded",
    amountMinor: command.amountMinor, currency: command.currency, ...changes };
}
function webhook(app: TestApp, data: unknown, options: { timestamp?: number; tamper?: boolean; unsigned?: boolean } = {}) {
  const raw = JSON.stringify(data), timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signatureKey).update(timestamp + "." + raw).digest("hex");
  return app.request("http://localhost/api/billing/webhooks/pancake", { method: "POST",
    headers: { "Content-Type": "application/json", "x-test-timestamp": timestamp,
      ...(options.unsigned ? {} : { "x-test-signature": signature }) }, body: options.tamper ? raw + " " : raw });
}
async function totals(orderId: string) {
  const [row] = await database().execute(sql`SELECT count(*)::int AS n, coalesce(sum(credits),0)::int AS credits FROM credit_ledger WHERE order_id=${orderId}::uuid`);
  return row;
}
async function state(orderId: string) {
  const [row] = await database().execute(sql`SELECT status,provider_payment_id,checkout_status FROM billing_orders WHERE id=${orderId}::uuid`);
  return row;
}
before(async () => {
  if (!integration) return;
  const url = new URL(process.env.BILLING_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1", "Billing tests only reset a disposable loopback database");
  assert.equal(url.pathname, "/video_billing_qa");
  process.env.DATABASE_URL = process.env.BILLING_TEST_DATABASE_URL;
  process.env.SESSION_SECRET = testSecret;
  process.env.APP_URL = origin;
  global.fetch = async () => { throw new Error("Network calls forbidden in billing tests"); };
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await db`DROP SCHEMA public CASCADE`;
    await db`CREATE SCHEMA public`;
    await db`CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of ["0001-init.sql", "0002-google-auth.sql"]) {
      const source = await readFile(new URL(`../db/${name}`, import.meta.url), "utf8");
      await db.unsafe(source);
      await db`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${createHash("sha256").update(source).digest("hex")})`;
    }
    await db`INSERT INTO users(id,google_sub,email) VALUES(${legacyUser},'retained-billing-fixture','retained@example.invalid')`;
    await db`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,status)
      VALUES(${legacyJob},${legacyUser},'seedance','text','Retained legacy job',5,'720p','fixture','success')`;
  } finally { await db.end(); }
  await Promise.all([migrate(), migrate()]);
});
after(async () => { global.fetch = originalFetch; await closeDatabase(); });

test("billing foundation on disposable PostgreSQL", { skip: integration ? false : "Set BILLING_TEST_DATABASE_URL to the dedicated disposable loopback database" }, async (t) => {
  await t.test("additive, concurrent and repeated migrations preserve users and videos and seed no money", async () => {
    await migrate();
    const rows = await database().execute(sql`SELECT owner FROM video_jobs WHERE id=${legacyJob}::uuid`);
    assert.equal(rows[0].owner, legacyUser);
    const versions = await database().execute(sql`SELECT name FROM schema_migrations ORDER BY name`);
    assert.deepEqual(versions.map((r) => r.name), ["0001-init.sql", "0002-google-auth.sql", "0003-billing.sql"]);
    const count = await database().execute(sql`SELECT count(*)::int AS n FROM credit_ledger`);
    assert.equal(count[0].n, 0);
  });
  await t.test("real app mounts exact anonymous webhook exceptions without loosening checkout CSRF", async () => {
    for (const provider of ["pancake", "waffo", "stripe", "antom"]) {
      const response = await realApp.request(`http://localhost/api/billing/webhooks/${provider}`, { method: "POST", body: "{}" });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "PROVIDER_UNAVAILABLE");
    }
    for (const path of ["/billing/webhooks/unknown", "/billing/webhooks/pancake/extra", "/billing/webhooks/pancake/", "/billing/checkout"]) {
      assert.equal((await realApp.request(`http://localhost/api${path}`, { method: "POST", body: "{}" })).status, 403, path);
    }
    assert.equal((await realApp.request("http://localhost/api/billing/webhooks/pancake", { method: "DELETE" })).status, 403);
    assert.equal((await realApp.request("http://localhost/api/billing/checkout", { method: "POST", headers: { origin: "https://attacker.invalid" }, body: "{}" })).status, 403);
  });
  await t.test("default catalog and every provider are disabled; no fake URL, order or credit", async () => {
    const app = harness(), who = await actor();
    const r = await request(app, undefined, "/billing/catalog");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const catalog = await r.json();
    assert.equal(catalog.checkoutEnabled, false);
    assert.ok(catalog.products.every((p: { price: unknown; available: boolean }) => p.price === null && !p.available));
    for (const provider of ["pancake", "waffo", "stripe", "antom"]) {
      const response = await request(app, who, "/billing/checkout", "POST", { ...input(), provider });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "PROVIDER_UNAVAILABLE");
      assert.equal((await app.request(`http://localhost/api/billing/webhooks/${provider}`, { method: "POST", body: "{}" })).status, 503);
    }
    assert.deepEqual((await (await request(app, who, "/billing/orders")).json()).orders, []);
    const summary = await (await request(app, who, "/billing")).json();
    assert.deepEqual(summary, { balanceCredits: 0, testBalanceCredits: 0, checkoutEnabled: false, generationChargingEnabled: false, previewAccess: false });
  });
  await t.test("Google sessions required, expired sessions refreshable, owner mandatory for checkout and checked for reads", async () => {
    const { app } = enabled(), who = await actor();
    assert.equal((await request(app, undefined, "/billing")).status, 401);
    assert.equal((await request(app, undefined, "/billing/checkout", "POST", input(), { cookie: `lm_session=${issueSession()}` })).status, 403);
    const expired = await request(app, undefined, "/billing", "GET", undefined, { cookie: "kr_access=expired" });
    assert.equal(expired.status, 401); assert.equal((await expired.json()).code, "SESSION_EXPIRED");
    assert.equal((await request(app, who, "/billing/checkout", "POST", input(), { "X-KakaReel-Owner": "" })).status, 409);
    assert.equal((await request(app, who, "/billing/checkout", "POST", input(), { "X-KakaReel-Owner": randomUUID() })).status, 409);
    assert.equal((await request(app, who, "/billing", "GET", undefined, { "X-KakaReel-Owner": randomUUID() })).status, 409);
  });
  await t.test("exact webhook exemption preserves all other mutation CSRF and rejects client pricing/ownership/status", async () => {
    const { app } = enabled(), who = await actor();
    for (const extra of [{ amountMinor: 1 }, { currency: "USD" }, { credits: 99999 }, { owner: who.id }, { userId: who.id }, { status: "paid" }])
      assert.equal((await request(app, who, "/billing/checkout", "POST", { ...input(), ...extra })).status, 400);
    for (const headers of [{ origin: "" }, { origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])
      assert.equal((await request(app, who, "/billing/checkout", "POST", input(), headers)).status, 403);
    assert.equal((await app.request("http://localhost/api/preview-action", { method: "POST" })).status, 403);
    for (const path of ["/billing/webhooks/pancake/extra", "/billing/webhooks/unknown", "/billing/checkout"])
      assert.equal((await app.request(`http://localhost/api${path}`, { method: "POST", body: "{}" })).status, 403);
    assert.equal(isBillingWebhookRequest("DELETE", "/api/billing/webhooks/pancake"), false);
    assert.equal((await webhook(app, {})).status, 400, "signed but incomplete event reaches verifier, never ordinary session auth");
  });
  await t.test("server snapshots and idempotent checkout isolate accounts and reject conflicting request keys", async () => {
    const { app, provider } = enabled(), a = await actor(), b = await actor(), body = input();
    const first = await checkout(app, a, body), second = await checkout(app, a, body);
    assert.equal(first.id, second.id);
    assert.equal(provider.commands.size, 1);
    assert.equal(first.amountMinor, 1250); assert.equal(first.currency, "USD"); assert.equal(first.credits, 80);
    assert.equal((await request(app, a, "/billing/checkout", "POST", { ...body, productId: "other-pack" })).status, 409);
    assert.equal((await request(app, a, "/billing/checkout", "POST", { ...input(), productId: "client-invented" })).status, 409);
    assert.equal((await request(app, b, `/billing/orders/${first.id}`)).status, 404);
    assert.deepEqual((await (await request(app, b, `/billing/orders?userId=${a.id}`)).json()).orders, []);
    const other = await checkout(app, b, body);
    assert.notEqual(other.id, first.id);
    const dump = await database().execute(sql`SELECT row_to_json(billing_orders)::text AS record FROM billing_orders WHERE id=${first.id}::uuid`);
    assert.ok(!String(dump[0].record).includes("test-only-transient"), "checkout URL/token must not be persisted");
    assert.equal((await totals(first.id)).n, 0);
  });
  await t.test("concurrent checkout, lost response, expired lease and invalid redirect do not create another payment", async () => {
    const { app, provider } = enabled(), who = await actor(), body = input();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { entered = r; });
    provider.gate = async () => { entered(); await waiting; };
    const first = request(app, who, "/billing/checkout", "POST", body);
    try {
      await started;
      const duplicate = await request(app, who, "/billing/checkout", "POST", body);
      assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).code, "CHECKOUT_IN_PROGRESS");
    } finally { release(); }
    assert.equal((await first).status, 200); provider.gate = undefined;
    provider.loseResponse = true;
    const lostBody = input();
    assert.equal((await request(app, who, "/billing/checkout", "POST", lostBody)).status, 503);
    const lostCommand = [...provider.commands.values()].find((x) => x.orderId !== [...provider.commands.keys()][0])!;
    assert.equal((await state(lostCommand.orderId)).checkout_status, "unknown");
    const recovered = await checkout(app, who, lostBody);
    assert.equal(recovered.id, lostCommand.orderId);
    await database().execute(sql`UPDATE billing_orders SET checkout_status='creating',lease_token=${randomUUID()}::uuid,lease_until=now()-interval '1 second' WHERE id=${recovered.id}::uuid`);
    assert.equal((await checkout(app, who, lostBody)).id, recovered.id);
    assert.equal(provider.commands.size, 2);
    provider.invalidUrl = true;
    const invalid = await request(app, who, "/billing/checkout", "POST", input());
    assert.equal(invalid.status, 503); assert.equal((await invalid.json()).code, "INVALID_CHECKOUT_RESPONSE");
  });
  await t.test("signature/raw-body/replay, environment and merchant failures cannot create ledger entries", async () => {
    const { app, provider } = enabled(), who = await actor(), order = await checkout(app, who);
    const payment = event(provider, order.id);
    for (const options of [{ unsigned: true }, { tamper: true }, { timestamp: 1 }, { timestamp: Math.floor(Date.now() / 1000) + 600 }])
      assert.equal((await webhook(app, payment, options)).status, 400);
    assert.equal((await webhook(app, { ...payment, environment: "live" })).status, 403);
    assert.equal((await webhook(app, { ...payment, merchantAccountId: "another-merchant" })).status, 403);
    assert.equal((await totals(order.id)).n, 0);
  });
  await t.test("wrong amount/currency/user/product/checkout and incomplete or partial refunds never authorize", async () => {
    const { app, provider } = enabled(), who = await actor(), order = await checkout(app, who);
    for (const changes of [{ amountMinor: 1 }, { currency: "EUR" }, { userId: randomUUID() },
      { productId: "wrong" }, { providerProductId: "wrong" }, { checkoutId: "other-checkout" }])
      assert.equal((await webhook(app, event(provider, order.id, changes))).status, 409);
    for (const changes of [{ amountMinor: undefined }, { amountMinor: 1.5 }, { amountMinor: -1 },
      { kind: "refund.failed" }, { paymentId: null }])
      assert.equal((await webhook(app, { ...event(provider, order.id), ...changes })).status, 400);
    assert.equal((await webhook(app, event(provider, order.id, { kind: "payment.refunded", amountMinor: 500 }))).status, 409);
    assert.equal((await totals(order.id)).n, 0);
  });
  await t.test("duplicate and concurrent verified events credit exactly once; conflicting event IDs fail closed", async () => {
    const { app, provider } = enabled(), who = await actor(), order = await checkout(app, who);
    const payment = event(provider, order.id);
    const results = await Promise.all([webhook(app, payment), webhook(app, payment), webhook(app, { ...payment, eventId: randomUUID() })]);
    assert.ok(results.every((r) => r.status === 200));
    assert.deepEqual(await totals(order.id), { n: 1, credits: 80 });
    assert.equal((await webhook(app, { ...payment, kind: "payment.failed" })).status, 409);
    const summary = await (await request(app, who, "/billing")).json();
    assert.equal(summary.testBalanceCredits, 80); assert.equal(summary.balanceCredits, 0);
    assert.equal(summary.generationChargingEnabled, false); assert.equal(summary.previewAccess, false);
  });
  await t.test("failure/cancel then success can fund exactly once; failed attempts do not bind the successful payment ID", async () => {
    for (const kind of ["payment.failed", "checkout.canceled"] as const) {
      const { app, provider } = enabled(), who = await actor(), body = input(), order = await checkout(app, who, body);
      assert.equal((await webhook(app, event(provider, order.id, { kind, paymentId: "failed-attempt" }))).status, 200);
      assert.equal((await state(order.id)).provider_payment_id, null);
      assert.equal((await checkout(app, who, body)).id, order.id, "retry failed checkout uses original order/key");
      assert.equal((await webhook(app, event(provider, order.id, { paymentId: `successful-${order.id}` }))).status, 200);
      assert.equal((await state(order.id)).status, "paid");
      assert.deepEqual(await totals(order.id), { n: 1, credits: 80 });
      assert.equal((await webhook(app, event(provider, order.id, { kind, paymentId: "another-failed-attempt" }))).status, 200);
      assert.equal((await state(order.id)).status, "paid");
      assert.equal((await totals(order.id)).credits, 80);
    }
  });
  await t.test("refund success reverses once; refund-before-payment remains terminal without a transient grant", async () => {
    const { app, provider } = enabled(), who = await actor(), paid = await checkout(app, who);
    assert.equal((await webhook(app, event(provider, paid.id))).status, 200);
    const refund = event(provider, paid.id, { kind: "payment.refunded" });
    const replies = await Promise.all([webhook(app, refund), webhook(app, refund), webhook(app, { ...refund, eventId: randomUUID() })]);
    assert.ok(replies.every((r) => r.status === 200));
    assert.deepEqual(await totals(paid.id), { n: 2, credits: 0 });
    assert.equal((await webhook(app, event(provider, paid.id))).status, 200);
    assert.equal((await totals(paid.id)).credits, 0);
    const early = await checkout(app, who);
    assert.equal((await webhook(app, event(provider, early.id, { kind: "payment.refunded" }))).status, 200);
    assert.equal((await webhook(app, event(provider, early.id))).status, 200);
    assert.equal((await state(early.id)).status, "refunded"); assert.equal((await totals(early.id)).n, 0);
  });
  await t.test("one payment cannot fund a second order; transactional conflict rolls back its event and grant", async () => {
    const { app, provider } = enabled(), who = await actor();
    const first = await checkout(app, who), second = await checkout(app, who);
    assert.equal((await webhook(app, event(provider, first.id))).status, 200);
    const reused = event(provider, second.id, { paymentId: `payment-${first.id}` });
    assert.equal((await webhook(app, reused)).status, 503);
    assert.equal((await state(second.id)).status, "pending"); assert.equal((await totals(second.id)).n, 0);
    const rows = await database().execute(sql`SELECT id FROM billing_events WHERE provider_event_id=${reused.eventId}`);
    assert.equal(rows.length, 0);
  });
  await t.test("early webhook retries only after checkout binding exists; no premature acknowledgement or credit", async () => {
    const { app, provider } = enabled(), who = await actor();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { entered = r; });
    provider.gate = async () => { entered(); await waiting; };
    const pending = request(app, who, "/billing/checkout", "POST", input());
    let payment!: VerifiedPaymentEvent;
    try {
      await started;
      const id = [...provider.commands.keys()][0]; payment = event(provider, id);
      const early = await webhook(app, payment);
      assert.equal(early.status, 503); assert.equal((await early.json()).code, "CHECKOUT_BINDING_PENDING");
      assert.equal((await totals(id)).n, 0);
    } finally { release(); }
    assert.equal((await pending).status, 200);
    assert.equal((await webhook(app, payment)).status, 200);
    assert.equal((await totals(payment.orderId)).credits, 80);
  });
  await t.test("ledger database failure rolls back event and order; the identical delivery succeeds on retry", async () => {
    const { app, provider } = enabled(), who = await actor(), order = await checkout(app, who);
    const payment = event(provider, order.id);
    await database().execute(sql`CREATE FUNCTION billing_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated ledger failure'; END; $$`);
    await database().execute(sql`CREATE TRIGGER billing_test_failure BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION billing_test_fail()`);
    try {
      assert.equal((await webhook(app, payment)).status, 503);
      assert.equal((await state(order.id)).status, "pending"); assert.equal((await totals(order.id)).n, 0);
      const rows = await database().execute(sql`SELECT id FROM billing_events WHERE provider_event_id=${payment.eventId}`);
      assert.equal(rows.length, 0);
    } finally {
      await database().execute(sql`DROP TRIGGER billing_test_failure ON credit_ledger`);
      await database().execute(sql`DROP FUNCTION billing_test_fail()`);
    }
    assert.equal((await webhook(app, payment)).status, 200); assert.equal((await totals(order.id)).credits, 80);
  });
});
