import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "../db";
import type { Account } from "../account";
import { billingProviderIds, type BillingCatalogResponse, type BillingCheckoutRequest,
  type BillingCheckoutResponse, type BillingOrder, type BillingProviderId } from "../../lib/billing";
import { defaultCatalog, priced, type CreditPack } from "./catalog";
import { defaultProviders, type BillingProvider, type ProviderRegistry } from "./providers";
import { billingOrders as orders, billingEvents as events, creditLedger as ledger, type OrderRow } from "./schema";

export class BillingError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
    readonly code: string, message: string) { super(message); }
}
const id = z.string().min(1).max(200);
const verifiedEventSchema = z.object({
  eventId: id,
  environment: z.enum(["test", "live"]),
  merchantAccountId: id,
  orderId: z.uuid(),
  userId: z.uuid(),
  productId: id,
  providerProductId: id,
  checkoutId: id,
  paymentId: id.nullable(),
  kind: z.enum(["payment.succeeded", "payment.failed", "checkout.canceled", "payment.refunded"]),
  amountMinor: z.number().int().positive().max(2_147_483_647),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict().refine((e) => !["payment.succeeded", "payment.refunded"].includes(e.kind) || !!e.paymentId);

function publicOrder(row: OrderRow): BillingOrder {
  return {
    id: row.id, productId: row.productId, productName: row.productName,
    priceVersion: row.priceVersion, provider: row.provider, environment: row.environment,
    status: row.status, checkoutStatus: row.checkoutStatus,
    amountMinor: row.amountMinor, currency: row.currency, credits: row.credits,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
function checkoutUrl(adapter: BillingProvider, raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !adapter.checkoutHosts.includes(url.hostname)) throw new Error();
    return url.href;
  } catch {
    throw new BillingError(503, "INVALID_CHECKOUT_RESPONSE", "The payment service did not return a valid checkout.");
  }
}
export type BillingOptions = {
  catalog?: readonly CreditPack[];
  providers?: ProviderRegistry;
  // Explicit code-level gate. No environment variable enables live collection.
  salesEnabled?: boolean;
};
export class BillingService {
  private readonly packs: readonly CreditPack[];
  private readonly providers: ProviderRegistry;
  private readonly salesEnabled: boolean;
  constructor(options: BillingOptions = {}) {
    this.packs = options.catalog ?? defaultCatalog;
    this.providers = options.providers ?? defaultProviders;
    this.salesEnabled = options.salesEnabled === true;
    if (new Set(this.packs.map((p) => p.id)).size !== this.packs.length)
      throw new Error("Duplicate billing product IDs");
  }
  private provider(providerId: BillingProviderId) {
    const adapter = this.providers[providerId];
    if (!adapter || adapter.id !== providerId || !adapter.isConfigured() ||
      !adapter.merchantAccountId || !["test", "live"].includes(adapter.environment))
      throw new BillingError(503, "PROVIDER_UNAVAILABLE", "This payment provider is not configured.");
    return adapter;
  }
  catalog(): BillingCatalogResponse {
    const providers = billingProviderIds.map((id) => {
      try { this.provider(id); return { id, available: this.salesEnabled }; }
      catch { return { id, available: false }; }
    });
    const products = this.packs.map((pack) => ({
      id: pack.id, name: pack.name, description: pack.description, credits: pack.credits,
      price: pack.amountMinor !== null && pack.currency !== null
        ? { amountMinor: pack.amountMinor, currency: pack.currency } : null,
      available: this.salesEnabled && priced(pack) && providers.some((p) =>
        p.available && !!pack.providerProducts[p.id]?.[this.provider(p.id).environment]),
    }));
    return { mode: "one-time-credits", checkoutEnabled: products.some((p) => p.available), products, providers };
  }
  async summary(userId: string, previewAccess: boolean) {
    const rows = await database().select({ environment: ledger.environment,
      total: sql<string>`sum(${ledger.credits})::text` }).from(ledger)
      .where(eq(ledger.userId, userId)).groupBy(ledger.environment);
    const amount = (environment: "test" | "live") => {
      const n = Number(rows.find((r) => r.environment === environment)?.total ?? "0");
      if (!Number.isSafeInteger(n) || n < 0)
        throw new BillingError(503, "BALANCE_REVIEW_REQUIRED", "Your balance needs review.");
      return n;
    };
    return { balanceCredits: amount("live"), testBalanceCredits: amount("test"),
      checkoutEnabled: this.catalog().checkoutEnabled, generationChargingEnabled: false as const, previewAccess };
  }
  async list(userId: string) {
    const rows = await database().select().from(orders).where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(50);
    return { orders: rows.map(publicOrder) };
  }
  async get(userId: string, orderId: string) {
    if (!z.uuid().safeParse(orderId).success)
      throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const [row] = await database().select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!row) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    return { order: publicOrder(row) };
  }
  async checkout(user: Account, input: BillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    // All availability checks happen before reserving an order.
    const adapter = this.provider(input.provider);
    if (!this.salesEnabled)
      throw new BillingError(503, "SALES_DISABLED", "Purchasing is not available yet.");
    const pack = this.packs.find((p) => p.id === input.productId);
    if (!pack || !priced(pack) || !pack.providerProducts[adapter.id]?.[adapter.environment])
      throw new BillingError(409, "PRODUCT_UNAVAILABLE", "This credit pack is not available.");
    const leaseToken = randomUUID();
    const row = await database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${user.id}:${input.requestId}`}, 0))`);
      const [prior] = await tx.select().from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, input.requestId))).for("update");
      if (prior) {
        if (prior.productId !== input.productId || prior.provider !== adapter.id ||
          prior.environment !== adapter.environment || prior.merchantAccountId !== adapter.merchantAccountId)
          throw new BillingError(409, "IDEMPOTENCY_CONFLICT", "This request ID was used for another checkout.");
        if (prior.status === "paid" || prior.status === "refunded")
          throw new BillingError(409, "ORDER_NOT_PAYABLE", "This order is no longer awaiting payment.");
        if (prior.leaseUntil && prior.leaseUntil > new Date())
          throw new BillingError(409, "CHECKOUT_IN_PROGRESS", "Checkout is being prepared. Retry with the same request ID.");
        const [claimed] = await tx.update(orders).set({ checkoutStatus: "creating", leaseToken,
          leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() })
          .where(eq(orders.id, prior.id)).returning();
        return claimed;
      }
      const [created] = await tx.insert(orders).values({
        id: randomUUID(), userId: user.id, requestId: input.requestId,
        productId: pack.id, productName: pack.name, priceVersion: pack.priceVersion,
        provider: adapter.id, environment: adapter.environment, merchantAccountId: adapter.merchantAccountId,
        providerProductId: pack.providerProducts[adapter.id]![adapter.environment]!,
        amountMinor: pack.amountMinor!, currency: pack.currency!, credits: pack.credits!,
        leaseToken, leaseUntil: new Date(Date.now() + 60_000),
      }).returning();
      return created;
    });
    try {
      const result = await adapter.createCheckout({
        orderId: row.id, userId: user.id, buyerEmail: user.email,
        productId: row.productId, providerProductId: row.providerProductId, priceVersion: row.priceVersion,
        amountMinor: row.amountMinor, currency: row.currency, credits: row.credits,
        idempotencyKey: row.id,
      });
      const url = checkoutUrl(adapter, result.checkoutUrl);
      if (!id.safeParse(result.checkoutId).success)
        throw new BillingError(503, "INVALID_CHECKOUT_RESPONSE", "The payment service returned an invalid reference.");
      const saved = await database().transaction(async (tx) => {
        const [current] = await tx.select().from(orders).where(eq(orders.id, row.id)).for("update");
        if (current.leaseToken !== leaseToken)
          throw new BillingError(409, "CHECKOUT_IN_PROGRESS", "Another retry is preparing checkout. Retry with the same request ID.");
        if (current.providerCheckoutId && current.providerCheckoutId !== result.checkoutId)
          throw new BillingError(503, "PROVIDER_IDEMPOTENCY_VIOLATION", "Checkout needs review before another attempt.");
        const [updated] = await tx.update(orders).set({ providerCheckoutId: result.checkoutId,
          checkoutStatus: "ready", leaseToken: null, leaseUntil: null, updatedAt: new Date() })
          .where(eq(orders.id, row.id)).returning();
        return updated;
      });
      return { order: publicOrder(saved), checkoutUrl: url };
    } catch (error) {
      await database().update(orders).set({ checkoutStatus: "unknown", leaseToken: null,
        leaseUntil: null, updatedAt: new Date() }).where(and(eq(orders.id, row.id), eq(orders.leaseToken, leaseToken)));
      if (error instanceof BillingError) throw error;
      throw new BillingError(503, "CHECKOUT_UNCONFIRMED", "Checkout could not be confirmed. Retry with the same request ID; do not start another payment.");
    }
  }
  // The only event ingestion entry point accepts raw bytes, never a caller's normalized event.
  async webhook(providerId: BillingProviderId, rawBody: Uint8Array, headers: Headers) {
    const adapter = this.provider(providerId);
    let event: z.infer<typeof verifiedEventSchema>;
    try {
      event = verifiedEventSchema.parse(await adapter.verifyAndNormalizeWebhook({ rawBody, headers }));
    } catch {
      throw new BillingError(400, "INVALID_WEBHOOK", "Webhook verification failed.");
    }
    if (event.environment !== adapter.environment || event.merchantAccountId !== adapter.merchantAccountId)
      throw new BillingError(403, "WEBHOOK_SCOPE_MISMATCH", "Webhook scope does not match this provider.");
    const fingerprint = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    return database().transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, event.orderId)).for("update");
      if (!order) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
      if (order.provider !== adapter.id || order.environment !== event.environment ||
        order.merchantAccountId !== event.merchantAccountId || order.userId !== event.userId ||
        order.productId !== event.productId || order.providerProductId !== event.providerProductId ||
        order.amountMinor !== event.amountMinor || order.currency !== event.currency)
        throw new BillingError(409, "PAYMENT_MISMATCH", "Payment does not match the order snapshot.");
      if (!order.providerCheckoutId)
        throw new BillingError(503, "CHECKOUT_BINDING_PENDING", "Checkout binding is pending. Retry this event later.");
      const fundingEvent = event.kind === "payment.succeeded" || event.kind === "payment.refunded";
      if (order.providerCheckoutId !== event.checkoutId ||
        (fundingEvent && order.providerPaymentId && order.providerPaymentId !== event.paymentId))
        throw new BillingError(409, "PAYMENT_MISMATCH", "Payment reference does not match the order.");
      const eventId = randomUUID();
      const [inserted] = await tx.insert(events).values({ id: eventId, provider: adapter.id,
        environment: event.environment, merchantAccountId: event.merchantAccountId,
        providerEventId: event.eventId, orderId: order.id, fingerprint, kind: event.kind,
        providerPaymentId: event.paymentId,
        outcome: "ignored" }).onConflictDoNothing().returning();
      if (!inserted) {
        const [prior] = await tx.select().from(events).where(and(eq(events.provider, adapter.id),
          eq(events.environment, event.environment), eq(events.merchantAccountId, event.merchantAccountId),
          eq(events.providerEventId, event.eventId)));
        if (!prior || prior.fingerprint !== fingerprint)
          throw new BillingError(409, "EVENT_ID_CONFLICT", "An event ID was reused with different payment details.");
        return { ok: true, outcome: "duplicate" as const };
      }
      let status = order.status;
      let delta = 0;
      if (event.kind === "payment.refunded" && order.status !== "refunded") {
        status = "refunded";
        if (order.status === "paid") delta = -order.credits;
      } else if (event.kind === "payment.succeeded" &&
        ["pending", "failed", "canceled"].includes(order.status)) {
        status = "paid";
        delta = order.credits;
      } else if (order.status === "pending") {
        if (event.kind === "payment.failed") status = "failed";
        if (event.kind === "checkout.canceled") status = "canceled";
      }
      const applied = status !== order.status;
      if (applied) {
        // Unique provider/environment/merchant/payment ID prevents the same payment
        // being reused to fund another order, even under a different delivery ID.
        await tx.update(orders).set({ status, providerPaymentId: fundingEvent ? event.paymentId : order.providerPaymentId,
          updatedAt: new Date() }).where(eq(orders.id, order.id));
        if (delta !== 0) await tx.insert(ledger).values({ id: randomUUID(), userId: order.userId,
          orderId: order.id, environment: order.environment, eventId,
          kind: delta > 0 ? "purchase" : "refund", credits: delta });
        await tx.update(events).set({ outcome: "applied" }).where(eq(events.id, eventId));
      }
      return { ok: true, outcome: applied ? "applied" as const : "ignored" as const };
    });
  }
}
