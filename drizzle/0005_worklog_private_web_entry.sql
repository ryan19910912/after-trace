CREATE TABLE "worklog_private_web_entry_nonces" (
  "nonce" varchar(128) PRIMARY KEY NOT NULL,
  "line_user_id" varchar(64) NOT NULL,
  "user_id" bigint NOT NULL,
  "source_id" bigint NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "worklog_private_web_entry_expiry_idx"
  ON "worklog_private_web_entry_nonces" ("expires_at");
CREATE INDEX "worklog_private_web_entry_user_idx"
  ON "worklog_private_web_entry_nonces" ("user_id", "expires_at");
CREATE INDEX "worklog_private_web_entry_source_idx"
  ON "worklog_private_web_entry_nonces" ("source_id", "expires_at");
