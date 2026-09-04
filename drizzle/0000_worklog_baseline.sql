CREATE TYPE "public"."worklog_anomaly_severity" AS ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."worklog_anomaly_status" AS ENUM('OPEN', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."worklog_feedback_channel" AS ENUM('LINE_OA', 'PWA');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_input_type" AS ENUM('TEXT', 'AUDIO', 'IMAGE', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_type" AS ENUM('PRIVATE', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_source" AS ENUM('FREE', 'PAYMENT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_status" AS ENUM('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_confirmation_status" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_confirmation_type" AS ENUM('ALIAS_MATCH', 'RECORD_TITLE', 'ENTITY_MATCH');--> statement-breakpoint
CREATE TYPE "public"."worklog_entity_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_revision_channel" AS ENUM('PWA_MANUAL', 'PWA_DELETE', 'PWA_RESTORE', 'LINE_AI_EDIT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_status" AS ENUM('ACTIVE', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_grant_status" AS ENUM('ACTIVE', 'EXHAUSTED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_grant_type" AS ENUM('FREE_INITIAL', 'SUBSCRIPTION_PERIOD', 'TOP_UP', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_point_reservation_status" AS ENUM('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');--> statement-breakpoint
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
CREATE TABLE "worklog_source_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
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
	"inactive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_source_line_group_uq" UNIQUE("line_group_id"),
	CONSTRAINT "worklog_source_private_user_id_uq" UNIQUE("private_user_id","id"),
	CONSTRAINT "worklog_source_identity_shape_ck" CHECK ((
        ("worklog_sources"."type" = 'PRIVATE' AND "worklog_sources"."private_user_id" IS NOT NULL AND "worklog_sources"."line_group_id" IS NULL)
        OR
        ("worklog_sources"."type" = 'GROUP' AND "worklog_sources"."private_user_id" IS NULL AND "worklog_sources"."line_group_id" IS NOT NULL)
      ))
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
	"subscription_period_points" integer DEFAULT 0 NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_subscription_plan_code_uq" UNIQUE("code")
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_user_line_user_uq" UNIQUE("line_user_id")
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
CREATE TABLE "worklog_ai_confirmations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"record_id" bigint,
	"requested_user_id" bigint NOT NULL,
	"confirmation_type" "worklog_ai_confirmation_type" NOT NULL,
	"candidate_entity_id" bigint,
	"proposed_name" varchar(255),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "worklog_ai_confirmation_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_ai_confirmation_source_id_uq" UNIQUE("source_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_entities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"entity_type" varchar(64),
	"status" "worklog_entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_entity_source_id_uq" UNIQUE("source_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_entity_aliases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"alias" varchar(255) NOT NULL,
	"created_by_user_id" bigint,
	"created_via" varchar(64) DEFAULT 'PWA_MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_record_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"record_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"editor_user_id" bigint,
	"channel" "worklog_record_revision_channel" NOT NULL,
	"previous_raw_text" text NOT NULL,
	"new_raw_text" text NOT NULL,
	"previous_occurred_at" timestamp with time zone NOT NULL,
	"new_occurred_at" timestamp with time zone NOT NULL,
	"previous_entity_id" bigint,
	"new_entity_id" bigint,
	"previous_status" "worklog_record_status" NOT NULL,
	"new_status" "worklog_record_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"entity_id" bigint,
	"author_user_id" bigint,
	"line_message_id" varchar(64),
	"quoted_line_message_id" varchar(64),
	"input_type" "worklog_record_input_type" NOT NULL,
	"raw_text" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "worklog_record_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_record_line_message_uq" UNIQUE("line_message_id"),
	CONSTRAINT "worklog_record_source_id_uq" UNIQUE("source_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reservation_token" varchar(64),
	"actor_user_id" bigint NOT NULL,
	"charged_user_id" bigint NOT NULL,
	"workspace_id" bigint,
	"source_id" bigint,
	"record_id" bigint,
	"operation" varchar(64) DEFAULT 'UNKNOWN' NOT NULL,
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
	"customer_points_charged" integer DEFAULT 0 NOT NULL,
	"platform_subsidized_points" integer DEFAULT 0 NOT NULL,
	"platform_subsidized_cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"platform_subsidized_cost_twd" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_grant_scopes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grant_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"cap_points" integer,
	"used_points" integer DEFAULT 0 NOT NULL,
	"reserved_points" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_ai_grant_scope_grant_id_uq" UNIQUE("grant_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"type" "worklog_ai_grant_type" NOT NULL,
	"status" "worklog_ai_grant_status" DEFAULT 'ACTIVE' NOT NULL,
	"original_points" integer NOT NULL,
	"remaining_points" integer NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"origin_key" varchar(255) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_point_reservation_funding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reservation_id" bigint NOT NULL,
	"grant_id" bigint NOT NULL,
	"grant_scope_id" bigint NOT NULL,
	"points_reserved" integer NOT NULL,
	"points_charged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_point_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"charged_user_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"points_reserved" integer NOT NULL,
	"points_committed" integer DEFAULT 0 NOT NULL,
	"platform_subsidized_points" integer DEFAULT 0 NOT NULL,
	"status" "worklog_ai_point_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_ai_point_reservation_token_uq" UNIQUE("token"),
	CONSTRAINT "worklog_ai_point_reservation_source_token_uq" UNIQUE("source_id","token")
);
--> statement-breakpoint
CREATE TABLE "worklog_ai_usage_funding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"usage_event_id" bigint NOT NULL,
	"grant_id" bigint NOT NULL,
	"grant_scope_id" bigint NOT NULL,
	"points_charged" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_ai_responsibility" (
	"source_id" bigint PRIMARY KEY NOT NULL,
	"responsible_user_id" bigint NOT NULL,
	"assigned_by_user_id" bigint,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_ai_responsibility_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"previous_user_id" bigint,
	"next_user_id" bigint,
	"actor_user_id" bigint,
	"reason" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "worklog_line_record_reply_targets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"record_id" bigint NOT NULL,
	"bot_line_message_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_line_ai_edits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"charged_user_id" bigint NOT NULL,
	"line_command_message_id" varchar(64) NOT NULL,
	"quoted_line_message_id" varchar(64) NOT NULL,
	"command_timestamp" timestamp with time zone NOT NULL,
	"instruction" text NOT NULL,
	"expected_record_version" integer NOT NULL,
	"status" varchar(32) DEFAULT 'PROCESSING' NOT NULL,
	"claim_token" varchar(64) NOT NULL,
	"reservation_token" varchar(64),
	"result_json" jsonb,
	"usage_commit_json" jsonb,
	"provider_response_id" varchar(255),
	"latency_ms" integer,
	"confirmation_id" bigint,
	"applied_record_version" integer,
	"applied_entity_id" bigint,
	"last_error_code" varchar(128),
	"last_error_detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_succeeded_at" timestamp with time zone,
	"usage_committed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_line_ai_edit_expected_version_check" CHECK ("worklog_line_ai_edits"."expected_record_version" > 0),
	CONSTRAINT "worklog_line_ai_edit_status_check" CHECK ("worklog_line_ai_edits"."status" IN ('PROCESSING', 'PROVIDER_SUCCEEDED', 'USAGE_COMMITTED', 'PENDING_CONFIRMATION', 'SUCCEEDED', 'RECORD_CHANGED', 'FAILED'))
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
ALTER TABLE "worklog_anomaly_events" ADD CONSTRAINT "worklog_anomaly_events_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_anomaly_events" ADD CONSTRAINT "worklog_anomaly_events_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_audit_logs" ADD CONSTRAINT "worklog_audit_logs_workspace_id_worklog_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."worklog_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_audit_logs" ADD CONSTRAINT "worklog_audit_logs_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_feedback" ADD CONSTRAINT "worklog_feedback_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_members" ADD CONSTRAINT "worklog_source_members_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_members" ADD CONSTRAINT "worklog_source_members_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_sources" ADD CONSTRAINT "worklog_sources_workspace_id_worklog_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."worklog_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_sources" ADD CONSTRAINT "worklog_sources_private_user_id_worklog_users_id_fk" FOREIGN KEY ("private_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_previous_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("previous_plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_next_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("next_plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions" ADD CONSTRAINT "worklog_user_subscriptions_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions" ADD CONSTRAINT "worklog_user_subscriptions_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_workspaces" ADD CONSTRAINT "worklog_workspaces_owner_user_id_worklog_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_confirmations" ADD CONSTRAINT "worklog_ai_confirmations_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_confirmations" ADD CONSTRAINT "worklog_ai_confirmations_requested_user_id_worklog_users_id_fk" FOREIGN KEY ("requested_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_confirmations" ADD CONSTRAINT "worklog_ai_confirmations_resolved_by_user_id_worklog_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_confirmations" ADD CONSTRAINT "worklog_ai_confirmation_source_record_fk" FOREIGN KEY ("source_id","record_id") REFERENCES "public"."worklog_records"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_confirmations" ADD CONSTRAINT "worklog_ai_confirmation_source_entity_fk" FOREIGN KEY ("source_id","candidate_entity_id") REFERENCES "public"."worklog_entities"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_entities" ADD CONSTRAINT "worklog_entities_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_entity_aliases" ADD CONSTRAINT "worklog_entity_aliases_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_entity_aliases" ADD CONSTRAINT "worklog_entity_aliases_created_by_user_id_worklog_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_entity_aliases" ADD CONSTRAINT "worklog_entity_alias_source_entity_fk" FOREIGN KEY ("source_id","entity_id") REFERENCES "public"."worklog_entities"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_editor_user_id_worklog_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_previous_entity_id_worklog_entities_id_fk" FOREIGN KEY ("previous_entity_id") REFERENCES "public"."worklog_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_new_entity_id_worklog_entities_id_fk" FOREIGN KEY ("new_entity_id") REFERENCES "public"."worklog_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_author_user_id_worklog_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_deleted_by_user_id_worklog_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_record_source_entity_fk" FOREIGN KEY ("source_id","entity_id") REFERENCES "public"."worklog_entities"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_events" ADD CONSTRAINT "worklog_ai_usage_events_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_events" ADD CONSTRAINT "worklog_ai_usage_events_charged_user_id_worklog_users_id_fk" FOREIGN KEY ("charged_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_events" ADD CONSTRAINT "worklog_ai_usage_events_workspace_id_worklog_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."worklog_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_events" ADD CONSTRAINT "worklog_ai_usage_events_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_events" ADD CONSTRAINT "worklog_ai_usage_events_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_grant_scopes" ADD CONSTRAINT "worklog_ai_grant_scopes_grant_id_worklog_ai_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."worklog_ai_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_grant_scopes" ADD CONSTRAINT "worklog_ai_grant_scopes_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_grants" ADD CONSTRAINT "worklog_ai_grants_owner_user_id_worklog_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservation_funding" ADD CONSTRAINT "worklog_ai_point_reservation_funding_reservation_id_worklog_ai_point_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."worklog_ai_point_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservation_funding" ADD CONSTRAINT "worklog_ai_point_reservation_funding_grant_id_worklog_ai_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."worklog_ai_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservation_funding" ADD CONSTRAINT "worklog_ai_point_reservation_funding_grant_scope_fk" FOREIGN KEY ("grant_id","grant_scope_id") REFERENCES "public"."worklog_ai_grant_scopes"("grant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservations" ADD CONSTRAINT "worklog_ai_point_reservations_charged_user_id_worklog_users_id_fk" FOREIGN KEY ("charged_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservations" ADD CONSTRAINT "worklog_ai_point_reservations_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_point_reservations" ADD CONSTRAINT "worklog_ai_point_reservations_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_usage_event_id_worklog_ai_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."worklog_ai_usage_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_grant_id_worklog_ai_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."worklog_ai_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_grant_scope_fk" FOREIGN KEY ("grant_id","grant_scope_id") REFERENCES "public"."worklog_ai_grant_scopes"("grant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility" ADD CONSTRAINT "worklog_source_ai_responsibility_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility" ADD CONSTRAINT "worklog_source_ai_responsibility_responsible_user_id_worklog_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility" ADD CONSTRAINT "worklog_source_ai_responsibility_assigned_by_user_id_worklog_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility_history" ADD CONSTRAINT "worklog_source_ai_responsibility_history_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility_history" ADD CONSTRAINT "worklog_source_ai_responsibility_history_previous_user_id_worklog_users_id_fk" FOREIGN KEY ("previous_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility_history" ADD CONSTRAINT "worklog_source_ai_responsibility_history_next_user_id_worklog_users_id_fk" FOREIGN KEY ("next_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_ai_responsibility_history" ADD CONSTRAINT "worklog_source_ai_responsibility_history_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_auth_entry_nonces" ADD CONSTRAINT "web_auth_entry_nonces_line_user_id_worklog_users_line_user_id_fk" FOREIGN KEY ("line_user_id") REFERENCES "public"."worklog_users"("line_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_auth_entry_nonces" ADD CONSTRAINT "web_auth_entry_nonces_line_group_id_worklog_sources_line_group_id_fk" FOREIGN KEY ("line_group_id") REFERENCES "public"."worklog_sources"("line_group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_private_web_entry_nonces" ADD CONSTRAINT "worklog_private_web_entry_nonces_line_user_id_worklog_users_line_user_id_fk" FOREIGN KEY ("line_user_id") REFERENCES "public"."worklog_users"("line_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_private_web_entry_nonces" ADD CONSTRAINT "worklog_private_web_entry_nonces_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_private_web_entry_nonces" ADD CONSTRAINT "worklog_private_web_entry_user_source_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "public"."worklog_sources"("private_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_ai_normalizations" ADD CONSTRAINT "worklog_record_ai_normalizations_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_ai_normalizations" ADD CONSTRAINT "worklog_record_ai_normalizations_reservation_token_worklog_ai_point_reservations_token_fk" FOREIGN KEY ("reservation_token") REFERENCES "public"."worklog_ai_point_reservations"("token") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_record_reply_targets" ADD CONSTRAINT "worklog_line_record_reply_targets_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edits_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edits_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edits_charged_user_id_worklog_users_id_fk" FOREIGN KEY ("charged_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edit_source_record_fk" FOREIGN KEY ("source_id","record_id") REFERENCES "public"."worklog_records"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edit_source_reservation_fk" FOREIGN KEY ("source_id","reservation_token") REFERENCES "public"."worklog_ai_point_reservations"("source_id","token") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edit_source_confirmation_fk" FOREIGN KEY ("source_id","confirmation_id") REFERENCES "public"."worklog_ai_confirmations"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_line_ai_edits" ADD CONSTRAINT "worklog_line_ai_edit_source_entity_fk" FOREIGN KEY ("source_id","applied_entity_id") REFERENCES "public"."worklog_entities"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_attachment_ingestions" ADD CONSTRAINT "worklog_attachment_ingestions_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_attachment_ingestions" ADD CONSTRAINT "worklog_attachment_ingestions_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_attachment_ingestions" ADD CONSTRAINT "worklog_attachment_ingestion_source_reservation_fk" FOREIGN KEY ("source_id","reservation_token") REFERENCES "public"."worklog_ai_point_reservations"("source_id","token") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_attachment_ingestions" ADD CONSTRAINT "worklog_attachment_ingestion_source_record_fk" FOREIGN KEY ("source_id","record_id") REFERENCES "public"."worklog_records"("source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_checkout_intents" ADD CONSTRAINT "worklog_checkout_intents_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_checkout_intents" ADD CONSTRAINT "worklog_checkout_intents_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worklog_anomaly_status_severity_time_idx" ON "worklog_anomaly_events" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "worklog_anomaly_user_idx" ON "worklog_anomaly_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worklog_audit_workspace_time_idx" ON "worklog_audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_audit_target_idx" ON "worklog_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "worklog_feedback_created_idx" ON "worklog_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_member_uq" ON "worklog_source_members" USING btree ("source_id","user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_member_user_active_idx" ON "worklog_source_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_private_user_uq" ON "worklog_sources" USING btree ("private_user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_workspace_type_idx" ON "worklog_sources" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "worklog_subscription_history_user_time_idx" ON "worklog_subscription_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_user_subscription_user_uq" ON "worklog_user_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worklog_user_subscription_plan_status_idx" ON "worklog_user_subscriptions" USING btree ("plan_code","status");--> statement-breakpoint
CREATE INDEX "worklog_user_oa_updated_idx" ON "worklog_users" USING btree ("is_oa_friend","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_workspace_owner_uq" ON "worklog_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "worklog_ai_confirmation_user_status_idx" ON "worklog_ai_confirmations" USING btree ("requested_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_confirmation_source_status_idx" ON "worklog_ai_confirmations" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "worklog_ai_confirmation_record_idx" ON "worklog_ai_confirmations" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_entity_source_name_uq" ON "worklog_entities" USING btree ("source_id","name");--> statement-breakpoint
CREATE INDEX "worklog_entity_source_status_idx" ON "worklog_entities" USING btree ("source_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_entity_alias_source_alias_uq" ON "worklog_entity_aliases" USING btree ("source_id","alias");--> statement-breakpoint
CREATE INDEX "worklog_entity_alias_entity_idx" ON "worklog_entity_aliases" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_record_revision_record_version_uq" ON "worklog_record_revisions" USING btree ("record_id","version");--> statement-breakpoint
CREATE INDEX "worklog_record_revision_record_time_idx" ON "worklog_record_revisions" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_record_source_status_occurred_idx" ON "worklog_records" USING btree ("source_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "worklog_record_source_entity_status_idx" ON "worklog_records" USING btree ("source_id","entity_id","status");--> statement-breakpoint
CREATE INDEX "worklog_record_author_type_idx" ON "worklog_records" USING btree ("author_user_id","input_type");--> statement-breakpoint
CREATE INDEX "worklog_record_quoted_line_idx" ON "worklog_records" USING btree ("quoted_line_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_usage_reservation_uq" ON "worklog_ai_usage_events" USING btree ("reservation_token");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_actor_time_idx" ON "worklog_ai_usage_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_charged_time_idx" ON "worklog_ai_usage_events" USING btree ("charged_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_source_actor_time_idx" ON "worklog_ai_usage_events" USING btree ("source_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_workspace_time_idx" ON "worklog_ai_usage_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_operation_time_idx" ON "worklog_ai_usage_events" USING btree ("operation","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_record_idx" ON "worklog_ai_usage_events" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_grant_scope_uq" ON "worklog_ai_grant_scopes" USING btree ("grant_id","source_id");--> statement-breakpoint
CREATE INDEX "worklog_ai_grant_scope_source_enabled_idx" ON "worklog_ai_grant_scopes" USING btree ("source_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_grant_origin_uq" ON "worklog_ai_grants" USING btree ("owner_user_id","origin_key");--> statement-breakpoint
CREATE INDEX "worklog_ai_grant_owner_status_time_idx" ON "worklog_ai_grants" USING btree ("owner_user_id","status","effective_at","expires_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_grant_type_status_idx" ON "worklog_ai_grants" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_point_reservation_funding_uq" ON "worklog_ai_point_reservation_funding" USING btree ("reservation_id","grant_id","grant_scope_id");--> statement-breakpoint
CREATE INDEX "worklog_ai_point_reservation_funding_grant_idx" ON "worklog_ai_point_reservation_funding" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_point_reservation_user_status_idx" ON "worklog_ai_point_reservations" USING btree ("charged_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "worklog_ai_point_reservation_source_idx" ON "worklog_ai_point_reservations" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_usage_funding_uq" ON "worklog_ai_usage_funding" USING btree ("usage_event_id","grant_id","grant_scope_id");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_funding_grant_idx" ON "worklog_ai_usage_funding" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_source_ai_responsibility_user_idx" ON "worklog_source_ai_responsibility" USING btree ("responsible_user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_ai_responsibility_history_source_idx" ON "worklog_source_ai_responsibility_history" USING btree ("source_id","created_at");--> statement-breakpoint
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
CREATE UNIQUE INDEX "worklog_line_record_reply_target_message_uq" ON "worklog_line_record_reply_targets" USING btree ("bot_line_message_id");--> statement-breakpoint
CREATE INDEX "worklog_line_record_reply_target_record_idx" ON "worklog_line_record_reply_targets" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_line_ai_edit_command_uq" ON "worklog_line_ai_edits" USING btree ("line_command_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_line_ai_edit_claim_uq" ON "worklog_line_ai_edits" USING btree ("claim_token");--> statement-breakpoint
CREATE INDEX "worklog_line_ai_edit_record_idx" ON "worklog_line_ai_edits" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_line_ai_edit_status_idx" ON "worklog_line_ai_edits" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "worklog_line_ai_edit_reservation_idx" ON "worklog_line_ai_edits" USING btree ("reservation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_attachment_ingestion_command_uq" ON "worklog_attachment_ingestions" USING btree ("command_line_message_id");--> statement-breakpoint
CREATE INDEX "worklog_attachment_ingestion_source_status_idx" ON "worklog_attachment_ingestions" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "worklog_attachment_ingestion_quoted_idx" ON "worklog_attachment_ingestions" USING btree ("quoted_line_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_checkout_intent_request_uq" ON "worklog_checkout_intents" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_user_time_idx" ON "worklog_checkout_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_status_time_idx" ON "worklog_checkout_intents" USING btree ("status","created_at");