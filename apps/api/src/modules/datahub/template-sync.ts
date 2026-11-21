import { sql, type SQL } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import { newId, type Db, type Executor } from "@soe/db";
import { enqueueOutbox, SYSTEM_USER_ID } from "@soe/db";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess } from "./access";
import { createColumn, deleteColumn, restoreColumn, type ColumnExtra } from "./columns";
import { columnFromDb } from "./table-schema";
import { displayConfig, OwnerIndex } from "./computed";
import { isComputedType } from "./cell-values";
import { STRUCTURE_EVENT } from "./shared";
import { columnTx } from "./change-queue";

type Raw = Record<string, unknown>;

/** The outbox call of a command (`ctx.emit`) or of the worker (`enqueueOutbox`), so the same sync code runs in both. */
export type Emit = (event: string, input: { aggregateType?: string; aggregateId?: string; payload: Record<string, unknown> }) => Promise<void>;
type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;

export const TEMPLATE_CONFLICT_EVENT = "datahub.template.conflict";

/** One template table (`dh_templates`): see the schema comment. */
export interface Template {
  id: string;
  kind: "shared" | "personal";
  scope: "tree" | "team";
  managerId: string;
  leaderId: string | null;
  name: string;
  masterTableId: string | null;
  memberPermission: "view" | "edit_data";
  leaderCanAddColumns: boolean;
  roleSet: string | null;
  deleted: boolean;
  version: number;
}

export function templateFromDb(r: Raw): Template {
  return {
    id: r.id as string,
    kind: r.kind as Template["kind"],
    scope: r.scope as Template["scope"],
    managerId: r.manager_id as string,
    leaderId: (r.leader_id as string | null) ?? null,
    name: r.name as string,
    masterTableId: (r.master_table_id as string | null) ?? null,
    memberPermission: r.member_permission as Template["memberPermission"],
    leaderCanAddColumns: !!r.leader_can_add_columns,
    roleSet: (r.role_set as string | null) ?? null,
    deleted: !!r.deleted_at,
    version: r.version as number,
  };
}

export async function loadTemplate(db: Executor, id: string, opts: { withDeleted?: boolean } = {}): Promise<Template | null> {
  const res = await db.execute(sql`SELECT * FROM dh_templates WHERE /*scope:system*/ id = ${id}::uuid ${opts.withDeleted ? sql`` : sql`AND deleted_at IS NULL`}`);
  return res.rows[0] ? templateFromDb(res.rows[0] as Raw) : null;
}

export const workerEmit = (db: Executor): Emit => async (event, input) => {
  await enqueueOutbox(db as never, { event, aggregateType: input.aggregateType ?? null, aggregateId: input.aggregateId ?? null, payload: input.payload, requestId: null, coalesce: event === STRUCTURE_EVENT });
};

/** A context that acts as the system (the worker, the template commands writing on behalf of an owner): `userId` is the person whose rights the table access is built with. */
export function systemCtx(db: Executor, emit: Emit, userId: string): Ctx {
  const actor: Actor = { userId, via: "worker", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "soe-template-sync" };
  return { db, actor, emit: emit as Ctx["emit"], audit: () => undefined, requestId: "template-sync" };
}

// ================================================================================================
// names: a template table or column takes the name, the person's own object gives way (design module4 3.1, 3.5)
// ================================================================================================

