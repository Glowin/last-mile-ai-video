import { createPublicKey } from "node:crypto";
import { WaffoPancake, WaffoPancakeError, verifyWebhook, ErrorLayer, type TaxCategory } from "@waffo/pancake-ts";
import { z } from "zod";
import { diagnosePancakeRefund } from "./refund-diagnostics";
import { queryPancakeOrder, inspectPancakeSchema } from "./pancake-query";
import type { BillingEnvironment } from "../../lib/billing";
import type { BillingProvider, CheckoutCommand, PancakePaymentEvent, RefundCommand, RefundResult } from "./providers";

/** Audited npm release (not GitHub main): @waffo/pancake-ts@0.26.0,
 * gitHead 800e01025473a11b868e7c2f4681dd1f234cff94, 2026-10-21.
 * Sources:
 * https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session
 * https://docs.waffo.ai/api-reference/webhooks
 * https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments
 * SDK dist/index.{js,d.ts}: authenticated.create, verifyWebhook, WebhookEventData.
 *
 * The bridge binds signed external order IDs, store, buyer and merchant metadata
 * in the billing transaction. A checkout session ID is never fabricated.
 * SDK 0.26.0 exposes customer refund tickets (pending review), not merchant
 * approval. Keep pending until authenticated executed refund evidence arrives.
 *
 * Before activation: reconcile lost callbacks/expired idempotency keys, verify
 * project-specific store/product ownership and key environment in a real sandbox.
 * SDK 0.26.0 omits taxIncluded from PriceSnapshot's type but forwards it; the
 * official endpoint documents it. Offline forwarding is not sandbox acceptance.
 */
export const PANCAKE_SDK_VERSION = "0.26.0";
export const PANCAKE_REFUND_TICKET_QUERY = `query($paymentId: String!) {
  refundTickets(filter: { subjectId: { eq: $paymentId } }, limit: 100) {
    id subjectId status refundTicketMerchantExternalId versionData { requestedAmount { amount currency } }
  }
}`;

export class PancakeError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PancakeError"; }
}
function reject(code: string): never { throw new PancakeError(code); }
// Only locally assigned codes and integer HTTP status escape to server logs.
// Never log SDK message/errors, response bodies, buyer IDs, tokens or request data.
export function safePancakeDiagnosticCode(error: unknown): string {
  if (error instanceof PancakeError && (
    ["PANCAKE_REFUND_RESPONSE_MISMATCH", "PANCAKE_QUERY_UNCONFIRMED", "PANCAKE_REFUND_QUERY_TRUNCATED", "PANCAKE_QUERY_REVIEW_REQUIRED"].includes(error.code) ||
    /^PANCAKE_REFUND_(SESSION|SUBMISSION|QUERY)_(HTTP_[1-5][0-9]{2}|TRANSPORT_UNCONFIRMED)$/.test(error.code)
  )) return error.code;
  if (error instanceof WaffoPancakeError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599)
    return `PANCAKE_SDK_HTTP_${error.status}`;
  return "PANCAKE_TRANSPORT_UNCONFIRMED";
}
function refundStageError(stage: "SESSION" | "SUBMISSION" | "QUERY", error: unknown): never {
  const suffix = error instanceof WaffoPancakeError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
    ? `HTTP_${error.status}` : "TRANSPORT_UNCONFIRMED";
  reject(`PANCAKE_REFUND_${stage}_${suffix}`);
}

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

function verifyEnvelope(input: { rawBody: Uint8Array; headers: Headers },
  scope: PancakeWebhookScope) {
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
  return e;
}

