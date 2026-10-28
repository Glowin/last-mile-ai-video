-- Additive only. First-touch marketing attribution and GA purchase dispatch state.
-- No emails, names, prompts, click-ID values or full URLs are stored here.
CREATE TABLE user_attribution (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
 ref text, referrer_host text, landing_path text NOT NULL DEFAULT '/', click_id_type text,
 first_seen_at timestamptz,
 captured_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT user_attribution_lengths CHECK (
  coalesce(length(utm_source),0) <= 100 AND coalesce(length(utm_medium),0) <= 100 AND
  coalesce(length(utm_campaign),0) <= 100 AND coalesce(length(utm_content),0) <= 100 AND
  coalesce(length(utm_term),0) <= 100 AND coalesce(length(ref),0) <= 100 AND
  coalesce(length(referrer_host),0) <= 100 AND length(landing_path) <= 200 AND
  coalesce(length(click_id_type),0) <= 20)
);
-- Pseudonymous GA browser ID, stored only while the browser has granted analytics consent.
CREATE TABLE analytics_ga_clients (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 ga_client_id text NOT NULL CHECK (length(ga_client_id) <= 64),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- One row per order: claims a single Measurement Protocol purchase send.
CREATE TABLE analytics_purchase_events (
 order_id uuid PRIMARY KEY REFERENCES billing_orders(id),
 status text NOT NULL CHECK (status IN ('pending','sent','failed','skipped_no_consent','skipped_backfill')),
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Orders already paid before this release (including acceptance payments) are never sent.
INSERT INTO analytics_purchase_events(order_id,status)
 SELECT id,'skipped_backfill' FROM billing_orders WHERE status IN ('paid','refunded') OR paid_at IS NOT NULL;
