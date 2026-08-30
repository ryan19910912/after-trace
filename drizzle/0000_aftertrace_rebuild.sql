-- AFTERTRACE sports availability/radar clean baseline.
-- The retired LINE/AI product is intentionally not migrated. If a legacy schema is
-- detected, stop and provision a fresh Neon database/branch instead of carrying
-- old tables into the new product.
DO $$
BEGIN
  IF to_regclass('public.line_groups') IS NOT NULL
     OR to_regclass('public.memories') IS NOT NULL
     OR to_regclass('public.user_energy_lots') IS NOT NULL
     OR to_regclass('public.reminders') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy AFTERTRACE schema detected. Use a fresh database/branch for the rebuild baseline.';
  END IF;
END $$;
--> statement-breakpoint
CREATE TYPE "public"."booking_channel" AS ENUM('WEB', 'APP', 'PHONE', 'ONSITE');
--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN');
--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('WEB_PUSH', 'EMAIL');
--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'OPENED');
--> statement-breakpoint
CREATE TABLE "users" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "auth_provider" varchar(32) NOT NULL,
  "auth_subject" varchar(191) NOT NULL,
  "email" varchar(320),
  "display_name" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(160) NOT NULL,
  "base_url" text,
  "active" boolean DEFAULT true NOT NULL,
  "min_poll_interval_seconds" integer DEFAULT 60 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "source_id" bigint NOT NULL,
  "external_venue_id" varchar(191) NOT NULL,
  "name" varchar(200) NOT NULL,
  "city" varchar(80) DEFAULT '臺北市' NOT NULL,
  "district" varchar(80),
  "address" text,
  "latitude" double precision,
  "longitude" double precision,
  "booking_channel" "booking_channel" DEFAULT 'WEB' NOT NULL,
  "booking_url" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_sports" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "venue_id" bigint NOT NULL,
  "sport_id" bigint NOT NULL,
  "external_category_id" varchar(191),
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "venue_id" bigint NOT NULL,
  "sport_id" bigint NOT NULL,
  "external_court_id" varchar(191) NOT NULL,
  "name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_slots" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "source_id" bigint NOT NULL,
  "venue_id" bigint NOT NULL,
  "sport_id" bigint NOT NULL,
  "court_id" bigint,
  "external_slot_key" varchar(256) NOT NULL,
  "use_date" date NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "status" "availability_status" DEFAULT 'UNKNOWN' NOT NULL,
  "price" numeric(12,2),
  "external_booking_ref" text,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "availability_slot_id" bigint NOT NULL,
  "previous_status" "availability_status" NOT NULL,
  "new_status" "availability_status" NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_rules" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "sport_id" bigint NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "date_from" date,
  "date_to" date,
  "days_of_week" jsonb,
  "start_time" time,
  "end_time" time,
  "city" varchar(80) DEFAULT '臺北市' NOT NULL,
  "district" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_rule_venues" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "watch_rule_id" bigint NOT NULL,
  "venue_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text,
  "auth_secret" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "watch_rule_id" bigint NOT NULL,
  "availability_event_id" bigint NOT NULL,
  "subscription_id" bigint,
  "channel" "notification_channel" NOT NULL,
  "status" "notification_delivery_status" DEFAULT 'PENDING' NOT NULL,
  "idempotency_key" varchar(191) NOT NULL UNIQUE,
  "error_code" varchar(128),
  "sent_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_targets" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "source_id" bigint NOT NULL,
  "venue_id" bigint NOT NULL,
  "sport_id" bigint NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "interval_seconds" integer DEFAULT 300 NOT NULL,
  "next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_polled_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error_code" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "venue_sports" ADD CONSTRAINT "venue_sports_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "venue_sports" ADD CONSTRAINT "venue_sports_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_availability_slot_id_availability_slots_id_fk" FOREIGN KEY ("availability_slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "watch_rules" ADD CONSTRAINT "watch_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "watch_rules" ADD CONSTRAINT "watch_rules_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "watch_rule_venues" ADD CONSTRAINT "watch_rule_venues_watch_rule_id_watch_rules_id_fk" FOREIGN KEY ("watch_rule_id") REFERENCES "public"."watch_rules"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "watch_rule_venues" ADD CONSTRAINT "watch_rule_venues_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_watch_rule_id_watch_rules_id_fk" FOREIGN KEY ("watch_rule_id") REFERENCES "public"."watch_rules"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_availability_event_id_availability_events_id_fk" FOREIGN KEY ("availability_event_id") REFERENCES "public"."availability_events"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_id_notification_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "poll_targets" ADD CONSTRAINT "poll_targets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "poll_targets" ADD CONSTRAINT "poll_targets_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "poll_targets" ADD CONSTRAINT "poll_targets_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_uq" ON "users" USING btree ("auth_provider","auth_subject");
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");
CREATE INDEX "sources_active_idx" ON "sources" USING btree ("active");
CREATE INDEX "sports_active_name_idx" ON "sports" USING btree ("active","name");
CREATE UNIQUE INDEX "venues_source_external_uq" ON "venues" USING btree ("source_id","external_venue_id");
CREATE INDEX "venues_city_district_active_idx" ON "venues" USING btree ("city","district","active");
CREATE UNIQUE INDEX "venue_sports_venue_sport_uq" ON "venue_sports" USING btree ("venue_id","sport_id");
CREATE INDEX "venue_sports_sport_active_idx" ON "venue_sports" USING btree ("sport_id","active");
CREATE UNIQUE INDEX "courts_venue_sport_external_uq" ON "courts" USING btree ("venue_id","sport_id","external_court_id");
CREATE INDEX "courts_venue_sport_active_idx" ON "courts" USING btree ("venue_id","sport_id","active");
CREATE UNIQUE INDEX "availability_slots_source_key_uq" ON "availability_slots" USING btree ("source_id","external_slot_key");
CREATE INDEX "availability_slots_search_idx" ON "availability_slots" USING btree ("sport_id","use_date","status","start_time");
CREATE INDEX "availability_slots_venue_date_idx" ON "availability_slots" USING btree ("venue_id","use_date","status");
CREATE INDEX "availability_events_slot_time_idx" ON "availability_events" USING btree ("availability_slot_id","occurred_at");
CREATE INDEX "watch_rules_enabled_sport_idx" ON "watch_rules" USING btree ("enabled","sport_id");
CREATE UNIQUE INDEX "watch_rule_venues_rule_venue_uq" ON "watch_rule_venues" USING btree ("watch_rule_id","venue_id");
CREATE UNIQUE INDEX "notification_subscriptions_user_endpoint_uq" ON "notification_subscriptions" USING btree ("user_id","endpoint");
CREATE INDEX "notification_subscriptions_user_active_idx" ON "notification_subscriptions" USING btree ("user_id","active");
CREATE INDEX "notification_deliveries_rule_status_idx" ON "notification_deliveries" USING btree ("watch_rule_id","status");
CREATE UNIQUE INDEX "poll_targets_source_venue_sport_uq" ON "poll_targets" USING btree ("source_id","venue_id","sport_id");
CREATE INDEX "poll_targets_due_idx" ON "poll_targets" USING btree ("enabled","next_poll_at","priority");
