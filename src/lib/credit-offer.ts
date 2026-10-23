// Shared public offer only. Sale availability always comes from the billing catalog.
export const STARTER_CREDIT_OFFER = {
  id: "credits-starter",
  name: "Starter Pack",
  priceVersion: "starter-usd19-150-v1",
  amountMinor: 1900,
  currency: "USD",
  credits: 150,
  purchaseType: "one_time",
  taxBehavior: "exclusive",
  expiresAfterDays: null,
  refundWindowDays: 14,
} as const;
