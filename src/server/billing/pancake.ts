import { createPublicKey } from "node:crypto";
import { WaffoPancake, verifyWebhook, type TaxCategory } from "@waffo/pancake-ts";
import { z } from "zod";
import type { BillingEnvironment } from "../../lib/billing";
import type { CheckoutCommand } from "./providers";

/** Audited npm release (not GitHub main): @waffo/pancake-ts@0.26.0,
 * gitHead 800e01025473a11b868e7c2f4681dd1f234cff94, 2026-10-21.
 * Sources:
 * https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session
 * https://docs.waffo.ai/api-reference/webhooks
 * https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments
 * SDK dist/index.{js,d.ts}: authenticated.create, verifyWebhook, WebhookEventData.
 *
 * SDK integration layer only: no BillingProvider registration or sales activation.
 * Service bridge TODO: locate the persisted order using signed external order ID,
 * then compare buyer identity, store/environment, exact amount/currency, and the
 * merchant-authored metadata (product, provider product, price version) against
 * its immutable snapshot. Bind providerOrderId and paymentId with uniqueness and
 * event deduplication inside the ledger transaction; preserve tax evidence.
 * Checkout's sessionId is a creation reference, NOT a webhook-observed field.
 * merchantId signs API requests; storeId is the independently verified webhook
 * scope. API-key environment comes from the key, not the SDK environment option.
 *
 * Before activation: reconcile lost callbacks/expired idempotency keys, verify
 * project-specific store/product ownership and key environment in a real sandbox.
 * SDK 0.26.0 omits taxIncluded from PriceSnapshot's type but forwards it; the
 * official endpoint documents it. Offline forwarding is not sandbox acceptance.
 */
export const PANCAKE_SDK_VERSION = "0.26.0";

export class PancakeError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PancakeError"; }
}
function reject(code: string): never { throw new PancakeError(code); }
const reference = z.string().min(1).max(200);
const display = z.string().max(32);
const minor = z.number().int().positive().max(2_147_483_647);
const currencySchema = z.enum(["USD", "EUR", "GBP", "HKD", "JPY", "CNY"]);
type Currency = z.infer<typeof currencySchema>;
const scale = (currency: Currency) => currency === "JPY" ? 0 : 2;

