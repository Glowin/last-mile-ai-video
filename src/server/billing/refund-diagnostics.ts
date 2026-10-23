import type { WaffoPancake } from "@waffo/pancake-ts";
import { z } from "zod";
import type { BillingEnvironment } from "../../lib/billing";
import type { RefundCommand } from "./providers";
import { pancakeMinorAmount, safePancakeDiagnosticCode } from "./pancake";

// Read-only query; all fields and filter operands checked against authenticated
// 2026-10-23 schema-full.json. No token issuance or refund POST occurs here.
export const PANCAKE_REFUND_DIAGNOSTIC_QUERY = `query($paymentId: String!, $reference: String!) {
  payment(id: $paymentId) {
    id status testMode orderMerchantExternalId pspAmountDetails { amount currency }
    onetimeOrder { storeId testMode merchantProvidedBuyerIdentity orderMerchantExternalId }
    refunds { paymentId status testMode }
  }
  byPayment: refundTickets(filter: { subjectId: { eq: $paymentId } }, limit: 100) {
    id subjectId status refundTicketMerchantExternalId
  }
  byReference: refundTickets(filter: { refundTicketMerchantExternalId: { eq: $reference } }, limit: 100) {
    id subjectId status refundTicketMerchantExternalId
  }
}`;
const ticket = z.object({ id: z.string(), subjectId: z.string(), status: z.string(), refundTicketMerchantExternalId: z.string().nullable() });
const schema = z.object({
  payment: z.object({ id: z.string(), status: z.string(), testMode: z.boolean(), orderMerchantExternalId: z.string().nullable(),
    pspAmountDetails: z.object({ amount: z.string(), currency: z.string() }).nullable(),
    onetimeOrder: z.object({ storeId: z.string(), testMode: z.boolean(), merchantProvidedBuyerIdentity: z.string(), orderMerchantExternalId: z.string().nullable() }).nullable(),
    refunds: z.array(z.object({ paymentId: z.string(), status: z.string(), testMode: z.boolean() })),
  }).nullable(), byPayment: z.array(ticket), byReference: z.array(ticket),
});
const statuses = new Set(["pending", "under_review", "approved", "processing", "succeeded", "failed", "rejected", "returned"]);
const report = (code: string) => ({ code, automaticRetryAllowed: false as const });
export async function diagnosePancakeRefund(client: WaffoPancake, scope: { environment: BillingEnvironment; storeId: string }, command: RefundCommand) {
  let result;
  try {
    result = await client.graphql.query({ query: PANCAKE_REFUND_DIAGNOSTIC_QUERY,
      variables: { paymentId: command.paymentId, reference: command.requestId } });
  } catch (error) { return report(safePancakeDiagnosticCode(error)); }
  if (result.errors?.length || !result.data) return report("PANCAKE_REFUND_DIAGNOSTIC_QUERY_UNCONFIRMED");
  const checked = schema.safeParse(result.data);
  if (!checked.success) return report("PANCAKE_REFUND_DIAGNOSTIC_SCHEMA_MISMATCH");
  const { payment, byPayment, byReference } = checked.data;
  if (!payment) return report("PANCAKE_REFUND_PAYMENT_NOT_OBSERVED");
  const order = payment.onetimeOrder, testMode = scope.environment === "test";
  if (!order || payment.id !== command.paymentId || payment.testMode !== testMode || order.testMode !== testMode ||
    order.storeId !== scope.storeId || order.merchantProvidedBuyerIdentity !== command.userId ||
    order.orderMerchantExternalId !== command.orderId || payment.orderMerchantExternalId !== command.orderId ||
    payment.refunds.some((r) => r.paymentId !== command.paymentId || r.testMode !== testMode) ||
    byPayment.some((t) => t.subjectId !== command.paymentId) || byReference.some((t) => t.refundTicketMerchantExternalId !== command.requestId))
    return report("PANCAKE_REFUND_DIAGNOSTIC_SCOPE_MISMATCH");
  if (byPayment.length >= 100 || byReference.length >= 100) return report("PANCAKE_REFUND_DIAGNOSTIC_QUERY_TRUNCATED");
  const exact = byPayment.filter((t) => t.refundTicketMerchantExternalId === command.requestId);
  const wrongPayment = byReference.filter((t) => t.subjectId !== command.paymentId);
  const referencesAgree = exact.length === byReference.length && exact.every((t) => byReference.some((r) => r.id === t.id));
  let amountMatches = false;
  try { amountMatches = payment.pspAmountDetails?.currency === command.currency &&
    pancakeMinorAmount(payment.pspAmountDetails.amount, command.currency) === command.amountMinor; } catch { /* No raw value escapes. */ }
  const code = wrongPayment.length ? "PANCAKE_REFUND_REFERENCE_ON_OTHER_PAYMENT" : !referencesAgree ? "PANCAKE_REFUND_QUERY_VIEWS_DISAGREE" :
    exact.length > 1 ? "PANCAKE_REFUND_MULTIPLE_TICKETS_OBSERVED" : exact.length === 1 ? "PANCAKE_REFUND_MATCHING_TICKET_OBSERVED" :
    byPayment.length ? "PANCAKE_REFUND_OTHER_TICKET_OBSERVED" : "PANCAKE_REFUND_NO_TICKET_OBSERVED";
  return { ...report(code), paymentStatus: ["pending", "succeeded", "failed", "canceled"].includes(payment.status) ? payment.status : "unknown",
    paymentAmountMatches: amountMatches, exactTicketCount: exact.length,
    otherPaymentTicketCount: byPayment.length - exact.length, referenceOnOtherPaymentCount: wrongPayment.length,
    refundRecordCount: payment.refunds.length, successfulRefundCount: payment.refunds.filter((r) => r.status === "succeeded").length,
    matchedTicketStatuses: exact.map((t) => statuses.has(t.status) ? t.status : "unknown") };
}
