-- Radar ownership/matching foundation layered on the clean sports-radar baseline.
ALTER TABLE "availability_events" ADD COLUMN "matched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "watch_rules" ADD COLUMN "client_key" varchar(128);
--> statement-breakpoint
ALTER TABLE "watch_rules" ADD COLUMN "client_payload_hash" varchar(64);
--> statement-breakpoint
UPDATE "watch_rules"
SET "client_key" = 'migration:' || "id"::text,
    "client_payload_hash" = repeat('0', 64)
WHERE "client_key" IS NULL OR "client_payload_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "watch_rules" ALTER COLUMN "client_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "watch_rules" ALTER COLUMN "client_payload_hash" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "watch_rules_user_client_key_uq" ON "watch_rules" USING btree ("user_id", "client_key");
--> statement-breakpoint
CREATE INDEX "availability_events_match_queue_idx" ON "availability_events" USING btree ("new_status", "matched_at", "id");
