-- Explicit rollout boundary: existing jobs retain their pre-rollout delivery flow.
-- New jobs cannot treat an absent input review as implicit approval.
CREATE TABLE generation_moderation_rollout (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO generation_moderation_rollout(id) VALUES(true);
