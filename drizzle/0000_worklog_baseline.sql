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
	"channel" varchar(32) DEFAULT 'PWA' NOT NULL,
	"text" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_source_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" varchar(32) DEFAULT 'MEMBER' NOT NULL,
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
	"type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"private_user_id" bigint,
	"name" varchar(255),
	"created_by_user_id" bigint,
	"inactive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_source_private_user_id_uq" UNIQUE("private_user_id","id")
);
--> statement-breakpoint
CREATE TABLE "worklog_subscription_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"previous_plan_code" varchar(64),
	"next_plan_code" varchar(64) NOT NULL,
	"source" varchar(32) NOT NULL,
	"actor" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_subscription_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"plan_type" varchar(32) NOT NULL,
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
	CONSTRAINT "worklog_subscription_plan_code_uq" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "worklog_user_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"source" varchar(32) DEFAULT 'FREE' NOT NULL,
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
	"channel" varchar(32) NOT NULL,
	"previous_title" varchar(255),
	"new_title" varchar(255),
	"previous_raw_text" text NOT NULL,
	"new_raw_text" text NOT NULL,
	"previous_occurred_at" timestamp with time zone,
	"new_occurred_at" timestamp with time zone,
	"previous_status" varchar(32) NOT NULL,
	"new_status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"author_user_id" bigint,
	"input_type" varchar(32) NOT NULL,
	"raw_text" text NOT NULL,
	"title" varchar(255),
	"search_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_metadata" jsonb,
	"capture_context" jsonb,
	"ai_enrichment_status" varchar(32) DEFAULT 'NONE' NOT NULL,
	"ai_enriched_at" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
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
	"provider" varchar(32) NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"push_status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"push_attempt_count" integer DEFAULT 0 NOT NULL,
	"push_attempted_at" timestamp with time zone,
	"push_next_attempt_at" timestamp with time zone,
	"push_sent_at" timestamp with time zone,
	"push_failure_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"audience" varchar(32) NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"reminder_notified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_commercial_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"free_initial_ai_trial_points" integer NOT NULL,
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
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
	"status" varchar(32) DEFAULT 'RESERVED' NOT NULL,
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
	"payer_email" varchar(320),
	"request_key" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING_PROVIDER' NOT NULL,
	"provider" varchar(64),
	"provider_checkout_id" varchar(255),
	"checkout_url" varchar(2048),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_feedback_management" (
	"feedback_id" bigint PRIMARY KEY NOT NULL,
	"category" varchar(32) DEFAULT 'OTHER' NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_newebpay_subscription_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"checkout_intent_id" bigint,
	"merchant_order_no" varchar(30) NOT NULL,
	"period_no" varchar(32),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"provider_status" varchar(64),
	"respond_code" varchar(64),
	"auth_amount" integer,
	"total_times" integer,
	"already_times" integer,
	"trade_no" varchar(64),
	"auth_date" timestamp with time zone,
	"next_auth_date" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"last_provider_event_key" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "worklog_newebpay_subscription_history" ADD CONSTRAINT "worklog_newebpay_subscription_history_user_id_worklog_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_newebpay_subscription_history" ADD CONSTRAINT "worklog_newebpay_subscription_history_checkout_intent_id_worklog_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."worklog_checkout_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "worklog_newebpay_history_order_uq" ON "worklog_newebpay_subscription_history" USING btree ("merchant_order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_history_period_uq" ON "worklog_newebpay_subscription_history" USING btree ("period_no");--> statement-breakpoint
CREATE INDEX "worklog_newebpay_history_user_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "worklog_newebpay_history_status_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_user_uq" ON "worklog_newebpay_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_order_uq" ON "worklog_newebpay_subscriptions" USING btree ("merchant_order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_newebpay_subscription_period_uq" ON "worklog_newebpay_subscriptions" USING btree ("period_no");--> statement-breakpoint
CREATE INDEX "worklog_newebpay_subscription_status_time_idx" ON "worklog_newebpay_subscriptions" USING btree ("status","updated_at");

--> statement-breakpoint
COMMENT ON TABLE "worklog_ai_runtime_config" IS 'AI 執行環境設定，保存目前使用的模型、單價與匯率。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."id" IS '設定流水號；目前以 1 作為主要設定。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."provider" IS 'AI 服務供應商代碼。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."model" IS '目前使用的 AI 模型名稱。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."input_usd_per_million" IS '每百萬輸入 Token 的美元成本。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."output_usd_per_million" IS '每百萬輸出 Token 的美元成本。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."audio_usd_per_million" IS '音訊輸入每百萬單位的美元成本。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."image_usd_per_million" IS '圖片輸入每百萬單位的美元成本。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."usd_twd_rate" IS '美元兌新台幣計價匯率。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."updated_by" IS '最後更新設定的管理者識別。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_ai_runtime_config"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_audit_logs" IS '系統稽核紀錄，保存管理或系統操作前後的資料變化。';
COMMENT ON COLUMN "worklog_audit_logs"."id" IS '稽核紀錄流水號。';
COMMENT ON COLUMN "worklog_audit_logs"."workspace_id" IS '相關工作區 ID。';
COMMENT ON COLUMN "worklog_audit_logs"."actor_user_id" IS '執行操作的使用者 ID。';
COMMENT ON COLUMN "worklog_audit_logs"."actor_admin" IS '執行操作的管理者識別。';
COMMENT ON COLUMN "worklog_audit_logs"."action" IS '操作動作代碼。';
COMMENT ON COLUMN "worklog_audit_logs"."target_type" IS '被操作的資源類型。';
COMMENT ON COLUMN "worklog_audit_logs"."target_id" IS '被操作資源的識別值。';
COMMENT ON COLUMN "worklog_audit_logs"."before_value" IS '操作前資料快照。';
COMMENT ON COLUMN "worklog_audit_logs"."after_value" IS '操作後資料快照。';
COMMENT ON COLUMN "worklog_audit_logs"."created_at" IS '稽核紀錄建立時間。';
COMMENT ON TABLE "worklog_feedback" IS '使用者提交的產品意見回饋。';
COMMENT ON COLUMN "worklog_feedback"."id" IS '回饋流水號。';
COMMENT ON COLUMN "worklog_feedback"."user_id" IS '提交回饋的使用者 ID。';
COMMENT ON COLUMN "worklog_feedback"."display_name_snapshot" IS '提交當下的使用者顯示名稱快照。';
COMMENT ON COLUMN "worklog_feedback"."channel" IS '回饋來源管道。';
COMMENT ON COLUMN "worklog_feedback"."text" IS '回饋內容。';
COMMENT ON COLUMN "worklog_feedback"."context" IS '提交回饋時的附加情境資訊。';
COMMENT ON COLUMN "worklog_feedback"."created_at" IS '回饋建立時間。';
COMMENT ON TABLE "worklog_source_members" IS '來源成員關聯，保存使用者在 PRIVATE 或 GROUP Source 中的成員資訊。';
COMMENT ON COLUMN "worklog_source_members"."id" IS '來源成員流水號。';
COMMENT ON COLUMN "worklog_source_members"."source_id" IS '所屬 Source ID。';
COMMENT ON COLUMN "worklog_source_members"."user_id" IS '成員使用者 ID。';
COMMENT ON COLUMN "worklog_source_members"."role" IS '成員角色。';
COMMENT ON COLUMN "worklog_source_members"."is_active" IS '是否仍為有效成員。';
COMMENT ON COLUMN "worklog_source_members"."first_seen_at" IS '首次出現在此 Source 的時間。';
COMMENT ON COLUMN "worklog_source_members"."last_seen_at" IS '最近一次出現在此 Source 的時間。';
COMMENT ON COLUMN "worklog_source_members"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_source_members"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_sources" IS 'AFTERTRACE 記錄來源，可代表個人 PRIVATE Source 或多人 GROUP Source。';
COMMENT ON COLUMN "worklog_sources"."id" IS 'Source 流水號。';
COMMENT ON COLUMN "worklog_sources"."workspace_id" IS '所屬工作區 ID。';
COMMENT ON COLUMN "worklog_sources"."type" IS 'Source 類型，例如 PRIVATE 或 GROUP。';
COMMENT ON COLUMN "worklog_sources"."status" IS 'Source 目前狀態。';
COMMENT ON COLUMN "worklog_sources"."private_user_id" IS 'PRIVATE Source 對應的使用者 ID。';
COMMENT ON COLUMN "worklog_sources"."name" IS 'GROUP Source 顯示名稱。';
COMMENT ON COLUMN "worklog_sources"."created_by_user_id" IS '建立此 Source 的使用者 ID。';
COMMENT ON COLUMN "worklog_sources"."inactive_at" IS 'Source 停用時間。';
COMMENT ON COLUMN "worklog_sources"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_sources"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_subscription_history" IS '使用者方案異動歷史，保存方案切換前後狀態。';
COMMENT ON COLUMN "worklog_subscription_history"."id" IS '方案異動流水號。';
COMMENT ON COLUMN "worklog_subscription_history"."user_id" IS '使用者 ID。';
COMMENT ON COLUMN "worklog_subscription_history"."previous_plan_code" IS '異動前方案代碼。';
COMMENT ON COLUMN "worklog_subscription_history"."next_plan_code" IS '異動後方案代碼。';
COMMENT ON COLUMN "worklog_subscription_history"."source" IS '方案異動來源。';
COMMENT ON COLUMN "worklog_subscription_history"."actor" IS '觸發方案異動的操作來源或管理者識別。';
COMMENT ON COLUMN "worklog_subscription_history"."metadata" IS '方案異動附加資訊。';
COMMENT ON COLUMN "worklog_subscription_history"."created_at" IS '方案異動時間。';
COMMENT ON TABLE "worklog_subscription_plans" IS 'AFTERTRACE 可用方案定義與 AI 額度、成本上限設定。';
COMMENT ON COLUMN "worklog_subscription_plans"."id" IS '方案流水號。';
COMMENT ON COLUMN "worklog_subscription_plans"."code" IS '方案唯一代碼。';
COMMENT ON COLUMN "worklog_subscription_plans"."plan_type" IS '方案類型。';
COMMENT ON COLUMN "worklog_subscription_plans"."display_name" IS '方案顯示名稱。';
COMMENT ON COLUMN "worklog_subscription_plans"."price_twd" IS '方案價格，單位新台幣元。';
COMMENT ON COLUMN "worklog_subscription_plans"."rank" IS '方案排序或層級值。';
COMMENT ON COLUMN "worklog_subscription_plans"."enabled" IS '方案是否可供系統使用。';
COMMENT ON COLUMN "worklog_subscription_plans"."grant_points" IS '方案預設授予點數。';
COMMENT ON COLUMN "worklog_subscription_plans"."ai_enabled" IS '方案是否啟用 AI 功能。';
COMMENT ON COLUMN "worklog_subscription_plans"."monthly_ai_point_cap" IS '每月 AI 點數上限。';
COMMENT ON COLUMN "worklog_subscription_plans"."monthly_provider_cost_cap_twd" IS '每月 AI Provider 成本上限，單位新台幣。';
COMMENT ON COLUMN "worklog_subscription_plans"."per_request_ai_point_cap" IS '單次 AI 請求可使用的點數上限。';
COMMENT ON COLUMN "worklog_subscription_plans"."capabilities" IS '方案功能能力設定。';
COMMENT ON COLUMN "worklog_subscription_plans"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_subscription_plans"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_user_subscriptions" IS '使用者目前有效方案狀態，每位使用者保存目前方案與服務週期。';
COMMENT ON COLUMN "worklog_user_subscriptions"."id" IS '使用者方案流水號。';
COMMENT ON COLUMN "worklog_user_subscriptions"."user_id" IS '使用者 ID。';
COMMENT ON COLUMN "worklog_user_subscriptions"."plan_code" IS '目前方案代碼。';
COMMENT ON COLUMN "worklog_user_subscriptions"."status" IS '目前訂閱狀態。';
COMMENT ON COLUMN "worklog_user_subscriptions"."source" IS '目前方案來源。';
COMMENT ON COLUMN "worklog_user_subscriptions"."effective_at" IS '目前方案開始生效時間。';
COMMENT ON COLUMN "worklog_user_subscriptions"."current_period_start" IS '目前服務週期開始時間。';
COMMENT ON COLUMN "worklog_user_subscriptions"."current_period_end" IS '目前服務週期結束時間。';
COMMENT ON COLUMN "worklog_user_subscriptions"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_user_subscriptions"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_users" IS 'AFTERTRACE 使用者主資料。';
COMMENT ON COLUMN "worklog_users"."id" IS '使用者內部流水號。';
COMMENT ON COLUMN "worklog_users"."display_name" IS '使用者顯示名稱。';
COMMENT ON COLUMN "worklog_users"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_users"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_workspaces" IS 'AFTERTRACE 工作區主資料。';
COMMENT ON COLUMN "worklog_workspaces"."id" IS '工作區流水號。';
COMMENT ON COLUMN "worklog_workspaces"."owner_user_id" IS '工作區擁有者使用者 ID。';
COMMENT ON COLUMN "worklog_workspaces"."name" IS '工作區名稱。';
COMMENT ON COLUMN "worklog_workspaces"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_workspaces"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_record_revisions" IS 'Record 不可變更的版本歷史，保存每次內容與狀態修改前後值。';
COMMENT ON COLUMN "worklog_record_revisions"."id" IS '版本歷史流水號。';
COMMENT ON COLUMN "worklog_record_revisions"."record_id" IS '對應 Record ID。';
COMMENT ON COLUMN "worklog_record_revisions"."version" IS 'Record 版本號。';
COMMENT ON COLUMN "worklog_record_revisions"."editor_user_id" IS '執行修改的使用者 ID。';
COMMENT ON COLUMN "worklog_record_revisions"."channel" IS '此次修改的來源管道。';
COMMENT ON COLUMN "worklog_record_revisions"."previous_title" IS '修改前的紀錄標題。';
COMMENT ON COLUMN "worklog_record_revisions"."new_title" IS '修改後的紀錄標題。';
COMMENT ON COLUMN "worklog_record_revisions"."previous_raw_text" IS '修改前原始文字。';
COMMENT ON COLUMN "worklog_record_revisions"."new_raw_text" IS '修改後原始文字。';
COMMENT ON COLUMN "worklog_record_revisions"."previous_occurred_at" IS '修改前事件發生時間。';
COMMENT ON COLUMN "worklog_record_revisions"."new_occurred_at" IS '修改後事件發生時間。';
COMMENT ON COLUMN "worklog_record_revisions"."previous_status" IS '修改前 Record 狀態。';
COMMENT ON COLUMN "worklog_record_revisions"."new_status" IS '修改後 Record 狀態。';
COMMENT ON COLUMN "worklog_record_revisions"."created_at" IS '版本歷史建立時間。';
COMMENT ON TABLE "worklog_records" IS 'AFTERTRACE 核心記錄資料，保存文字、附件輸入後的標題、搜尋與 AI 擴充資訊。';
COMMENT ON COLUMN "worklog_records"."id" IS 'Record 流水號。';
COMMENT ON COLUMN "worklog_records"."source_id" IS 'Record 所屬 Source ID。';
COMMENT ON COLUMN "worklog_records"."author_user_id" IS '建立 Record 的使用者 ID。';
COMMENT ON COLUMN "worklog_records"."input_type" IS '原始輸入類型。';
COMMENT ON COLUMN "worklog_records"."raw_text" IS 'Record 原始文字內容。';
COMMENT ON COLUMN "worklog_records"."title" IS 'Record 標題。';
COMMENT ON COLUMN "worklog_records"."search_terms" IS '供搜尋使用的關鍵字集合。';
COMMENT ON COLUMN "worklog_records"."extracted_metadata" IS '從內容擷取出的結構化資訊。';
COMMENT ON COLUMN "worklog_records"."capture_context" IS '建立 Record 時的擷取情境資訊。';
COMMENT ON COLUMN "worklog_records"."ai_enrichment_status" IS 'AI 擴充處理狀態。';
COMMENT ON COLUMN "worklog_records"."ai_enriched_at" IS 'AI 擴充完成時間。';
COMMENT ON COLUMN "worklog_records"."occurred_at" IS '此筆內容實際描述的事件發生時間。';
COMMENT ON COLUMN "worklog_records"."status" IS 'Record 目前狀態。';
COMMENT ON COLUMN "worklog_records"."version" IS 'Record 目前版本號。';
COMMENT ON COLUMN "worklog_records"."deleted_at" IS 'Record 刪除時間。';
COMMENT ON COLUMN "worklog_records"."deleted_by_user_id" IS '執行刪除的使用者 ID。';
COMMENT ON COLUMN "worklog_records"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_records"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_auth_identities" IS '第三方登入身分綁定，將 Google、LINE、Apple 等 Provider 身分對應到 AFTERTRACE 使用者。';
COMMENT ON COLUMN "worklog_auth_identities"."id" IS '登入身分流水號。';
COMMENT ON COLUMN "worklog_auth_identities"."user_id" IS '對應 AFTERTRACE 使用者 ID。';
COMMENT ON COLUMN "worklog_auth_identities"."provider" IS '第三方登入 Provider。';
COMMENT ON COLUMN "worklog_auth_identities"."subject" IS 'Provider 回傳的使用者唯一 Subject。';
COMMENT ON COLUMN "worklog_auth_identities"."email_snapshot" IS '登入 Provider 當下的 Email 快照。';
COMMENT ON COLUMN "worklog_auth_identities"."display_name_snapshot" IS '登入 Provider 當下的顯示名稱快照。';
COMMENT ON COLUMN "worklog_auth_identities"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_auth_identities"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_source_invites" IS 'GROUP Source 邀請連結／Token 資料。';
COMMENT ON COLUMN "worklog_source_invites"."id" IS '邀請流水號。';
COMMENT ON COLUMN "worklog_source_invites"."source_id" IS '要加入的 Source ID。';
COMMENT ON COLUMN "worklog_source_invites"."token_hash" IS '邀請 Token 的雜湊值。';
COMMENT ON COLUMN "worklog_source_invites"."created_by_user_id" IS '建立邀請的使用者 ID。';
COMMENT ON COLUMN "worklog_source_invites"."expires_at" IS '邀請到期時間。';
COMMENT ON COLUMN "worklog_source_invites"."revoked_at" IS '邀請撤銷時間。';
COMMENT ON COLUMN "worklog_source_invites"."max_uses" IS '邀請允許的最大使用次數。';
COMMENT ON COLUMN "worklog_source_invites"."use_count" IS '邀請目前已使用次數。';
COMMENT ON COLUMN "worklog_source_invites"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_source_invites"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_user_public_accounts" IS '使用者對外顯示的非連續公開帳號識別。';
COMMENT ON COLUMN "worklog_user_public_accounts"."user_id" IS 'AFTERTRACE 使用者 ID。';
COMMENT ON COLUMN "worklog_user_public_accounts"."public_account_id" IS '對外使用的公開帳號 ID。';
COMMENT ON COLUMN "worklog_user_public_accounts"."created_at" IS '資料建立時間。';
COMMENT ON TABLE "worklog_notification_preferences" IS '使用者各類 Web Push 通知偏好設定。';
COMMENT ON COLUMN "worklog_notification_preferences"."user_id" IS '使用者 ID。';
COMMENT ON COLUMN "worklog_notification_preferences"."announcement_push_enabled" IS '是否接收公告 Push。';
COMMENT ON COLUMN "worklog_notification_preferences"."system_push_enabled" IS '是否接收系統通知 Push。';
COMMENT ON COLUMN "worklog_notification_preferences"."task_push_enabled" IS '是否接收任務提醒 Push。';
COMMENT ON COLUMN "worklog_notification_preferences"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_notification_preferences"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_notification_recipients" IS '通知與接收使用者的關聯及 Push 投遞狀態。';
COMMENT ON COLUMN "worklog_notification_recipients"."id" IS '通知接收紀錄流水號。';
COMMENT ON COLUMN "worklog_notification_recipients"."notification_id" IS '通知 ID。';
COMMENT ON COLUMN "worklog_notification_recipients"."user_id" IS '接收使用者 ID。';
COMMENT ON COLUMN "worklog_notification_recipients"."read_at" IS '使用者閱讀時間。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_status" IS 'Push 投遞狀態。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_attempt_count" IS 'Push 已嘗試投遞次數。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_attempted_at" IS '最近一次嘗試 Push 的時間。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_next_attempt_at" IS '下一次允許重試 Push 的時間。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_sent_at" IS 'Push 成功送達 Provider 的時間。';
COMMENT ON COLUMN "worklog_notification_recipients"."push_failure_code" IS '最近一次 Push 失敗代碼。';
COMMENT ON COLUMN "worklog_notification_recipients"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_notification_recipients"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_notifications" IS '站內公告、系統通知與任務通知主資料。';
COMMENT ON COLUMN "worklog_notifications"."id" IS '通知流水號。';
COMMENT ON COLUMN "worklog_notifications"."type" IS '通知類型。';
COMMENT ON COLUMN "worklog_notifications"."status" IS '通知處理狀態。';
COMMENT ON COLUMN "worklog_notifications"."audience" IS '通知目標受眾類型。';
COMMENT ON COLUMN "worklog_notifications"."title" IS '通知標題。';
COMMENT ON COLUMN "worklog_notifications"."body" IS '通知本文。';
COMMENT ON COLUMN "worklog_notifications"."in_app_enabled" IS '是否顯示於站內通知。';
COMMENT ON COLUMN "worklog_notifications"."push_enabled" IS '是否透過 Web Push 發送。';
COMMENT ON COLUMN "worklog_notifications"."system_event_key" IS '系統事件唯一識別值，用於避免重複建立通知。';
COMMENT ON COLUMN "worklog_notifications"."reference_type" IS '通知關聯資源類型。';
COMMENT ON COLUMN "worklog_notifications"."reference_id" IS '通知關聯資源 ID。';
COMMENT ON COLUMN "worklog_notifications"."deep_link" IS '點擊通知後導向的 AFTERTRACE 路徑。';
COMMENT ON COLUMN "worklog_notifications"."metadata" IS '通知附加資訊。';
COMMENT ON COLUMN "worklog_notifications"."created_by_actor" IS '建立通知的操作來源或管理者識別。';
COMMENT ON COLUMN "worklog_notifications"."scheduled_at" IS '預定發送時間。';
COMMENT ON COLUMN "worklog_notifications"."dispatch_started_at" IS '開始派送時間。';
COMMENT ON COLUMN "worklog_notifications"."sent_at" IS '完成發送時間。';
COMMENT ON COLUMN "worklog_notifications"."cancelled_at" IS '取消時間。';
COMMENT ON COLUMN "worklog_notifications"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_notifications"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_push_subscriptions" IS '使用者瀏覽器 Web Push 訂閱端點。';
COMMENT ON COLUMN "worklog_push_subscriptions"."id" IS 'Push 訂閱流水號。';
COMMENT ON COLUMN "worklog_push_subscriptions"."user_id" IS '使用者 ID。';
COMMENT ON COLUMN "worklog_push_subscriptions"."endpoint" IS '瀏覽器 Push Service endpoint。';
COMMENT ON COLUMN "worklog_push_subscriptions"."p256dh" IS 'Web Push 加密使用的 p256dh 公鑰。';
COMMENT ON COLUMN "worklog_push_subscriptions"."auth" IS 'Web Push 加密使用的 auth secret。';
COMMENT ON COLUMN "worklog_push_subscriptions"."user_agent" IS '建立訂閱時的瀏覽器 User-Agent。';
COMMENT ON COLUMN "worklog_push_subscriptions"."platform" IS '使用者裝置或瀏覽器平台資訊。';
COMMENT ON COLUMN "worklog_push_subscriptions"."revoked_at" IS '訂閱失效或撤銷時間。';
COMMENT ON COLUMN "worklog_push_subscriptions"."last_success_at" IS '最近一次 Push 成功時間。';
COMMENT ON COLUMN "worklog_push_subscriptions"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_push_subscriptions"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_tasks" IS '使用者確認建立的任務與提醒資料。';
COMMENT ON COLUMN "worklog_tasks"."id" IS '任務流水號。';
COMMENT ON COLUMN "worklog_tasks"."user_id" IS '任務擁有者使用者 ID。';
COMMENT ON COLUMN "worklog_tasks"."source_id" IS '任務相關 Source ID。';
COMMENT ON COLUMN "worklog_tasks"."record_id" IS '任務來源 Record ID。';
COMMENT ON COLUMN "worklog_tasks"."title" IS '任務標題。';
COMMENT ON COLUMN "worklog_tasks"."body" IS '任務補充內容。';
COMMENT ON COLUMN "worklog_tasks"."status" IS '任務目前狀態。';
COMMENT ON COLUMN "worklog_tasks"."due_at" IS '任務到期時間。';
COMMENT ON COLUMN "worklog_tasks"."remind_at" IS '預定提醒時間。';
COMMENT ON COLUMN "worklog_tasks"."reminder_notified_at" IS '提醒通知實際建立或送出時間。';
COMMENT ON COLUMN "worklog_tasks"."completed_at" IS '任務完成時間。';
COMMENT ON COLUMN "worklog_tasks"."cancelled_at" IS '任務取消時間。';
COMMENT ON COLUMN "worklog_tasks"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_tasks"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_commercial_config" IS 'AFTERTRACE 商業設定，保存免費 AI 試用等營運參數。';
COMMENT ON COLUMN "worklog_commercial_config"."id" IS '設定流水號；目前以 1 作為主要設定。';
COMMENT ON COLUMN "worklog_commercial_config"."free_initial_ai_trial_points" IS '新使用者首次免費 AI 試用點數。';
COMMENT ON COLUMN "worklog_commercial_config"."updated_by" IS '最後更新設定的管理者識別。';
COMMENT ON COLUMN "worklog_commercial_config"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_commercial_config"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_ai_usage_events" IS 'AI 使用事件明細，保存模型用量、Provider 成本與客戶點數扣款結果。';
COMMENT ON COLUMN "worklog_ai_usage_events"."id" IS 'AI 使用事件流水號。';
COMMENT ON COLUMN "worklog_ai_usage_events"."reservation_token" IS '對應 AI 點數預留 Token。';
COMMENT ON COLUMN "worklog_ai_usage_events"."actor_user_id" IS '實際發起 AI 操作的使用者 ID。';
COMMENT ON COLUMN "worklog_ai_usage_events"."charged_user_id" IS '實際被扣除 AI 點數的使用者 ID。';
COMMENT ON COLUMN "worklog_ai_usage_events"."workspace_id" IS '此次 AI 操作相關工作區 ID。';
COMMENT ON COLUMN "worklog_ai_usage_events"."source_id" IS '此次 AI 操作相關 Source ID。';
COMMENT ON COLUMN "worklog_ai_usage_events"."record_id" IS '此次 AI 操作相關 Record ID。';
COMMENT ON COLUMN "worklog_ai_usage_events"."operation" IS 'AI 操作類型。';
COMMENT ON COLUMN "worklog_ai_usage_events"."provider" IS 'AI Provider。';
COMMENT ON COLUMN "worklog_ai_usage_events"."model" IS '實際使用的模型。';
COMMENT ON COLUMN "worklog_ai_usage_events"."input_tokens" IS '輸入 Token 數量。';
COMMENT ON COLUMN "worklog_ai_usage_events"."output_tokens" IS '輸出 Token 數量。';
COMMENT ON COLUMN "worklog_ai_usage_events"."audio_input_units" IS '音訊輸入計價單位數量。';
COMMENT ON COLUMN "worklog_ai_usage_events"."image_input_units" IS '圖片輸入計價單位數量。';
COMMENT ON COLUMN "worklog_ai_usage_events"."input_usd_per_million" IS '本次計價使用的每百萬輸入 Token 美元單價。';
COMMENT ON COLUMN "worklog_ai_usage_events"."output_usd_per_million" IS '本次計價使用的每百萬輸出 Token 美元單價。';
COMMENT ON COLUMN "worklog_ai_usage_events"."audio_usd_per_million" IS '本次計價使用的音訊美元單價。';
COMMENT ON COLUMN "worklog_ai_usage_events"."image_usd_per_million" IS '本次計價使用的圖片美元單價。';
COMMENT ON COLUMN "worklog_ai_usage_events"."usd_twd_rate" IS '本次計價使用的美元兌新台幣匯率。';
COMMENT ON COLUMN "worklog_ai_usage_events"."provider_cost_usd" IS '此次 AI 操作的 Provider 美元成本。';
COMMENT ON COLUMN "worklog_ai_usage_events"."provider_cost_twd" IS '此次 AI 操作的 Provider 新台幣成本。';
COMMENT ON COLUMN "worklog_ai_usage_events"."customer_points_charged" IS '此次操作實際向客戶扣除的點數。';
COMMENT ON COLUMN "worklog_ai_usage_events"."platform_subsidized_points" IS '此次操作由平台補貼的點數。';
COMMENT ON COLUMN "worklog_ai_usage_events"."platform_subsidized_cost_usd" IS '平台補貼部分換算的美元成本。';
COMMENT ON COLUMN "worklog_ai_usage_events"."platform_subsidized_cost_twd" IS '平台補貼部分換算的新台幣成本。';
COMMENT ON COLUMN "worklog_ai_usage_events"."created_at" IS 'AI 使用事件建立時間。';
COMMENT ON TABLE "worklog_ai_grant_scopes" IS 'AI Grant 可使用範圍，將 Grant 配置到特定 Source 並追蹤額度。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."id" IS 'Grant Scope 流水號。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."grant_id" IS '所屬 AI Grant ID。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."source_id" IS '可使用此 Grant 的 Source ID。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."cap_points" IS '此 Source 可使用的點數上限。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."used_points" IS '此 Source 已實際使用點數。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."reserved_points" IS '此 Source 目前預留中的點數。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."enabled" IS '此 Scope 是否可使用。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_ai_grant_scopes"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_ai_grants" IS '使用者擁有的 AI 點數 Grant，保存免費試用、訂閱週期或管理員授予額度。';
COMMENT ON COLUMN "worklog_ai_grants"."id" IS 'AI Grant 流水號。';
COMMENT ON COLUMN "worklog_ai_grants"."owner_user_id" IS 'Grant 擁有者使用者 ID。';
COMMENT ON COLUMN "worklog_ai_grants"."type" IS 'Grant 類型。';
COMMENT ON COLUMN "worklog_ai_grants"."status" IS 'Grant 目前狀態。';
COMMENT ON COLUMN "worklog_ai_grants"."original_points" IS 'Grant 原始授予點數。';
COMMENT ON COLUMN "worklog_ai_grants"."remaining_points" IS 'Grant 目前剩餘點數。';
COMMENT ON COLUMN "worklog_ai_grants"."provider_cost_committed_twd" IS '此 Grant 已確認產生的 Provider 新台幣成本。';
COMMENT ON COLUMN "worklog_ai_grants"."provider_cost_reserved_twd" IS '此 Grant 目前預留中的 Provider 新台幣成本。';
COMMENT ON COLUMN "worklog_ai_grants"."effective_at" IS 'Grant 開始生效時間。';
COMMENT ON COLUMN "worklog_ai_grants"."expires_at" IS 'Grant 到期時間。';
COMMENT ON COLUMN "worklog_ai_grants"."origin_key" IS 'Grant 來源唯一識別值，用於避免重複授予。';
COMMENT ON COLUMN "worklog_ai_grants"."metadata" IS 'Grant 附加資訊。';
COMMENT ON COLUMN "worklog_ai_grants"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_ai_grants"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_ai_point_reservation_funding" IS 'AI 點數預留與實際 Grant／Grant Scope 的資金來源拆分。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."id" IS '預留資金來源流水號。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."reservation_id" IS '對應 AI 點數預留紀錄 ID。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."grant_id" IS '實際提供點數的 AI Grant ID。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."grant_scope_id" IS '實際提供點數的 Grant Scope ID。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."points_reserved" IS '從此 Grant Scope 預留的點數。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."points_charged" IS '最後實際從此 Grant Scope 扣除的點數。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_ai_point_reservation_funding"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_ai_point_reservations" IS 'AI 請求執行前的點數與 Provider 成本預留紀錄。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."id" IS 'AI 點數預留流水號。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."token" IS '預留唯一 Token。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."charged_user_id" IS '預計扣點的使用者 ID。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."actor_user_id" IS '實際發起 AI 操作的使用者 ID。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."source_id" IS '此次 AI 操作所屬 Source ID。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."entitlement_grant_id" IS '此次操作主要對應的 entitlement Grant ID。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."points_reserved" IS '預留點數。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."points_committed" IS '最後確認扣除的點數。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."platform_subsidized_points" IS '此次預留中由平台補貼的點數。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."provider_cost_hold_twd" IS '此次請求暫時保留的 Provider 新台幣成本額度。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."status" IS '點數預留目前狀態。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."expires_at" IS '預留失效時間。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_ai_point_reservations"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_ai_usage_funding" IS 'AI 使用事件的實際 Grant／Grant Scope 扣點來源。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."id" IS 'AI 使用資金來源流水號。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."usage_event_id" IS '對應 AI 使用事件 ID。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."grant_id" IS '實際被扣點的 AI Grant ID。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."grant_scope_id" IS '實際被扣點的 Grant Scope ID。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."points_charged" IS '從此 Grant Scope 實際扣除的點數。';
COMMENT ON COLUMN "worklog_ai_usage_funding"."created_at" IS '資料建立時間。';
COMMENT ON TABLE "worklog_checkout_intents" IS '使用者發起付費升級時的付款意圖與 Provider checkout 資訊。';
COMMENT ON COLUMN "worklog_checkout_intents"."id" IS '付款意圖流水號。';
COMMENT ON COLUMN "worklog_checkout_intents"."user_id" IS '發起付款的使用者 ID。';
COMMENT ON COLUMN "worklog_checkout_intents"."plan_code" IS '準備購買的方案代碼。';
COMMENT ON COLUMN "worklog_checkout_intents"."payer_email" IS '本次付款使用的 Email 快照，供付款與訂單查詢使用。';
COMMENT ON COLUMN "worklog_checkout_intents"."request_key" IS '前端付款請求唯一鍵，用於 idempotency。';
COMMENT ON COLUMN "worklog_checkout_intents"."status" IS '付款意圖目前狀態。';
COMMENT ON COLUMN "worklog_checkout_intents"."provider" IS '付款 Provider 代碼。';
COMMENT ON COLUMN "worklog_checkout_intents"."provider_checkout_id" IS '付款 Provider 或商店端 checkout／訂單識別值。';
COMMENT ON COLUMN "worklog_checkout_intents"."checkout_url" IS 'Provider checkout 導向網址；Provider 不使用 URL 時可為空。';
COMMENT ON COLUMN "worklog_checkout_intents"."expires_at" IS '此付款意圖失效時間。';
COMMENT ON COLUMN "worklog_checkout_intents"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_checkout_intents"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_subscription_lifecycle_events" IS 'Provider-neutral 訂閱生命週期事件 Inbox，用於 idempotent 處理啟用、續訂與取消。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."id" IS '生命週期事件流水號。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."provider" IS '事件來源 Provider。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."external_event_key" IS 'Provider 外部事件唯一鍵。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."event_type" IS '生命週期事件類型。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."user_id" IS '事件對應使用者 ID。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."plan_code" IS '事件對應方案代碼。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."period_start" IS '事件對應服務週期開始時間。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."period_end" IS '事件對應服務週期結束時間。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."occurred_at" IS 'Provider 事件實際發生時間。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."processing_result" IS 'AFTERTRACE 對此事件的處理結果。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."processed_at" IS 'AFTERTRACE 處理此事件的時間。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."metadata" IS 'Provider 事件附加資訊。';
COMMENT ON COLUMN "worklog_subscription_lifecycle_events"."created_at" IS '資料建立時間。';
COMMENT ON TABLE "worklog_feedback_management" IS '管理後台對使用者回饋的分類與處理狀態。';
COMMENT ON COLUMN "worklog_feedback_management"."feedback_id" IS '對應 worklog_feedback.id。';
COMMENT ON COLUMN "worklog_feedback_management"."category" IS '回饋分類。';
COMMENT ON COLUMN "worklog_feedback_management"."status" IS '回饋處理狀態。';
COMMENT ON COLUMN "worklog_feedback_management"."updated_by" IS '最後更新此回饋狀態的管理者識別。';
COMMENT ON COLUMN "worklog_feedback_management"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_newebpay_subscription_history" IS '藍新定期定額歷史紀錄。每一筆 merchant_order_no 代表一次付款／委託建立紀錄，用於保留完整歷史並處理延遲回呼。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."id" IS '歷史紀錄流水號。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."user_id" IS 'AFTERTRACE 使用者 ID，關聯 worklog_users.id。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."checkout_intent_id" IS '對應的付款意圖 ID，關聯 worklog_checkout_intents.id。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."merchant_order_no" IS 'AFTERTRACE 傳給藍新的商店訂單編號，每次 checkout 唯一。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."period_no" IS '藍新定期定額委託編號，成功建立定期定額後由藍新回傳。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."status" IS 'AFTERTRACE 內部付款歷史狀態，由應用程式層控管。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."provider_status" IS '藍新回傳的原始交易／委託狀態。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."respond_code" IS '藍新回傳代碼，例如 00 代表成功。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."auth_amount" IS '本次授權金額，單位為新台幣元。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."total_times" IS '定期定額設定的總授權期數。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."already_times" IS '目前已完成的授權／扣款期數。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."trade_no" IS '藍新交易序號。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."auth_date" IS '首次或本次信用卡授權成功時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."next_auth_date" IS '藍新提供的下一次預計授權／扣款日期。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."current_period_start" IS '此筆訂閱目前服務週期開始時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."current_period_end" IS '此筆訂閱目前服務週期結束時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."last_provider_event_key" IS '最近一次已處理的藍新事件識別值，用於避免重複處理。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."metadata" IS '其他付款、回呼或 reconciliation 擴充資訊，JSON 格式保存。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."updated_at" IS '資料最後更新時間。';
COMMENT ON TABLE "worklog_newebpay_subscriptions" IS '使用者目前的藍新定期定額狀態；每位使用者僅保留目前一筆 Provider adapter 狀態。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."id" IS '藍新目前訂閱流水號。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."user_id" IS 'AFTERTRACE 使用者 ID。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."checkout_intent_id" IS '目前訂閱對應的付款意圖 ID。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."merchant_order_no" IS '目前藍新訂閱對應的商店訂單編號。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."period_no" IS '藍新定期定額委託編號。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."status" IS '目前藍新訂閱 adapter 狀態，由應用程式層控管。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."current_period_start" IS '目前服務週期開始時間。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."current_period_end" IS '目前服務週期結束時間。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."last_provider_event_key" IS '最近一次成功處理的 Provider 事件識別值。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."metadata" IS '藍新目前訂閱的附加資訊。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_newebpay_subscriptions"."updated_at" IS '資料最後更新時間。';
