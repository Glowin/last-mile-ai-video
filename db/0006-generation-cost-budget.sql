-- CNY fen throughout. No automatic daily reset: unresolved costs must survive renewal.
CREATE TABLE generation_cost_budget (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 cap_minor bigint NOT NULL DEFAULT 0 CHECK(cap_minor BETWEEN 0 AND 9007199254740991),
 exposure_minor bigint NOT NULL DEFAULT 0 CHECK(exposure_minor BETWEEN 0 AND 9007199254740991),
 valid_from timestamptz, expires_at timestamptz,
 revision integer NOT NULL DEFAULT 0,
 CHECK(NOT enabled OR (valid_from IS NOT NULL AND expires_at IS NOT NULL AND expires_at > valid_from))
);
INSERT INTO generation_cost_budget(id) VALUES(true);
CREATE TABLE generation_cost_rates (
 id uuid PRIMARY KEY,
 spec_key text NOT NULL, spec jsonb NOT NULL,
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 maximum_minor bigint NOT NULL CHECK(maximum_minor BETWEEN 1 AND 9007199254740991),
 source_ref text NOT NULL, observed_at timestamptz NOT NULL,
 valid_from timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at > valid_from),
 confirmed_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE generation_cost_specs (
 spec_key text PRIMARY KEY,
 rate_id uuid NOT NULL REFERENCES generation_cost_rates(id),
 blocked_reason text,
 observed_minor bigint CHECK(observed_minor BETWEEN 0 AND 9007199254740991),
 observation_ref text, observed_at timestamptz
);
CREATE TABLE generation_cost_reservations (
 job_id uuid PRIMARY KEY,
 -- No FK to video_jobs: can be composed before job insertion in the same transaction.
 fingerprint text NOT NULL,
 rate_id uuid NOT NULL REFERENCES generation_cost_rates(id),
 spec_key text NOT NULL REFERENCES generation_cost_specs(spec_key),
 snapshot jsonb NOT NULL,
 reserved_minor bigint NOT NULL CHECK(reserved_minor BETWEEN 1 AND 9007199254740991),
 exposure_minor bigint NOT NULL CHECK(exposure_minor BETWEEN 0 AND 9007199254740991),
 actual_minor bigint CHECK(actual_minor BETWEEN 0 AND 9007199254740991),
 actual_evidence_ref text,
 state text NOT NULL CHECK(state IN ('held','submitted','released')),
 outcome text NOT NULL DEFAULT 'pending' CHECK(outcome IN ('pending','unknown','success','failed')),
 submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='submitted') = (submitted_at IS NOT NULL)),
 CHECK(state <> 'released' OR exposure_minor=0),
 CHECK(state = 'released' OR exposure_minor >= reserved_minor),
 CHECK(actual_minor IS NULL OR (state='submitted' AND exposure_minor >= actual_minor)),
 CHECK((actual_minor IS NULL) = (actual_evidence_ref IS NULL))
);
CREATE TABLE generation_cost_audit (
 id uuid PRIMARY KEY, job_id uuid REFERENCES generation_cost_reservations(job_id),
 action text NOT NULL, actor text NOT NULL, evidence_ref text NOT NULL,
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_cost_audit_job ON generation_cost_audit(job_id,created_at);
