import type { BillingEnvironment, BillingProviderId } from "../../lib/billing";

export type CheckoutCommand = {
  orderId: string;
  userId: string;
  buyerEmail: string;
  productId: string;
  providerProductId: string;
  priceVersion: string;
  amountMinor: number;
  currency: string;
  credits: number;
  idempotencyKey: string;
};
// Only adapters construct this AFTER authenticating raw bytes, timestamp/replay
// policy, environment and merchant/store. This is not an HTTP request schema.
export type VerifiedPaymentEvent = {
  eventId: string;
  environment: BillingEnvironment;
  merchantAccountId: string;
  orderId: string;
  userId: string;
  productId: string;
  providerProductId: string;
  checkoutId: string;
  paymentId: string | null;
  // "payment.failed" is a failed attempt, never proof that a later attempt cannot
  // pay this checkout. Unknown/partial/authorized-only payments are NOT success.
  kind: "payment.succeeded" | "payment.failed" | "checkout.canceled" | "payment.refunded";
  amountMinor: number;
  currency: string;
};
export interface BillingProvider {
  readonly id: BillingProviderId;
  readonly environment: BillingEnvironment;
  readonly merchantAccountId: string;
  readonly checkoutHosts: readonly string[];
  readonly capabilities: { hostedCheckout: true; fullRefundEvents: true; subscriptions: false };
  isConfigured(): boolean;
  // MUST honor this stable order idempotency key, including timeout/restart/retry.
  // Hosted URLs are returned transiently, never persisted/logged by billing.
  createCheckout(command: CheckoutCommand): Promise<{ checkoutId: string; checkoutUrl: string }>;
  // Signature algorithms are provider-specific. Never trust a caller's JSON
  // "verified" flag or redirect URL; reject incomplete/unsupported event types.
  // Refund events mean FULL successfully completed refund, not a ticket/request.
  verifyAndNormalizeWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<VerifiedPaymentEvent>;
}
export type ProviderRegistry = Partial<Record<BillingProviderId, BillingProvider>>;
// Deliberately empty: no SDK, env-variable activation, placeholder URL or mock in production.
export const defaultProviders: ProviderRegistry = Object.freeze({});
