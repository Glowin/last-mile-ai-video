-- Browser-scoped consent replaces the unsafe account-wide GA ID lookup.
-- Existing account-wide IDs cannot prove consent for any particular order.
DELETE FROM analytics_ga_clients;
CREATE TABLE analytics_browser_consents (
 id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE analytics_order_contexts (
 order_id uuid PRIMARY KEY REFERENCES billing_orders(id),
 consent_id uuid NOT NULL REFERENCES analytics_browser_consents(id) ON DELETE CASCADE,
 ga_client_id text NOT NULL CHECK (ga_client_id ~ '^[0-9]{1,12}\.[0-9]{1,12}$'),
 ga_session_id text NOT NULL CHECK (ga_session_id ~ '^[0-9]{1,12}$'),
 captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_order_contexts_consent_idx ON analytics_order_contexts(consent_id);
