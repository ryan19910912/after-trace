CREATE TYPE "public"."worklog_feedback_channel" AS ENUM('PWA');--> statement-breakpoint
CREATE TYPE "public"."worklog_plan_type" AS ENUM('FREE', 'SUBSCRIPTION');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_input_type" AS ENUM('TEXT', 'AUDIO', 'IMAGE', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_member_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."worklog_source_type" AS ENUM('PRIVATE', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_source" AS ENUM('FREE', 'PAYMENT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."worklog_subscription_status" AS ENUM('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_ai_enrichment_status" AS ENUM('NONE', 'ENRICHED');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_revision_channel" AS ENUM('PWA_MANUAL', 'PWA_DELETE', 'PWA_RESTORE', 'AI_REWRITE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."worklog_record_status" AS ENUM('ACTIVE', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."worklog_auth_provider" AS ENUM('GOOGLE', 'LINE', 'APPLE');--> statement-breakpoint
CREATE TYPE "public"."worklog_notification_audience" AS ENUM('ALL_USERS', 'FREE_USERS', 'AI_SUBSCRIBERS', 'SPECIFIC_USERS');--> statement-breakpoint
CREATE TYPE "public"."worklog_notification_delivery_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."worklog_notification_status" AS ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."worklog_notification_type" AS ENUM('ANNOUNCEMENT', 'SYSTEM', 'TASK');--> statement-breakpoint
CREATE TYPE "public"."worklog_task_status" AS ENUM('OPEN', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_grant_status" AS ENUM('ACTIVE', 'EXHAUSTED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."worklog_ai_grant_type" AS ENUM('FREE_INITIAL', 'SUBSCRIPTION_PERIOD', 'ADMIN');--> statement-breakpoint
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
	"channel" "worklog_feedback_channel" DEFAULT 'PWA' NOT NULL,
	"text" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" "worklog_source_member_role" DEFAULT 'MEMBER' NOT NULL,
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
	"name" varchar(255),
	"created_by_user_id" bigint,
	"inactive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_source_private_user_id_uq" UNIQUE("private_user_id","id"),
	CONSTRAINT "worklog_source_identity_shape_ck" CHECK ((
        ("worklog_sources"."type" = 'PRIVATE' AND "worklog_sources"."private_user_id" IS NOT NULL AND "worklog_sources"."name" IS NULL)
        OR
        ("worklog_sources"."type" = 'GROUP' AND "worklog_sources"."private_user_id" IS NULL AND "worklog_sources"."name" IS NOT NULL AND length(btrim("worklog_sources"."name")) > 0)
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
	"plan_type" "worklog_plan_type" NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"price_twd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"grant_points" integer DEFAULT 0 NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"monthly_ai_point_cap" integer,
	"monthly_provider_cost_cap_twd" numeric(12, 2),
	"per_request_ai_point_cap" integer,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_subscription_plan_code_uq" UNIQUE("code"),
	CONSTRAINT "worklog_plan_v1_identity_ck" CHECK ((
        ("worklog_subscription_plans"."code" = 'FREE' AND "worklog_subscription_plans"."plan_type" = 'FREE' AND "worklog_subscription_plans"."price_twd" = 0 AND "worklog_subscription_plans"."ai_enabled" = FALSE)
        OR
        ("worklog_subscription_plans"."code" = 'AI_PRO' AND "worklog_subscription_plans"."plan_type" = 'SUBSCRIPTION' AND "worklog_subscription_plans"."price_twd" = 99 AND "worklog_subscription_plans"."ai_enabled" = TRUE)
      )),
	CONSTRAINT "worklog_plan_grant_points_ck" CHECK ("worklog_subscription_plans"."grant_points" >= 0),
	CONSTRAINT "worklog_plan_ai_cap_values_ck" CHECK ((
        ("worklog_subscription_plans"."monthly_ai_point_cap" IS NULL OR "worklog_subscription_plans"."monthly_ai_point_cap" > 0)
        AND ("worklog_subscription_plans"."monthly_provider_cost_cap_twd" IS NULL OR "worklog_subscription_plans"."monthly_provider_cost_cap_twd" > 0)
        AND ("worklog_subscription_plans"."per_request_ai_point_cap" IS NULL OR "worklog_subscription_plans"."per_request_ai_point_cap" > 0)
      )),
	CONSTRAINT "worklog_plan_ai_enabled_shape_ck" CHECK ((
        "worklog_subscription_plans"."ai_enabled" = FALSE
        OR (
          "worklog_subscription_plans"."plan_type" = 'SUBSCRIPTION'
          AND "worklog_subscription_plans"."price_twd" = 99
          AND "worklog_subscription_plans"."monthly_ai_point_cap" IS NOT NULL
          AND "worklog_subscription_plans"."monthly_provider_cost_cap_twd" IS NOT NULL
        )
      ))
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
	"display_name" varchar(255),
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
CREATE TABLE "worklog_record_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"record_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"editor_user_id" bigint,
	"channel" "worklog_record_revision_channel" NOT NULL,
	"previous_raw_text" text NOT NULL,
	"new_raw_text" text NOT NULL,
	"previous_occurred_at" timestamp with time zone,
	"new_occurred_at" timestamp with time zone,
	"previous_status" "worklog_record_status" NOT NULL,
	"new_status" "worklog_record_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"author_user_id" bigint,
	"input_type" "worklog_record_input_type" NOT NULL,
	"raw_text" text NOT NULL,
	"title" varchar(255),
	"search_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_metadata" jsonb,
	"capture_context" jsonb,
	"ai_enrichment_status" "worklog_record_ai_enrichment_status" DEFAULT 'NONE' NOT NULL,
	"ai_enriched_at" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"status" "worklog_record_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_record_source_id_uq" UNIQUE("source_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_auth_identities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" "worklog_auth_provider" NOT NULL,
	"subject" varchar(255) NOT NULL,
	"email_snapshot" varchar(320),
	"display_name_snapshot" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_invites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_source_invite_use_count_ck" CHECK ("worklog_source_invites"."use_count" >= 0),
	CONSTRAINT "worklog_source_invite_max_uses_ck" CHECK ("worklog_source_invites"."max_uses" IS NULL OR ("worklog_source_invites"."max_uses" > 0 AND "worklog_source_invites"."use_count" <= "worklog_source_invites"."max_uses"))
);
--> statement-breakpoint
CREATE TABLE "worklog_user_public_accounts" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"public_account_id" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_notification_preferences" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"announcement_push_enabled" boolean DEFAULT true NOT NULL,
	"system_push_enabled" boolean DEFAULT true NOT NULL,
	"task_push_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_notification_recipients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"read_at" timestamp with time zone,
	"push_status" "worklog_notification_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"push_attempt_count" integer DEFAULT 0 NOT NULL,
	"push_attempted_at" timestamp with time zone,
	"push_next_attempt_at" timestamp with time zone,
	"push_sent_at" timestamp with time zone,
	"push_failure_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_notification_recipient_push_attempt_count_ck" CHECK ("worklog_notification_recipients"."push_attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "worklog_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "worklog_notification_type" NOT NULL,
	"status" "worklog_notification_status" DEFAULT 'DRAFT' NOT NULL,
	"audience" "worklog_notification_audience" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"system_event_key" varchar(255),
	"reference_type" varchar(64),
	"reference_id" bigint,
	"deep_link" text,
	"metadata" jsonb,
	"created_by_actor" varchar(128),
	"scheduled_at" timestamp with time zone,
	"dispatch_started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_notification_channel_ck" CHECK ("worklog_notifications"."in_app_enabled" = TRUE OR "worklog_notifications"."push_enabled" = TRUE),
	CONSTRAINT "worklog_notification_schedule_ck" CHECK ("worklog_notifications"."status" <> 'SCHEDULED' OR "worklog_notifications"."scheduled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "worklog_push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"platform" varchar(64),
	"revoked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"source_id" bigint,
	"record_id" bigint,
	"title" varchar(255) NOT NULL,
	"body" text,
	"status" "worklog_task_status" DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"reminder_notified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_task_title_nonblank_ck" CHECK (length(btrim("worklog_tasks"."title")) > 0),
	CONSTRAINT "worklog_task_completed_state_ck" CHECK ("worklog_tasks"."status" <> 'COMPLETED' OR "worklog_tasks"."completed_at" IS NOT NULL),
	CONSTRAINT "worklog_task_cancelled_state_ck" CHECK ("worklog_tasks"."status" <> 'CANCELLED' OR "worklog_tasks"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "worklog_commercial_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"free_initial_ai_trial_points" integer NOT NULL,
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_commercial_config_singleton_ck" CHECK ("worklog_commercial_config"."id" = 1),
	CONSTRAINT "worklog_commercial_config_free_trial_points_ck" CHECK ("worklog_commercial_config"."free_initial_ai_trial_points" > 0)
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
	"provider_cost_committed_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"provider_cost_reserved_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
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
	"entitlement_grant_id" bigint,
	"points_reserved" integer NOT NULL,
	"points_committed" integer DEFAULT 0 NOT NULL,
	"platform_subsidized_points" integer DEFAULT 0 NOT NULL,
	"provider_cost_hold_twd" numeric(18, 8),
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
CREATE TABLE "worklog_subscription_lifecycle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"external_event_key" varchar(255) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"user_id" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"processing_result" varchar(32) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_subscription_lifecycle_event_type_ck" CHECK ("worklog_subscription_lifecycle_events"."event_type" IN ('ACTIVATE','RENEW','CANCEL')),
	CONSTRAINT "worklog_subscription_lifecycle_plan_code_ck" CHECK ("worklog_subscription_lifecycle_events"."plan_code" = 'AI_PRO'),
	CONSTRAINT "worklog_subscription_lifecycle_processing_result_ck" CHECK ("worklog_subscription_lifecycle_events"."processing_result" IN ('PENDING','APPLIED','IGNORED_STALE'))
);
--> statement-breakpoint
CREATE TABLE "worklog_feedback_management" (
	"feedback_id" bigint PRIMARY KEY NOT NULL,
	"category" varchar(32) DEFAULT 'OTHER' NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_feedback_management_category_ck" CHECK ("worklog_feedback_management"."category" IN ('BUG','FEATURE','UX','OTHER')),
	CONSTRAINT "worklog_feedback_management_status_ck" CHECK ("worklog_feedback_management"."status" IN ('OPEN','IN_PROGRESS','RESOLVED','IGNORED'))
);
--> statement-breakpoint
CREATE TABLE "worklog_newebpay_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"checkout_intent_id" bigint,
	"merchant_order_no" varchar(30) NOT NULL,
	"period_no" varchar(32),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"last_provider_event_key" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_newebpay_subscription_status_ck" CHECK ("worklog_newebpay_subscriptions"."status" IN ('PENDING','ACTIVE','TERMINATED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "worklog_audit_logs" ADD CONSTRAINT "worklog_audit_logs_workspace_id_worklog_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."worklog_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_audit_logs" ADD CONSTRAINT "worklog_audit_logs_actor_user_id_worklog_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_feedback" ADD CONSTRAINT "worklog_feedback_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_members" ADD CONSTRAINT "worklog_source_members_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_members" ADD CONSTRAINT "worklog_source_members_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_sources" ADD CONSTRAINT "worklog_sources_workspace_id_worklog_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."worklog_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_sources" ADD CONSTRAINT "worklog_sources_private_user_id_worklog_users_id_fk" FOREIGN KEY ("private_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_sources" ADD CONSTRAINT "worklog_sources_created_by_user_id_worklog_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_previous_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("previous_plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_history" ADD CONSTRAINT "worklog_subscription_history_next_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("next_plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions" ADD CONSTRAINT "worklog_user_subscriptions_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions" ADD CONSTRAINT "worklog_user_subscriptions_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_workspaces" ADD CONSTRAINT "worklog_workspaces_owner_user_id_worklog_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_record_revisions" ADD CONSTRAINT "worklog_record_revisions_editor_user_id_worklog_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_author_user_id_worklog_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_records" ADD CONSTRAINT "worklog_records_deleted_by_user_id_worklog_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_auth_identities" ADD CONSTRAINT "worklog_auth_identities_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_invites" ADD CONSTRAINT "worklog_source_invites_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_source_invites" ADD CONSTRAINT "worklog_source_invites_created_by_user_id_worklog_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_user_public_accounts" ADD CONSTRAINT "worklog_user_public_accounts_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_notification_preferences" ADD CONSTRAINT "worklog_notification_preferences_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_notification_recipients" ADD CONSTRAINT "worklog_notification_recipients_notification_id_worklog_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."worklog_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_notification_recipients" ADD CONSTRAINT "worklog_notification_recipients_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_push_subscriptions" ADD CONSTRAINT "worklog_push_subscriptions_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_tasks" ADD CONSTRAINT "worklog_tasks_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_tasks" ADD CONSTRAINT "worklog_tasks_source_id_worklog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."worklog_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_tasks" ADD CONSTRAINT "worklog_tasks_record_id_worklog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."worklog_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "worklog_ai_point_reservations" ADD CONSTRAINT "worklog_ai_point_reservations_entitlement_grant_id_worklog_ai_grants_id_fk" FOREIGN KEY ("entitlement_grant_id") REFERENCES "public"."worklog_ai_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_usage_event_id_worklog_ai_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."worklog_ai_usage_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_grant_id_worklog_ai_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."worklog_ai_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_ai_usage_funding" ADD CONSTRAINT "worklog_ai_usage_funding_grant_scope_fk" FOREIGN KEY ("grant_id","grant_scope_id") REFERENCES "public"."worklog_ai_grant_scopes"("grant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_checkout_intents" ADD CONSTRAINT "worklog_checkout_intents_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_checkout_intents" ADD CONSTRAINT "worklog_checkout_intents_plan_code_worklog_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."worklog_subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_subscription_lifecycle_events" ADD CONSTRAINT "worklog_subscription_lifecycle_events_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_feedback_management" ADD CONSTRAINT "worklog_feedback_management_feedback_id_worklog_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."worklog_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_newebpay_subscriptions" ADD CONSTRAINT "worklog_newebpay_subscriptions_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_newebpay_subscriptions" ADD CONSTRAINT "worklog_newebpay_subscriptions_checkout_intent_id_worklog_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."worklog_checkout_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worklog_audit_workspace_time_idx" ON "worklog_audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_audit_target_idx" ON "worklog_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "worklog_feedback_created_idx" ON "worklog_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_member_uq" ON "worklog_source_members" USING btree ("source_id","user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_member_user_active_idx" ON "worklog_source_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "worklog_source_member_source_role_idx" ON "worklog_source_members" USING btree ("source_id","role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_private_user_uq" ON "worklog_sources" USING btree ("private_user_id");--> statement-breakpoint
CREATE INDEX "worklog_source_workspace_type_idx" ON "worklog_sources" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "worklog_source_creator_idx" ON "worklog_sources" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "worklog_subscription_history_user_time_idx" ON "worklog_subscription_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_user_subscription_user_uq" ON "worklog_user_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worklog_user_subscription_plan_status_idx" ON "worklog_user_subscriptions" USING btree ("plan_code","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_workspace_owner_uq" ON "worklog_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_record_revision_record_version_uq" ON "worklog_record_revisions" USING btree ("record_id","version");--> statement-breakpoint
CREATE INDEX "worklog_record_revision_record_time_idx" ON "worklog_record_revisions" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_record_source_status_occurred_idx" ON "worklog_records" USING btree ("source_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "worklog_record_author_type_idx" ON "worklog_records" USING btree ("author_user_id","input_type");--> statement-breakpoint
CREATE INDEX "worklog_record_ai_enrichment_idx" ON "worklog_records" USING btree ("ai_enrichment_status","ai_enriched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_auth_identity_provider_subject_uq" ON "worklog_auth_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "worklog_auth_identity_user_idx" ON "worklog_auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_source_invite_token_hash_uq" ON "worklog_source_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "worklog_source_invite_source_active_idx" ON "worklog_source_invites" USING btree ("source_id","revoked_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_user_public_account_id_uq" ON "worklog_user_public_accounts" USING btree ("public_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_notification_recipient_uq" ON "worklog_notification_recipients" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "worklog_notification_recipient_user_read_idx" ON "worklog_notification_recipients" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "worklog_notification_recipient_push_idx" ON "worklog_notification_recipients" USING btree ("push_status","push_next_attempt_at","push_attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_notification_system_event_key_uq" ON "worklog_notifications" USING btree ("system_event_key");--> statement-breakpoint
CREATE INDEX "worklog_notification_status_schedule_idx" ON "worklog_notifications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "worklog_notification_type_created_idx" ON "worklog_notifications" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_push_subscription_endpoint_uq" ON "worklog_push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "worklog_push_subscription_user_active_idx" ON "worklog_push_subscriptions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "worklog_task_user_status_idx" ON "worklog_tasks" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "worklog_task_due_reminder_idx" ON "worklog_tasks" USING btree ("status","remind_at","reminder_notified_at");--> statement-breakpoint
CREATE INDEX "worklog_task_source_idx" ON "worklog_tasks" USING btree ("source_id","status");--> statement-breakpoint
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
CREATE INDEX "worklog_ai_point_reservation_entitlement_grant_idx" ON "worklog_ai_point_reservations" USING btree ("entitlement_grant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_ai_usage_funding_uq" ON "worklog_ai_usage_funding" USING btree ("usage_event_id","grant_id","grant_scope_id");--> statement-breakpoint
CREATE INDEX "worklog_ai_usage_funding_grant_idx" ON "worklog_ai_usage_funding" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_checkout_intent_request_uq" ON "worklog_checkout_intents" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_user_time_idx" ON "worklog_checkout_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "worklog_checkout_intent_status_time_idx" ON "worklog_checkout_intents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_subscription_lifecycle_provider_event_uq" ON "worklog_subscription_lifecycle_events" USING btree ("provider","external_event_key");--> statement-breakpoint
CREATE INDEX "worklog_subscription_lifecycle_user_time_idx" ON "worklog_subscription_lifecycle_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "worklog_subscription_lifecycle_type_time_idx" ON "worklog_subscription_lifecycle_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "worklog_feedback_management_status_time_idx" ON "worklog_feedback_management" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_user_uq" ON "worklog_newebpay_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_order_uq" ON "worklog_newebpay_subscriptions" USING btree ("merchant_order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_period_uq" ON "worklog_newebpay_subscriptions" USING btree ("period_no");--> statement-breakpoint
CREATE INDEX "worklog_newebpay_subscription_status_time_idx" ON "worklog_newebpay_subscriptions" USING btree ("status","updated_at");