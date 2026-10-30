CREATE TABLE "worklog_error_occurrences" (
	"dedupe_key" varchar(128) PRIMARY KEY NOT NULL,
	"summary_id" varchar(64) NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"request_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_error_rate_limits" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_error_summaries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"source" varchar(16) NOT NULL,
	"feature" varchar(32) NOT NULL,
	"code" varchar(48) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"route_key" varchar(96) NOT NULL,
	"http_status" integer,
	"user_id" bigint,
	"user_public_id" varchar(32),
	"admin_id" bigint,
	"model_id" varchar(200),
	"model_revision" varchar(64),
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"total_count" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_id" varchar(36) NOT NULL,
	"last_request_id" varchar(36),
	"handled_by" bigint,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "worklog_error_occurrences" ADD CONSTRAINT "worklog_error_occurrences_summary_id_worklog_error_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."worklog_error_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worklog_error_occurrence_request_idx" ON "worklog_error_occurrences" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "worklog_error_occurrence_event_idx" ON "worklog_error_occurrences" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "worklog_error_occurrence_summary_idx" ON "worklog_error_occurrences" USING btree ("summary_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_error_last_seen_idx" ON "worklog_error_summaries" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "worklog_error_status_time_idx" ON "worklog_error_summaries" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "worklog_error_user_time_idx" ON "worklog_error_summaries" USING btree ("user_public_id","last_seen_at");
--> statement-breakpoint
COMMENT ON TABLE "worklog_error_occurrences" IS 'Sanitized diagnostic metadata; excludes secrets and content.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_occurrences"."dedupe_key" IS 'Diagnostic dedupe key; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_occurrences"."summary_id" IS 'Diagnostic summary id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_occurrences"."event_id" IS 'Diagnostic event id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_occurrences"."request_id" IS 'Diagnostic request id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_occurrences"."created_at" IS 'Diagnostic created at; bounded metadata only.';

--> statement-breakpoint
COMMENT ON TABLE "worklog_error_rate_limits" IS 'Sanitized diagnostic metadata; excludes secrets and content.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_rate_limits"."key" IS 'Diagnostic key; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_rate_limits"."window_start" IS 'Diagnostic window start; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_rate_limits"."total" IS 'Diagnostic total; bounded metadata only.';

--> statement-breakpoint
COMMENT ON TABLE "worklog_error_summaries" IS 'Sanitized diagnostic metadata; excludes secrets and content.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."id" IS 'Diagnostic id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."source" IS 'Diagnostic source; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."feature" IS 'Diagnostic feature; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."code" IS 'Diagnostic code; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."severity" IS 'Diagnostic severity; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."route_key" IS 'Diagnostic route key; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."http_status" IS 'Diagnostic http status; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."user_id" IS 'Diagnostic user id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."user_public_id" IS 'Diagnostic user public id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."admin_id" IS 'Diagnostic admin id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."model_id" IS 'Diagnostic model id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."model_revision" IS 'Diagnostic model revision; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."status" IS 'Diagnostic status; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."total_count" IS 'Diagnostic total count; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."version" IS 'Diagnostic version; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."first_seen_at" IS 'Diagnostic first seen at; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."last_seen_at" IS 'Diagnostic last seen at; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."last_event_id" IS 'Diagnostic last event id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."last_request_id" IS 'Diagnostic last request id; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."handled_by" IS 'Diagnostic handled by; bounded metadata only.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_error_summaries"."handled_at" IS 'Diagnostic handled at; bounded metadata only.';
