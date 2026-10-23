import type { BillingEnvironment, BillingProviderId } from "../../lib/billing";
import { STARTER_CREDIT_OFFER } from "../../lib/credit-offer";
export type CreditPack = {
  id: string; name: string; description: string; priceVersion: string;
  credits: number | null; amountMinor: number | null; currency: string | null; enabled: boolean;
  providerProducts: Partial<Record<BillingProviderId, Partial<Record<BillingEnvironment, string>>>>;
};
// Display approved pricing independently of collection availability.
export const defaultCatalog: readonly CreditPack[] = Object.freeze([{
  ...STARTER_CREDIT_OFFER,
  description: "150 credits. One-time purchase, no expiry or automatic renewal. Applicable tax is added at checkout.",
  enabled: true, providerProducts: {},
}]);
export const integerUnits = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 2_147_483_647;
export function priced(pack: CreditPack) {
  return pack.enabled && integerUnits(pack.amountMinor) && integerUnits(pack.credits) &&
    typeof pack.currency === "string" && /^[A-Z]{3}$/.test(pack.currency);
}
