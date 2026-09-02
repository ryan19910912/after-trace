-- AFTERTRACE Worklog post-cutover legacy cleanup.
--
-- Run only after the Worklog-only API Worker is deployed and healthy. This is intentionally
-- not in the automatic Drizzle journal yet: the production helper applies journaled migrations
-- before deploying the Worker, while these tables belonged to the previous runtime. Keeping the
-- destructive step post-cutover avoids a migration window where an older Worker could query
-- tables that have already been dropped.
--
-- The active GROUP one-time-link table `web_auth_entry_nonces` is deliberately preserved.

DROP TABLE IF EXISTS "ai_usage_events" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "conversation_extraction_batches" CASCADE;
DROP TABLE IF EXISTS "conversation_messages" CASCADE;
DROP TABLE IF EXISTS "credit_accounts" CASCADE;
DROP TABLE IF EXISTS "credit_operations" CASCADE;
DROP TABLE IF EXISTS "credit_reservations" CASCADE;
DROP TABLE IF EXISTS "credit_transactions" CASCADE;
DROP TABLE IF EXISTS "group_members" CASCADE;
DROP TABLE IF EXISTS "line_groups" CASCADE;
DROP TABLE IF EXISTS "line_users" CASCADE;
DROP TABLE IF EXISTS "memories" CASCADE;
DROP TABLE IF EXISTS "memory_candidate_requests" CASCADE;
DROP TABLE IF EXISTS "rewarded_ad_grants" CASCADE;
DROP TABLE IF EXISTS "rewarded_ad_policy_state" CASCADE;
DROP TABLE IF EXISTS "welcome_credit_attributions" CASCADE;
DROP TABLE IF EXISTS "welcome_credit_user_state" CASCADE;
DROP TABLE IF EXISTS "automatic_memory_request_keys" CASCADE;
DROP TABLE IF EXISTS "memory_candidate_results" CASCADE;
DROP TABLE IF EXISTS "memory_request_work_states" CASCADE;
DROP TABLE IF EXISTS "memory_classifier_results" CASCADE;
DROP TABLE IF EXISTS "global_free_ai_budget_operations" CASCADE;
DROP TABLE IF EXISTS "global_free_ai_budget_state" CASCADE;
DROP TABLE IF EXISTS "reminders" CASCADE;
DROP TABLE IF EXISTS "user_energy_lots" CASCADE;
DROP TABLE IF EXISTS "user_energy_operations" CASCADE;
DROP TABLE IF EXISTS "user_energy_reservation_allocations" CASCADE;
DROP TABLE IF EXISTS "user_energy_reservations" CASCADE;
DROP TABLE IF EXISTS "user_energy_transactions" CASCADE;
DROP TABLE IF EXISTS "user_paid_purchases" CASCADE;
DROP TABLE IF EXISTS "user_subscription_cycles" CASCADE;
DROP TABLE IF EXISTS "ai_energy_usage_events" CASCADE;
DROP TABLE IF EXISTS "ai_user_energy_allocations" CASCADE;
DROP TABLE IF EXISTS "automatic_memory_eligible_subjects" CASCADE;
DROP TABLE IF EXISTS "platform_ai_subsidy_operations" CASCADE;
DROP TABLE IF EXISTS "user_reminder_ownership" CASCADE;
DROP TABLE IF EXISTS "user_rewarded_ad_claims" CASCADE;
DROP TABLE IF EXISTS "user_rewarded_ad_nonces" CASCADE;
DROP TABLE IF EXISTS "commerce_provider_events" CASCADE;
DROP TABLE IF EXISTS "explicit_ai_chat_requests" CASCADE;
DROP TABLE IF EXISTS "explicit_ai_energy_hold_allocations" CASCADE;
DROP TABLE IF EXISTS "explicit_ai_energy_holds" CASCADE;
DROP TABLE IF EXISTS "platform_ai_budget_reservations" CASCADE;
DROP TABLE IF EXISTS "proactive_pushes" CASCADE;
DROP TABLE IF EXISTS "user_checkout_intents" CASCADE;
DROP TABLE IF EXISTS "user_subscription_state" CASCADE;
DROP TABLE IF EXISTS "operational_setting_changes" CASCADE;
DROP TABLE IF EXISTS "operational_settings" CASCADE;

DROP TYPE IF EXISTS "credit_bucket" CASCADE;
DROP TYPE IF EXISTS "credit_reservation_status" CASCADE;
DROP TYPE IF EXISTS "credit_transaction_type" CASCADE;
DROP TYPE IF EXISTS "extraction_batch_status" CASCADE;
DROP TYPE IF EXISTS "group_status" CASCADE;
DROP TYPE IF EXISTS "memory_status" CASCADE;
DROP TYPE IF EXISTS "memory_request_origin" CASCADE;
DROP TYPE IF EXISTS "memory_request_status" CASCADE;
DROP TYPE IF EXISTS "rewarded_ad_grant_status" CASCADE;
DROP TYPE IF EXISTS "memory_candidate_decision" CASCADE;
DROP TYPE IF EXISTS "reminder_status" CASCADE;
DROP TYPE IF EXISTS "energy_bucket" CASCADE;
DROP TYPE IF EXISTS "energy_operation_type" CASCADE;
DROP TYPE IF EXISTS "energy_reservation_status" CASCADE;
DROP TYPE IF EXISTS "paid_pack_code" CASCADE;
DROP TYPE IF EXISTS "commerce_event_status" CASCADE;
DROP TYPE IF EXISTS "platform_ai_budget_reservation_status" CASCADE;
