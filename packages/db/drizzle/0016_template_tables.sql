CREATE TABLE "dh_person_cells" (
	"row_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "dh_person_cells_row_id_user_id_pk" PRIMARY KEY("row_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dh_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"manager_id" uuid NOT NULL,
	"leader_id" uuid,
	"name" text NOT NULL,
	"name_norm" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"master_table_id" uuid,
	"member_permission" text DEFAULT 'view' NOT NULL,
	"leader_can_add_columns" boolean DEFAULT false NOT NULL,
	"role_set" text,
	CONSTRAINT "dh_templates_kind_chk" CHECK ("dh_templates"."kind" IN ('shared', 'personal')),
	CONSTRAINT "dh_templates_scope_chk" CHECK (("dh_templates"."scope" = 'tree' AND "dh_templates"."leader_id" IS NULL) OR ("dh_templates"."scope" = 'team' AND "dh_templates"."leader_id" IS NOT NULL)),
	CONSTRAINT "dh_templates_perm_chk" CHECK ("dh_templates"."member_permission" IN ('view', 'edit_data')),
	CONSTRAINT "dh_templates_name_chk" CHECK (char_length(btrim("dh_templates"."name")) BETWEEN 1 AND 100 AND "dh_templates"."name" !~ '[\[\]]')
);
--> statement-breakpoint
DROP INDEX "dh_columns_name_uq";--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "layer" text;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "layer_ref" uuid;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "layer_roles" text[];--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "storage" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "template_column_id" uuid;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_datahubs" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "dh_shares" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "template_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "role_set" text;--> statement-breakpoint
ALTER TABLE "dh_person_cells" ADD CONSTRAINT "dh_person_cells_row_id_dh_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."dh_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_person_cells" ADD CONSTRAINT "dh_person_cells_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_person_cells" ADD CONSTRAINT "dh_person_cells_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_templates" ADD CONSTRAINT "dh_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_templates" ADD CONSTRAINT "dh_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_templates" ADD CONSTRAINT "dh_templates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_templates" ADD CONSTRAINT "dh_templates_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_templates" ADD CONSTRAINT "dh_templates_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dh_person_cells_user_idx" ON "dh_person_cells" USING btree ("table_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_templates_name_uq" ON "dh_templates" USING btree ("manager_id","name_norm") WHERE "dh_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dh_templates_leader_idx" ON "dh_templates" USING btree ("leader_id");--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_layer_ref_users_id_fk" FOREIGN KEY ("layer_ref") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_template_id_dh_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dh_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_template_user_id_users_id_fk" FOREIGN KEY ("template_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_custom_name_uq" ON "dh_columns" USING btree ("table_id","layer_ref","name_norm") WHERE "dh_columns"."deleted_at" IS NULL AND "dh_columns"."layer" = 'custom';--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_role_uq" ON "dh_columns" USING btree ("table_id","role") WHERE "dh_columns"."deleted_at" IS NULL AND "dh_columns"."role" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_datahubs_system_uq" ON "dh_datahubs" USING btree ("owner_id","system_key") WHERE "dh_datahubs"."system_key" IS NOT NULL AND "dh_datahubs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dh_tables_template_idx" ON "dh_tables" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_name_uq" ON "dh_columns" USING btree ("table_id","name_norm") WHERE "dh_columns"."deleted_at" IS NULL AND "dh_columns"."layer" IS DISTINCT FROM 'custom';--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_layer_chk" CHECK ("dh_columns"."layer" IS NULL OR "dh_columns"."layer" IN ('basic', 'role', 'team', 'custom'));--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_storage_chk" CHECK ("dh_columns"."storage" IN ('shared', 'person'));--> statement-breakpoint

--> statement-breakpoint
-- The export view lists the columns everyone shares; a custom column (module4 3.1) belongs to one person and never appears in it.
CREATE OR REPLACE FUNCTION soe_dh_regenerate_view(p_table uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  t dh_tables%ROWTYPE;
  d dh_datahubs%ROWTYPE;
  v_owner text;
  v_name text;
  v_base text;
  v_cols text := 'id, row_no AS ' || quote_ident('row_no');
  v_used text[] := ARRAY['id', 'row_no'];
  c record;
  v_alias text;
  v_i integer;
BEGIN
  SELECT * INTO t FROM dh_tables WHERE id = p_table;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO d FROM dh_datahubs WHERE id = t.datahub_id;
  IF t.sql_view IS NOT NULL THEN EXECUTE format('DROP VIEW IF EXISTS dh_views.%I', t.sql_view); END IF;
  IF t.deleted_at IS NOT NULL OR d.deleted_at IS NOT NULL THEN
    UPDATE dh_tables SET sql_view = NULL WHERE id = p_table;
    RETURN NULL;
  END IF;
  SELECT split_part(coalesce(email, full_name), '@', 1) INTO v_owner FROM users WHERE id = d.owner_id;
  v_base := v_owner || ' – ' || d.name || ' – ' || t.name;
  v_name := soe_dh_ident(v_base);
  -- Two tables that cut down to the same name: the later one gets a short id suffix.
  IF EXISTS (SELECT 1 FROM dh_tables x WHERE x.sql_view = v_name AND x.id <> p_table) THEN
    v_name := soe_dh_ident(v_base, 54) || ' #' || substr(replace(p_table::text, '-', ''), 1, 6);
  END IF;
  FOR c IN SELECT * FROM dh_columns WHERE table_id = p_table AND deleted_at IS NULL AND layer IS DISTINCT FROM 'custom' ORDER BY position, created_at, id LOOP
    v_alias := soe_dh_ident(c.name);
    v_i := 1;
    WHILE lower(v_alias) = ANY (v_used) LOOP
      v_i := v_i + 1;
      v_alias := soe_dh_ident(c.name, 56) || '_' || v_i;
    END LOOP;
    v_used := v_used || lower(v_alias);
    v_cols := v_cols || ', ' || soe_dh_view_expr(c.type, c.key, c.config) || ' AS ' || quote_ident(v_alias);
  END LOOP;
  EXECUTE format('CREATE VIEW dh_views.%I AS SELECT %s FROM public.dh_rows WHERE table_id = %L AND deleted_at IS NULL', v_name, v_cols, p_table);
  UPDATE dh_tables SET sql_view = v_name WHERE id = p_table;
  RETURN v_name;
END
$$;
