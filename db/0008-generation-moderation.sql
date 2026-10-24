-- Manual review is separate from provider status and financial settlement.
CREATE TABLE generation_moderation (
 job_id uuid NOT NULL REFERENCES video_jobs(id), phase text NOT NULL CHECK(phase IN ('input','output')),
 version integer NOT NULL CHECK(version > 0), policy_version text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 output_hash text CHECK(output_hash ~ '^[0-9a-f]{64}$'),
 binding_hash text NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
 snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','expired')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 decided_at timestamptz, actor text, reason text,
 PRIMARY KEY(job_id,phase,version),
 CHECK((phase='input' AND output_hash IS NULL) OR (phase='output' AND output_hash IS NOT NULL)),
 CHECK((state='pending' AND decided_at IS NULL AND actor IS NULL AND reason IS NULL) OR
       (state<>'pending' AND decided_at IS NOT NULL AND length(actor)>=2 AND length(reason)>=10))
);
CREATE INDEX generation_moderation_queue ON generation_moderation(state,created_at);
CREATE TABLE moderation_cases (
 id uuid PRIMARY KEY, job_id uuid REFERENCES video_jobs(id), source_reference text NOT NULL UNIQUE,
 category text NOT NULL CHECK(category IN ('content','rights','privacy','billing','account','other')),
 summary text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by text, resolution text, resolved_at timestamptz
);
CREATE TABLE moderation_case_events (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES moderation_cases(id),
 actor text NOT NULL, action text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