/** `<name> (riêng)`, `<name> (riêng 2)`... the first one nobody uses in `taken`. */
async function freeName(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  const cut = base.length > 80 ? base.slice(0, 80) : base;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${cut} (riêng)` : `${cut} (riêng ${n})`;
    if (!(await taken(candidate))) return candidate;
  }
}

const tell = (emit: Emit, tpl: { id: string; name: string }, userId: string, p: { object: "table" | "column" | "datahub"; old_name: string; new_name: string; table_name?: string }) =>
  emit(TEMPLATE_CONFLICT_EVENT, { aggregateType: "datahub_template", aggregateId: tpl.id, payload: { recipient_id: userId, template_name: tpl.name, ...p } });

/** The person's own tables of the datahub "Quản lý Deal" that carry the name of a template table give way: renamed `<tên> (riêng)`, the person is told. Returns how many. */
export async function renameOwnTablesTaking(db: Executor, emit: Emit, tpl: { id: string; name: string }, userId: string, datahubId: string): Promise<number> {
  const res = await db.execute(sql`SELECT id, name FROM dh_tables WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL AND template_id IS NULL AND name_norm = lower(btrim(${tpl.name}))`);
  let n = 0;
  for (const t of res.rows as { id: string; name: string }[]) {
    const next = await freeName(t.name, async (c) => (await db.execute(sql`SELECT 1 FROM dh_tables WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL AND name_norm = lower(btrim(${c}))`)).rows.length > 0);
    await db.execute(sql`UPDATE dh_tables SET name = ${next}, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${t.id}::uuid`);
    await emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: t.id, payload: { datahub_id: datahubId, table_id: t.id, change: "table_updated" } });
    await tell(emit, tpl, userId, { object: "table", old_name: t.name, new_name: next });
    n++;
  }
  return n;
}

/** Custom columns (of one person, or of everyone) that carry the name of a template column give way. `names` = the template column names to look for. */
export async function renameCustomColumnsTaking(db: Executor, emit: Emit, tpl: { id: string; name: string }, tableId: string, datahubId: string, tableName: string, names: string[]): Promise<number> {
  if (names.length === 0) return 0;
  const res = await db.execute(sql`SELECT id, name, layer_ref FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND layer = 'custom' AND name_norm = ANY(${`{${names.map((x) => `"${x.trim().toLowerCase().replace(/(["\\])/g, "\\$1")}"`).join(",")}}`}::text[])`);
  let n = 0;
  for (const c of res.rows as { id: string; name: string; layer_ref: string }[]) {
    const next = await freeName(c.name, async (cand) => {
      const own = await db.execute(sql`SELECT 1 FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND name_norm = lower(btrim(${cand})) AND (layer IS DISTINCT FROM 'custom' OR layer_ref = ${c.layer_ref}::uuid)`);
      return own.rows.length > 0;
    });
    await db.execute(sql`UPDATE dh_columns SET name = ${next}, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${c.id}::uuid`);
    await tell(emit, tpl, c.layer_ref, { object: "column", old_name: c.name, new_name: next, table_name: tableName });
    n++;
  }
  if (n) await emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: tableId, payload: { datahub_id: datahubId, table_id: tableId, change: "column_updated" } });
  return n;
}

// ================================================================================================
// who is in a template's scope (design module4 3.5: the organization tree decides)
// ================================================================================================

const MEMBER_ROLES = "{manager,leader,user}";

/**
 * The people a template reaches, by the CURRENT organization tree (Admin and Guest never get a Quản lý Deal): a tree template = everyone under the
 * Manager (the Manager included); a team template = the Leader and the people whose Leader they are, plus the Leader's Manager who only views.
 */
export async function scopeMembers(db: Executor, t: Pick<Template, "scope" | "managerId" | "leaderId">): Promise<{ id: string; viewOnly: boolean }[]> {
  if (t.scope === "tree") {
    const res = await db.execute(sql`SELECT m.user_id AS id FROM org_memberships m JOIN users u ON u.id = m.user_id
      WHERE /*scope:system*/ m.valid_to IS NULL AND m.manager_id = ${t.managerId}::uuid AND u.kind = 'person' AND u.status <> 'locked' AND u.roles && ${MEMBER_ROLES}::text[]`);
    return (res.rows as { id: string }[]).map((r) => ({ id: r.id, viewOnly: false }));
  }
  const res = await db.execute(sql`SELECT u.id, false AS view_only FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
      WHERE /*scope:system*/ u.kind = 'person' AND u.status <> 'locked' AND u.roles && ${MEMBER_ROLES}::text[] AND (u.id = ${t.leaderId}::uuid OR m.leader_id = ${t.leaderId}::uuid)
    UNION
    SELECT mg.manager_id AS id, true AS view_only FROM org_memberships mg JOIN users u ON u.id = mg.manager_id
      WHERE /*scope:system*/ mg.valid_to IS NULL AND mg.user_id = ${t.leaderId}::uuid AND mg.manager_id <> mg.user_id AND u.kind = 'person' AND u.status <> 'locked'`);
  const out = new Map<string, boolean>();
  for (const r of res.rows as { id: string; view_only: boolean }[]) out.set(r.id, (out.get(r.id) ?? true) && r.view_only);
  return [...out].map(([id, viewOnly]) => ({ id, viewOnly }));
}

