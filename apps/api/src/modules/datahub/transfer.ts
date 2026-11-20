import { sql } from "drizzle-orm";
import { enqueueOutbox, rowHistory, type FieldChange } from "@soe/db";
import { toActorRef } from "@soe/shared";
import { registerTransferHandler, type TransferHandler } from "../transfer";
import { nextChangeSeq } from "./change-queue";
import { recordChanges, type RowChange } from "./partial";
import { refillRows } from "./pushdown";
import { assertColumnKey } from "./types";

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
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${from}::uuid AND system_key IS NULL ORDER BY created_at`);
    return (res.rows as Raw[]).map((r) => ({ type: "datahub", id: r.id as string, label: `${r.name as string}${r.deleted_at ? " (trong thùng rác)" : ""}`, action: "move" as const }));
  },
  async execute(ex, from, to, _opts, actor) {
    const res = await ex.execute(sql`SELECT id, name, deleted_at FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${from}::uuid AND system_key IS NULL ORDER BY created_at FOR UPDATE`);
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

/** Rows still open: a table with a status column by role (Deals) keeps the old person on rows whose status means closed; others have no condition. */
function closedRowsCondition(statusKey: string | null, closedIds: string[]) {
  if (!statusKey || closedIds.length === 0) return sql`true`;
  return sql`NOT (coalesce(data->>${sql.raw(`'${assertColumnKey(statusKey)}'`)}, '') = ANY(${`{${closedIds.join(",")}}`}::text[]))`;
}

/**
 * Split-lock tables (design module2 section 10, Stage 4.1a): the target of a transfer gets the membership of the source (the same shares) and
 * the tags of the source in the key columns, so the rows of the person who leaves are seen and edited by the person who takes over. Covers the
 * tables the source is a member of, and the split-lock tables of the datahubs that change owner (checked on either owner: handlers run in one
 * transaction and the order of handlers is not part of the contract). Rows are changed like any person's edit: version, history, and the change
 * queue for formulas that read them. Closed deals keep their old person (design module1 section 8): the Deals rules of Stage 4 register what
 * stays; nothing is held back here because Stage 4.1a has no deals yet.
 */
export const splitLockTransferHandler: TransferHandler = {
  key: "datahub_split_membership",
  label: "Thành viên bảng có khoá phân chia",
  async preview(ex, from, to) {
    const res = await ex.execute(sql`SELECT DISTINCT t.id, d.name AS dh, t.name FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope:system*/ t.key_split AND t.deleted_at IS NULL AND d.deleted_at IS NULL
        AND (d.owner_id IN (${from}::uuid, ${to}::uuid) OR EXISTS (SELECT 1 FROM dh_shares s WHERE s.datahub_id = d.id AND s.grantee_id = ${from}::uuid AND (s.table_id IS NULL OR s.table_id = t.id)))`);
    return (res.rows as Raw[]).map((r) => ({ type: "datahub_table", id: r.id as string, label: `${r.dh as string} / ${r.name as string}`, action: "move" as const }));
  },
  async execute(ex, from, to, _opts, actor) {
    const tables = (await ex.execute(sql`SELECT DISTINCT t.id, t.datahub_id, d.name AS dh, t.name, t.key_columns, d.owner_id,
        (SELECT c.key FROM dh_columns c WHERE c.table_id = t.id AND c.role = 'trang_thai' AND t.role_set = 'deals' AND c.deleted_at IS NULL LIMIT 1) AS closed_key,
        (SELECT coalesce(array_agg(o->>'id'), '{}') FROM dh_columns c, jsonb_array_elements(c.config->'options') o
          WHERE c.table_id = t.id AND c.role = 'trang_thai' AND t.role_set = 'deals' AND c.deleted_at IS NULL AND coalesce(o->>'meaning', 'open') <> 'open') AS closed_ids
      FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope:system*/ t.key_split AND t.deleted_at IS NULL AND d.deleted_at IS NULL
        AND (d.owner_id IN (${from}::uuid, ${to}::uuid) OR EXISTS (SELECT 1 FROM dh_shares s WHERE s.datahub_id = d.id AND s.grantee_id = ${from}::uuid AND (s.table_id IS NULL OR s.table_id = t.id)))`)).rows as Raw[];
    const items = [];
    for (const t of tables) {
      // 1. membership: the target gets the source's share (the higher permission wins); the owner needs none
      if (t.owner_id !== to) {
        await ex.execute(sql`INSERT INTO dh_shares (id, datahub_id, table_id, grantee_id, permission, created_by)
          SELECT gen_random_uuid(), s.datahub_id, s.table_id, ${to}::uuid, s.permission, ${actor.userId}::uuid FROM dh_shares s
          WHERE /*scope:system*/ s.datahub_id = ${t.datahub_id as string}::uuid AND s.grantee_id = ${from}::uuid AND (s.table_id IS NULL OR s.table_id = ${t.id as string}::uuid)
          ON CONFLICT DO NOTHING`);
        await ex.execute(sql`UPDATE dh_shares s SET permission = 'edit_data', updated_at = now() WHERE /*scope:system*/ s.grantee_id = ${to}::uuid AND s.datahub_id = ${t.datahub_id as string}::uuid AND (s.table_id IS NULL OR s.table_id = ${t.id as string}::uuid)
          AND EXISTS (SELECT 1 FROM dh_shares f WHERE f.datahub_id = s.datahub_id AND f.grantee_id = ${from}::uuid AND f.permission = 'edit_data' AND (f.table_id IS NULL OR f.table_id = ${t.id as string}::uuid))`);
      }
      // 2. tags: the source's name in the key columns becomes the target's
      const actorRef = toActorRef(actor);
      const moved: RowChange[] = [];
      for (const k of (t.key_columns as string[]) ?? []) {
        assertColumnKey(k);
        // The cell holds one person (a uuid string) or a list with attributes: the source's entry becomes the target's; when the target is already in
        // the list the source's entry is dropped (one entry per person). Closed deals keep their old person (module1 section 8).
        const cell = sql.raw(`data->'${k}'`);
        const closed = closedRowsCondition(t.closedKey as string | null, t.closedIds as string[]);
        const res = await ex.execute(sql`UPDATE dh_rows SET data = jsonb_set(data, ARRAY[${k}::text], CASE
              WHEN jsonb_typeof(${cell}) = 'string' THEN to_jsonb(${to}::text)
              WHEN ${to} = ANY(soe_dh_ids(${cell})) THEN coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(${cell}) e WHERE e->>'id' <> ${from}), '[]'::jsonb)
              ELSE (SELECT jsonb_agg(CASE WHEN e->>'id' = ${from} THEN jsonb_set(e, '{id}', to_jsonb(${to}::text)) ELSE e END) FROM jsonb_array_elements(${cell}) e) END),
            version = version + 1, updated_at = now(), updated_by = ${actor.userId}::uuid
          WHERE /*scope:system*/ table_id = ${t.id as string}::uuid AND deleted_at IS NULL AND ${from} = ANY(soe_dh_ids(${cell})) AND ${closed}
          RETURNING id, version, data`);
        const rows = res.rows as { id: string; version: number; data: Record<string, unknown> }[];
        if (rows.length === 0) continue;
        const changes: FieldChange[] = [{ field: k, old: from, new: to }];
        for (let i = 0; i < rows.length; i += 1000) {
          await ex.insert(rowHistory).values(rows.slice(i, i + 1000).map((r) => ({ tableId: t.id as string, rowId: r.id, version: r.version, op: "update", changes, actor: actorRef })));
        }
        for (const r of rows) moved.push({ rowId: r.id, kind: "update", old: { ...r.data, [k]: from }, new: r.data });
      }
      if (moved.length) {
        // The people of these rows changed: "gửi xuống" refills what each person reads (rows are the ones just written).
        const changedRows = new Map<string, Record<string, unknown>>();
        for (const m of moved) changedRows.set(m.rowId, m.new as Record<string, unknown>);
        await refillRows(ex, t.id as string, [...changedRows].map(([id, data]) => ({ id, data: data as never })));
        const seq = await nextChangeSeq(ex);
        await recordChanges(ex, t.id as string, moved, seq);
        const ids = [...new Set(moved.map((m) => m.rowId))];
        for (let i = 0; i < ids.length; i += 500) {
          await enqueueOutbox(ex, { event: "datahub.row.updated", aggregateType: "datahub_table", aggregateId: t.id as string, payload: { table_id: t.id, row_ids: ids.slice(i, i + 500), columns: t.key_columns, seq, key_users: [from, to] }, requestId: null });
        }
      }
      items.push({ type: "datahub_table", id: t.id as string, label: `${t.dh as string} / ${t.name as string}`, action: "move" as const });
    }
    return items;
  },
};

registerTransferHandler(splitLockTransferHandler);
