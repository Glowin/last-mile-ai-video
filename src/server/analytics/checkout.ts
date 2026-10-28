import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../account";
import { checkoutAnalyticsSchema, type CheckoutAnalytics } from "../../lib/analytics-context";

export const ANALYTICS_CONSENT_COOKIE = "kr_analytics_consent";
export type OrderAnalytics = CheckoutAnalytics & { consentId: string };
export function checkoutAnalytics(c: Context, input: unknown): OrderAnalytics | null {
  const parsed = checkoutAnalyticsSchema.safeParse(input);
  const consent = z.uuid().safeParse(getCookie(c, ANALYTICS_CONSENT_COOKIE));
  return parsed.success && consent.success ? { ...parsed.data, consentId: consent.data } : null;
}

// Called only for a newly created order, inside its transaction. Replays cannot
// attach another browser's context or retroactively opt an untracked order in.
export async function bindOrderAnalytics(tx: Transaction, orderId: string, context: OrderAnalytics | null) {
  if (!context) return;
  await tx.execute(sql`
    INSERT INTO analytics_order_contexts(order_id, consent_id, ga_client_id, ga_session_id)
    SELECT ${orderId}, id, ${context.clientId}, ${context.sessionId}
    FROM analytics_browser_consents WHERE id = ${context.consentId}
    ON CONFLICT (order_id) DO NOTHING`);
}
