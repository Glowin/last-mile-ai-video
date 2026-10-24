-- Scheduling metadata only. No new payment/refund or wallet mutation.
CREATE TABLE billing_reconciliation (
 order_id uuid PRIMARY KEY REFERENCES billing_orders(id),
 refund_request_id uuid,
 state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','complete','exhausted','review')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 64),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 last_attempt_at timestamptz,
 last_result text CHECK (last_result IN ('observed','query_failed','review_required','limit_reached')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX billing_reconciliation_due ON billing_reconciliation(next_attempt_at, order_id) WHERE state='scheduled';
CREATE INDEX billing_orders_reconciliation_scope ON billing_orders(provider,environment,merchant_account_id,created_at,id);
