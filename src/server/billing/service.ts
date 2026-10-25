import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "../db";
import { lockWallet, grantPurchase, applyFullRefund, freezeRefund, unfreezeRefund, walletSummary, blockWalletForReview, resolveWalletReview } from "../credits/wallet";
import { GENERATION_CHARGING_ENABLED } from "../credits/config";
import { safePancakeDiagnosticCode } from "./pancake";
import { billingOptionsFromEnvironment, productionBillingRelease, type BillingReleaseApproval } from "./config";
import type { Account } from "../account";
import { billingProviderIds, type BillingCatalogResponse, type BillingCheckoutRequest,
  type BillingCheckoutResponse, type BillingEnvironment, type BillingOrder, type BillingProviderId, type BillingRefundResponse } from "../../lib/billing";
import { defaultCatalog, priced, type CreditPack } from "./catalog";
import { defaultProviders, type BillingProvider, type ProviderRegistry, type VerifiedPaymentEvent, type RefundCommand, type RefundResult } from "./providers";
import { billingOrders as orders, billingEvents as events, creditLedger as ledger, type OrderRow } from "./schema";

export class BillingError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
    readonly code: string, message: string) { super(message); }
}
const id = z.string().min(1).max(200);
const commonEvent = {
  eventId: id, environment: z.enum(["test", "live"]), merchantAccountId: id,
  orderId: z.uuid(), userId: z.uuid(), productId: id, providerProductId: id,
  paymentId: id.nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
};
const units = z.number().int().nonnegative().max(2_147_483_647);
const checkoutEventSchema = z.object({ ...commonEvent,
  evidenceType: z.literal("checkout").optional(), checkoutId: id,
  kind: z.enum(["payment.succeeded", "payment.failed", "checkout.canceled", "payment.refunded"]),
  amountMinor: units.positive(),
}).strict().refine((e) => !["payment.succeeded", "payment.refunded"].includes(e.kind) || !!e.paymentId);
const pancakeEventSchema = z.object({ ...commonEvent,
  evidenceType: z.literal("pancake"), providerOrderId: id, priceVersion: id,
  paymentId: id, kind: z.enum(["payment.succeeded", "payment.refunded"]),
  amountMinor: units.nullable(), subtotalMinor: units.nullable(), taxMinor: units.nullable(), totalMinor: units.nullable(),
  originalPaidAmountMinor: units.nullable(), reviewReason: id.nullable(), paidAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
const verifiedEventSchema = z.union([checkoutEventSchema, pancakeEventSchema]);

function publicOrder(row: OrderRow): BillingOrder {
  return {
    id: row.id, productId: row.productId, productName: row.productName,
    priceVersion: row.priceVersion, provider: row.provider, environment: row.environment,
    status: row.status, checkoutStatus: row.checkoutStatus,
    amountMinor: row.amountMinor, subtotalMinor: row.subtotalMinor, taxMinor: row.taxMinor,
    totalMinor: row.totalMinor, paidAmountMinor: row.paidAmountMinor, taxBehavior: "exclusive",
    refundStatus: row.refundStatus, reviewRequired: row.reviewReason !== null, paidAt: row.paidAt?.toISOString() ?? null,
    currency: row.currency, credits: row.credits,
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
  salesEnabled?: boolean;
  // Internal server policy; never populated from request data. Test remains the default.
  environment?: BillingEnvironment;
  releaseApproval?: BillingReleaseApproval;
  generationChargingEnabled?: boolean;
  assertIsolation?: () => Promise<void>;
};
export class BillingService {
  private readonly packs: readonly CreditPack[];
  private readonly providers: ProviderRegistry;
  private readonly salesEnabled: boolean;
  private readonly environment: BillingEnvironment;
  private readonly liveSalesApproved: boolean;
  private readonly generationChargingEnabled: boolean;
  private readonly assertIsolation: () => Promise<void>;
  constructor(options?: BillingOptions) {
    options ??= billingOptionsFromEnvironment();
    this.assertIsolation = options.assertIsolation ?? (async () => {});
    this.packs = options.catalog ?? defaultCatalog;
    this.providers = options.providers ?? defaultProviders;
    this.salesEnabled = options.salesEnabled === true;
    this.environment = options.environment ?? "test";
    this.liveSalesApproved = (options.releaseApproval ?? productionBillingRelease).liveSalesApproved === true;
    this.generationChargingEnabled = options.generationChargingEnabled ?? GENERATION_CHARGING_ENABLED;
    if (new Set(this.packs.map((p) => p.id)).size !== this.packs.length)
      throw new Error("Duplicate billing product IDs");
  }
  private provider(providerId: BillingProviderId, order?: Pick<OrderRow, "environment" | "merchantAccountId">) {
    const adapter = this.providers[providerId];
    if (!adapter || adapter.id !== providerId || !adapter.isConfigured() ||
      !adapter.merchantAccountId || !["test", "live"].includes(adapter.environment))
      throw new BillingError(503, "PROVIDER_UNAVAILABLE", "This payment provider is not configured.");
    if (adapter.environment !== this.environment)
      throw new BillingError(503, "PROVIDER_ENVIRONMENT_MISMATCH", "The payment provider does not match this billing environment.");
    if (order && (order.environment !== adapter.environment || order.merchantAccountId !== adapter.merchantAccountId))
      throw new BillingError(409, "PAYMENT_SCOPE_MISMATCH", "The order does not match this payment provider scope.");
    return adapter;
  }
  private salesAllowed() {
    return this.salesEnabled && (this.environment === "test" || this.liveSalesApproved);
  }
  catalog(): BillingCatalogResponse {
    const providers = billingProviderIds.map((id) => {
      try { const p = this.provider(id); return { id, available: this.salesAllowed(), environment: p.environment }; }
      catch { return { id, available: false, environment: null }; }
    });
    const products = this.packs.map((pack) => ({
      id: pack.id, name: pack.name, description: pack.description, credits: pack.credits,
      purchaseType: "one_time" as const, taxBehavior: "exclusive" as const, expiresAt: null, refundWindowDays: 14 as const,
      price: pack.amountMinor !== null && pack.currency !== null
        ? { amountMinor: pack.amountMinor, currency: pack.currency } : null,
      available: this.salesEnabled && priced(pack) && providers.some((p) =>
        p.available && !!pack.providerProducts[p.id]?.[this.provider(p.id).environment]),
    }));
    return { mode: "one-time-credits", environment: providers.find((p) => p.environment)?.environment ?? null, checkoutEnabled: products.some((p) => p.available), products, providers };
  }
  async summary(userId: string, previewAccess: boolean) {
    await this.assertIsolation();
    const wallet = await walletSummary(userId);
    return { ...wallet, balanceCredits: wallet.availableCredits + wallet.reservedCredits,
      testBalanceCredits: wallet.testAvailableCredits + wallet.testReservedCredits,
      checkoutEnabled: this.catalog().checkoutEnabled, generationChargingEnabled: this.generationChargingEnabled, previewAccess };
  }

  async list(userId: string) {
    await this.assertIsolation();
    const rows = await database().select().from(orders).where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(50);
    return { orders: rows.map(publicOrder) };
  }
  async get(userId: string, orderId: string) {
    await this.assertIsolation();
    if (!z.uuid().safeParse(orderId).success)
      throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const [row] = await database().select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!row) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    return { order: publicOrder(row) };
  }
  async checkout(user: Account, input: BillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    // All availability checks happen before database access or reserving an order.
    const adapter = this.provider(input.provider);
    if (!this.salesAllowed())
      throw new BillingError(503, "SALES_DISABLED", "Purchasing is not available yet.");
    const pack = this.packs.find((p) => p.id === input.productId);
    if (!pack || !priced(pack) || !pack.providerProducts[adapter.id]?.[adapter.environment])
      throw new BillingError(409, "PRODUCT_UNAVAILABLE", "This credit pack is not available.");
    await this.assertIsolation();
    const leaseToken = randomUUID();
    const row = await database().transaction(async (tx) => {
      await lockWallet(tx, user.id, adapter.environment);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${user.id}:${input.requestId}`}, 0))`);
      const [prior] = await tx.select().from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, input.requestId))).for("update");
      if (prior) {
        if (prior.productId !== input.productId || prior.provider !== adapter.id ||
          prior.environment !== adapter.environment || prior.merchantAccountId !== adapter.merchantAccountId)
          throw new BillingError(409, "IDEMPOTENCY_CONFLICT", "This request ID was used for another checkout.");
        if (Date.now() - prior.createdAt.getTime() >= 23 * 3_600_000)
          throw new BillingError(409, "CHECKOUT_RECONCILIATION_REQUIRED", "This checkout needs reconciliation; do not start another payment.");
        if (prior.reviewReason || prior.status === "paid" || prior.status === "refunded")
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
        amountMinor: pack.amountMinor!, subtotalMinor: pack.amountMinor!, currency: pack.currency!, credits: pack.credits!,
        leaseToken, leaseUntil: new Date(Date.now() + 60_000),
      }).returning();
      return created;
    });
    try {
      const result = await adapter.createCheckout({
        orderId: row.id, userId: user.id, buyerEmail: user.email,
        productId: row.productId, providerProductId: row.providerProductId, priceVersion: row.priceVersion,
        amountMinor: row.amountMinor, currency: row.currency, credits: row.credits, idempotencyKey: row.id,
      });
      const url = checkoutUrl(adapter, result.checkoutUrl);
      if (!id.safeParse(result.checkoutId).success)
        throw new BillingError(503, "INVALID_CHECKOUT_RESPONSE", "The payment service returned an invalid reference.");
      const saved = await database().transaction(async (tx) => {
        await lockWallet(tx, user.id, adapter.environment);
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
  async webhook(providerId: BillingProviderId, rawBody: Uint8Array, headers: Headers) {
    await this.assertIsolation();
    const adapter = this.provider(providerId);
    let event: VerifiedPaymentEvent;
    try { event = verifiedEventSchema.parse(await adapter.verifyAndNormalizeWebhook({ rawBody, headers })); }
    catch { throw new BillingError(400, "INVALID_WEBHOOK", "Webhook verification failed."); }
    return this.applyEvent(adapter, event);
  }
  // Internal operator/CLI entry only. No unauthenticated production debug route.
  // Reconciliation may run with sales closed, and never creates a new checkout.
  async reconcile(orderId: string) {
    await this.assertIsolation();
    if (!z.uuid().safeParse(orderId).success) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const [order] = await database().select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const adapter = this.provider(order.provider, order);
    if (!adapter.reconcile) throw new BillingError(503, "RECONCILIATION_UNAVAILABLE", "Provider reconciliation is unavailable.");
    const recovered = await adapter.reconcile(orderId);
    const results = [];
    for (const raw of recovered) {
      const event = verifiedEventSchema.parse(raw);
      if (event.orderId !== orderId) throw new BillingError(409, "PAYMENT_MISMATCH", "Reconciliation returned another order.");
      results.push(await this.applyEvent(adapter, event));
    }
    if (order.refundRequestId && adapter.reconcileRefund) {
      const command = this.refundCommand(order);
      const result = await adapter.reconcileRefund(command);
      await this.saveRefundResult(order, command, result);
    }
    return { results, ...(await this.get(order.userId, orderId)) };
  }
  private async applyEvent(adapter: BillingProvider, event: VerifiedPaymentEvent) {
    if (event.environment !== adapter.environment || event.merchantAccountId !== adapter.merchantAccountId ||
      (event.evidenceType === "pancake" && adapter.id !== "pancake"))
      throw new BillingError(403, "WEBHOOK_SCOPE_MISMATCH", "Webhook scope does not match this provider.");
    // Query recovery can supply the exact payment time missing from a callback.
    // It is enrichment, not conflicting money evidence for the same payment.
    const canonical = event.evidenceType === "pancake" ? { ...event, paidAt: null } : event;
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const [owner] = await database().select({ userId: orders.userId }).from(orders).where(eq(orders.id, event.orderId));
    if (!owner) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    if (owner.userId !== event.userId) throw new BillingError(409, "PAYMENT_MISMATCH", "Payment buyer does not match the order.");
    return database().transaction(async (tx) => {
      await lockWallet(tx, event.userId, event.environment);
      const [order] = await tx.select().from(orders).where(eq(orders.id, event.orderId)).for("update");
      if (!order) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
      if (order.provider !== adapter.id || order.environment !== event.environment ||
        order.merchantAccountId !== event.merchantAccountId || order.userId !== event.userId ||
        order.productId !== event.productId || order.providerProductId !== event.providerProductId || order.currency !== event.currency)
        throw new BillingError(409, "PAYMENT_MISMATCH", "Payment does not match the order snapshot.");
      const funding = event.kind === "payment.succeeded" || event.kind === "payment.refunded";
      if (funding && order.providerPaymentId && order.providerPaymentId !== event.paymentId)
        throw new BillingError(409, "PAYMENT_MISMATCH", "Payment reference does not match the order.");
      let reviewReason: string | null = null;
      if (event.evidenceType === "pancake") {
        if (order.priceVersion !== event.priceVersion || (order.providerOrderId && order.providerOrderId !== event.providerOrderId))
          throw new BillingError(409, "PAYMENT_MISMATCH", "Payment identity does not match the order snapshot.");
        reviewReason = event.reviewReason;
        if (event.subtotalMinor !== order.subtotalMinor || event.taxMinor === null || event.totalMinor === null ||
          event.totalMinor !== order.subtotalMinor + event.taxMinor || event.originalPaidAmountMinor !== event.totalMinor ||
          event.amountMinor !== event.totalMinor || event.amountMinor === 0)
          reviewReason ??= "PAYMENT_AMOUNT_REVIEW_REQUIRED";
        if ((order.paidAmountMinor !== null && order.paidAmountMinor !== event.originalPaidAmountMinor) ||
          (order.totalMinor !== null && order.totalMinor !== event.totalMinor) ||
          (order.taxMinor !== null && order.taxMinor !== event.taxMinor))
          reviewReason ??= "PAYMENT_RECEIPT_CHANGED_REVIEW_REQUIRED";
        if (event.paidAt && Date.parse(event.paidAt) > Date.now() + 60_000)
          throw new BillingError(409, "PAYMENT_TIME_REVIEW_REQUIRED", "The provider payment time is invalid.");
      } else {
        if (!order.providerCheckoutId)
          throw new BillingError(503, "CHECKOUT_BINDING_PENDING", "Checkout binding is pending. Retry this event later.");
        if (order.providerCheckoutId !== event.checkoutId || order.amountMinor !== event.amountMinor)
          throw new BillingError(409, "PAYMENT_MISMATCH", "Checkout or payment amount does not match the order.");
      }
      const eventId = randomUUID();
      let [record] = await tx.insert(events).values({ id: eventId, provider: adapter.id,
        environment: event.environment, merchantAccountId: event.merchantAccountId,
        providerEventId: event.eventId, orderId: order.id, fingerprint, kind: event.kind,
        providerPaymentId: event.paymentId, outcome: "ignored", evidence: [{ fingerprint, event }] }).onConflictDoNothing().returning();
      if (!record) {
        const [prior] = await tx.select().from(events).where(and(eq(events.provider, adapter.id),
          eq(events.environment, event.environment), eq(events.merchantAccountId, event.merchantAccountId), eq(events.providerEventId, event.eventId)));
        const observed = Array.isArray(prior?.evidence) && prior.evidence.some((e: unknown) =>
          typeof e === "object" && e !== null && "fingerprint" in e && e.fingerprint === fingerprint);
        if (!prior || prior.orderId !== order.id || prior.kind !== event.kind || prior.providerPaymentId !== event.paymentId ||
          (prior.fingerprint !== fingerprint && prior.outcome !== "review_required" && !observed))
          throw new BillingError(409, "EVENT_ID_CONFLICT", "An event ID was reused with different payment details.");
        if (prior.outcome !== "review_required") {
          if (event.evidenceType === "pancake" && event.paidAt && !order.paidAt && !reviewReason) {
            await tx.update(orders).set({ paidAt: new Date(event.paidAt) }).where(eq(orders.id, order.id));
            await tx.execute(sql`UPDATE credit_batches SET paid_at=${event.paidAt}::timestamptz
              WHERE order_id=${order.id}::uuid AND user_id=${order.userId}::uuid AND environment=${order.environment}`);
          }
          return { ok: true, outcome: "duplicate" as const };
        }
        record = prior;
        await tx.update(events).set({ fingerprint,
          evidence: sql`coalesce(${events.evidence}, '[]'::jsonb) || ${JSON.stringify([{ fingerprint, event }])}::jsonb`,
        }).where(eq(events.id, record.id));
      }
      const binding = event.evidenceType === "pancake" ? { providerOrderId: event.providerOrderId } : {};
      if (reviewReason) {
        await tx.update(orders).set({ ...binding, providerPaymentId: event.paymentId, reviewReason,
          ...(event.kind === "payment.refunded" ? { refundStatus: "review_required" as const } : {}), updatedAt: new Date() }).where(eq(orders.id, order.id));
        await blockWalletForReview(tx, { orderId: order.id, userId: order.userId, environment: order.environment }, reviewReason);
        await tx.update(events).set({ outcome: "review_required" }).where(eq(events.id, record.id));
        return { ok: true, outcome: "review_required" as const };
      }
      // A normal payment cannot undo a pending external refund investigation.
      if (order.refundStatus === "review_required" && event.kind === "payment.succeeded") {
        await tx.update(events).set({ outcome: "ignored" }).where(eq(events.id, record.id));
        return { ok: true, outcome: "ignored" as const };
      }
      let status = order.status, delta = 0;
      if (event.kind === "payment.refunded" && order.status !== "refunded") {
        status = "refunded";
        if (order.status === "paid") delta = -order.credits;
      } else if (event.kind === "payment.succeeded" && ["pending", "failed", "canceled"].includes(order.status)) {
        status = "paid"; delta = order.credits;
      } else if (order.status === "pending") {
        if (event.kind === "payment.failed") status = "failed";
        if (event.kind === "checkout.canceled") status = "canceled";
      }
      if (event.evidenceType === "pancake" && order.reviewReason)
        await resolveWalletReview(tx, { orderId: order.id, userId: order.userId, environment: order.environment }, "Authenticated complete payment evidence resolved this order hold");
      const paidAt = event.evidenceType === "pancake" ? (event.paidAt ? new Date(event.paidAt) : null) : new Date();
      // Unknown paid time uses order creation as a conservative eligibility bound.
      // It does not pretend checkout creation was the actual charge timestamp.
      const money = funding ? event.evidenceType === "pancake"
        ? { taxMinor: event.taxMinor, totalMinor: event.totalMinor, paidAmountMinor: event.originalPaidAmountMinor }
        : { taxMinor: 0, totalMinor: event.amountMinor, paidAmountMinor: event.amountMinor } : {};
      const applied = status !== order.status;
      await tx.update(orders).set({ ...binding, ...money, status,
        providerPaymentId: funding ? event.paymentId : order.providerPaymentId,
        paidAt: order.paidAt ?? paidAt,
        ...(event.kind === "payment.refunded" ? { refundStatus: "succeeded" as const } : {}),
        reviewReason: null, updatedAt: new Date() }).where(eq(orders.id, order.id));
      if (paidAt && !order.paidAt)
        await tx.execute(sql`UPDATE credit_batches SET paid_at=${paidAt.toISOString()}::timestamptz
          WHERE order_id=${order.id}::uuid AND user_id=${order.userId}::uuid AND environment=${order.environment}`);
      if (delta !== 0) {
        const command = { orderId: order.id, userId: order.userId, environment: order.environment, credits: order.credits };
        if (delta > 0) await grantPurchase(tx, { ...command, paidAt: paidAt ?? order.createdAt });
        else await applyFullRefund(tx, command); // external over-consumption is recorded as debt/block by wallet
        await tx.insert(ledger).values({ id: randomUUID(), userId: order.userId, orderId: order.id,
          environment: order.environment, eventId: record.id, kind: delta > 0 ? "purchase" : "refund", credits: delta });
      }
      if (applied && status === "refunded" && delta === 0)
        await applyFullRefund(tx, { orderId: order.id, userId: order.userId, environment: order.environment, credits: order.credits });
      await tx.update(events).set({ outcome: applied ? "applied" : "ignored" }).where(eq(events.id, record.id));
      return { ok: true, outcome: applied ? "applied" as const : "ignored" as const };
    });
  }
  private refundCommand(order: OrderRow): RefundCommand {
    if (!order.providerPaymentId || !order.paidAmountMinor || !order.refundRequestId)
      throw new BillingError(409, "REFUND_REVIEW_REQUIRED", "Payment details need review before a refund can be requested.");
    return { orderId: order.id, userId: order.userId, paymentId: order.providerPaymentId,
      amountMinor: order.paidAmountMinor, currency: order.currency, requestId: order.refundRequestId };
  }
  async requestRefund(userId: string, orderId: string): Promise<BillingRefundResponse> {
    await this.assertIsolation();
    if (!z.uuid().safeParse(orderId).success) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const [owned] = await database().select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!owned) throw new BillingError(404, "ORDER_NOT_FOUND", "Order not found.");
    const adapter = this.provider(owned.provider, owned);
    if (!adapter.requestRefund) throw new BillingError(503, "REFUND_UNAVAILABLE", "Refund requests are not available through this provider.");
    const { order, submit } = await database().transaction(async (tx) => {
      await lockWallet(tx, userId, owned.environment);
      const [current] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).for("update");
      if (current.refundStatus !== "none") return { order: current, submit: false };
      if (current.status !== "paid") throw new BillingError(409, "ORDER_NOT_REFUNDABLE", "Only paid orders can be refunded.");
      if (current.reviewReason || !current.paidAmountMinor || !current.providerPaymentId)
        throw new BillingError(409, "REFUND_REVIEW_REQUIRED", "This payment needs review before requesting a refund.");
      const now = new Date(), eligibleFrom = current.paidAt ?? current.createdAt;
      if (now.getTime() - eligibleFrom.getTime() > 14 * 86400_000)
        throw new BillingError(409, current.paidAt ? "REFUND_WINDOW_CLOSED" : "REFUND_PAYMENT_TIME_REQUIRED",
          current.paidAt ? "The 14-day refund window has closed." : "The payment time must be reconciled before refund eligibility can be confirmed.");
      const frozen = await freezeRefund(tx, { orderId, userId, environment: current.environment, now });
      if (!frozen.ok) throw new BillingError(409, "REFUND_PACK_USED_OR_RESERVED", "A full refund requires the entire pack to be unused and unreserved.");
      const [updated] = await tx.update(orders).set({ refundStatus: "submitting", refundRequestId: randomUUID(),
        refundRequestedAt: now, updatedAt: now }).where(eq(orders.id, orderId)).returning();
      return { order: updated, submit: true };
    });
    if (submit) {
      const command = this.refundCommand(order);
      let result: RefundResult;
      try { result = await adapter.requestRefund!(command); }
      catch (error) {
        console.warn(safePancakeDiagnosticCode(error)); // Code only; no SDK message, response or account data.
        result = { ticketId: null, status: "unknown" };
      } // Never release or repeat POST on ambiguity.
      await this.saveRefundResult(order, command, result);
    }
    const response = await this.get(userId, orderId);
    return { ...response, refundStatus: response.order.refundStatus };
  }
  private async saveRefundResult(order: OrderRow, command: RefundCommand, result: RefundResult) {
    const checked = z.object({ ticketId: id.nullable(), status: z.enum(["pending", "processing", "unknown", "failed", "rejected"]) }).parse(result);
    await database().transaction(async (tx) => {
      await lockWallet(tx, order.userId, order.environment);
      const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      // A callback may finish while the request is in flight. Never downgrade it.
      if (current.refundRequestId !== command.requestId || ["succeeded", "review_required"].includes(current.refundStatus)) return;
      if (["failed", "rejected"].includes(current.refundStatus) && !["failed", "rejected"].includes(checked.status)) {
        await blockWalletForReview(tx, { orderId: order.id, userId: order.userId, environment: order.environment }, "REFUND_TICKET_REOPENED_REVIEW");
        await tx.update(orders).set({ refundStatus: "review_required", reviewReason: "REFUND_TICKET_REOPENED_REVIEW", updatedAt: new Date() }).where(eq(orders.id, order.id));
        return;
      }
      if (["failed", "rejected"].includes(checked.status))
        await unfreezeRefund(tx, { orderId: order.id, userId: order.userId, environment: order.environment });
      await tx.update(orders).set({ refundStatus: checked.status,
        refundTicketId: checked.ticketId ?? current.refundTicketId, updatedAt: new Date() }).where(eq(orders.id, order.id));
    });
  }
}
