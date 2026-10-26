-- Additive only: historical users remain unconfirmed. No DOB is retained.
ALTER TABLE users ADD COLUMN age_confirmed_at timestamptz;
ALTER TABLE users ADD COLUMN age_policy_version text;
ALTER TABLE users ADD CONSTRAINT users_age_declaration_pair
 CHECK ((age_confirmed_at IS NULL) = (age_policy_version IS NULL));
CREATE TABLE guest_age_declarations (
 guest_id uuid PRIMARY KEY,
 age_confirmed_at timestamptz NOT NULL,
 age_policy_version text NOT NULL
);
