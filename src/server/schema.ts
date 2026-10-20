import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import type { JobStatus } from "../lib/models";
export const jobs = pgTable(
  "video_jobs",
  {
    id: uuid("id").primaryKey(),
    owner: uuid("owner").notNull(),
    family: text("family").notNull(),
    mode: text("mode").notNull(),
    prompt: text("prompt").notNull(),
    duration: integer("duration").notNull(),
    resolution: text("resolution").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").$type<JobStatus>().notNull(),
    upstreamId: text("upstream_id"),
    resultUrl: text("result_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("video_jobs_owner_created_idx").on(t.owner, t.createdAt)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => authSessions.id),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("refresh_tokens_session_idx").on(t.sessionId)],
);
export const guestClaims = pgTable("guest_claims", {
  guestId: uuid("guest_id").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  claimedAt: timestamp("claimed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonceHash: text("nonce_hash").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("auth_nonces_expiry_idx").on(t.expiresAt)],
);