export function verifyPancakePaymentEvidence(input: { rawBody: Uint8Array; headers: Headers },
  scope: PancakeWebhookScope): PancakePaymentEvidence {
  const e = verifyEnvelope(input, scope), d = e.data;
  const refund = e.eventType === "refund.succeeded";
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
    if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && !(options.environment === "test" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
      reject("PANCAKE_INVALID_RETURN_URL");
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
    const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    const checkedFetch: typeof fetch = async (input, init) => {
      const response = await transport(input, init);
      // SDK 0.26.0 unwrapAction checks errors[], not HTTP status. Preserve a
      // non-2xx rejection even when the gateway omits the standard error envelope.
      // This wrapper does not alter auth, body, idempotency, or retry any request.
      if (!response.ok) throw new WaffoPancakeError(response.status,
        [{ message: "Pancake HTTP request was not successful", layer: ErrorLayer.Gateway }]);
      return response;
    };
    this.client = new WaffoPancake({ merchantId: options.merchantId, privateKey: options.privateKey,
      environment: options.environment === "live" ? "prod" : "test", fetch: checkedFetch,
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
      taxCategory: product.taxCategory, taxIncluded: false };
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
  normalizeWebhook(input: { rawBody: Uint8Array; headers: Headers }): PancakePaymentEvent {
    const e = verifyEnvelope(input, this.options), d = e.data;
    const refund = e.eventType === "refund.succeeded";
    const snapshot = refund ? d.originalPayment : d.listPrice;
    const actual = refund ? d.refundedAmount : d.chargedAmount;
    const convert = (value: string | undefined) => value === undefined ? null : pancakeMinorAmount(value, d.currency);
    let amountMinor: number | null = null, totalMinor: number | null = null, taxMinor: number | null = null;
    let subtotalMinor: number | null = null, originalPaidAmountMinor: number | null = null, reviewReason: string | null = null;
    try {
      amountMinor = convert(actual); totalMinor = convert(snapshot?.total); taxMinor = convert(snapshot?.taxAmount);
      subtotalMinor = convert(snapshot?.subtotal);
      originalPaidAmountMinor = refund ? convert(d.originalChargedAmount) : amountMinor;
      if (amountMinor === null || totalMinor === null || taxMinor === null || subtotalMinor === null || originalPaidAmountMinor === null)
        reviewReason = "PANCAKE_MISSING_ACTUAL_AMOUNT";
      else if (amountMinor <= 0 || totalMinor !== subtotalMinor + taxMinor || totalMinor !== originalPaidAmountMinor ||
        (!refund && amountMinor !== totalMinor) || (d.amount !== undefined && convert(d.amount) !== amountMinor))
        reviewReason = "PANCAKE_AMOUNT_MISMATCH";
      else if (refund && amountMinor !== originalPaidAmountMinor) reviewReason = "PANCAKE_PARTIAL_REFUND_REVIEW";
    } catch { reviewReason = "PANCAKE_INVALID_AMOUNT"; }
    return {
      evidenceType: "pancake", eventId: e.eventId, environment: this.environment, merchantAccountId: this.storeId,
      orderId: d.orderMerchantExternalId, userId: d.merchantProvidedBuyerIdentity,
      productId: d.orderMetadata.kakareel_product_id, providerProductId: d.orderMetadata.kakareel_provider_product_id,
      priceVersion: d.orderMetadata.kakareel_price_version, providerOrderId: d.orderId, paymentId: d.paymentId,
      kind: refund ? "payment.refunded" : "payment.succeeded", currency: d.currency,
      amountMinor, totalMinor, taxMinor, subtotalMinor, originalPaidAmountMinor, reviewReason,
      // A delivery timestamp is not the payment time. GraphQL recovers the exact
      // time for refund eligibility; never extend the window on a delayed callback.
      paidAt: null,
    };
  }
  async requestRefund(command: RefundCommand): Promise<RefundResult> {
    let token: string;
    try { ({ token } = await this.client.auth.issueSessionToken({ storeId: this.storeId, buyerIdentity: command.userId })); }
    catch (error) { refundStageError("SESSION", error); }
    // Pinned SDK's actual public capability. It submits a customer ticket; no
    // invented approval endpoint and no claim that pending means money returned.
    const { ticket } = await this.client.customer(token).createRefundTicket({
      paymentId: command.paymentId, reason: "Full unused credit pack refund within 14 days",
      requestedAmount: { amount: pancakeDisplayAmount(command.amountMinor, command.currency), currency: command.currency },
      refundTicketMerchantExternalId: command.requestId,
    }, { idempotencyKey: command.requestId }).catch((error: unknown) => refundStageError("SUBMISSION", error));
    if (!ticket || ticket.subjectId !== command.paymentId || ticket.refundTicketMerchantExternalId !== command.requestId ||
      !reference.safeParse(ticket.id).success) reject("PANCAKE_REFUND_RESPONSE_MISMATCH");
    return { ticketId: ticket.id, status: refundTicketState(ticket.status) };
  }
  async reconcileRefund(command: RefundCommand): Promise<RefundResult> {
    const result = await this.client.graphql.query<{ refundTickets: Array<{
      id: string; subjectId: string; status: string; refundTicketMerchantExternalId: string;
      versionData: { requestedAmount: { amount: string; currency: string } };
    }> }>({ query: PANCAKE_REFUND_TICKET_QUERY, variables: { paymentId: command.paymentId } })
      .catch((error: unknown) => refundStageError("QUERY", error));
    if (result.errors?.length || !result.data) reject("PANCAKE_QUERY_UNCONFIRMED");
    if (result.data.refundTickets.length >= 100) reject("PANCAKE_REFUND_QUERY_TRUNCATED");
    const matches = result.data.refundTickets.filter((t) => t.refundTicketMerchantExternalId === command.requestId);
    if (matches.length !== 1) return { ticketId: null, status: "unknown" };
    const t = matches[0], amount = t.versionData?.requestedAmount;
    if (t.subjectId !== command.paymentId || !reference.safeParse(t.id).success || !amount || amount.currency !== command.currency ||
      pancakeMinorAmount(amount.amount, amount.currency) !== command.amountMinor) reject("PANCAKE_REFUND_RESPONSE_MISMATCH");
    return { ticketId: t.id, status: refundTicketState(t.status) };
  }
  async diagnoseRefund(command: RefundCommand) { return diagnosePancakeRefund(this.client, this.options, command); }
  async inspectRecoverySchema() { return inspectPancakeSchema(this.client); }
  async reconcile(orderId: string): Promise<PancakePaymentEvent[]> {
    return queryPancakeOrder(this.client, this.options, orderId);
  }
  verifyPaymentEvidence(input: { rawBody: Uint8Array; headers: Headers }): PancakePaymentEvidence {
    const evidence = verifyPancakePaymentEvidence(input, this.options);
    const m = evidence.checkoutMetadata;
    const product = this.options.products.find((p) => p.productId === m.kakareel_product_id && p.priceVersion === m.kakareel_price_version);
    if (!product || product.providerProductId !== m.kakareel_provider_product_id || product.amountMinor !== (evidence.price.totalMinor - evidence.price.taxMinor) ||
      product.currency !== evidence.currency) reject("PANCAKE_PRODUCT_SNAPSHOT_MISMATCH");
    return evidence;
  }
}

function refundTicketState(status: string): RefundResult["status"] {
  // Actual 2026-10-23 GraphQL enum has returned, not cancelled. A returned
  // ticket is not proof of rejection; retain the freeze pending review. Future
  // states (including the SDK-only cancelled) must not silently release credits.
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  if (["approved", "processing", "succeeded"].includes(status)) return "processing";
  if (["pending", "under_review"].includes(status)) return "pending";
  return "unknown";
}

export class PancakeBillingProvider implements BillingProvider {
  readonly id = "pancake" as const;
  readonly capabilities = { hostedCheckout: true, fullRefundEvents: true, subscriptions: false } as const;
  readonly client: PancakeClient;
  constructor(options: PancakeOptions) { this.client = new PancakeClient(options); }
  get environment() { return this.client.environment; }
  get merchantAccountId() { return this.client.storeId; }
  get checkoutHosts() { return this.client.checkoutHosts; }
  isConfigured() { return true; }
  async createCheckout(command: CheckoutCommand) {
    const r = await this.client.createCheckout(command);
    return { checkoutId: r.sessionId, checkoutUrl: r.checkoutUrl };
  }
  async verifyAndNormalizeWebhook(input: { rawBody: Uint8Array; headers: Headers }) { return this.client.normalizeWebhook(input); }
  reconcile(orderId: string) { return this.client.reconcile(orderId); }
  requestRefund(command: RefundCommand) { return this.client.requestRefund(command); }
  reconcileRefund(command: RefundCommand) { return this.client.reconcileRefund(command); }
}
