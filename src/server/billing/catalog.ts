import type { BillingEnvironment, BillingProviderId } from "../../lib/billing";
export type CreditPack = {
  id: string;
  name: string;
  description: string;
  priceVersion: string;
  credits: number | null;
  amountMinor: number | null;
  currency: string | null;
  enabled: boolean;
  providerProducts: Partial<Record<BillingProviderId, Partial<Record<BillingEnvironment, string>>>>;
};
// No retail price/credit grant has been approved. A display placeholder is not a sale.
export const defaultCatalog: readonly CreditPack[] = Object.freeze([{
  id: "credits-starter",
  name: "One-time credits",
  description: "Credit packs are being prepared. Purchasing is not available yet.",
  priceVersion: "unpriced-v1",
  credits: null,
  amountMinor: null,
  currency: null,
  enabled: false,
  providerProducts: {},
}]);
export const integerUnits = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 2_147_483_647;
export function priced(pack: CreditPack) {
  return pack.enabled && integerUnits(pack.amountMinor) && integerUnits(pack.credits) &&
    typeof pack.currency === "string" && /^[A-Z]{3}$/.test(pack.currency);
}
