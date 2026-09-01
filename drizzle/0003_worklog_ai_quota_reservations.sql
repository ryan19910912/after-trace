DO $$ BEGIN
  CREATE TYPE "worklog_ai_reservation_status" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions"
  ADD COLUMN IF NOT EXISTS "ai_units_used" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions"
  ADD COLUMN IF NOT EXISTS "ai_units_reserved" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "worklog_user_subscriptions" AS subscription
SET
  "ai_units_used" = COALESCE((
    SELECT SUM(event."ai_units_consumed")::integer
    FROM "worklog_ai_usage_events" AS event
    WHERE event."charged_user_id" = subscription."user_id"
      AND event."created_at" >= subscription."current_period_start"
      AND (
        subscription."current_period_end" IS NULL
        OR event."created_at" < subscription."current_period_end"
      )
  ), 0),
  "ai_units_reserved" = 0,
  "updated_at" = NOW();
--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions"
  DROP CONSTRAINT IF EXISTS "worklog_user_subscription_ai_units_nonnegative";
--> statement-breakpoint
ALTER TABLE "worklog_user_subscriptions"
  ADD CONSTRAINT "worklog_user_subscription_ai_units_nonnegative"
  CHECK ("ai_units_used" >= 0 AND "ai_units_reserved" >= 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_ai_quota_reservations" (
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
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_ai_quota_reservation_token_uq" UNIQUE("token"),
  CONSTRAINT "worklog_ai_quota_reservation_units_check"
    CHECK ("units_reserved" > 0 AND "units_committed" >= 0 AND "units_committed" <= "units_reserved")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_ai_quota_reservation_charged_status_expiry_idx"
  ON "worklog_ai_quota_reservations" USING btree ("charged_user_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_ai_quota_reservation_source_actor_idx"
  ON "worklog_ai_quota_reservations" USING btree ("source_id", "actor_user_id", "created_at");
