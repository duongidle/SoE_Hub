CREATE TABLE "mt_dashboard_prefs" (
	"dashboard_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt_dashboard_prefs_dashboard_id_user_id_pk" PRIMARY KEY("dashboard_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mt_dashboard_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "mt_dashboard_prefs" ADD CONSTRAINT "mt_dashboard_prefs_dashboard_id_mt_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."mt_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_dashboard_shares" ADD CONSTRAINT "mt_dashboard_shares_dashboard_id_mt_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."mt_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mt_dashboard_shares_uq" ON "mt_dashboard_shares" USING btree ("dashboard_id","grantee_id");--> statement-breakpoint
CREATE INDEX "mt_dashboard_shares_grantee_idx" ON "mt_dashboard_shares" USING btree ("grantee_id");