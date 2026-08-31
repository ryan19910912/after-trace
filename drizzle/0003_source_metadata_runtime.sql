CREATE TABLE "source_metadata_runtime" (
  "source_id" bigint PRIMARY KEY NOT NULL,
  "last_successful_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error_code" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_metadata_runtime" ADD CONSTRAINT "source_metadata_runtime_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "source_metadata_runtime_due_idx" ON "source_metadata_runtime" USING btree ("next_attempt_at","source_id");
