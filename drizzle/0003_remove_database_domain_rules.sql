-- AFTERTRACE database stores structural integrity only.
-- Domain/status/business validation belongs to application services.

ALTER TABLE "worklog_sources" DROP CONSTRAINT IF EXISTS "worklog_source_identity_shape_ck";
ALTER TABLE "worklog_subscription_plans" DROP CONSTRAINT IF EXISTS "worklog_plan_v1_identity_ck";
ALTER TABLE "worklog_subscription_plans" DROP CONSTRAINT IF EXISTS "worklog_plan_grant_points_ck";
ALTER TABLE "worklog_subscription_plans" DROP CONSTRAINT IF EXISTS "worklog_plan_ai_cap_values_ck";
ALTER TABLE "worklog_subscription_plans" DROP CONSTRAINT IF EXISTS "worklog_plan_ai_enabled_shape_ck";
ALTER TABLE "worklog_source_invites" DROP CONSTRAINT IF EXISTS "worklog_source_invite_use_count_ck";
ALTER TABLE "worklog_source_invites" DROP CONSTRAINT IF EXISTS "worklog_source_invite_max_uses_ck";
ALTER TABLE "worklog_notifications" DROP CONSTRAINT IF EXISTS "worklog_notification_channel_ck";
ALTER TABLE "worklog_notifications" DROP CONSTRAINT IF EXISTS "worklog_notification_schedule_ck";
ALTER TABLE "worklog_notification_recipients" DROP CONSTRAINT IF EXISTS "worklog_notification_recipient_push_attempt_count_ck";
ALTER TABLE "worklog_tasks" DROP CONSTRAINT IF EXISTS "worklog_task_title_nonblank_ck";
ALTER TABLE "worklog_tasks" DROP CONSTRAINT IF EXISTS "worklog_task_completed_state_ck";
ALTER TABLE "worklog_tasks" DROP CONSTRAINT IF EXISTS "worklog_task_cancelled_state_ck";
ALTER TABLE "worklog_commercial_config" DROP CONSTRAINT IF EXISTS "worklog_commercial_config_singleton_ck";
ALTER TABLE "worklog_commercial_config" DROP CONSTRAINT IF EXISTS "worklog_commercial_config_free_trial_points_ck";
ALTER TABLE "worklog_checkout_intents" DROP CONSTRAINT IF EXISTS "worklog_checkout_intent_status_ck";
ALTER TABLE "worklog_subscription_lifecycle_events" DROP CONSTRAINT IF EXISTS "worklog_subscription_lifecycle_event_type_ck";
ALTER TABLE "worklog_subscription_lifecycle_events" DROP CONSTRAINT IF EXISTS "worklog_subscription_lifecycle_plan_code_ck";
ALTER TABLE "worklog_subscription_lifecycle_events" DROP CONSTRAINT IF EXISTS "worklog_subscription_lifecycle_processing_result_ck";
ALTER TABLE "worklog_feedback_management" DROP CONSTRAINT IF EXISTS "worklog_feedback_management_category_ck";
ALTER TABLE "worklog_feedback_management" DROP CONSTRAINT IF EXISTS "worklog_feedback_management_status_ck";
ALTER TABLE "worklog_newebpay_subscriptions" DROP CONSTRAINT IF EXISTS "worklog_newebpay_subscription_status_ck";

ALTER TABLE "worklog_checkout_intents" ADD COLUMN IF NOT EXISTS "payer_email" varchar(320);

ALTER TABLE "worklog_feedback" ALTER COLUMN "channel" TYPE varchar(32) USING "channel"::text;
ALTER TABLE "worklog_subscription_plans" ALTER COLUMN "plan_type" TYPE varchar(32) USING "plan_type"::text;
ALTER TABLE "worklog_records" ALTER COLUMN "input_type" TYPE varchar(32) USING "input_type"::text;
ALTER TABLE "worklog_source_members" ALTER COLUMN "role" TYPE varchar(32) USING "role"::text;
ALTER TABLE "worklog_sources" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_sources" ALTER COLUMN "type" TYPE varchar(32) USING "type"::text;
ALTER TABLE "worklog_user_subscriptions" ALTER COLUMN "source" TYPE varchar(32) USING "source"::text;
ALTER TABLE "worklog_subscription_history" ALTER COLUMN "source" TYPE varchar(32) USING "source"::text;
ALTER TABLE "worklog_user_subscriptions" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_records" ALTER COLUMN "ai_enrichment_status" TYPE varchar(32) USING "ai_enrichment_status"::text;
ALTER TABLE "worklog_record_revisions" ALTER COLUMN "channel" TYPE varchar(32) USING "channel"::text;
ALTER TABLE "worklog_records" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_record_revisions" ALTER COLUMN "previous_status" TYPE varchar(32) USING "previous_status"::text;
ALTER TABLE "worklog_record_revisions" ALTER COLUMN "new_status" TYPE varchar(32) USING "new_status"::text;
ALTER TABLE "worklog_auth_identities" ALTER COLUMN "provider" TYPE varchar(32) USING "provider"::text;
ALTER TABLE "worklog_notifications" ALTER COLUMN "audience" TYPE varchar(32) USING "audience"::text;
ALTER TABLE "worklog_notification_recipients" ALTER COLUMN "push_status" TYPE varchar(32) USING "push_status"::text;
ALTER TABLE "worklog_notifications" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_notifications" ALTER COLUMN "type" TYPE varchar(32) USING "type"::text;
ALTER TABLE "worklog_tasks" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_ai_grants" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;
ALTER TABLE "worklog_ai_grants" ALTER COLUMN "type" TYPE varchar(32) USING "type"::text;
ALTER TABLE "worklog_ai_point_reservations" ALTER COLUMN "status" TYPE varchar(32) USING "status"::text;

DROP TYPE IF EXISTS "public"."worklog_feedback_channel";
DROP TYPE IF EXISTS "public"."worklog_plan_type";
DROP TYPE IF EXISTS "public"."worklog_record_input_type";
DROP TYPE IF EXISTS "public"."worklog_source_member_role";
DROP TYPE IF EXISTS "public"."worklog_source_status";
DROP TYPE IF EXISTS "public"."worklog_source_type";
DROP TYPE IF EXISTS "public"."worklog_subscription_source";
DROP TYPE IF EXISTS "public"."worklog_subscription_status";
DROP TYPE IF EXISTS "public"."worklog_record_ai_enrichment_status";
DROP TYPE IF EXISTS "public"."worklog_record_revision_channel";
DROP TYPE IF EXISTS "public"."worklog_record_status";
DROP TYPE IF EXISTS "public"."worklog_auth_provider";
DROP TYPE IF EXISTS "public"."worklog_notification_audience";
DROP TYPE IF EXISTS "public"."worklog_notification_delivery_status";
DROP TYPE IF EXISTS "public"."worklog_notification_status";
DROP TYPE IF EXISTS "public"."worklog_notification_type";
DROP TYPE IF EXISTS "public"."worklog_task_status";
DROP TYPE IF EXISTS "public"."worklog_ai_grant_status";
DROP TYPE IF EXISTS "public"."worklog_ai_grant_type";
DROP TYPE IF EXISTS "public"."worklog_ai_point_reservation_status";

COMMENT ON COLUMN "worklog_checkout_intents"."payer_email" IS '本次付款使用的 Email 快照，供付款與訂單查詢使用。';
