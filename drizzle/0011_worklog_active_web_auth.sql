-- Worklog still uses the historical physical table name for GROUP one-time Web links.
-- Older environments may already have this table from the pre-Worklog deployment helper;
-- fresh databases created only from the Drizzle journal did not. Make the active dependency
-- explicit and idempotent before deleting the retired schema declarations.
CREATE TABLE IF NOT EXISTS "web_auth_entry_nonces" (
  "nonce" varchar(128) PRIMARY KEY NOT NULL,
  "line_user_id" varchar(64) NOT NULL,
  "line_group_id" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_auth_entry_nonce_expiry_idx"
  ON "web_auth_entry_nonces" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_auth_entry_nonce_user_idx"
  ON "web_auth_entry_nonces" ("line_user_id");
