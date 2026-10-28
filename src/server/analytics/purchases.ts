import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { billingOrders, type OrderRow } from "../billing/schema";
import { analyticsGaClients, analyticsPurchaseEvents } from "./schema";
import { measurementProtocolConfig, sendMeasurementProtocol, type Fetch, type MpConfig, type MpEvent } from "./measurement-protocol";

// Read-only with respect to billing: this module only reads billing_orders and
// writes its own analytics_purchase_events claim rows.
const MAX_ATTEMPTS = 5;
const SEVENTY_TWO_HOURS = 72 * 3_600_000;

export function purchaseEvent(order: Pick<OrderRow, "id" | "productId" | "productName" | "subtotalMinor" | "taxMinor" | "currency">): MpEvent {
  const value = order.subtotalMinor / 100;
  return {
    name: "purchase",
    params: {
      transaction_id: order.id, value, currency: order.currency,
      ...(order.taxMinor !== null ? { tax: order.taxMinor / 100 } : {}),
      items: [{ item_id: order.productId, item_name: order.productName, price: value, quantity: 1 }],
    },
  };
}

export type DispatchResult = { disabled: true } | { disabled: false; claimed: number; sent: number; skipped: number; failed: number };
let running: Promise<DispatchResult> | null = null;

/**
 * Send one GA4 purchase per paid live order, after the payment webhook/reconciliation
 * marked it paid. A claim row per order (unique on order_id) prevents duplicates across
 * requests and replicas. Orders whose buyer has no consented GA client ID are skipped.
 */
export function dispatchPaidPurchases(options: { limit?: number; config?: MpConfig | null; fetchImpl?: Fetch } = {}): Promise<DispatchResult> {
  const config = options.config === undefined ? measurementProtocolConfig() : options.config;
  if (!config || !process.env.DATABASE_URL) return Promise.resolve({ disabled: true });
  running ??= run(config, options.limit ?? 10, options.fetchImpl).finally(() => { running = null; });
  return running;
}

async function run(config: MpConfig, limit: number, fetchImpl?: Fetch): Promise<DispatchResult> {
  const db = database();
  const claimed = await db.execute<{ order_id: string }>(sql`
    WITH candidates AS (
      SELECT o.id FROM billing_orders o
      LEFT JOIN analytics_purchase_events a ON a.order_id = o.id
      WHERE o.environment = 'live' AND o.status = 'paid' AND o.review_reason IS NULL
        AND (a.order_id IS NULL OR (a.status IN ('pending','failed') AND a.attempts < ${MAX_ATTEMPTS}
          AND (a.lease_until IS NULL OR a.lease_until < now())))
      ORDER BY o.paid_at NULLS LAST, o.created_at
      LIMIT ${limit}
    )
    INSERT INTO analytics_purchase_events(order_id, status, attempts, lease_until)
    SELECT id, 'pending', 1, now() + interval '2 minutes' FROM candidates
    ON CONFLICT (order_id) DO UPDATE SET status = 'pending', attempts = analytics_purchase_events.attempts + 1,
      lease_until = excluded.lease_until, updated_at = now()
    WHERE analytics_purchase_events.status IN ('pending','failed') AND analytics_purchase_events.attempts < ${MAX_ATTEMPTS}
      AND (analytics_purchase_events.lease_until IS NULL OR analytics_purchase_events.lease_until < now())
    RETURNING order_id`);
  let sent = 0, skipped = 0, failed = 0;
  for (const { order_id: orderId } of claimed) {
    const mark = (status: "sent" | "failed" | "skipped_no_consent") => db.update(analyticsPurchaseEvents)
      .set({ status, leaseUntil: null, updatedAt: new Date(), ...(status === "sent" ? { sentAt: new Date() } : {}) })
      .where(eq(analyticsPurchaseEvents.orderId, orderId));
    try {
      const [order] = await db.select().from(billingOrders).where(eq(billingOrders.id, orderId));
      const [client] = order ? await db.select().from(analyticsGaClients).where(eq(analyticsGaClients.userId, order.userId)) : [];
      if (!order || !client) { await mark("skipped_no_consent"); skipped++; continue; }
      const paidAt = order.paidAt?.getTime();
      const ok = await sendMeasurementProtocol(config, client.gaClientId, [purchaseEvent(order)], {
        fetchImpl,
        // GA accepts back-dated events up to 72 hours; older ones are sent as "now".
        timestampMicros: paidAt && Date.now() - paidAt < SEVENTY_TWO_HOURS ? paidAt * 1000 : undefined,
      });
      await mark(ok ? "sent" : "failed");
      if (ok) sent++; else failed++;
    } catch {
      await mark("failed").catch(() => {});
      failed++;
    }
  }
  return { disabled: false, claimed: claimed.length, sent, skipped, failed };
}

/** Fire-and-forget trigger for HTTP paths. Never throws and never delays the response. */
export function triggerPurchaseDispatch() {
  if (!measurementProtocolConfig()) return;
  void dispatchPaidPurchases().catch(() => console.warn("ANALYTICS_PURCHASE_DISPATCH_FAILED"));
}
