import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "../schema";
import { billingOrders } from "../billing/schema";
const time = (name: string) => timestamp(name, { withTimezone: true });
// Constraints live in db/0011-analytics-attribution.sql.
export const userAttribution = pgTable("user_attribution", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  utmSource: text("utm_source"), utmMedium: text("utm_medium"), utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"), utmTerm: text("utm_term"), ref: text("ref"),
  referrerHost: text("referrer_host"), landingPath: text("landing_path").notNull().default("/"),
  clickIdType: text("click_id_type"), firstSeenAt: time("first_seen_at"),
  capturedAt: time("captured_at").notNull().defaultNow(),
});
// Legacy 0011 table; cleared by 0012 and never used for dispatch.
export const analyticsGaClients = pgTable("analytics_ga_clients", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  gaClientId: text("ga_client_id").notNull(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export type PurchaseDispatchStatus = "pending" | "sent" | "failed" | "skipped_no_consent" | "skipped_backfill";
export const analyticsPurchaseEvents = pgTable("analytics_purchase_events", {
  orderId: uuid("order_id").primaryKey().references(() => billingOrders.id),
  status: text("status").$type<PurchaseDispatchStatus>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  leaseUntil: time("lease_until"), sentAt: time("sent_at"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const analyticsBrowserConsents = pgTable("analytics_browser_consents", {
  id: uuid("id").primaryKey(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const analyticsOrderContexts = pgTable("analytics_order_contexts", {
  orderId: uuid("order_id").primaryKey().references(() => billingOrders.id),
  consentId: uuid("consent_id").notNull().references(() => analyticsBrowserConsents.id, { onDelete: "cascade" }),
  gaClientId: text("ga_client_id").notNull(),
  gaSessionId: text("ga_session_id").notNull(),
  capturedAt: time("captured_at").notNull().defaultNow(),
});
