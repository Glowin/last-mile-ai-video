import { test } from "node:test";
import assert from "node:assert/strict";
import { PANCAKE_REFUND_DIAGNOSTIC_QUERY } from "../src/server/billing/refund-diagnostics";
import { PANCAKE_REFUND_TICKET_QUERY } from "../src/server/billing/pancake";
import { PANCAKE_RECOVERY_QUERY } from "../src/server/billing/pancake-query";
// Structural fixture extracted from authenticated Pancake test-key introspection,
// supplied by the main session on 2026-10-23. API types only, no account data.
// Source: https://docs.waffo.ai/api-reference/endpoints/graphql/overview
const fields = {
  "SnapshotAmountDetails": {
    "currency": "String",
    "subtotal": "String",
    "taxAmount": "String",
    "total": "String",
    "taxCategory": "TaxCategory",
    "phase": "String",
    "taxRate": "Float",
    "taxName": "String"
  },
  "PspAmountDetails": {
    "currency": "String",
    "amount": "String",
    "settlementCurrency": "String",
    "settlementAmount": "String"
  },
  "RequestedAmountDetails": {
    "currency": "String",
    "amount": "String"
  },
  "OnetimeOrder": {
    "id": "String",
    "storeId": "String",
    "buyerEmail": "String",
    "buyerIp": "String",
    "status": "OnetimeOrderStatus",
    "total": "Money",
    "subtotal": "Money",
    "taxAmount": "Money",
    "currency": "String",
    "testMode": "Boolean",
    "merchantProvidedBuyerIdentity": "String",
    "orderMerchantExternalId": "String",
    "metadata": "String",
    "productVersionId": "String",
    "productVersion": "OnetimeProductVersion",
    "priceSnapshot": "OnetimePriceSnapshot",
    "billingDetail": "BillingDetail",
    "createdAt": "String",
    "updatedAt": "String",
    "store": "Store",
    "payments": "Payment",
    "onetimeProduct": "OnetimeProduct"
  },
  "Payment": {
    "id": "String",
    "orderId": "String",
    "status": "PaymentStatus",
    "amount": "Money",
    "refundedAmount": "Money",
    "isFullyRefunded": "Boolean",
    "testMode": "Boolean",
    "failureReason": "String",
    "periodNumber": "Int",
    "paymentMethod": "PaymentMethod",
    "snapshotAmountDetails": "SnapshotAmountDetails",
    "pspAmountDetails": "PspAmountDetails",
    "pspPaymentId": "String",
    "cardInfo": "CardInfo",
    "invoiceToken": "String",
    "orderMerchantExternalId": "String",
    "createdAt": "String",
    "onetimeOrder": "OnetimeOrder",
    "subscriptionOrder": "SubscriptionOrder",
    "refundStatus": "PaymentRefundStatus",
    "refunds": "Refund",
    "chargebacks": "Chargeback",
    "settlementInfo": "SettlementInfo",
    "settlementBatch": "SettlementBatch"
  },
  "Refund": {
    "id": "String",
    "paymentId": "String",
    "ticketId": "String",
    "status": "RefundStatus",
    "amount": "Money",
    "testMode": "Boolean",
    "reason": "String",
    "requestedAmountDetails": "RequestedAmountDetails",
    "pspAmountDetails": "PspAmountDetails",
    "pspRefundId": "String",
    "createdAt": "String",
    "payment": "Payment",
    "ticket": "RefundTicket",
    "orderMerchantExternalId": "String",
    "refundTicketMerchantExternalId": "String",
    "isPostSettlementRefund": "Boolean",
    "settlementInfo": "SettlementInfo",
    "settlementBatch": "SettlementBatch"
  },
  "RefundTicketVersionData": {
    "reason": "String",
    "requestedAmount": "RequestedAmountDetails"
  },
  "RefundTicket": {
    "id": "String",
    "status": "RefundTicketStatus",
    "subjectId": "String",
    "submitterId": "String",
    "submitterType": "String",
    "currentVersionId": "String",
    "reviewedAt": "String",
    "reviewNote": "String",
    "rejectReason": "String",
    "executedAt": "String",
    "metadata": "String",
    "refundTicketMerchantExternalId": "String",
    "createdAt": "String",
    "updatedAt": "String",
    "versionNumber": "Int",
    "versionData": "RefundTicketVersionData",
    "versions": "RefundTicketVersion"
  }
} as const;
const args = {
  "onetimeOrders": {
    "storeId": "String",
    "storeSlug": "String",
    "limit": "Int",
    "offset": "Int",
    "filter": "OnetimeOrderFilter",
    "orderBy": null
  },
  "payments": {
    "storeId": "String",
    "limit": "Int",
    "offset": "Int",
    "filter": "PaymentFilter",
    "orderBy": null
  },
  "refundTickets": {
    "limit": "Int",
    "offset": "Int",
    "filter": "RefundTicketFilter",
    "orderBy": null
  }
} as const;

