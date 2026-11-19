CREATE TABLE "dh_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_id" uuid NOT NULL,
	"datahub_id" uuid,
	"table_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phase" text,
	"progress_done" bigint DEFAULT 0 NOT NULL,
	"progress_total" bigint DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error" text,
	"source_key" text,
	"source_name" text,
	"source_kind" text,
	"result_key" text,
	"result_name" text,
	"result_type" text,
	"result_size" bigint,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "dh_jobs_kind_chk" CHECK ("dh_jobs"."kind" IN ('import', 'export')),
	CONSTRAINT "dh_jobs_status_chk" CHECK ("dh_jobs"."status" IN ('draft', 'pending', 'running', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "dh_jobs" ADD CONSTRAINT "dh_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dh_jobs_owner_idx" ON "dh_jobs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "dh_jobs_pending_idx" ON "dh_jobs" USING btree ("status","created_at");