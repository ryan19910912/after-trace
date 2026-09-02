CREATE TYPE "public"."worklog_anomaly_severity" AS ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."worklog_anomaly_status" AS ENUM('OPEN', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."worklog_feedback_channel" AS ENUM('LINE_OA', 'PWA');--> statement-breakpoint
CREATE TYPE "public"."worklog_project_status" AS ENUM('ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_category" AS ENUM('NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'PHOTO', 'AUDIO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_input_type" AS ENUM('TEXT', 'AUDIO', 'IMAGE', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_type" AS ENUM('PRIVATE', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_source" AS ENUM('FREE', 'PAYMENT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_status" AS ENUM('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worklog_transaction_type" AS ENUM('RECEIVED', 'EXPENSE', 'RECEIVABLE');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_reservation_status" AS ENUM('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "worklog_ai_runtime_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" varchar(128) NOT NULL,
	"model" varchar(255) NOT NULL,
	"input_usd_per_million" numeric(18, 8) NOT NULL,
	"output_usd_per_million" numeric(18, 8) NOT NULL,
	"audio_usd_per_million" numeric(18, 8),
	"image_usd_per_million" numeric(18, 8),
	"usd_twd_rate" numeric(12, 6),
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"charged_user_id" bigint NOT NULL,
	"workspace_id" bigint,
	"source_id" bigint,
	"record_id" bigint,
	"provider" varchar(128) NOT NULL,
	"model" varchar(255) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_input_units" integer DEFAULT 0 NOT NULL,
	"image_input_units" integer DEFAULT 0 NOT NULL,
	"input_usd_per_million" numeric(18, 8) NOT NULL,
	"output_usd_per_million" numeric(18, 8) NOT NULL,
	"audio_usd_per_million" numeric(18, 8),
	"image_usd_per_million" numeric(18, 8),
	"usd_twd_rate" numeric(12, 6),
	"provider_cost_usd" numeric(18, 8) NOT NULL,
	"provider_cost_twd" numeric(18, 6),
	"ai_units_consumed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_anomaly_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category" varchar(128) NOT NULL,
	"severity" "worklog_anomaly_severity" DEFAULT 'ERROR' NOT NULL,
	"status" "worklog_anomaly_status" DEFAULT 'OPEN' NOT NULL,
	"error_code" varchar(128),
	"summary" text NOT NULL,
	"user_id" bigint,
	"source_id" bigint,
	"line_message_id" varchar(64),
	"request_ref" varchar(255),
	"metadata" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint,
	"actor_user_id" bigint,
	"actor_admin" varchar(128),
	"action" varchar(128) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(128),
	"before_value" jsonb,
	"after_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(64),
	"address" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"display_name_snapshot" varchar(255),
	"channel" "worklog_feedback_channel" NOT NULL,
	"text" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_projects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint NOT NULL,
	"customer_id" bigint,
	"name" varchar(255) NOT NULL,
	"address" text,
	"status" "worklog_project_status" DEFAULT 'ACTIVE' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"author_user_id" bigint,
	"customer_id" bigint,
	"project_id" bigint,
	"line_message_id" varchar(64),
	"quoted_line_message_id" varchar(64),
	"input_type" "worklog_record_input_type" NOT NULL,
	"category" "worklog_record_category" DEFAULT 'OTHER' NOT NULL,
	"raw_text" text,
	"attachment_metadata" jsonb,
	"normalized_summary" text,
	"source_timestamp" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"recording_enabled" boolean DEFAULT true NOT NULL,
	"recording_updated_by_user_id" bigint,
	"recording_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint NOT NULL,
	"type" "worklog_source_type" NOT NULL,
	"status" "worklog_source_status" DEFAULT 'ACTIVE' NOT NULL,
	"private_user_id" bigint,
	"line_group_id" varchar(64),
	"owner_user_id" bigint,
	"owner_binding_method" varchar(64),
	"owner_bound_at" timestamp with time zone,
	"subscription_owner_user_id" bigint,
	"inactive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_subscription_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"previous_plan_code" varchar(64),
	"next_plan_code" varchar(64) NOT NULL,
	"source" "worklog_subscription_source" NOT NULL,
	"actor" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_subscription_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"price_twd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"ai_allowance_units" integer DEFAULT 0 NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" bigint NOT NULL,
	"record_id" bigint,
	"customer_id" bigint,
	"project_id" bigint,
	"type" "worklog_transaction_type" NOT NULL,
	"amount_twd" numeric(14, 2) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_user_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"status" "worklog_subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"source" "worklog_subscription_source" DEFAULT 'FREE' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"display_name" varchar(255),
	"is_oa_friend" boolean DEFAULT false NOT NULL,
	"first_oa_added_at" timestamp with time zone,
	"oa_friend_state_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_workspaces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_quota_balances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"allowance_units" integer DEFAULT 0 NOT NULL,
	"used_units" integer DEFAULT 0 NOT NULL,
	"reserved_units" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_quota_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"charged_user_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"source_id" bigint,
	"units_reserved" integer NOT NULL,
	"units_committed" integer DEFAULT 0 NOT NULL,
	"status" "worklog_ai_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_pending_group_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pending_group_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_pending_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"line_group_id" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inactive_at" timestamp with time zone,
	"promoted_source_id" bigint,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_auth_entry_nonces" (
	"nonce" varchar(128) PRIMARY KEY NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"line_group_id" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_private_web_entry_nonces" (
	"nonce" varchar(128) PRIMARY KEY NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"user_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_record_ai_normalizations" (
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
	CONSTRAINT "worklog_record_ai_normalization_status_check" CHECK ("worklog_record_ai_normalizations"."status" IN ('PENDING', 'PROCESSING', 'PROVIDER_SUCCEEDED', 'USAGE_COMMITTED', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "worklog_line_text_cache" (
	"line_message_id" varchar(64) PRIMARY KEY NOT NULL,
	"line_group_id" varchar(64) NOT NULL,
	"line_user_id" varchar(64),
	"text" text NOT NULL,
	"line_timestamp" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_attachment_ingestions" (
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
	CONSTRAINT "worklog_attachment_ingestion_status_ck" CHECK ("worklog_attachment_ingestions"."status" IN ('PROCESSING', 'RECORD_CREATED', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "worklog_checkout_intents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"request_key" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING_PROVIDER' NOT NULL,
	"provider" varchar(64),
	"provider_checkout_id" varchar(255),
	"checkout_url" varchar(2048),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_checkout_intent_status_ck" CHECK ("worklog_checkout_intents"."status" IN ('PENDING_PROVIDER','READY','COMPLETED','CANCELLED','FAILED'))
);
--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_actor_time_idx" ON "worklog_ai_usage_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_charged_time_idx" ON "worklog_ai_usage_events" USING btree ("charged_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_source_actor_time_idx" ON "worklog_ai_usage_events" USING btree ("source_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_workspace_time_idx" ON "worklog_ai_usage_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_record_idx" ON "worklog_ai_usage_events" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "worklog_anomaly_status_severity_time_idx" ON "worklog_anomaly_events" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "worklog_anomaly_user_idx" ON "worklog_anomaly_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worklog_audit_workspace_time_idx" ON "worklog_audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_audit_target_idx" ON "worklog_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "worklog_customer_workspace_name_idx" ON "worklog_customers" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "worklog_feedback_created_idx" ON "worklog_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "worklog_project_workspace_status_idx" ON "worklog_projects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "worklog_project_customer_idx" ON "worklog_projects" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_record_line_message_uq" ON "worklog_records" USING btree ("line_message_id");--> statement-breakpoint
CREATE INDEX "worklog_record_source_created_idx" ON "worklog_records" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_record_workspace_customer_idx" ON "worklog_records" USING btree ("workspace_id","customer_id");--> statement-breakpoint
CREATE INDEX "worklog_record_workspace_project_idx" ON "worklog_records" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "worklog_record_author_type_idx" ON "worklog_records" USING btree ("author_user_id","input_type");--> statement-breakpoint
CREATE INDEX "worklog_record_source_author_type_idx" ON "worklog_records" USING btree ("source_id","author_user_id","input_type");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_member_uq" ON "worklog_source_members" USING btree ("source_id","user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_member_user_active_idx" ON "worklog_source_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "worklog_source_member_source_recording_idx" ON "worklog_source_members" USING btree ("source_id","is_active","recording_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_private_user_uq" ON "worklog_sources" USING btree ("private_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_line_group_uq" ON "worklog_sources" USING btree ("line_group_id");--> statement-breakpoint
CREATE INDEX "worklog_source_workspace_type_idx" ON "worklog_sources" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "worklog_source_owner_idx" ON "worklog_sources" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_subscription_owner_idx" ON "worklog_sources" USING btree ("subscription_owner_user_id");--> statement-breakpoint
CREATE INDEX "worklog_subscription_history_user_time_idx" ON "worklog_subscription_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_subscription_plan_code_uq" ON "worklog_subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "worklog_transaction_workspace_time_idx" ON "worklog_transactions" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "worklog_transaction_project_idx" ON "worklog_transactions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "worklog_transaction_record_idx" ON "worklog_transactions" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_user_subscription_user_uq" ON "worklog_user_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worklog_user_subscription_plan_status_idx" ON "worklog_user_subscriptions" USING btree ("plan_code","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_user_line_user_uq" ON "worklog_users" USING btree ("line_user_id");--> statement-breakpoint
CREATE INDEX "worklog_user_oa_updated_idx" ON "worklog_users" USING btree ("is_oa_friend","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_workspace_owner_uq" ON "worklog_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_quota_balance_user_period_uq" ON "worklog_ai_quota_balances" USING btree ("user_id","period_start");--> statement-breakpoint
CREATE INDEX "worklog_ai_quota_balance_user_time_idx" ON "worklog_ai_quota_balances" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_quota_reservation_token_uq" ON "worklog_ai_quota_reservations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "worklog_ai_quota_reservation_charged_status_expiry_idx" ON "worklog_ai_quota_reservations" USING btree ("charged_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_quota_reservation_source_actor_idx" ON "worklog_ai_quota_reservations" USING btree ("source_id","actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_pending_group_member_uq" ON "worklog_pending_group_members" USING btree ("pending_group_id","user_id");--> statement-breakpoint
CREATE INDEX "worklog_pending_group_member_user_active_idx" ON "worklog_pending_group_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_pending_group_line_group_uq" ON "worklog_pending_groups" USING btree ("line_group_id");--> statement-breakpoint
CREATE INDEX "worklog_pending_group_active_updated_idx" ON "worklog_pending_groups" USING btree ("is_active","updated_at");--> statement-breakpoint
CREATE INDEX "worklog_pending_group_promoted_idx" ON "worklog_pending_groups" USING btree ("promoted_source_id");--> statement-breakpoint
CREATE INDEX "web_auth_entry_nonce_expiry_idx" ON "web_auth_entry_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "web_auth_entry_nonce_user_idx" ON "web_auth_entry_nonces" USING btree ("line_user_id");--> statement-breakpoint
CREATE INDEX "worklog_private_web_entry_expiry_idx" ON "worklog_private_web_entry_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "worklog_private_web_entry_user_idx" ON "worklog_private_web_entry_nonces" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "worklog_private_web_entry_source_idx" ON "worklog_private_web_entry_nonces" USING btree ("source_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_record_ai_normalization_claim_uq" ON "worklog_record_ai_normalizations" USING btree ("claim_token");--> statement-breakpoint
CREATE INDEX "worklog_record_ai_normalization_status_idx" ON "worklog_record_ai_normalizations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "worklog_record_ai_normalization_reservation_idx" ON "worklog_record_ai_normalizations" USING btree ("reservation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_line_text_cache_group_message_uq" ON "worklog_line_text_cache" USING btree ("line_group_id","line_message_id");--> statement-breakpoint
CREATE INDEX "worklog_line_text_cache_group_time_idx" ON "worklog_line_text_cache" USING btree ("line_group_id","line_timestamp");--> statement-breakpoint
CREATE INDEX "worklog_line_text_cache_expires_idx" ON "worklog_line_text_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_attachment_ingestion_command_uq" ON "worklog_attachment_ingestions" USING btree ("command_line_message_id");--> statement-breakpoint
CREATE INDEX "worklog_attachment_ingestion_source_status_idx" ON "worklog_attachment_ingestions" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "worklog_attachment_ingestion_quoted_idx" ON "worklog_attachment_ingestions" USING btree ("quoted_line_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_checkout_intent_request_uq" ON "worklog_checkout_intents" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_user_time_idx" ON "worklog_checkout_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_status_time_idx" ON "worklog_checkout_intents" USING btree ("status","created_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION worklog_capture_attachment_failure_anomaly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'FAILED' AND (OLD.status IS DISTINCT FROM 'FAILED' OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code) THEN
    INSERT INTO worklog_anomaly_events (
      category,
      severity,
      status,
      error_code,
      summary,
      user_id,
      source_id,
      line_message_id,
      request_ref,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      'LINE_ATTACHMENT_INGESTION',
      CASE
        WHEN NEW.last_error_code IN ('LINE_CONTENT_EXPIRED', 'ATTACHMENT_UNSUPPORTED', 'LINE_CONTENT_TOO_LARGE') THEN 'WARNING'::worklog_anomaly_severity
        ELSE 'ERROR'::worklog_anomaly_severity
      END,
      'OPEN',
      LEFT(COALESCE(NEW.last_error_code, 'ATTACHMENT_INGESTION_FAILED'), 128),
      'LINE Reply attachment ingestion failed',
      NEW.actor_user_id,
      NEW.source_id,
      NEW.command_line_message_id,
      NEW.quoted_line_message_id,
      jsonb_build_object(
        'quotedLineMessageId', NEW.quoted_line_message_id,
        'ingestionStatus', NEW.status,
        'recordId', NEW.record_id
      ),
      NOW(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_attachment_failure_anomaly_trg ON worklog_attachment_ingestions;
CREATE TRIGGER worklog_attachment_failure_anomaly_trg
AFTER UPDATE OF status, last_error_code ON worklog_attachment_ingestions
FOR EACH ROW
EXECUTE FUNCTION worklog_capture_attachment_failure_anomaly();

CREATE OR REPLACE FUNCTION worklog_capture_normalization_failure_anomaly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_source_id bigint;
  target_user_id bigint;
  target_line_message_id varchar(64);
BEGIN
  IF NEW.status = 'FAILED' AND (OLD.status IS DISTINCT FROM 'FAILED' OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code) THEN
    SELECT source_id, author_user_id, line_message_id
      INTO target_source_id, target_user_id, target_line_message_id
    FROM worklog_records
    WHERE id = NEW.record_id;

    INSERT INTO worklog_anomaly_events (
      category,
      severity,
      status,
      error_code,
      summary,
      user_id,
      source_id,
      line_message_id,
      request_ref,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      'TEXT_AI_NORMALIZATION',
      'ERROR',
      'OPEN',
      LEFT(COALESCE(NEW.last_error_code, 'AI_NORMALIZATION_FAILED'), 128),
      'Worklog TEXT AI normalization failed',
      target_user_id,
      target_source_id,
      target_line_message_id,
      NEW.record_id::text,
      jsonb_build_object(
        'recordId', NEW.record_id,
        'normalizationStatus', NEW.status,
        'detail', NEW.last_error_detail
      ),
      NOW(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_normalization_failure_anomaly_trg ON worklog_record_ai_normalizations;
CREATE TRIGGER worklog_normalization_failure_anomaly_trg
AFTER UPDATE OF status, last_error_code ON worklog_record_ai_normalizations
FOR EACH ROW
EXECUTE FUNCTION worklog_capture_normalization_failure_anomaly();

--> statement-breakpoint

-- Preserve AI allowance as an immutable billing-cycle snapshot.
--
-- Plan definitions are templates for future cycles. Once a row exists in
-- worklog_ai_quota_balances for (user_id, period_start), reassigning a plan or
-- editing a plan template must not rewrite that cycle's allowance underneath
-- already-used or reserved units. A future explicit operator adjustment should
-- use a dedicated audited mechanism rather than mutating this snapshot implicitly.

CREATE OR REPLACE FUNCTION worklog_preserve_quota_cycle_allowance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.allowance_units IS DISTINCT FROM OLD.allowance_units THEN
    NEW.allowance_units := OLD.allowance_units;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_quota_cycle_allowance_snapshot
  ON worklog_ai_quota_balances;

CREATE TRIGGER worklog_quota_cycle_allowance_snapshot
BEFORE UPDATE OF allowance_units ON worklog_ai_quota_balances
FOR EACH ROW
EXECUTE FUNCTION worklog_preserve_quota_cycle_allowance();

--> statement-breakpoint

-- Keep customer/project links deterministic even when a project is reassigned.
--
-- API writes already canonicalize customer_id from a selected project's customer,
-- but changing the project's customer later could leave existing records and
-- transactions pointing at the previous customer. This migration closes that gap
-- at the database layer.

CREATE OR REPLACE FUNCTION worklog_sync_project_customer_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL THEN
    UPDATE worklog_records
    SET customer_id = NEW.customer_id,
        updated_at = NOW()
    WHERE project_id = NEW.id
      AND workspace_id = NEW.workspace_id
      AND customer_id IS DISTINCT FROM NEW.customer_id;

    UPDATE worklog_transactions
    SET customer_id = NEW.customer_id,
        updated_at = NOW()
    WHERE project_id = NEW.id
      AND workspace_id = NEW.workspace_id
      AND customer_id IS DISTINCT FROM NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_project_customer_link_sync
  ON worklog_projects;

CREATE TRIGGER worklog_project_customer_link_sync
AFTER UPDATE OF customer_id ON worklog_projects
FOR EACH ROW
EXECUTE FUNCTION worklog_sync_project_customer_links();
