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
    // A purged column leaves no values behind in the rows, and its automatic indexes go with it.
    beforePurge: async (ex, cutoff) => {
      const doomed = await ex.execute(sql`SELECT table_id, key FROM dh_columns WHERE /*scope:system*/ deleted_at IS NOT NULL AND deleted_at < ${cutoff}`);
      for (const c of doomed.rows as { table_id: string; key: string }[]) {
        await ex.execute(sql`UPDATE dh_rows SET data = data - ${c.key}::text WHERE /*scope:system*/ table_id = ${c.table_id}::uuid AND data ? ${c.key}`);
        await ex.execute(sql`SELECT soe_dh_drop_indexes(${c.table_id}::uuid, ${c.key})`);
      }
    },
  });
  registerTrashTable({ name: "dh_tables" });
  registerTrashTable({ name: "dh_datahubs" });
}
