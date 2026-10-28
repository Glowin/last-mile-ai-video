// Browser-safe contracts. No credentials, checkout tokens, or SDKs.
export const billingProviderIds = ["pancake", "waffo", "stripe", "antom"] as const;
export type BillingProviderId = (typeof billingProviderIds)[number];
export type BillingEnvironment = "test" | "live";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "canceled" | "refunded";
export type BillingRefundStatus = "none" | "submitting" | "pending" | "processing" | "unknown" | "rejected" | "failed" | "succeeded" | "review_required";
export type BillingPrice = { amountMinor: number; currency: string };
export type BillingProduct = {
  id: string; name: string; description: string; credits: number | null;
  price: BillingPrice | null; available: boolean;
  purchaseType: "one_time"; taxBehavior: "exclusive"; expiresAt: null; refundWindowDays: 14;
};
export type BillingCatalogResponse = {
  mode: "one-time-credits"; environment: BillingEnvironment | null; checkoutEnabled: boolean; products: BillingProduct[];
  providers: { id: BillingProviderId; available: boolean; environment: BillingEnvironment | null }[];
};
// Authenticated one-person acceptance offer; public catalog remains closed.
export type BillingPilotResponse =
  | { catalog: BillingCatalogResponse; requestId: string; expiresAt: string }
  | { catalog: null; requestId: null; expiresAt: null };
export type GenerationPilotOffer = {
  requestId: string; expiresAt: string; available: boolean; jobId: string | null;
  spec: { family: "minimax"; mode: "image"; duration: 6; resolution: "2K"; ratio: "adaptive"; audio: false };
  credits: 23;
};
/** Browser hint only. The server independently checks identity, scope and slot. */
export function generationPilotInputAllowed(pilot: GenerationPilotOffer, input: Record<string, unknown>, now = Date.now()): boolean {
  return pilot.available && Number.isFinite(Date.parse(pilot.expiresAt)) && Date.parse(pilot.expiresAt) > now &&
    Object.entries(pilot.spec).every(([key, value]) => input[key] === value);
}
export type BillingSummaryResponse = {
  balanceCredits: number; testBalanceCredits: number;
  availableCredits: number; reservedCredits: number; testAvailableCredits: number; testReservedCredits: number;
  blocked: boolean; testBlocked: boolean; checkoutEnabled: boolean; generationChargingEnabled: boolean; previewAccess: boolean;
  generationPilot?: GenerationPilotOffer | null;
};
export type BillingOrder = {
  id: string; productId: string; productName: string; priceVersion: string;
  provider: BillingProviderId; environment: BillingEnvironment; status: BillingOrderStatus;
  checkoutStatus: "creating" | "ready" | "unknown";
  amountMinor: number; subtotalMinor: number; taxMinor: number | null; totalMinor: number | null;
  paidAmountMinor: number | null; taxBehavior: "exclusive";
  currency: string; credits: number; refundStatus: BillingRefundStatus; reviewRequired: boolean;
  paidAt: string | null; createdAt: string; updatedAt: string;
};
export type BillingOrdersResponse = { orders: BillingOrder[] };
export type BillingOrderResponse = { order: BillingOrder };
export type BillingCheckoutRequest = { productId: string; provider: BillingProviderId; requestId: string };
export type BillingCheckoutResponse = { order: BillingOrder; checkoutUrl: string };
// POST /api/billing/orders/:id/refund with {} and X-KakaReel-Owner + same-origin.
export type BillingRefundRequest = Record<string, never>;
export type BillingRefundResponse = { order: BillingOrder; refundStatus: BillingRefundStatus };
export type BillingErrorResponse = { error: string; code: string };
