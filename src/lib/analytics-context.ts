import { z } from "zod";

export const analyticsConsentKey = "kakareel-analytics-consent";
export const checkoutAnalyticsSchema = z.object({
  clientId: z.string().regex(/^\d{1,12}\.\d{1,12}$/),
  sessionId: z.string().regex(/^\d{1,12}$/).refine((v) => Number(v) > 0),
}).strict();
export type CheckoutAnalytics = z.infer<typeof checkoutAnalyticsSchema>;

// A purchase outside the originating session is still a purchase, but must not
// be advertised as having that session's attribution. The tag uses GA's default
// 30-minute inactivity timeout; checkout is our last confirmed browser activity.
export function purchaseSessionParams(context: CheckoutAnalytics & { capturedAt: Date }, paidAt: number, now = Date.now()) {
  const start = Number(context.sessionId) * 1000;
  return start <= context.capturedAt.getTime() && paidAt >= context.capturedAt.getTime()
    && paidAt <= context.capturedAt.getTime() + 30 * 60_000
    && now >= paidAt && now < start + 24 * 3_600_000
    ? { session_id: Number(context.sessionId) } : {};
}
