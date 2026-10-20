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