/** The person's datahub "Quản lý Deal", made when missing. Their own datahub that already carries the name gives way (renamed `(riêng)`, they are told). */
export async function ensureDealDatahub(db: Executor, emit: Emit, userId: string, tpl?: { id: string; name: string }): Promise<string> {
  const have = await db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${userId}::uuid AND system_key = 'deal' AND deleted_at IS NULL`);
  if (have.rows[0]) return (have.rows[0] as { id: string }).id;
  const NAME = "Quản lý Deal";
  const clash = await db.execute(sql`SELECT id, name FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${userId}::uuid AND deleted_at IS NULL AND name_norm = lower(btrim(${NAME}))`);
  for (const d of clash.rows as { id: string; name: string }[]) {
    const next = await freeName(d.name, async (c) => (await db.execute(sql`SELECT 1 FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${userId}::uuid AND deleted_at IS NULL AND name_norm = lower(btrim(${c}))`)).rows.length > 0);
    await db.execute(sql`UPDATE dh_datahubs SET name = ${next}, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${d.id}::uuid`);
    await tell(emit, tpl ?? { id: d.id, name: NAME }, userId, { object: "datahub", old_name: d.name, new_name: next });
  }
  const id = newId();
  await db.execute(sql`INSERT INTO dh_datahubs (id, owner_id, name, system_key, created_by, updated_by) VALUES (${id}::uuid, ${userId}::uuid, ${NAME}, 'deal', ${SYSTEM_USER_ID}::uuid, ${SYSTEM_USER_ID}::uuid)`);
  await emit("datahub.structure.changed", { aggregateType: "datahub", aggregateId: id, payload: { datahub_id: id, table_id: null, change: "datahub_created" } });
  return id;
}

// ================================================================================================
// the sync
// ================================================================================================

/** The same pieces `datahub.table.create` writes: the table row and its first shared grid view. */
export async function insertTemplateTable(db: Executor, o: { datahubId: string; name: string; templateId: string; userId: string | null; roleSet: string | null; actorId: string }): Promise<string> {
  const id = newId();
  const pos = await db.execute(sql`SELECT coalesce(max(position), -1) + 1 AS next FROM dh_tables WHERE /*scope:system*/ datahub_id = ${o.datahubId}::uuid AND deleted_at IS NULL`);
  await db.execute(sql`INSERT INTO dh_tables (id, datahub_id, name, position, protected, template_id, template_user_id, role_set, members_bulk_create, created_by, updated_by)
    VALUES (${id}::uuid, ${o.datahubId}::uuid, ${o.name}, ${(pos.rows[0] as { next: number }).next}::int, true, ${o.templateId}::uuid, ${o.userId}::uuid, ${o.roleSet}, false, ${o.actorId}::uuid, ${o.actorId}::uuid)`);
  await db.execute(sql`INSERT INTO dh_views (id, table_id, owner_id, name, kind, position, config, created_by, updated_by) VALUES (${newId()}::uuid, ${id}::uuid, NULL, 'Dạng bảng', 'grid', 0, '{}'::jsonb, ${o.actorId}::uuid, ${o.actorId}::uuid)`);
  return id;
}

/**
 * Makes the copy of a PERSONAL template follow its master column by column (module4 3.5, "mỗi người một bảng cùng cấu trúc"): a column of the master
 * the copy lacks is created, one that changed is updated, one the master archived is archived (and back). Columns are matched by `template_column_id`.
 * A formula is written with names (the display form) so it resolves in the copy's own columns. `only` limits the work to some master columns.
 */
export async function syncCopyColumns(ctx: Ctx, tpl: Template, master: { id: string; datahubId: string }, copy: { id: string; ownerId: string }, only?: Set<string>): Promise<void> {
  const db = ctx.db;
  const cctx = systemCtx(db, ctx.emit as Emit, copy.ownerId);
  const acc = await loadTableAccess(cctx, copy.id, "owner");
  const ownerIx = await OwnerIndex.load(db, master.datahubId ? (await ownerOfDatahub(db, master.datahubId)) : copy.ownerId);
  const masterRes = await db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ table_id = ${master.id}::uuid AND layer IN ('basic', 'role', 'team') ORDER BY position, created_at, id`);
  const copyRes = await db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ table_id = ${copy.id}::uuid AND template_column_id IS NOT NULL`);
  const copyBy = new Map((copyRes.rows as Raw[]).map((r) => [r.template_column_id as string, columnFromDb(r)]));
  const mine = new Set<string>();
  for (const mc of (masterRes.rows as Raw[]).map(columnFromDb)) {
    mine.add(mc.id);
    if (only && !only.has(mc.id)) continue;
    const cc = copyBy.get(mc.id);
    const config = isComputedType(mc.type) ? displayConfig({ type: mc.type, config: mc.config, tableId: mc.tableId }, ownerIx) : mc.config;
    const extra: ColumnExtra = { layer: mc.layer as "basic" | "role" | "team", layerRef: mc.layerRef, layerRoles: mc.layerRoles, storage: mc.storage, role: mc.role, templateColumnId: mc.id, protectedColumn: true };
    if (!cc) {
      if (mc.deletedAt) continue;
      // A template column takes the name: the person's own column of that name gives way first.
      await renameCustomColumnsTaking(db, ctx.emit as Emit, { id: tpl.id, name: tpl.name }, copy.id, acc.datahub.id, tpl.name, [mc.name]);
      await createColumn(cctx, acc, { name: mc.name, type: mc.type, config, required: mc.required, unique: mc.isUnique, default_value: mc.defaultValue ?? undefined, description: mc.description, display: mc.display, position: mc.position, allow_edit: mc.allowEdit }, extra);
      continue;
    }
    if (mc.deletedAt && !cc.deletedAt) {
      await deleteColumn(cctx, acc, cc);
      continue;
    }
    if (!mc.deletedAt && cc.deletedAt) await restoreColumn(cctx, acc, cc, undefined);
    if (mc.deletedAt) continue;
    if (cc.name !== mc.name) await renameCustomColumnsTaking(db, ctx.emit as Emit, { id: tpl.id, name: tpl.name }, copy.id, acc.datahub.id, tpl.name, [mc.name]);
    // Everything but the type and the computation is plain data on the column row; a formula is rewritten through its names.
    await db.execute(sql`UPDATE dh_columns SET name = ${mc.name}, required = ${mc.required}, allow_edit = ${mc.allowEdit}, description = ${mc.description}, display = ${JSON.stringify(mc.display)}::jsonb, position = ${mc.position}::int,
        default_value = ${mc.defaultValue === null || mc.defaultValue === undefined ? null : JSON.stringify(mc.defaultValue)}::jsonb, layer = ${mc.layer}, layer_ref = ${mc.layerRef}::uuid, layer_roles = ${mc.layerRoles ? `{${mc.layerRoles.join(",")}}` : null}::text[],
        role = ${mc.role}, storage = ${mc.storage}, config = CASE WHEN type IN ('formula', 'lookup', 'rollup', 'relation') THEN config ELSE ${JSON.stringify(config)}::jsonb END,
        version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${cc.id}::uuid`);
  }
  // A column of the copy whose master column is gone for good.
  for (const [mid, cc] of copyBy) if (!mine.has(mid) && !cc.deletedAt) await deleteColumn(cctx, acc, cc);
  await ctx.emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: copy.id, payload: { datahub_id: acc.datahub.id, table_id: copy.id, change: "column_updated" } });
}

async function ownerOfDatahub(db: Executor, datahubId: string): Promise<string> {
  const res = await db.execute(sql`SELECT owner_id FROM dh_datahubs WHERE /*scope:system*/ id = ${datahubId}::uuid`);
  return (res.rows[0] as { owner_id: string }).owner_id;
}

interface MasterRef {
  id: string;
  datahubId: string;
  ownerId: string;
  name: string;
}

async function loadMaster(db: Executor, tableId: string): Promise<MasterRef | null> {
  const res = await db.execute(sql`SELECT t.id, t.datahub_id, t.name, d.owner_id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid AND t.deleted_at IS NULL`);
  const r = res.rows[0] as Raw | undefined;
  return r ? { id: r.id as string, datahubId: r.datahub_id as string, ownerId: r.owner_id as string, name: r.name as string } : null;
}

export interface SyncResult {
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Brings the people of a template to match the organization tree now. SHARED: the table is the owner's; the people in scope are members through
 * automatic shares (`dh_shares.auto`), a person who left loses theirs (the table is hidden, their values are kept; coming back shows it again).
 * PERSONAL: everyone in scope has a copy in their datahub "Quản lý Deal" (the owner's own copy is the master); a person who left has theirs
 * archived (hidden and kept), one who came back gets it back. A person's own table of the same name gives way. Runs in the command that changed
 * the template and again in the worker on every change of the organization tree (`org.member.changed`).
 */
export async function syncTemplate(ctx: Ctx, templateId: string): Promise<SyncResult> {
  const out: SyncResult = { added: [], removed: [], changed: [] };
  const db = ctx.db;
  const emit = ctx.emit as Emit;
  const tpl = await loadTemplate(db, templateId);
  if (!tpl || !tpl.masterTableId) return out;
  const master = await loadMaster(db, tpl.masterTableId);
  if (!master) return out;
  const members = (await scopeMembers(db, tpl)).filter((m) => m.id !== master.ownerId);
  if (tpl.kind === "shared") {
    const want = new Map(members.map((m) => [m.id, m.viewOnly ? "view" : tpl.memberPermission]));
    const have = await db.execute(sql`SELECT id, grantee_id, permission, auto FROM dh_shares WHERE /*scope:system*/ table_id = ${master.id}::uuid`);
    const haveBy = new Map((have.rows as { id: string; grantee_id: string; permission: string; auto: boolean }[]).map((r) => [r.grantee_id, r]));
    const shareChanged = (grantee: string) => emit("datahub.share.changed", { aggregateType: "datahub", aggregateId: master.datahubId, payload: { datahub_id: master.datahubId, table_id: master.id, grantee_id: grantee } });
    for (const [uid, perm] of want) {
      const cur = haveBy.get(uid);
      if (!cur) {
        await db.execute(sql`INSERT INTO dh_shares (id, datahub_id, table_id, grantee_id, permission, auto, created_by) VALUES (${newId()}::uuid, ${master.datahubId}::uuid, ${master.id}::uuid, ${uid}::uuid, ${perm}, true, ${SYSTEM_USER_ID}::uuid)`);
        out.added.push(uid);
        await shareChanged(uid);
      } else if (cur.auto && cur.permission !== perm) {
        await db.execute(sql`UPDATE dh_shares SET permission = ${perm}, updated_at = now() WHERE /*scope:system*/ id = ${cur.id}::uuid`);
        out.changed.push(uid);
        await shareChanged(uid);
      }
    }
    for (const [uid, cur] of haveBy) {
      if (cur.auto && !want.has(uid)) {
        await db.execute(sql`DELETE FROM dh_shares WHERE /*scope:system*/ id = ${cur.id}::uuid`);
        out.removed.push(uid);
        await shareChanged(uid);
      }
    }
    // A person's own table of the datahub "Quản lý Deal" that takes the template's name gives way.
    for (const m of members) {
      const dh = await db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${m.id}::uuid AND system_key = 'deal' AND deleted_at IS NULL`);
      if (dh.rows[0]) await renameOwnTablesTaking(db, emit, tpl, m.id, (dh.rows[0] as { id: string }).id);
    }
    return out;
  }
  // ---- personal
  const people = members.filter((m) => !m.viewOnly);
  const wantIds = new Set(people.map((m) => m.id));
  const copies = await db.execute(sql`SELECT t.id, t.template_user_id, t.archived, t.deleted_at, t.name FROM dh_tables t WHERE /*scope:system*/ t.template_id = ${tpl.id}::uuid AND t.template_user_id IS NOT NULL AND t.id <> ${master.id}::uuid`);
  const copyBy = new Map((copies.rows as { id: string; template_user_id: string; archived: boolean; deleted_at: Date | null; name: string }[]).map((r) => [r.template_user_id, r]));
  for (const p of people) {
    const cur = copyBy.get(p.id);
    const dhId = await ensureDealDatahub(db, emit, p.id, tpl);
    if (!cur) {
      await renameOwnTablesTaking(db, emit, tpl, p.id, dhId);
      const id = await insertTemplateTable(db, { datahubId: dhId, name: tpl.name, templateId: tpl.id, userId: p.id, roleSet: tpl.roleSet, actorId: SYSTEM_USER_ID });
      await syncCopyColumns(ctx, tpl, master, { id, ownerId: p.id });
      await emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: id, payload: { datahub_id: dhId, table_id: id, change: "table_created" } });
      out.added.push(p.id);
    } else if (cur.archived) {
      await renameOwnTablesTaking(db, emit, tpl, p.id, dhId);
      await db.execute(sql`UPDATE dh_tables SET archived = false, deleted_at = NULL, deleted_by = NULL, name = ${tpl.name}, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${cur.id}::uuid`);
      await syncCopyColumns(ctx, tpl, master, { id: cur.id, ownerId: p.id });
      await emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: cur.id, payload: { datahub_id: dhId, table_id: cur.id, change: "table_restored" } });
      out.added.push(p.id);
    } else {
      await syncCopyColumns(ctx, tpl, master, { id: cur.id, ownerId: p.id });
    }
  }
  for (const [uid, cur] of copyBy) {
    if (wantIds.has(uid) || cur.archived) continue;
    await db.execute(sql`UPDATE dh_tables SET archived = true, deleted_at = now(), deleted_by = ${SYSTEM_USER_ID}::uuid, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${cur.id}::uuid`);
    const dh = await db.execute(sql`SELECT datahub_id FROM dh_tables WHERE /*scope:system*/ id = ${cur.id}::uuid`);
    await emit("datahub.structure.changed", { aggregateType: "datahub_table", aggregateId: cur.id, payload: { datahub_id: (dh.rows[0] as { datahub_id: string }).datahub_id, table_id: cur.id, change: "table_deleted" } });
    out.removed.push(uid);
  }
  return out;
}

