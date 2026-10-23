import type { BillingEnvironment, BillingProviderId, BillingRefundStatus } from "../../lib/billing";
export type CheckoutCommand = {
  orderId: string; userId: string; buyerEmail: string; productId: string; providerProductId: string;
  priceVersion: string; amountMinor: number; currency: string; credits: number; idempotencyKey: string;
};
type EventBase = {
  eventId: string; environment: BillingEnvironment; merchantAccountId: string;
  orderId: string; userId: string; productId: string; providerProductId: string;
  paymentId: string | null; currency: string;
};
// Discriminated evidence: checkout binding remains mandatory for other providers.
export type CheckoutPaymentEvent = EventBase & {
  evidenceType?: "checkout"; checkoutId: string;
  kind: "payment.succeeded" | "payment.failed" | "checkout.canceled" | "payment.refunded";
  amountMinor: number;
};
export type PancakePaymentEvent = EventBase & {
  evidenceType: "pancake"; providerOrderId: string; priceVersion: string;
  kind: "payment.succeeded" | "payment.refunded";
  amountMinor: number | null; subtotalMinor: number | null; taxMinor: number | null; totalMinor: number | null;
  originalPaidAmountMinor: number | null; reviewReason: string | null;
  paidAt: string | null;
};
export type VerifiedPaymentEvent = CheckoutPaymentEvent | PancakePaymentEvent;
export type RefundCommand = {
  orderId: string; userId: string; paymentId: string; amountMinor: number; currency: string; requestId: string;
};
export type RefundResult = { ticketId: string | null; status: Exclude<BillingRefundStatus, "none" | "submitting" | "succeeded" | "review_required"> };
export interface BillingProvider {
  readonly id: BillingProviderId; readonly environment: BillingEnvironment;
  readonly merchantAccountId: string; readonly checkoutHosts: readonly string[];
  readonly capabilities: { hostedCheckout: true; fullRefundEvents: true; subscriptions: false };
  isConfigured(): boolean;
  createCheckout(command: CheckoutCommand): Promise<{ checkoutId: string; checkoutUrl: string }>;
  verifyAndNormalizeWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<VerifiedPaymentEvent>;
  reconcile?(orderId: string): Promise<VerifiedPaymentEvent[]>;
  requestRefund?(command: RefundCommand): Promise<RefundResult>;
  reconcileRefund?(command: RefundCommand): Promise<RefundResult>;
}
export type ProviderRegistry = Partial<Record<BillingProviderId, BillingProvider>>;
export const defaultProviders: ProviderRegistry = Object.freeze({});