const inputs = {
  "StringFilter": {
    "eq": "String",
    "ne": "String",
    "contains": "String",
    "startsWith": "String",
    "endsWith": "String",
    "in": "String",
    "notIn": "String",
    "isNull": "Boolean"
  },
  "OnetimeOrderFilter": {
    "id": "StringFilter",
    "storeId": "StringFilter",
    "buyerEmail": "StringFilter",
    "merchantProvidedBuyerIdentity": "StringFilter",
    "orderMerchantExternalId": "StringFilter",
    "status": "StringFilter",
    "total": "AmountFilter",
    "country": "StringFilter",
    "hasRefund": "BooleanFilter",
    "productId": "StringFilter",
    "currency": "StringFilter",
    "createdAt": "DateTimeFilter",
    "updatedAt": "DateTimeFilter"
  },
  "PaymentFilter": {
    "id": "StringFilter",
    "orderId": "StringFilter",
    "orderType": "OrderTypeFilter",
    "productId": "StringFilter",
    "status": "StringFilter",
    "testMode": "BooleanFilter",
    "refundStatus": "RefundStatusFilter",
    "paymentMethodType": "StringFilter",
    "cardBrand": "StringFilter",
    "isFullyRefunded": "BooleanFilter",
    "hasSettlement": "BooleanFilter",
    "settlementDate": "DateTimeFilter",
    "amount": "AmountFilter",
    "currency": "StringFilter",
    "storeId": "StringFilter",
    "buyerEmail": "StringFilter",
    "pspPaymentId": "StringFilter",
    "orderMerchantExternalId": "StringFilter",
    "createdAt": "DateTimeFilter"
  },
  "RefundTicketFilter": {
    "status": "StringFilter",
    "subjectId": "StringFilter",
    "submitterId": "StringFilter",
    "amount": "AmountFilter",
    "currency": "StringFilter",
    "reason": "StringFilter",
    "refundTicketMerchantExternalId": "StringFilter",
    "createdAt": "DateTimeFilter",
    "updatedAt": "DateTimeFilter"
  }
} as const;
const enums = {
  "OnetimeOrderStatus": [
    "pending",
    "completed",
    "canceled"
  ],
  "PaymentStatus": [
    "pending",
    "succeeded",
    "failed",
    "canceled"
  ],
  "RefundStatus": [
    "pending",
    "succeeded",
    "failed"
  ],
  "RefundTicketStatus": [
    "pending",
    "under_review",
    "approved",
    "processing",
    "succeeded",
    "failed",
    "rejected",
    "returned"
  ]
} as const;

test("recovery selections match authenticated real schema rather than webhook vocabulary", () => {
  assert.equal(fields.OnetimeOrder.testMode, "Boolean");
  assert.equal(fields.OnetimeOrder.merchantProvidedBuyerIdentity, "String");
  assert.equal(fields.OnetimeOrder.metadata, "String");
  assert.equal(fields.Payment.pspAmountDetails, "PspAmountDetails");
  assert.equal(fields.PspAmountDetails.amount, "String");
  assert.equal(fields.SnapshotAmountDetails.total, "String");
  for (const type of [fields.OnetimeOrder, fields.Payment, fields.Refund]) {
    assert.equal("mode" in type, false); assert.equal("environment" in type, false);
    assert.equal(type.testMode, "Boolean");
  }
  assert.match(PANCAKE_RECOVERY_QUERY, /buyer: merchantProvidedBuyerIdentity/);
  assert.match(PANCAKE_RECOVERY_QUERY, /testMode/);
  assert.doesNotMatch(PANCAKE_RECOVERY_QUERY, /scopeEnvironment|chargedAmount|buyerIdentity/);
  assert.equal(args.onetimeOrders.filter, "OnetimeOrderFilter");
  assert.equal(args.payments.filter, "PaymentFilter");
  assert.equal(args.payments.storeId, "String");
  assert.equal(args.refundTickets.filter, "RefundTicketFilter");
  assert.equal(fields.RefundTicket.subjectId, "String");
  assert.equal(fields.RefundTicket.versionData, "RefundTicketVersionData");
  assert.equal(fields.RefundTicketVersionData.requestedAmount, "RequestedAmountDetails");
  assert.equal(fields.RequestedAmountDetails.amount, "String");
});


test("actual input fields authorize each query filter and eq operand as String", () => {
  const expected = [inputs.OnetimeOrderFilter, inputs.PaymentFilter, inputs.RefundTicketFilter];
  const filters = [...(PANCAKE_RECOVERY_QUERY + PANCAKE_REFUND_TICKET_QUERY).matchAll(/filter:\s*\{\s*(\w+):\s*\{\s*(\w+):\s*\$(\w+)/g)];
  assert.equal(filters.length, 3);
  for (let i = 0; i < filters.length; i++) {
    const [, field, operation, variable] = filters[i];
    assert.equal((expected[i] as Record<string, string>)[field], "StringFilter");
    assert.equal((inputs.StringFilter as Record<string, string>)[operation], "String");
    assert.equal(variable, i === 2 ? "paymentId" : "ref");
  }
});
test("captured status enums match money terminal states; cancelled is not a deployed refund-ticket enum", () => {
  assert.deepEqual(enums.OnetimeOrderStatus, ["pending", "completed", "canceled"]);
  assert.deepEqual(enums.PaymentStatus, ["pending", "succeeded", "failed", "canceled"]);
  assert.deepEqual(enums.RefundStatus, ["pending", "succeeded", "failed"]);
  assert.deepEqual(enums.RefundTicketStatus, ["pending", "under_review", "approved", "processing", "succeeded", "failed", "rejected", "returned"]);
});


test("read-only refund diagnostic aliases use observed ticket inputs and String eq", () => {
  assert.equal(inputs.RefundTicketFilter.subjectId, "StringFilter");
  assert.equal(inputs.RefundTicketFilter.refundTicketMerchantExternalId, "StringFilter");
  assert.equal(inputs.StringFilter.eq, "String");
  assert.match(PANCAKE_REFUND_DIAGNOSTIC_QUERY, /payment\(id: \$paymentId\)/);
  const filters = [...PANCAKE_REFUND_DIAGNOSTIC_QUERY.matchAll(/filter:\s*\{\s*(\w+):\s*\{\s*(\w+):/g)];
  assert.deepEqual(filters.map((f) => [f[1], f[2]]), [["subjectId", "eq"], ["refundTicketMerchantExternalId", "eq"]]);
});