/**
 * Syncs every live template (the organization tree changed). One transaction per template, so a template that fails does not roll back or hold
 * back the others; the failures are logged with their ids and raised together at the end, so the outbox retries the event.
 */
export async function syncAllTemplates(db: Db, log?: { error: (o: object, m: string) => void }): Promise<number> {
  const ids = await db.execute(sql`SELECT id FROM dh_templates WHERE /*scope:system*/ deleted_at IS NULL AND master_table_id IS NOT NULL ORDER BY created_at`);
  const failed: string[] = [];
  let n = 0;
  for (const r of ids.rows as { id: string }[]) {
    try {
      await columnTx(db, async (tx) => {
        await syncTemplate(systemCtx(tx as Executor, workerEmit(tx as Executor), SYSTEM_USER_ID), r.id);
      });
      n++;
    } catch (e) {
      failed.push(r.id);
      log?.error({ template_id: r.id, err: e instanceof Error ? e.message : String(e) }, "template sync failed");
    }
  }
  if (failed.length) throw new Error(`Đồng bộ template lỗi ở ${failed.length} template: ${failed.join(", ")}`);
  return n;
}

/** Condition helper: the live tables of the templates a person is in the scope of (used by name checks). */
export const templateTablesNamed = (name: string): SQL => sql`template_id IS NOT NULL AND deleted_at IS NULL AND name_norm = lower(btrim(${name}))`;

