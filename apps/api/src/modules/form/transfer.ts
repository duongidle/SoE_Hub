import { sql } from "drizzle-orm";
import { registerTransferHandler, type TransferHandler } from "../transfer";

type Raw = Record<string, unknown>;

/**
 * Data transfer (design module1 section 8, module7 9): the forms of the source account (live and in the trash) change owner together with
 * their datahubs, so a form keeps writing to a table its owner still owns. The names the owner had named as graders stay as they are.
 */
export const formTransferHandler: TransferHandler = {
  key: "forms",
  label: "Form",
  async preview(ex, from) {
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM forms WHERE /*scope:system*/ owner_id = ${from}::uuid ORDER BY created_at`);
    return (res.rows as Raw[]).map((r) => ({ type: "form", id: r.id as string, label: `${r.name as string}${r.deleted_at ? " (trong thùng rác)" : ""}`, action: "move" as const }));
  },
  async execute(ex, from, to, _opts, actor) {
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM forms WHERE /*scope:system*/ owner_id = ${from}::uuid ORDER BY created_at FOR UPDATE`);
    const items = [];
    for (const r of res.rows as Raw[]) {
      await ex.execute(sql`UPDATE forms SET owner_id = ${to}::uuid, version = version + 1, updated_at = now(), updated_by = ${actor.userId}::uuid WHERE /*scope:system*/ id = ${r.id as string}::uuid`);
      items.push({ type: "form", id: r.id as string, label: `${r.name as string}${r.deleted_at ? " (trong thùng rác)" : ""}`, action: "move" as const });
    }
    return items;
  },
};

registerTransferHandler(formTransferHandler);
