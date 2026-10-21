// Browser-safe contracts. No provider credentials, checkout tokens, or SDKs.
export const billingProviderIds = ["pancake", "waffo", "stripe", "antom"] as const;
export type BillingProviderId = (typeof billingProviderIds)[number];
export type BillingEnvironment = "test" | "live";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "canceled" | "refunded";
export type BillingPrice = { amountMinor: number; currency: string };
export type BillingProduct = {
  id: string;
  name: string;
  description: string;
  credits: number | null;
  price: BillingPrice | null;
  available: boolean;
};
export type BillingCatalogResponse = {
  mode: "one-time-credits";
  checkoutEnabled: boolean;
  products: BillingProduct[];
  providers: { id: BillingProviderId; available: boolean }[];
};
export type BillingSummaryResponse = {
  balanceCredits: number;
  testBalanceCredits: number;
  checkoutEnabled: boolean;
  generationChargingEnabled: false;
  previewAccess: boolean;
};
export type BillingOrder = {
  id: string;
  productId: string;
  productName: string;
  priceVersion: string;
  provider: BillingProviderId;
  environment: BillingEnvironment;
  status: BillingOrderStatus;
  checkoutStatus: "creating" | "ready" | "unknown";
  amountMinor: number;
  currency: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
};
export type BillingOrdersResponse = { orders: BillingOrder[] };
export type BillingOrderResponse = { order: BillingOrder };
export type BillingCheckoutRequest = {
  productId: string;
  provider: BillingProviderId;
  requestId: string;
};
export type BillingCheckoutResponse = { order: BillingOrder; checkoutUrl: string };
export type BillingErrorResponse = { error: string; code: string };
