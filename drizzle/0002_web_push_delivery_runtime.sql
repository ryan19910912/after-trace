CREATE TABLE "notification_delivery_runtime" (
  "delivery_id" bigint PRIMARY KEY NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "dispatch_claim_key" varchar(64),
  "presented_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_delivery_runtime"
  ADD CONSTRAINT "notification_delivery_runtime_delivery_id_notification_deliveries_id_fk"
  FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notification_delivery_runtime_due_idx"
  ON "notification_delivery_runtime" USING btree ("next_attempt_at", "expires_at", "delivery_id");
--> statement-breakpoint
CREATE INDEX "notification_delivery_runtime_presented_idx"
  ON "notification_delivery_runtime" USING btree ("presented_at", "delivery_id");
--> statement-breakpoint
INSERT INTO "notification_delivery_runtime" (
  "delivery_id",
  "attempt_count",
  "next_attempt_at",
  "expires_at",
  "created_at",
  "updated_at"
)
SELECT
  d."id",
  0,
  d."created_at",
  d."created_at" + interval '30 minutes',
  d."created_at",
  d."updated_at"
FROM "notification_deliveries" d
ON CONFLICT ("delivery_id") DO NOTHING;
