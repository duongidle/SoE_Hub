import { sql } from "drizzle-orm";
import { registerTrashTable } from "@soe/db";

/**
 * Trash of the Datahub tables (design module2 section 12, Module 0 section 12). The nightly job `system-trash-purge`
 * hard-deletes what stayed in the trash past the retention days. Order matters: rows, then columns, tables, datahubs.
 * Foreign keys cascade, so purging a table also removes its rows, views and shares. Row history is kept forever.
 */
export function registerDatahubTrash(): void {
  registerTrashTable({ name: "dh_rows" });
  registerTrashTable({
    name: "dh_columns",
    // A template column is archived, never purged (design module4 3.1).
    keepWhere: "protected",
    // A purged column leaves no values behind in the rows, and its automatic indexes go with it.
    beforePurge: async (ex, cutoff) => {
      const doomed = await ex.execute(sql`SELECT table_id, key FROM dh_columns WHERE /*scope:system*/ deleted_at IS NOT NULL AND deleted_at < ${cutoff} AND NOT protected`);
      for (const c of doomed.rows as { table_id: string; key: string }[]) {
        // The error of a computed cell lives under `!<key>`; it goes too.
        await ex.execute(sql`UPDATE dh_rows SET data = data - ARRAY[${c.key}::text, ${`!${c.key}`}::text] WHERE /*scope:system*/ table_id = ${c.table_id}::uuid AND (data ? ${c.key} OR data ? ${`!${c.key}`})`);
        // The same for the values people kept of their own (person-stored column).
        await ex.execute(sql`UPDATE dh_person_cells SET data = data - ${c.key}::text WHERE /*scope:system*/ table_id = ${c.table_id}::uuid AND data ? ${c.key}`);
        await ex.execute(sql`SELECT soe_dh_drop_indexes(${c.table_id}::uuid, ${c.key})`);
      }
    },
  });
  // Dashboards of a datahub (Stage 3C-1): charts first (a purged dashboard takes its charts with it through the foreign key).
  registerTrashTable({ name: "mt_charts" });
  registerTrashTable({ name: "mt_dashboards" });
  // A template table that was archived (its person left the template's scope) keeps its rows until they come back (module4 3.5).
  registerTrashTable({ name: "dh_tables", keepWhere: "protected OR archived" });
  registerTrashTable({ name: "dh_datahubs", keepWhere: "system_key IS NOT NULL" });
}
