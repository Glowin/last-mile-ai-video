-- Additive only. No historical job, wallet, review or rollout row is modified.
-- Absence of a row ALWAYS means the pre-existing manual/legacy behavior.
CREATE TABLE generation_automation (
 job_id uuid PRIMARY KEY REFERENCES video_jobs(id),
 policy_version text NOT NULL CHECK(policy_version IN ('manual-v1','mvp-text-only-v1')),
 policy_snapshot jsonb NOT NULL,
 fingerprint text NOT NULL, binding_hash text NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
 identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
 idempotency_key uuid NOT NULL UNIQUE,
 max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
 timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 30000),
 created_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL CHECK(deadline_at>created_at),
 status text NOT NULL CHECK(status IN ('manual','checking','review','allowed','blocked','expired','error','canceled')),
 reason text,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=max_attempts),
 next_attempt_at timestamptz NOT NULL,
 lease_token uuid, lease_until timestamptz,
 allowed_at timestamptz,
 image_review text NOT NULL CHECK(image_review IN ('manual','not_applicable','not_reviewed_mvp')),
 output_review text NOT NULL CHECK(output_review IN ('manual','not_reviewed_mvp')),
 output_content_sha256 text CHECK(output_content_sha256 ~ '^[a-f0-9]{64}$'),
 output_verified_at timestamptz,
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK((output_content_sha256 IS NULL)=(output_verified_at IS NULL)),
 CHECK(policy_version<>'manual-v1' OR (status='manual' AND attempts=0 AND output_review='manual' AND image_review<>'not_reviewed_mvp')),
 CHECK(policy_version<>'mvp-text-only-v1' OR (status<>'manual' AND output_review='not_reviewed_mvp' AND image_review<>'manual'))
);
CREATE TABLE generation_automation_attempts (
 job_id uuid NOT NULL REFERENCES generation_automation(job_id),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 lease_token uuid NOT NULL UNIQUE,
 started_at timestamptz NOT NULL, finished_at timestamptz,
 action text NOT NULL CHECK(action IN ('started','allow','block','review','error','abandoned')),
 request_id text, reason_code text, semantic_status text,
 retryable boolean, retry_after_ms bigint, http_status integer,
 PRIMARY KEY(job_id,attempt)
);
CREATE INDEX generation_automation_due ON generation_automation(next_attempt_at)
 WHERE status IN ('checking','review');
CREATE FUNCTION protect_generation_automation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.job_id,NEW.policy_version,NEW.policy_snapshot,NEW.fingerprint,NEW.binding_hash,NEW.identity_hash,
        NEW.idempotency_key,NEW.max_attempts,NEW.timeout_ms,NEW.created_at,NEW.deadline_at,NEW.image_review,NEW.output_review)
    IS DISTINCT FROM
    ROW(OLD.job_id,OLD.policy_version,OLD.policy_snapshot,OLD.fingerprint,OLD.binding_hash,OLD.identity_hash,
        OLD.idempotency_key,OLD.max_attempts,OLD.timeout_ms,OLD.created_at,OLD.deadline_at,OLD.image_review,OLD.output_review)
    OR NEW.attempts<OLD.attempts THEN
   RAISE EXCEPTION 'Generation review policy and binding are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_automation_immutable BEFORE UPDATE ON generation_automation
 FOR EACH ROW EXECUTE FUNCTION protect_generation_automation_snapshot();
