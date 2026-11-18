import { sql } from "drizzle-orm";
import { enqueueOutbox } from "@soe/db";
import { registerTransferHandler, type TransferHandler } from "../transfer";

type Raw = Record<string, unknown>;

/**
 * Data transfer (design module1 section 8): the datahubs of the source account (live and in the trash) change owner.
 * A name already taken by the target gets " (chuyển giao)" added, so nothing is lost or rejected. Shares the target
 * already had on those datahubs become redundant and are removed. The SQL export views are rebuilt (their names carry
 * the owner).
 */
export const datahubTransferHandler: TransferHandler = {
  key: "datahubs",
  label: "Datahub",
  async preview(ex, from) {
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${from}::uuid ORDER BY created_at`);
    return (res.rows as Raw[]).map((r) => ({ type: "datahub", id: r.id as string, label: `${r.name as string}${r.deleted_at ? " (trong thùng rác)" : ""}`, action: "move" as const }));
  },
  async execute(ex, from, to, _opts, actor) {
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${from}::uuid ORDER BY created_at FOR UPDATE`);
    const items = [];
    for (const r of res.rows as Raw[]) {
      let name = r.name as string;
      const taken = async (n: string) => (await ex.execute(sql`SELECT 1 FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${to}::uuid AND deleted_at IS NULL AND lower(btrim(name)) = lower(btrim(${n}))`)).rows.length > 0;
      if (!r.deleted_at) {
        let candidate = name;
        for (let n = 0; await taken(candidate); n++) candidate = `${name.slice(0, 80)} (chuyển giao${n ? ` ${n + 1}` : ""})`;
        name = candidate;
      }
      await ex.execute(sql`UPDATE dh_datahubs SET owner_id = ${to}::uuid, name = ${name}, version = version + 1, updated_at = now(), updated_by = ${actor.userId}::uuid WHERE /*scope:system*/ id = ${r.id as string}::uuid`);
      await ex.execute(sql`DELETE FROM dh_shares WHERE /*scope:system*/ datahub_id = ${r.id as string}::uuid AND grantee_id = ${to}::uuid`);
      await enqueueOutbox(ex, { event: "datahub.structure.changed", aggregateType: "datahub", aggregateId: r.id as string, payload: { datahub_id: r.id, table_id: null, change: "owner_changed" }, requestId: null });
      items.push({ type: "datahub", id: r.id as string, label: name, action: "move" as const });
    }
    return items;
  },
};

registerTransferHandler(datahubTransferHandler);
