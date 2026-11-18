CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"actor_user_id" uuid,
	"via" text,
	"connection_id" uuid,
	"automation_id" uuid,
	"ip" text,
	"user_agent" text,
	"command" text NOT NULL,
	"result" text NOT NULL,
	"error_code" text,
	"target_type" text,
	"target_id" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "row_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"row_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"op" text NOT NULL,
	"changes" jsonb NOT NULL,
	"actor" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" text,
	"aggregate_id" text,
	"payload" jsonb NOT NULL,
	"actor" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"command" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"label" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" uuid,
	"unlocked_at" timestamp with time zone,
	"unlocked_by" uuid,
	"unlock_reason" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_rows" (
	"snapshot_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "snapshot_rows_snapshot_id_row_id_pk" PRIMARY KEY("snapshot_id","row_id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"table_id" text,
	"scope" text DEFAULT 'global' NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid,
	"row_count" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"owner_id" uuid,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshot_rows" ADD CONSTRAINT "snapshot_rows_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_command_idx" ON "audit_log" USING btree ("command","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "row_history_row_version_uq" ON "row_history" USING btree ("table_id","row_id","version");--> statement-breakpoint
CREATE INDEX "row_history_row_idx" ON "row_history" USING btree ("table_id","row_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_event_idx" ON "outbox" USING btree ("event","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "period_locks_active_idx" ON "period_locks" USING btree ("table_id","scope","period_start","period_end") WHERE "period_locks"."unlocked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "snapshots_kind_idx" ON "snapshots" USING btree ("kind","scope","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_uq" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_uq" ON "system_settings" USING btree ("key");