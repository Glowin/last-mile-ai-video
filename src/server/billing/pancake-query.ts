import type { WaffoPancake } from "@waffo/pancake-ts";
import { z } from "zod";
import { PancakeError, pancakeMinorAmount, type PancakeOptions } from "./pancake";
import type { PancakePaymentEvent } from "./providers";

// Official GraphQL examples + captured authenticated introspection, never SDK REST types.
// https://docs.waffo.ai/api-reference/endpoints/graphql/overview
// https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments
// Amounts from pspAmountDetails are channel-reported display strings. Missing
// actuals remain null; snapshotAmountDetails is ONLY a tax/price comparison.
const ref = z.string().min(1).max(200);
const money = z.object({ amount: z.string(), currency: z.string() });
const snapshot = z.object({ subtotal: z.string(), taxAmount: z.string(), total: z.string(), currency: z.string() });
const metadata = z.object({ kakareel_schema: z.literal("one-time-v1"), kakareel_order_id: z.uuid(),
  kakareel_user_id: z.uuid(), kakareel_product_id: ref, kakareel_provider_product_id: ref, kakareel_price_version: ref });
const orderSchema = z.object({ id: ref, status: z.string(), orderMerchantExternalId: z.uuid(),
  buyer: z.uuid(), scopeStore: ref, testMode: z.boolean(), metadata: z.string() });
const paymentSchema = z.object({ id: ref, orderId: ref, status: z.string(), orderMerchantExternalId: z.uuid(),
  testMode: z.boolean(), periodNumber: z.number().nullable(), createdAt: z.iso.datetime({ offset: true }),
  snapshotAmountDetails: snapshot.nullable(), pspAmountDetails: money.nullable(),
  refunds: z.array(z.object({ id: ref, status: z.string(), testMode: z.boolean(), paymentId: ref, pspAmountDetails: money.nullable() })) });
function fail(code = "PANCAKE_QUERY_REVIEW_REQUIRED"): never { throw new PancakeError(code); }
// Verified against actual test-key schema on 2026-10-23. No mode/environment
// string exists on these entities: testMode is a required Boolean.
export const PANCAKE_RECOVERY_QUERY = `query($storeId: String!, $ref: String!) {
  onetimeOrders(storeId: $storeId, filter: { orderMerchantExternalId: { eq: $ref } }, limit: 2) {
    id status orderMerchantExternalId metadata buyer: merchantProvidedBuyerIdentity scopeStore: storeId testMode
  }
  payments(storeId: $storeId, filter: { orderMerchantExternalId: { eq: $ref } }, limit: 100) {
    id orderId status orderMerchantExternalId testMode periodNumber createdAt
    pspAmountDetails { amount currency } snapshotAmountDetails { subtotal taxAmount total currency }
    refunds { id paymentId status testMode pspAmountDetails { amount currency } }
  }
}`;
export async function queryPancakeOrder(client: WaffoPancake, scope: PancakeOptions, orderId: string): Promise<PancakePaymentEvent[]> {
  z.uuid().parse(orderId);
  const response = await client.graphql.query<{ onetimeOrders: unknown[]; payments: unknown[] }>({
    query: PANCAKE_RECOVERY_QUERY, variables: { storeId: scope.storeId, ref: orderId },
  });
  if (response.errors?.length || !response.data) fail();
  if (response.data.onetimeOrders.length === 0) return [];
  if (response.data.onetimeOrders.length !== 1 || response.data.payments.length >= 100) fail();
  const o = orderSchema.parse(response.data.onetimeOrders[0]);
  const m = metadata.parse(JSON.parse(o.metadata));
  if (o.scopeStore !== scope.storeId || o.testMode !== (scope.environment === "test") ||
    o.orderMerchantExternalId !== orderId || m.kakareel_order_id !== orderId || m.kakareel_user_id !== o.buyer) fail("PANCAKE_QUERY_SCOPE_MISMATCH");
  const payments = response.data.payments.map((p) => paymentSchema.parse(p)).filter((p) => p.status === "succeeded");
  if (payments.length > 1) fail("PANCAKE_MULTIPLE_PAYMENTS_REVIEW");
  const result: PancakePaymentEvent[] = [];
  for (const p of payments) {
    if (p.orderId !== o.id || p.orderMerchantExternalId !== orderId || p.periodNumber !== null || p.testMode !== o.testMode || o.status !== "completed") fail();
    const s = p.snapshotAmountDetails, actual = p.pspAmountDetails;
    const currency = s?.currency ?? actual?.currency;
    if (!currency) fail();
    const minor = (value: string | undefined) => value === undefined ? null : pancakeMinorAmount(value, currency);
    const subtotalMinor = minor(s?.subtotal), taxMinor = minor(s?.taxAmount), totalMinor = minor(s?.total);
    const paid = actual && actual.currency === currency ? minor(actual.amount) : null;
    const reviewReason = !s || paid === null ? "PANCAKE_MISSING_ACTUAL_AMOUNT" :
      subtotalMinor! + taxMinor! !== totalMinor || paid !== totalMinor || paid <= 0 ? "PANCAKE_AMOUNT_MISMATCH" : null;
    const base = { evidenceType: "pancake" as const, environment: scope.environment, merchantAccountId: scope.storeId,
      orderId, userId: o.buyer, productId: m.kakareel_product_id, providerProductId: m.kakareel_provider_product_id,
      priceVersion: m.kakareel_price_version, providerOrderId: o.id, paymentId: p.id, currency,
      subtotalMinor, taxMinor, totalMinor, originalPaidAmountMinor: paid, paidAt: p.createdAt };
    result.push({ ...base, eventId: p.id, kind: "payment.succeeded", amountMinor: paid, reviewReason });
    for (const r of p.refunds.filter((r) => r.status === "succeeded")) {
      if (r.testMode !== o.testMode || r.paymentId !== p.id) fail("PANCAKE_QUERY_SCOPE_MISMATCH");
      const amount = r.pspAmountDetails?.currency === currency ? minor(r.pspAmountDetails.amount) : null;
      result.push({ ...base, eventId: r.id, kind: "payment.refunded", amountMinor: amount,
        reviewReason: reviewReason ?? (amount === null ? "PANCAKE_MISSING_ACTUAL_AMOUNT" : amount !== paid ? "PANCAKE_PARTIAL_REFUND_REVIEW" : null) });
    }
  }
  // Refunds first: a recovered already-refunded purchase must never briefly fund
  // generation between separate event transactions.
  return result.sort((a, b) => Number(b.kind === "payment.refunded") - Number(a.kind === "payment.refunded"));
}

export async function inspectPancakeSchema(client: WaffoPancake) {
  const result = await client.graphql.query({ query: `{ __schema {
    queryType { fields { name args { name type { name kind ofType { name kind } } } type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } }
    types { name inputFields { name type { name kind ofType { name kind ofType { name kind } } } } enumValues { name }
      fields { name description type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } }
    }
  } }` });
  if (result.errors?.length || !result.data) fail("PANCAKE_QUERY_UNCONFIRMED");
  return result.data;
}
