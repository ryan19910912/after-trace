CREATE TABLE IF NOT EXISTS "worklog_attachment_ingestions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "command_line_message_id" varchar(64) NOT NULL,
  "quoted_line_message_id" varchar(64) NOT NULL,
  "source_id" bigint NOT NULL,
  "actor_user_id" bigint NOT NULL,
  "status" varchar(32) NOT NULL,
  "reservation_token" varchar(64),
  "record_id" bigint,
  "usage_commit_json" jsonb,
  "last_error_code" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "worklog_attachment_ingestion_status_ck" CHECK ("status" IN ('PROCESSING', 'RECORD_CREATED', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_attachment_ingestion_command_uq" ON "worklog_attachment_ingestions" USING btree ("command_line_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_attachment_ingestion_source_status_idx" ON "worklog_attachment_ingestions" USING btree ("source_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_attachment_ingestion_quoted_idx" ON "worklog_attachment_ingestions" USING btree ("quoted_line_message_id");
