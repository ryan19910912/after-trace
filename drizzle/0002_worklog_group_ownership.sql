ALTER TABLE "worklog_sources"
  ADD COLUMN "owner_user_id" bigint,
  ADD COLUMN "owner_binding_method" varchar(64),
  ADD COLUMN "owner_bound_at" timestamptz;
--> statement-breakpoint

UPDATE "worklog_sources"
SET
  "owner_user_id" = "subscription_owner_user_id",
  "owner_binding_method" = CASE
    WHEN "subscription_owner_user_id" IS NOT NULL THEN 'LEGACY_SUBSCRIPTION_OWNER'
    ELSE NULL
  END,
  "owner_bound_at" = CASE
    WHEN "subscription_owner_user_id" IS NOT NULL THEN "created_at"
    ELSE NULL
  END
WHERE "type" = 'GROUP';
--> statement-breakpoint

ALTER TABLE "worklog_source_members"
  ADD COLUMN "recording_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "recording_updated_by_user_id" bigint,
  ADD COLUMN "recording_updated_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "worklog_ai_usage_events"
  RENAME COLUMN "user_id" TO "actor_user_id";
--> statement-breakpoint

ALTER TABLE "worklog_ai_usage_events"
  ADD COLUMN "charged_user_id" bigint;
--> statement-breakpoint

UPDATE "worklog_ai_usage_events"
SET "charged_user_id" = "actor_user_id"
WHERE "charged_user_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "worklog_ai_usage_events"
  ALTER COLUMN "charged_user_id" SET NOT NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "worklog_ai_usage_user_time_idx";
--> statement-breakpoint

CREATE INDEX "worklog_source_owner_idx"
  ON "worklog_sources" USING btree ("owner_user_id");
--> statement-breakpoint

CREATE INDEX "worklog_source_member_source_recording_idx"
  ON "worklog_source_members" USING btree ("source_id", "is_active", "recording_enabled");
--> statement-breakpoint

CREATE INDEX "worklog_record_source_author_type_idx"
  ON "worklog_records" USING btree ("source_id", "author_user_id", "input_type");
--> statement-breakpoint

CREATE INDEX "worklog_ai_usage_actor_time_idx"
  ON "worklog_ai_usage_events" USING btree ("actor_user_id", "created_at");
--> statement-breakpoint

CREATE INDEX "worklog_ai_usage_charged_time_idx"
  ON "worklog_ai_usage_events" USING btree ("charged_user_id", "created_at");
--> statement-breakpoint

CREATE INDEX "worklog_ai_usage_source_actor_time_idx"
  ON "worklog_ai_usage_events" USING btree ("source_id", "actor_user_id", "created_at");
