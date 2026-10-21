import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "../schema";
import type { BillingProviderId, BillingEnvironment, BillingOrderStatus } from "../../lib/billing";
const time = (name: string) => timestamp(name, { withTimezone: true });
// Database constraints/indexes live in 0003-billing.sql; no changes to auth schema.
export const billingOrders = pgTable("billing_orders", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  requestId: uuid("request_id").notNull(),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  priceVersion: text("price_version").notNull(),
  provider: text("provider").$type<BillingProviderId>().notNull(),
  environment: text("environment").$type<BillingEnvironment>().notNull(),
  merchantAccountId: text("merchant_account_id").notNull(),
  providerProductId: text("provider_product_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  credits: integer("credits").notNull(),
  status: text("status").$type<BillingOrderStatus>().notNull().default("pending"),
  checkoutStatus: text("checkout_status").$type<"creating" | "ready" | "unknown">().notNull().default("creating"),
  providerCheckoutId: text("provider_checkout_id"),
  providerPaymentId: text("provider_payment_id"),
  leaseToken: uuid("lease_token"),
  leaseUntil: time("lease_until"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export type OrderRow = typeof billingOrders.$inferSelect;
export const billingEvents = pgTable("billing_events", {
  id: uuid("id").primaryKey(),
  provider: text("provider").$type<BillingProviderId>().notNull(),
  environment: text("environment").$type<BillingEnvironment>().notNull(),
  merchantAccountId: text("merchant_account_id").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  providerPaymentId: text("provider_payment_id"),
  orderId: uuid("order_id").notNull().references(() => billingOrders.id),
  fingerprint: text("fingerprint").notNull(),
  kind: text("kind").notNull(),
  outcome: text("outcome").$type<"applied" | "ignored">().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orderId: uuid("order_id").notNull().references(() => billingOrders.id),
  environment: text("environment").$type<BillingEnvironment>().notNull(),
  eventId: uuid("event_id").notNull().references(() => billingEvents.id),
  kind: text("kind").$type<"purchase" | "refund">().notNull(),
  credits: integer("credits").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
