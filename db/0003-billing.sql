-- Additive foundation only: no products, prices, payments or credit grants seeded.
CREATE TABLE billing_orders (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL,
 product_id text NOT NULL,
 product_name text NOT NULL,
 price_version text NOT NULL,
 provider text NOT NULL CHECK (provider IN ('pancake','waffo','stripe','antom')),
 environment text NOT NULL CHECK (environment IN ('test','live')),
 merchant_account_id text NOT NULL,
 provider_product_id text NOT NULL,
 amount_minor integer NOT NULL CHECK (amount_minor > 0),
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 credits integer NOT NULL CHECK (credits > 0),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','canceled','refunded')),
 checkout_status text NOT NULL DEFAULT 'creating' CHECK (checkout_status IN ('creating','ready','unknown')),
 provider_checkout_id text,
 provider_payment_id text,
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, request_id),
 UNIQUE (id, user_id, environment),
 UNIQUE (provider, environment, merchant_account_id, provider_checkout_id),
 UNIQUE (provider, environment, merchant_account_id, provider_payment_id)
);
CREATE INDEX billing_orders_user_created_idx ON billing_orders(user_id, created_at DESC, id);
CREATE TABLE billing_events (
 id uuid PRIMARY KEY,
 provider text NOT NULL,
 environment text NOT NULL CHECK (environment IN ('test','live')),
 merchant_account_id text NOT NULL,
 provider_event_id text NOT NULL,
 provider_payment_id text,
 order_id uuid NOT NULL REFERENCES billing_orders(id),
 fingerprint text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('payment.succeeded','payment.failed','checkout.canceled','payment.refunded')),
 outcome text NOT NULL CHECK (outcome IN ('applied','ignored')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (provider, environment, merchant_account_id, provider_event_id)
);
CREATE TABLE credit_ledger (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 order_id uuid NOT NULL,
 environment text NOT NULL CHECK (environment IN ('test','live')),
 event_id uuid NOT NULL REFERENCES billing_events(id),
 kind text NOT NULL CHECK (kind IN ('purchase','refund')),
 credits integer NOT NULL CHECK ((kind='purchase' AND credits > 0) OR (kind='refund' AND credits < 0)),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (order_id, user_id, environment) REFERENCES billing_orders(id, user_id, environment),
 UNIQUE (order_id, kind)
);
CREATE INDEX credit_ledger_user_environment_idx ON credit_ledger(user_id, environment);
