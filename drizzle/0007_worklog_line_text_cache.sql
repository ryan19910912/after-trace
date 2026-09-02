CREATE TABLE IF NOT EXISTS "worklog_line_text_cache" (
  "line_message_id" varchar(64) PRIMARY KEY NOT NULL,
  "line_group_id" varchar(64) NOT NULL,
  "line_user_id" varchar(64),
  "text" text NOT NULL,
  "line_timestamp" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_line_text_cache_group_message_uq"
  ON "worklog_line_text_cache" USING btree ("line_group_id", "line_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_line_text_cache_group_time_idx"
  ON "worklog_line_text_cache" USING btree ("line_group_id", "line_timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_line_text_cache_expires_idx"
  ON "worklog_line_text_cache" USING btree ("expires_at");
