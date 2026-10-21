-- Additive: legacy job owners and signed guest sessions remain valid until claimed.
CREATE TABLE users (
 id uuid PRIMARY KEY,
 google_sub text NOT NULL UNIQUE,
 email text NOT NULL,
 name text,
 invited_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE refresh_tokens (
 token_hash text PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES auth_sessions(id),
 used_at timestamptz
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id);
CREATE TABLE guest_claims (
 guest_id uuid PRIMARY KEY,
 user_id uuid REFERENCES users(id), -- NULL is an explicitly ended guest session.
 claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_nonces (
 nonce_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
CREATE INDEX auth_nonces_expiry_idx ON auth_nonces(expires_at);
CREATE TABLE auth_attempts (
 minute timestamptz PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 0
);
