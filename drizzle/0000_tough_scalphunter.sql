CREATE TYPE "public"."credit_bucket" AS ENUM('WELCOME', 'AD', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."credit_reservation_status" AS ENUM('RESERVED', 'CONSUMED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('GRANT', 'CONSUME', 'RESERVE', 'RELEASE');--> statement-breakpoint
CREATE TYPE "public"."extraction_batch_status" AS ENUM('CLAIMED', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."memory_request_origin" AS ENUM('EXPLICIT', 'AUTOMATIC');--> statement-breakpoint
CREATE TYPE "public"."memory_request_status" AS ENUM('PENDING', 'BLOCKED_SOURCE_MISSING', 'CLAIMED', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."rewarded_ad_grant_status" AS ENUM('PENDING', 'GRANTED', 'REJECTED_POLICY');--> statement-breakpoint
CREATE TYPE "public"."memory_candidate_decision" AS ENUM('NEW', 'DUPLICATE', 'UPDATE', 'CONTRADICT');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('SCHEDULED', 'DISPATCHING', 'CANCELLED', 'DELIVERED');--> statement-breakpoint
CREATE TYPE "public"."energy_bucket" AS ENUM('FREE', 'SUBSCRIPTION', 'AD', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."energy_operation_type" AS ENUM('GRANT', 'CONSUME', 'RESERVE', 'RELEASE', 'RESERVED_CONSUME');--> statement-breakpoint
CREATE TYPE "public"."energy_reservation_status" AS ENUM('RESERVED', 'RELEASED', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "public"."paid_pack_code" AS ENUM('SMALL', 'MEDIUM', 'LARGE');--> statement-breakpoint
CREATE TYPE "public"."commerce_event_status" AS ENUM('APPLIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."platform_ai_budget_reservation_status" AS ENUM('RESERVED', 'SETTLED', 'RELEASED');--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"line_user_id" varchar(64),
	"usage_type" varchar(64) NOT NULL,
	"provider" varchar(32) DEFAULT 'GOOGLE' NOT NULL,
	"model" varchar(128) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"input_usd_per_million_tokens" numeric(18, 10) NOT NULL,
	"output_usd_per_million_tokens" numeric(18, 10) NOT NULL,
	"cost_usd" numeric(18, 10) NOT NULL,
	"usd_twd_rate" numeric(12, 6) NOT NULL,
	"cost_twd" numeric(18, 8) NOT NULL,
	"charged_cost_twd" numeric(18, 8) NOT NULL,
	"latency_ms" integer,
	"charge_operation_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"actor_line_user_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(128),
	"before_value" jsonb,
	"after_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_extraction_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"status" "extraction_batch_status" DEFAULT 'CLAIMED' NOT NULL,
	"active_claim_key" varchar(16),
	"message_count" integer NOT NULL,
	"char_count" integer NOT NULL,
	"first_message_id" bigint NOT NULL,
	"last_message_id" bigint NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"webhook_event_id" varchar(128),
	"line_message_id" varchar(64) NOT NULL,
	"quoted_line_message_id" varchar(64),
	"line_user_id" varchar(64),
	"message_type" varchar(32) NOT NULL,
	"text_content" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"quote_token" text,
	"line_timestamp" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"extraction_batch_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"bucket" "credit_bucket" NOT NULL,
	"available_cost_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"reserved_cost_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"scope_bucket" "credit_bucket",
	"requested_amount_cost_twd" numeric(18, 8) NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"reserve_operation_id" bigint NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" varchar(128) NOT NULL,
	"amount_cost_twd" numeric(18, 8) NOT NULL,
	"status" "credit_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reservations_reserve_operation_id_unique" UNIQUE("reserve_operation_id")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operation_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"bucket" "credit_bucket" NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount_cost_twd" numeric(18, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"line_group_id" varchar(64) NOT NULL,
	"status" "group_status" DEFAULT 'ACTIVE' NOT NULL,
	"has_paid" boolean DEFAULT false NOT NULL,
	"pending_message_count" integer DEFAULT 0 NOT NULL,
	"pending_char_count" integer DEFAULT 0 NOT NULL,
	"inactive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_groups_line_group_id_unique" UNIQUE("line_group_id")
);
--> statement-breakpoint
CREATE TABLE "line_users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_users_line_user_id_unique" UNIQUE("line_user_id")
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"category" varchar(64) NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"status" "memory_status" DEFAULT 'ACTIVE' NOT NULL,
	"source_message_id" varchar(64),
	"source_quote_token" text,
	"source_line_user_id" varchar(64),
	"source_line_timestamp" timestamp with time zone,
	"metadata" jsonb,
	"superseded_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_candidate_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"origin" "memory_request_origin" NOT NULL,
	"status" "memory_request_status" DEFAULT 'PENDING' NOT NULL,
	"extraction_batch_id" bigint,
	"request_line_message_id" varchar(64),
	"actor_line_user_id" varchar(64),
	"source_line_message_id" varchar(64),
	"source_conversation_message_id" bigint,
	"instruction" text,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewarded_ad_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"actor_line_user_id" varchar(64) NOT NULL,
	"reward_event_id" varchar(128) NOT NULL,
	"policy_day" varchar(10) NOT NULL,
	"amount_cost_twd" numeric(18, 8) NOT NULL,
	"status" "rewarded_ad_grant_status" DEFAULT 'PENDING' NOT NULL,
	"grant_operation_id" bigint,
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewarded_ad_grants_grant_operation_id_unique" UNIQUE("grant_operation_id")
);
--> statement-breakpoint
CREATE TABLE "rewarded_ad_policy_state" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"policy_day" varchar(10) NOT NULL,
	"grant_count" integer DEFAULT 0 NOT NULL,
	"last_accepted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_credit_attributions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"is_first_group" boolean DEFAULT false NOT NULL,
	"amount_cost_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"grant_operation_id" bigint,
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "welcome_credit_attributions_grant_operation_id_unique" UNIQUE("grant_operation_id")
);
--> statement-breakpoint
CREATE TABLE "welcome_credit_user_state" (
	"line_user_id" varchar(64) PRIMARY KEY NOT NULL,
	"group_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automatic_memory_request_keys" (
	"extraction_batch_id" bigint PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_candidate_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"candidate_index" integer NOT NULL,
	"decision" "memory_candidate_decision" NOT NULL,
	"target_memory_id" bigint,
	"persisted_memory_id" bigint NOT NULL,
	"source_conversation_message_id" bigint NOT NULL,
	"category" varchar(64) NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_request_work_states" (
	"request_id" bigint PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"transient_failure_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_classifier_results" (
	"request_id" bigint PRIMARY KEY NOT NULL,
	"attempt_count" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"provider_response_id" varchar(128),
	"structured_output" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer,
	"input_usd_per_million_tokens" numeric(18, 10) NOT NULL,
	"output_usd_per_million_tokens" numeric(18, 10) NOT NULL,
	"usd_twd_rate" numeric(12, 6) NOT NULL,
	"cost_usd" numeric(18, 10) NOT NULL,
	"cost_twd" numeric(18, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_free_ai_budget_operations" (
	"credit_operation_id" bigint PRIMARY KEY NOT NULL,
	"budget_key" varchar(64) NOT NULL,
	"free_cost_twd" numeric(18, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_free_ai_budget_state" (
	"budget_key" varchar(64) PRIMARY KEY NOT NULL,
	"spent_cost_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"message" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'SCHEDULED' NOT NULL,
	"reserved_cost_twd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"reserve_operation_id" bigint,
	"created_by_line_user_id" varchar(64) NOT NULL,
	"cancelled_by_line_user_id" varchar(64),
	"delivery_reference" varchar(128),
	"delivery_attempt_count" integer DEFAULT 0 NOT NULL,
	"delivery_retry_key" varchar(36),
	"delivery_retry_expires_at" timestamp with time zone,
	"delivery_lease_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_reserve_operation_id_unique" UNIQUE("reserve_operation_id")
);
--> statement-breakpoint
CREATE TABLE "user_energy_lots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"bucket" "energy_bucket" NOT NULL,
	"original_units" bigint NOT NULL,
	"available_units" bigint NOT NULL,
	"reserved_units" bigint DEFAULT 0 NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_energy_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"type" "energy_operation_type" NOT NULL,
	"requested_units" bigint NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" varchar(160) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_energy_reservation_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reservation_id" bigint NOT NULL,
	"lot_id" bigint NOT NULL,
	"units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_energy_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"reserve_operation_id" bigint NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" varchar(160) NOT NULL,
	"requested_units" bigint NOT NULL,
	"status" "energy_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"valid_through" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_energy_reservations_reserve_operation_id_unique" UNIQUE("reserve_operation_id")
);
--> statement-breakpoint
CREATE TABLE "user_energy_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operation_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"lot_id" bigint NOT NULL,
	"bucket" "energy_bucket" NOT NULL,
	"type" "energy_operation_type" NOT NULL,
	"units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_paid_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_purchase_id" varchar(160) NOT NULL,
	"pack_code" "paid_pack_code" NOT NULL,
	"grant_operation_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_paid_purchases_grant_operation_id_unique" UNIQUE("grant_operation_id")
);
--> statement-breakpoint
CREATE TABLE "user_subscription_cycles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" varchar(32) NOT NULL,
	"subscription_id" varchar(160) NOT NULL,
	"cycle_id" varchar(160) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"grant_operation_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_subscription_cycles_grant_operation_id_unique" UNIQUE("grant_operation_id")
);
--> statement-breakpoint
CREATE TABLE "ai_energy_usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"usage_type" varchar(64) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(18, 10) NOT NULL,
	"cost_twd" numeric(18, 8) NOT NULL,
	"energy_units" bigint NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_energy_usage_events_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "ai_user_energy_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"allocated_units" bigint NOT NULL,
	"charged_units" bigint NOT NULL,
	"platform_subsidy_units" bigint NOT NULL,
	"charge_operation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automatic_memory_eligible_subjects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"extraction_batch_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"normalized_char_count" integer NOT NULL,
	"preflight_available_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_ai_subsidy_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"units" bigint NOT NULL,
	"budget_key" varchar(64) DEFAULT 'V1_FREE_AI' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reminder_ownership" (
	"reminder_id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"energy_reservation_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_reminder_ownership_energy_reservation_id_unique" UNIQUE("energy_reservation_id")
);
--> statement-breakpoint
CREATE TABLE "user_rewarded_ad_claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"nonce_id" bigint NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(160) NOT NULL,
	"policy_day" varchar(10) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"grant_operation_id" bigint,
	"accepted_at" timestamp with time zone NOT NULL,
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_rewarded_ad_claims_nonce_id_unique" UNIQUE("nonce_id")
);
--> statement-breakpoint
CREATE TABLE "user_rewarded_ad_nonces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"nonce_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_provider_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(160) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"user_id" bigint NOT NULL,
	"status" "commerce_event_status" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explicit_ai_chat_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"line_message_id" varchar(64) NOT NULL,
	"prompt" text NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"response_text" text,
	"usage_type" varchar(64),
	"provider" varchar(32),
	"model" varchar(128),
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"input_usd_per_million_tokens" numeric(18, 10),
	"output_usd_per_million_tokens" numeric(18, 10),
	"usd_twd_rate" numeric(18, 6),
	"cost_usd" numeric(18, 10),
	"cost_twd" numeric(18, 8),
	"energy_units" bigint,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explicit_ai_energy_hold_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"lot_id" bigint NOT NULL,
	"units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explicit_ai_energy_holds" (
	"request_id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"reserved_units" bigint NOT NULL,
	"actual_units" bigint,
	"status" varchar(32) DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_ai_budget_reservations" (
	"request_id" bigint PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"budget_key" varchar(64) DEFAULT 'V1_FREE_AI' NOT NULL,
	"reserved_cost_twd" numeric(18, 8) NOT NULL,
	"actual_subsidy_cost_twd" numeric(18, 8),
	"status" "platform_ai_budget_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proactive_pushes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(160) NOT NULL,
	"message" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" varchar(32) DEFAULT 'SCHEDULED' NOT NULL,
	"delivery_attempt_count" integer DEFAULT 0 NOT NULL,
	"delivery_retry_key" varchar(36),
	"delivery_lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_checkout_intents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"product_code" varchar(64) NOT NULL,
	"provider" varchar(32),
	"provider_checkout_id" varchar(160),
	"status" varchar(32) DEFAULT 'PENDING_PROVIDER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_subscription_state" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_subscription_id" varchar(160) NOT NULL,
	"status" varchar(32) NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" varchar(8) DEFAULT 'false' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_setting_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"changed_by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" jsonb,
	"updated_by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_charge_operation_uq" ON "ai_usage_events" USING btree ("charge_operation_id");--> statement-breakpoint
CREATE INDEX "ai_usage_group_created_idx" ON "ai_usage_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_group_created_idx" ON "audit_logs" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_batch_active_claim_uq" ON "conversation_extraction_batches" USING btree ("group_id","active_claim_key");--> statement-breakpoint
CREATE INDEX "extraction_batch_group_status_idx" ON "conversation_extraction_batches" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "extraction_batch_lease_idx" ON "conversation_extraction_batches" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_line_id_uq" ON "conversation_messages" USING btree ("line_message_id");--> statement-breakpoint
CREATE INDEX "conversation_message_group_created_idx" ON "conversation_messages" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_message_group_line_time_idx" ON "conversation_messages" USING btree ("group_id","line_timestamp");--> statement-breakpoint
CREATE INDEX "conversation_message_quoted_line_id_idx" ON "conversation_messages" USING btree ("quoted_line_message_id");--> statement-breakpoint
CREATE INDEX "conversation_message_extraction_batch_idx" ON "conversation_messages" USING btree ("extraction_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_account_group_bucket_uq" ON "credit_accounts" USING btree ("group_id","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_operation_reference_uq" ON "credit_operations" USING btree ("group_id","type","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "credit_operation_group_created_idx" ON "credit_operations" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_reservation_reference_uq" ON "credit_reservations" USING btree ("group_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "credit_reservation_group_status_idx" ON "credit_reservations" USING btree ("group_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transaction_operation_bucket_uq" ON "credit_transactions" USING btree ("operation_id","bucket");--> statement-breakpoint
CREATE INDEX "credit_transaction_group_created_idx" ON "credit_transactions" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_member_group_user_uq" ON "group_members" USING btree ("group_id","line_user_id");--> statement-breakpoint
CREATE INDEX "group_member_user_idx" ON "group_members" USING btree ("line_user_id");--> statement-breakpoint
CREATE INDEX "memory_group_status_idx" ON "memories" USING btree ("group_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_request_explicit_line_message_uq" ON "memory_candidate_requests" USING btree ("group_id","request_line_message_id");--> statement-breakpoint
CREATE INDEX "memory_request_group_status_idx" ON "memory_candidate_requests" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "memory_request_extraction_batch_idx" ON "memory_candidate_requests" USING btree ("extraction_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rewarded_ad_group_event_uq" ON "rewarded_ad_grants" USING btree ("group_id","reward_event_id");--> statement-breakpoint
CREATE INDEX "rewarded_ad_group_day_status_idx" ON "rewarded_ad_grants" USING btree ("group_id","policy_day","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rewarded_ad_policy_group_day_uq" ON "rewarded_ad_policy_state" USING btree ("group_id","policy_day");--> statement-breakpoint
CREATE UNIQUE INDEX "welcome_credit_group_uq" ON "welcome_credit_attributions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "welcome_credit_user_created_idx" ON "welcome_credit_attributions" USING btree ("line_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automatic_memory_request_request_uq" ON "automatic_memory_request_keys" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "automatic_memory_request_group_idx" ON "automatic_memory_request_keys" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_candidate_result_request_index_uq" ON "memory_candidate_results" USING btree ("request_id","candidate_index");--> statement-breakpoint
CREATE INDEX "memory_candidate_result_memory_idx" ON "memory_candidate_results" USING btree ("persisted_memory_id");--> statement-breakpoint
CREATE INDEX "memory_candidate_result_target_idx" ON "memory_candidate_results" USING btree ("target_memory_id");--> statement-breakpoint
CREATE INDEX "memory_request_work_lease_idx" ON "memory_request_work_states" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "global_free_ai_budget_operation_key_idx" ON "global_free_ai_budget_operations" USING btree ("budget_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_group_request_key_uq" ON "reminders" USING btree ("group_id","request_key");--> statement-breakpoint
CREATE INDEX "reminder_group_status_scheduled_idx" ON "reminders" USING btree ("group_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "reminder_due_idx" ON "reminders" USING btree ("status","scheduled_for","delivery_lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_energy_lot_source_uq" ON "user_energy_lots" USING btree ("user_id","bucket","source_type","source_id");--> statement-breakpoint
CREATE INDEX "user_energy_lot_spend_idx" ON "user_energy_lots" USING btree ("user_id","expires_at","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "user_energy_operation_reference_uq" ON "user_energy_operations" USING btree ("user_id","type","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "user_energy_operation_user_created_idx" ON "user_energy_operations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_energy_reservation_allocation_lot_uq" ON "user_energy_reservation_allocations" USING btree ("reservation_id","lot_id");--> statement-breakpoint
CREATE INDEX "user_energy_reservation_allocation_lot_idx" ON "user_energy_reservation_allocations" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_energy_reservation_reference_uq" ON "user_energy_reservations" USING btree ("user_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "user_energy_reservation_user_status_idx" ON "user_energy_reservations" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_energy_transaction_operation_lot_uq" ON "user_energy_transactions" USING btree ("operation_id","lot_id");--> statement-breakpoint
CREATE INDEX "user_energy_transaction_user_created_idx" ON "user_energy_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_paid_purchase_provider_uq" ON "user_paid_purchases" USING btree ("provider","provider_purchase_id");--> statement-breakpoint
CREATE INDEX "user_paid_purchase_user_created_idx" ON "user_paid_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_subscription_cycle_provider_uq" ON "user_subscription_cycles" USING btree ("provider","cycle_id");--> statement-breakpoint
CREATE INDEX "user_subscription_cycle_user_period_idx" ON "user_subscription_cycles" USING btree ("user_id","period_end");--> statement-breakpoint
CREATE INDEX "ai_energy_usage_group_created_idx" ON "ai_energy_usage_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_user_energy_allocation_request_user_uq" ON "ai_user_energy_allocations" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_user_energy_allocation_group_created_idx" ON "ai_user_energy_allocations" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automatic_memory_eligible_request_user_uq" ON "automatic_memory_eligible_subjects" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "automatic_memory_eligible_batch_idx" ON "automatic_memory_eligible_subjects" USING btree ("extraction_batch_id");--> statement-breakpoint
CREATE INDEX "automatic_memory_eligible_group_request_idx" ON "automatic_memory_eligible_subjects" USING btree ("group_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_ai_subsidy_request_user_uq" ON "platform_ai_subsidy_operations" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "platform_ai_subsidy_budget_created_idx" ON "platform_ai_subsidy_operations" USING btree ("budget_key","created_at");--> statement-breakpoint
CREATE INDEX "user_reminder_owner_group_idx" ON "user_reminder_ownership" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_rewarded_ad_provider_event_uq" ON "user_rewarded_ad_claims" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "user_rewarded_ad_user_day_status_idx" ON "user_rewarded_ad_claims" USING btree ("user_id","policy_day","status");--> statement-breakpoint
CREATE INDEX "user_rewarded_ad_user_accepted_idx" ON "user_rewarded_ad_claims" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_rewarded_ad_nonce_hash_uq" ON "user_rewarded_ad_nonces" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "user_rewarded_ad_nonce_user_expiry_idx" ON "user_rewarded_ad_nonces" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_provider_event_uq" ON "commerce_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "commerce_provider_event_user_created_idx" ON "commerce_provider_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "explicit_ai_chat_line_message_uq" ON "explicit_ai_chat_requests" USING btree ("group_id","line_message_id");--> statement-breakpoint
CREATE INDEX "explicit_ai_chat_user_created_idx" ON "explicit_ai_chat_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "explicit_ai_energy_hold_allocation_uq" ON "explicit_ai_energy_hold_allocations" USING btree ("request_id","lot_id");--> statement-breakpoint
CREATE INDEX "explicit_ai_energy_hold_lot_idx" ON "explicit_ai_energy_hold_allocations" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "explicit_ai_energy_hold_user_status_idx" ON "explicit_ai_energy_holds" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "platform_ai_budget_reservation_status_idx" ON "platform_ai_budget_reservations" USING btree ("budget_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_push_user_request_uq" ON "proactive_pushes" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_push_source_uq" ON "proactive_pushes" USING btree ("user_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "proactive_push_due_idx" ON "proactive_pushes" USING btree ("status","scheduled_for","delivery_lease_expires_at");--> statement-breakpoint
CREATE INDEX "proactive_push_group_status_idx" ON "proactive_pushes" USING btree ("group_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_checkout_intent_request_uq" ON "user_checkout_intents" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE INDEX "user_checkout_intent_user_created_idx" ON "user_checkout_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_subscription_provider_subscription_uq" ON "user_subscription_state" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "operational_setting_change_created_idx" ON "operational_setting_changes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_setting_key_uq" ON "operational_settings" USING btree ("key");