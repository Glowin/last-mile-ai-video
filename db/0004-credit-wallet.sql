-- Independent test/live wallets. Every writer locks the wallet before an order or batch.
CREATE TABLE credit_wallets (
 user_id uuid NOT NULL REFERENCES users(id), environment text NOT NULL CHECK(environment IN ('test','live')),
 debt integer NOT NULL DEFAULT 0 CHECK(debt >= 0), PRIMARY KEY(user_id,environment)
);
CREATE TABLE credit_batches (
 order_id uuid PRIMARY KEY, user_id uuid NOT NULL, environment text NOT NULL,
 credits integer NOT NULL CHECK(credits > 0), paid_at timestamptz NOT NULL,
 consumed integer NOT NULL DEFAULT 0 CHECK(consumed >= 0), reserved integer NOT NULL DEFAULT 0 CHECK(reserved >= 0),
 refunded boolean NOT NULL DEFAULT false, refund_frozen boolean NOT NULL DEFAULT false,
 CHECK(consumed + reserved <= credits),
 FOREIGN KEY(user_id,environment) REFERENCES credit_wallets(user_id,environment),
 FOREIGN KEY(order_id,user_id,environment) REFERENCES billing_orders(id,user_id,environment)
);
CREATE INDEX credit_batches_fifo ON credit_batches(user_id,environment,paid_at,order_id);
CREATE TABLE video_quotes (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), environment text NOT NULL CHECK(environment IN ('test','live')),
 fingerprint text NOT NULL, credits integer NOT NULL CHECK(credits > 0), price_version text NOT NULL,
 expires_at timestamptz NOT NULL, job_id uuid UNIQUE REFERENCES video_jobs(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE video_jobs ADD COLUMN billing_mode text NOT NULL DEFAULT 'preview' CHECK(billing_mode IN ('preview','paid'));
ALTER TABLE video_jobs ADD COLUMN credit_environment text CHECK(credit_environment IN ('test','live'));
ALTER TABLE video_jobs ADD COLUMN credits integer NOT NULL DEFAULT 0 CHECK(credits >= 0);
ALTER TABLE video_jobs ADD COLUMN credit_state text NOT NULL DEFAULT 'none' CHECK(credit_state IN ('none','reserved','consumed','released'));
ALTER TABLE video_jobs ADD COLUMN lease_token uuid;
ALTER TABLE video_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE video_jobs ADD COLUMN submission_started_at timestamptz;
ALTER TABLE video_jobs ADD COLUMN next_poll_at timestamptz NOT NULL DEFAULT now();
-- Every pre-migration active job may already have reached the provider. Never POST it again.
UPDATE video_jobs SET submission_started_at=created_at WHERE status NOT IN ('success','failed');
ALTER TABLE video_jobs ADD COLUMN review_required boolean NOT NULL DEFAULT false;
ALTER TABLE video_jobs ADD COLUMN delivery_verified_at timestamptz;
CREATE INDEX video_jobs_worker_due ON video_jobs(next_poll_at) WHERE status NOT IN ('success','failed') AND NOT review_required;
CREATE TABLE credit_allocations (
 job_id uuid NOT NULL REFERENCES video_jobs(id), order_id uuid NOT NULL REFERENCES credit_batches(order_id),
 credits integer NOT NULL CHECK(credits > 0), state text NOT NULL CHECK(state IN ('reserved','consumed','released')),
 PRIMARY KEY(job_id,order_id)
);
CREATE TABLE credit_audit (
 id uuid PRIMARY KEY, job_id uuid REFERENCES video_jobs(id), order_id uuid REFERENCES billing_orders(id),
 action text NOT NULL, actor text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Old preview jobs stay free. Reconstruct purchase/refund facts without issuing a second grant.
INSERT INTO credit_wallets(user_id,environment) SELECT DISTINCT user_id,environment FROM credit_ledger ON CONFLICT DO NOTHING;
INSERT INTO credit_batches(order_id,user_id,environment,credits,paid_at,refunded)
 SELECT l.order_id,l.user_id,l.environment, max(abs(l.credits)),
 coalesce(min(l.created_at) FILTER(WHERE l.kind='purchase'),min(l.created_at)),bool_or(l.kind='refund')
 FROM credit_ledger l GROUP BY l.order_id,l.user_id,l.environment;
