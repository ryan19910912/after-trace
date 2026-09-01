CREATE TABLE "worklog_pending_groups" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "line_group_id" varchar(64) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "inactive_at" timestamptz,
  "promoted_source_id" bigint,
  "promoted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_pending_group_line_group_uq"
  ON "worklog_pending_groups" USING btree ("line_group_id");
--> statement-breakpoint
CREATE INDEX "worklog_pending_group_active_updated_idx"
  ON "worklog_pending_groups" USING btree ("is_active", "updated_at");
--> statement-breakpoint
CREATE INDEX "worklog_pending_group_promoted_idx"
  ON "worklog_pending_groups" USING btree ("promoted_source_id");
--> statement-breakpoint

CREATE TABLE "worklog_pending_group_members" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "pending_group_id" bigint NOT NULL,
  "user_id" bigint NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_pending_group_member_uq"
  ON "worklog_pending_group_members" USING btree ("pending_group_id", "user_id");
--> statement-breakpoint
CREATE INDEX "worklog_pending_group_member_user_active_idx"
  ON "worklog_pending_group_members" USING btree ("user_id", "is_active");