export function pancakeDisplayAmount(amountMinor: number, currency: string): string {
  const c = currencySchema.parse(currency);
  minor.parse(amountMinor);
  const value = BigInt(amountMinor);
  return scale(c) === 0 ? value.toString() : `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function pancakeMinorAmount(amount: string, currency: string): number {
  const c = currencySchema.parse(currency);
  if (typeof amount !== "string" || amount.length > 32 ||
    !(scale(c) === 0 ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)(\.\d{1,2})?$/).test(amount))
    reject("PANCAKE_INVALID_AMOUNT");
  const [whole, fraction = ""] = amount.split(".");
  const value = scale(c) === 0 ? BigInt(whole) : BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (value > 2_147_483_647n) reject("PANCAKE_INVALID_AMOUNT");
  return Number(value);
}

const breakdownSchema = z.object({ total: display, subtotal: display.optional(), taxAmount: display,
  taxRate: z.number().finite().optional(), taxName: z.string().optional() });
const metadataSchema = z.object({
  kakareel_schema: z.literal("one-time-v1"),
  kakareel_order_id: z.uuid(), kakareel_user_id: z.uuid(),
  kakareel_product_id: reference, kakareel_provider_product_id: reference,
  kakareel_price_version: reference,
});
// Validate fields used for money/identity decisions. Zod strips unrelated added
// fields, so a benign provider schema extension does not stop paid-order delivery.
// Explicitly reject the competing legacy event discriminator instead of accepting
// two schemas with potentially contradictory meanings.
const dataSchema = z.object({
  orderId: reference, orderStatus: z.literal("completed"),
  merchantProvidedBuyerIdentity: z.uuid(), orderMerchantExternalId: z.uuid(),
  currency: currencySchema, orderMetadata: metadataSchema,
  chargedAmount: display.optional(), refundedAmount: display.optional(), originalChargedAmount: display.optional(),
  listPrice: breakdownSchema.optional(), originalPayment: breakdownSchema.optional(),
  amount: display.optional(),
  paymentId: reference, paymentStatus: z.literal("succeeded"),
  // These identify subscription refunds, unsupported by this one-time layer.
  periodNumber: z.number().nullable().optional(), billingPeriod: z.string().nullable().optional(),
  refundStatus: z.string().optional(),
});
const eventSchema = z.object({
  // SDK guide says delivery UUID; current endpoint examples use PAY_/REF_. Keep
  // these opaque and retain both identifiers, without enforcing either prefix.
  id: reference, timestamp: z.iso.datetime({ offset: true }),
  eventType: z.enum(["order.completed", "refund.succeeded"]), event: z.never().optional(),
  eventId: reference, storeId: reference, mode: z.enum(["test", "prod"]), data: dataSchema,
});

// JSON.parse silently keeps the last duplicate member. Run this AFTER RSA
// verification, including escaped member names and nested metadata objects.
function rejectDuplicateMembers(raw: string) {
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)!;
  let i = 0;
  function value(depth: number): void {
    if (depth > 64) reject("PANCAKE_INVALID_JSON");
    const token = tokens[i++];
    if (token === "{") {
      const keys = new Set<string>();
      while (tokens[i] !== "}") {
        const key: string = JSON.parse(tokens[i++]);
        if (keys.has(key)) reject("PANCAKE_DUPLICATE_JSON_MEMBER");
        keys.add(key); i++; // colon; JSON validity was already checked by SDK
        value(depth + 1);
        if (tokens[i] !== ",") break;
        i++;
      }
      i++;
    } else if (token === "[") {
      while (tokens[i] !== "]") {
        value(depth + 1);
        if (tokens[i] !== ",") break;
        i++;
      }
      i++;
    }
  }
  value(0);
}

export type PancakePaymentEvidence = {
  deliveryId: string;
  businessEventId: string;
  providerOrderId: string;
  environment: BillingEnvironment;
  storeId: string;
  orderId: string;
  userId: string;
  paymentId: string;
  kind: "payment.succeeded" | "payment.refunded";
  amountMinor: number;
  currency: Currency;
  // A signed merchant-authored echo, not a provider-observed product/session ID.
  checkoutMetadata: z.infer<typeof metadataSchema>;
  price: { totalMinor: number; taxMinor: number; subtotalMinor?: number };
};
export type PancakeWebhookScope = {
  environment: BillingEnvironment;
  storeId: string;
  // Explicit project-selected platform key. Never use SDK env/auto-test fallback.
  platformPublicKey: string;
};

export function verifyPancakePaymentEvidence(input: { rawBody: Uint8Array; headers: Headers },
  scope: PancakeWebhookScope): PancakePaymentEvidence {
  if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > 262_144) reject("PANCAKE_INVALID_BODY");
  if (!["test", "live"].includes(scope.environment) || !reference.safeParse(scope.storeId).success ||
    !scope.platformPublicKey.trim()) reject("PANCAKE_INVALID_SCOPE");
  const signature = input.headers.get("x-waffo-signature");
  // Require one timestamp and one signature; allow order/whitespace and future
  // signature versions. Never accept duplicate members or non-integer timestamps.
  const parts = new Map<string, string>();
  for (const entry of signature?.split(",") ?? []) {
    const at = entry.indexOf("=");
    if (at < 1) reject("PANCAKE_INVALID_SIGNATURE");
    const name = entry.slice(0, at).trim(), value = entry.slice(at + 1).trim();
    if (parts.has(name)) reject("PANCAKE_INVALID_SIGNATURE");
    parts.set(name, value);
  }
  const timestamp = parts.get("t"), v1 = parts.get("v1");
  if (!timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) ||
    !v1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v1)) reject("PANCAKE_INVALID_SIGNATURE");
  let raw: string;
  let verified: unknown;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.rawBody);
    if (!Buffer.from(raw, "utf8").equals(Buffer.from(input.rawBody))) reject("PANCAKE_INVALID_BODY");
    verified = verifyWebhook(raw, signature, {
      publicKey: scope.platformPublicKey, environment: scope.environment === "live" ? "prod" : "test",
      toleranceMs: 2_700_000, futureToleranceMs: 60_000,
    });
  } catch { reject("PANCAKE_INVALID_SIGNATURE"); }
  rejectDuplicateMembers(raw);
  const parsed = eventSchema.safeParse(verified);
  if (!parsed.success) reject("PANCAKE_UNSUPPORTED_OR_INCOMPLETE_EVENT");
  const e = parsed.data, d = e.data;
  if (e.mode !== (scope.environment === "live" ? "prod" : "test") || e.storeId !== scope.storeId)
    reject("PANCAKE_SCOPE_MISMATCH");
  const eventHeader = input.headers.get("x-waffo-event");
  if (eventHeader !== null && eventHeader !== e.eventType) reject("PANCAKE_EVENT_TYPE_MISMATCH");
  const eventAge = Date.now() - Date.parse(e.timestamp);
  if (eventAge > 2_700_000 || eventAge < -60_000) reject("PANCAKE_EVENT_TIME_OUTSIDE_WINDOW");
  if (d.orderMetadata.kakareel_order_id !== d.orderMerchantExternalId ||
    d.orderMetadata.kakareel_user_id !== d.merchantProvidedBuyerIdentity) reject("PANCAKE_IDENTITY_MISMATCH");
  if (d.periodNumber != null || d.billingPeriod != null) reject("PANCAKE_UNSUPPORTED_EVENT");
  const refund = e.eventType === "refund.succeeded";
  if (!refund && (e.eventId !== d.paymentId || d.refundStatus !== undefined || d.refundedAmount !== undefined ||
    d.originalChargedAmount !== undefined || d.originalPayment !== undefined)) reject("PANCAKE_EVENT_TYPE_MISMATCH");
  if (refund && (d.refundStatus !== "succeeded" || d.chargedAmount !== undefined || d.listPrice !== undefined ||
    e.eventId === d.paymentId)) reject("PANCAKE_EVENT_TYPE_MISMATCH");
  const actual = refund ? d.refundedAmount : d.chargedAmount;
  const snapshot = refund ? d.originalPayment : d.listPrice;
  if (actual === undefined || snapshot === undefined || (refund && d.originalChargedAmount === undefined))
    reject("PANCAKE_MISSING_ACTUAL_AMOUNT");
  const amountMinor = pancakeMinorAmount(actual, d.currency);
  const totalMinor = pancakeMinorAmount(snapshot.total, d.currency);
  const taxMinor = pancakeMinorAmount(snapshot.taxAmount, d.currency);
  const subtotalMinor = snapshot.subtotal === undefined ? undefined : pancakeMinorAmount(snapshot.subtotal, d.currency);
  if (amountMinor <= 0 || amountMinor !== totalMinor || taxMinor > totalMinor ||
    (subtotalMinor !== undefined && subtotalMinor + taxMinor !== totalMinor)) reject("PANCAKE_AMOUNT_MISMATCH");
  if (refund && pancakeMinorAmount(d.originalChargedAmount!, d.currency) !== amountMinor)
    reject("PANCAKE_PARTIAL_REFUND_UNSUPPORTED");
  if (d.amount !== undefined && pancakeMinorAmount(d.amount, d.currency) !== amountMinor)
    reject("PANCAKE_CONFLICTING_AMOUNT_FIELDS");
  return {
    deliveryId: e.id, businessEventId: e.eventId, providerOrderId: d.orderId,
    environment: scope.environment, storeId: e.storeId, orderId: d.orderMerchantExternalId,
    userId: d.merchantProvidedBuyerIdentity, paymentId: d.paymentId,
    kind: refund ? "payment.refunded" : "payment.succeeded", amountMinor, currency: d.currency,
    checkoutMetadata: d.orderMetadata, price: { totalMinor, taxMinor, ...(subtotalMinor === undefined ? {} : { subtotalMinor }) },
  };
}

export type PancakeProduct = {
  productId: string; providerProductId: string; priceVersion: string;
  currency: Currency; amountMinor: number; credits: number; taxCategory: TaxCategory;
};
export type PancakeOptions = PancakeWebhookScope & {
  merchantId: string;
  privateKey: string;
  products: readonly PancakeProduct[];
  successUrl: string;
  /** Read a persisted local order creation time, never Date.now() or an in-memory
   * first-seen timestamp. Missing/old orders must be reconciled, not recreated. */
  getOrderCreatedAt(orderId: string): Promise<Date | null>;
  /** Actual SDK transport injection for offline tests; no alternate SDK protocol. */
  fetch?: typeof fetch;
};

export class PancakeClient {
  readonly environment: BillingEnvironment;
  readonly merchantId: string;
  readonly storeId: string;
  readonly checkoutHosts = Object.freeze(["pancake.waffo.ai", "checkout.waffo.ai"]);
  private readonly client: WaffoPancake;
  private readonly options: PancakeOptions;
  constructor(options: PancakeOptions) {
    if (!reference.safeParse(options.merchantId).success || !reference.safeParse(options.storeId).success ||
      !["test", "live"].includes(options.environment)) reject("PANCAKE_INVALID_CONFIG");
    const key = createPublicKey(options.platformPublicKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      reject("PANCAKE_INVALID_PLATFORM_KEY");
    const url = new URL(options.successUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) reject("PANCAKE_INVALID_RETURN_URL");
    const identities = new Set<string>();
    for (const product of options.products) {
      const identity = JSON.stringify([product.productId, product.priceVersion]);
      if (identities.has(identity)) reject("PANCAKE_DUPLICATE_PRODUCT");
      identities.add(identity);
      reference.parse(product.productId); reference.parse(product.priceVersion);
      reference.parse(product.providerProductId);
      pancakeDisplayAmount(product.amountMinor, product.currency); minor.parse(product.credits);
    }
    this.environment = options.environment; this.merchantId = options.merchantId; this.storeId = options.storeId;
    this.options = { ...options, products: options.products.map((p) => Object.freeze({ ...p })) };
    this.client = new WaffoPancake({ merchantId: options.merchantId, privateKey: options.privateKey,
      environment: options.environment === "live" ? "prod" : "test", fetch: options.fetch,
      webhookPublicKey: options.platformPublicKey });
  }
  async createCheckout(command: CheckoutCommand): Promise<{ sessionId: string; checkoutUrl: string }> {
    z.uuid().parse(command.orderId); z.uuid().parse(command.userId);
    z.email().parse(command.buyerEmail);
    if (command.idempotencyKey !== command.orderId) reject("PANCAKE_INVALID_IDEMPOTENCY_KEY");
    const product = this.options.products.find((p) => p.productId === command.productId && p.priceVersion === command.priceVersion);
    if (!product || product.providerProductId !== command.providerProductId || product.amountMinor !== command.amountMinor ||
      product.currency !== command.currency || product.credits !== command.credits) reject("PANCAKE_PRODUCT_SNAPSHOT_MISMATCH");
    const createdAt = await this.options.getOrderCreatedAt(command.orderId);
    const age = createdAt instanceof Date ? Date.now() - createdAt.getTime() : NaN;
    if (!Number.isFinite(age) || age < 0 || age >= 23 * 3_600_000) reject("PANCAKE_CHECKOUT_RECONCILIATION_REQUIRED");
    // Official endpoint documents taxIncluded; 0.26.0's narrower PriceSnapshot
    // type omits it, but its authenticated wrapper forwards this object unchanged.
    const priceSnapshot = { amount: pancakeDisplayAmount(command.amountMinor, command.currency),
      taxCategory: product.taxCategory, taxIncluded: true };
    const metadata: z.infer<typeof metadataSchema> = {
      kakareel_schema: "one-time-v1", kakareel_order_id: command.orderId, kakareel_user_id: command.userId,
      kakareel_product_id: command.productId, kakareel_provider_product_id: command.providerProductId,
      kakareel_price_version: command.priceVersion,
    };
    const successUrl = new URL(this.options.successUrl);
    successUrl.searchParams.set("orderId", command.orderId);
    let result;
    try {
      result = await this.client.checkout.authenticated.create({
        productId: command.providerProductId, currency: command.currency, priceSnapshot,
        buyerIdentity: command.userId, buyerEmail: command.buyerEmail, orderMerchantExternalId: command.orderId,
        metadata, successUrl: successUrl.href, expiresInSeconds: 3600,
      }, { idempotencyKey: command.orderId });
    } catch { reject("PANCAKE_CHECKOUT_UNCONFIRMED"); }
    try {
      if (!reference.safeParse(result.sessionId).success ||
        !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now())
        reject("PANCAKE_INVALID_CHECKOUT_RESPONSE");
      const url = new URL(result.checkoutUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !this.checkoutHosts.includes(url.hostname) ||
        !result.token || url.hash !== `#token=${result.token}`) reject("PANCAKE_INVALID_CHECKOUT_RESPONSE");
      return { sessionId: result.sessionId, checkoutUrl: result.checkoutUrl };
    } catch { reject("PANCAKE_INVALID_CHECKOUT_RESPONSE"); }
  }
  verifyPaymentEvidence(input: { rawBody: Uint8Array; headers: Headers }): PancakePaymentEvidence {
    const evidence = verifyPancakePaymentEvidence(input, this.options);
    const m = evidence.checkoutMetadata;
    const product = this.options.products.find((p) => p.productId === m.kakareel_product_id && p.priceVersion === m.kakareel_price_version);
    if (!product || product.providerProductId !== m.kakareel_provider_product_id || product.amountMinor !== evidence.amountMinor ||
      product.currency !== evidence.currency) reject("PANCAKE_PRODUCT_SNAPSHOT_MISMATCH");
    return evidence;
  }
}
