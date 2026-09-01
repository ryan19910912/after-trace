CREATE TYPE "worklog_source_type" AS ENUM ('PRIVATE', 'GROUP');
CREATE TYPE "worklog_source_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "worklog_record_input_type" AS ENUM ('TEXT', 'AUDIO', 'IMAGE', 'FILE');
CREATE TYPE "worklog_record_category" AS ENUM ('NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'PHOTO', 'AUDIO', 'OTHER');
CREATE TYPE "worklog_project_status" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "worklog_transaction_type" AS ENUM ('RECEIVED', 'EXPENSE', 'RECEIVABLE');
CREATE TYPE "worklog_subscription_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "worklog_subscription_source" AS ENUM ('FREE', 'PAYMENT', 'ADMIN');
CREATE TYPE "worklog_feedback_channel" AS ENUM ('LINE_OA', 'PWA');
CREATE TYPE "worklog_anomaly_severity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "worklog_anomaly_status" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

CREATE TABLE "worklog_users" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "line_user_id" varchar(64) NOT NULL,
  "display_name" varchar(255),
  "is_oa_friend" boolean DEFAULT false NOT NULL,
  "first_oa_added_at" timestamptz,
  "last_interaction_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_user_line_user_uq" ON "worklog_users" ("line_user_id");
CREATE INDEX "worklog_user_oa_updated_idx" ON "worklog_users" ("is_oa_friend", "updated_at");

CREATE TABLE "worklog_workspaces" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "owner_user_id" bigint NOT NULL,
  "name" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_workspace_owner_uq" ON "worklog_workspaces" ("owner_user_id");

CREATE TABLE "worklog_sources" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "workspace_id" bigint NOT NULL,
  "type" "worklog_source_type" NOT NULL,
  "status" "worklog_source_status" DEFAULT 'ACTIVE' NOT NULL,
  "private_user_id" bigint,
  "line_group_id" varchar(64),
  "subscription_owner_user_id" bigint,
  "inactive_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_source_identity_ck" CHECK (
    ("type" = 'PRIVATE' AND "private_user_id" IS NOT NULL AND "line_group_id" IS NULL)
    OR
    ("type" = 'GROUP' AND "private_user_id" IS NULL AND "line_group_id" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "worklog_source_private_user_uq" ON "worklog_sources" ("private_user_id");
CREATE UNIQUE INDEX "worklog_source_line_group_uq" ON "worklog_sources" ("line_group_id");
CREATE INDEX "worklog_source_workspace_type_idx" ON "worklog_sources" ("workspace_id", "type");
CREATE INDEX "worklog_source_subscription_owner_idx" ON "worklog_sources" ("subscription_owner_user_id");

CREATE TABLE "worklog_source_members" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "source_id" bigint NOT NULL,
  "user_id" bigint NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_source_member_uq" ON "worklog_source_members" ("source_id", "user_id");
CREATE INDEX "worklog_source_member_user_active_idx" ON "worklog_source_members" ("user_id", "is_active");

CREATE TABLE "worklog_customers" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "workspace_id" bigint NOT NULL,
  "name" varchar(255) NOT NULL,
  "phone" varchar(64),
  "address" text,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_customer_workspace_name_idx" ON "worklog_customers" ("workspace_id", "name");

CREATE TABLE "worklog_projects" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "workspace_id" bigint NOT NULL,
  "customer_id" bigint,
  "name" varchar(255) NOT NULL,
  "address" text,
  "status" "worklog_project_status" DEFAULT 'ACTIVE' NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_project_workspace_status_idx" ON "worklog_projects" ("workspace_id", "status");
CREATE INDEX "worklog_project_customer_idx" ON "worklog_projects" ("customer_id");

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
  "source_timestamp" timestamptz,
  "edited_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_record_line_message_uq" ON "worklog_records" ("line_message_id");
CREATE INDEX "worklog_record_source_created_idx" ON "worklog_records" ("source_id", "created_at");
CREATE INDEX "worklog_record_workspace_customer_idx" ON "worklog_records" ("workspace_id", "customer_id");
CREATE INDEX "worklog_record_workspace_project_idx" ON "worklog_records" ("workspace_id", "project_id");
CREATE INDEX "worklog_record_author_type_idx" ON "worklog_records" ("author_user_id", "input_type");

CREATE TABLE "worklog_transactions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "workspace_id" bigint NOT NULL,
  "record_id" bigint,
  "customer_id" bigint,
  "project_id" bigint,
  "type" "worklog_transaction_type" NOT NULL,
  "amount_twd" numeric(14,2) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_transaction_workspace_time_idx" ON "worklog_transactions" ("workspace_id", "occurred_at");
CREATE INDEX "worklog_transaction_project_idx" ON "worklog_transactions" ("project_id");
CREATE INDEX "worklog_transaction_record_idx" ON "worklog_transactions" ("record_id");

CREATE TABLE "worklog_subscription_plans" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "code" varchar(64) NOT NULL,
  "display_name" varchar(255) NOT NULL,
  "price_twd" numeric(12,2) DEFAULT 0 NOT NULL,
  "rank" integer DEFAULT 0 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "ai_allowance_units" integer DEFAULT 0 NOT NULL,
  "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_subscription_plan_code_uq" ON "worklog_subscription_plans" ("code");

CREATE TABLE "worklog_user_subscriptions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "plan_code" varchar(64) NOT NULL,
  "status" "worklog_subscription_status" DEFAULT 'ACTIVE' NOT NULL,
  "source" "worklog_subscription_source" DEFAULT 'FREE' NOT NULL,
  "effective_at" timestamptz DEFAULT now() NOT NULL,
  "current_period_start" timestamptz DEFAULT now() NOT NULL,
  "current_period_end" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "worklog_user_subscription_user_uq" ON "worklog_user_subscriptions" ("user_id");
CREATE INDEX "worklog_user_subscription_plan_status_idx" ON "worklog_user_subscriptions" ("plan_code", "status");

CREATE TABLE "worklog_subscription_history" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "previous_plan_code" varchar(64),
  "next_plan_code" varchar(64) NOT NULL,
  "source" "worklog_subscription_source" NOT NULL,
  "actor" varchar(128),
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_subscription_history_user_time_idx" ON "worklog_subscription_history" ("user_id", "created_at");

CREATE TABLE "worklog_ai_runtime_config" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "provider" varchar(128) NOT NULL,
  "model" varchar(255) NOT NULL,
  "input_usd_per_million" numeric(18,8) NOT NULL,
  "output_usd_per_million" numeric(18,8) NOT NULL,
  "audio_usd_per_million" numeric(18,8),
  "image_usd_per_million" numeric(18,8),
  "usd_twd_rate" numeric(12,6),
  "updated_by" varchar(128),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_ai_runtime_singleton_ck" CHECK ("id" = 1)
);

CREATE TABLE "worklog_ai_usage_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "workspace_id" bigint,
  "source_id" bigint,
  "record_id" bigint,
  "provider" varchar(128) NOT NULL,
  "model" varchar(255) NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "audio_input_units" integer DEFAULT 0 NOT NULL,
  "image_input_units" integer DEFAULT 0 NOT NULL,
  "input_usd_per_million" numeric(18,8) NOT NULL,
  "output_usd_per_million" numeric(18,8) NOT NULL,
  "audio_usd_per_million" numeric(18,8),
  "image_usd_per_million" numeric(18,8),
  "usd_twd_rate" numeric(12,6),
  "provider_cost_usd" numeric(18,8) NOT NULL,
  "provider_cost_twd" numeric(18,6),
  "ai_units_consumed" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_ai_usage_user_time_idx" ON "worklog_ai_usage_events" ("user_id", "created_at");
CREATE INDEX "worklog_ai_usage_workspace_time_idx" ON "worklog_ai_usage_events" ("workspace_id", "created_at");
CREATE INDEX "worklog_ai_usage_record_idx" ON "worklog_ai_usage_events" ("record_id");

CREATE TABLE "worklog_feedback" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "display_name_snapshot" varchar(255),
  "channel" "worklog_feedback_channel" NOT NULL,
  "text" text NOT NULL,
  "context" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_feedback_created_idx" ON "worklog_feedback" ("created_at");

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
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_anomaly_status_severity_time_idx" ON "worklog_anomaly_events" ("status", "severity", "created_at");
CREATE INDEX "worklog_anomaly_user_idx" ON "worklog_anomaly_events" ("user_id");

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
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "worklog_audit_workspace_time_idx" ON "worklog_audit_logs" ("workspace_id", "created_at");
CREATE INDEX "worklog_audit_target_idx" ON "worklog_audit_logs" ("target_type", "target_id");
