CREATE TABLE IF NOT EXISTS "worklog_record_ai_normalizations" (
  "record_id" bigint PRIMARY KEY NOT NULL,
  "status" varchar(32) DEFAULT 'PENDING' NOT NULL,
  "claim_token" varchar(64) NOT NULL,
  "reservation_token" varchar(64),
  "result_json" jsonb,
  "usage_commit_json" jsonb,
  "provider_response_id" varchar(255),
  "latency_ms" integer,
  "last_error_code" varchar(128),
  "last_error_detail" text,
  "started_at" timestamp with time zone,
  "provider_succeeded_at" timestamp with time zone,
  "usage_committed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_record_ai_normalization_status_check" CHECK (
    "status" IN ('PENDING', 'PROCESSING', 'PROVIDER_SUCCEEDED', 'USAGE_COMMITTED', 'SUCCEEDED', 'FAILED')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_record_ai_normalization_claim_uq"
  ON "worklog_record_ai_normalizations" USING btree ("claim_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_record_ai_normalization_status_idx"
  ON "worklog_record_ai_normalizations" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_record_ai_normalization_reservation_idx"
  ON "worklog_record_ai_normalizations" USING btree ("reservation_token");
