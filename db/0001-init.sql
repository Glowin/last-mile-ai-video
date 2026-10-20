CREATE TABLE IF NOT EXISTS video_jobs (
 id uuid PRIMARY KEY, owner uuid NOT NULL, family text NOT NULL, mode text NOT NULL,
 prompt text NOT NULL, duration integer NOT NULL, resolution text NOT NULL, fingerprint text NOT NULL,
 payload jsonb, status text NOT NULL CHECK(status IN ('submitting','pending','success','failed','unknown')),
 upstream_id text, result_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_jobs_owner_created_idx ON video_jobs(owner,created_at DESC);
CREATE TABLE IF NOT EXISTS demo_login_attempts (minute timestamptz PRIMARY KEY, attempts integer NOT NULL DEFAULT 0);
