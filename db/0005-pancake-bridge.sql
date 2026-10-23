-- Immutable checkout subtotal; taxes/receipt only filled from authenticated evidence.
ALTER TABLE billing_orders
 ADD COLUMN subtotal_minor integer,
 ADD COLUMN tax_minor integer,
 ADD COLUMN total_minor integer,
 ADD COLUMN paid_amount_minor integer,
 ADD COLUMN tax_behavior text NOT NULL DEFAULT 'exclusive' CHECK (tax_behavior = 'exclusive'),
 ADD COLUMN provider_order_id text,
 ADD COLUMN paid_at timestamptz,
 ADD COLUMN refund_status text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none','submitting','pending','processing','unknown','rejected','failed','succeeded','review_required')),
 ADD COLUMN refund_request_id uuid,
 ADD COLUMN refund_ticket_id text,
 ADD COLUMN refund_requested_at timestamptz,
 ADD COLUMN review_reason text;
UPDATE billing_orders SET subtotal_minor=amount_minor;
ALTER TABLE billing_orders ALTER COLUMN subtotal_minor SET NOT NULL;
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_money_check CHECK (
 subtotal_minor > 0 AND subtotal_minor=amount_minor AND (tax_minor IS NULL OR tax_minor >= 0)
 AND (total_minor IS NULL OR (tax_minor IS NOT NULL AND total_minor::bigint=subtotal_minor::bigint+tax_minor::bigint))
 AND (paid_amount_minor IS NULL OR paid_amount_minor > 0));
CREATE UNIQUE INDEX billing_orders_provider_order_unique ON billing_orders(provider,environment,merchant_account_id,provider_order_id);
ALTER TABLE billing_events DROP CONSTRAINT billing_events_outcome_check;
ALTER TABLE billing_events ADD CONSTRAINT billing_events_outcome_check CHECK (outcome IN ('applied','ignored','review_required'));
ALTER TABLE billing_events ADD COLUMN evidence jsonb;
-- Redacted normalized facts only; raw webhook bodies, auth tokens and URLs never persist.
