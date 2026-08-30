-- AFTERTRACE Web Auth cutover prerequisite.
-- Apply this to Neon before deploying the Worker version that issues one-time Bot login links.

CREATE TABLE IF NOT EXISTS web_auth_entry_nonces (
  nonce varchar(128) PRIMARY KEY,
  line_user_id varchar(64) NOT NULL,
  line_group_id varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_auth_entry_nonce_expiry_idx
  ON web_auth_entry_nonces (expires_at);

CREATE INDEX IF NOT EXISTS web_auth_entry_nonce_user_idx
  ON web_auth_entry_nonces (line_user_id);
