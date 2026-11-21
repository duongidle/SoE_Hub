import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Db, Executor } from "@soe/db";
import type { Logger } from "pino";
import { assertRoleOfSet } from "../datahub/column-roles";
import { setShareOptions } from "../datahub/split-ops";
import { addTemplateColumn, createTemplateCore, masterAccess } from "../datahub/template-ops";
import { loadTemplate, systemCtx, workerEmit, type Emit } from "../datahub/template-sync";
import { readSetting, type SettingDef } from "../system/settings-catalog";
import { BUILTIN_DEFAULT_SET, DefaultSetSchema, type DefaultTable, type DefaultTableSchema } from "./default-templates";
import type { z } from "zod";

type Table = z.output<typeof DefaultTableSchema>;

/** The set the Admin edits (module4 3.1): the built-in set until the Admin saves another. A new tree copies the set as it is NOW; trees that exist keep theirs. */
export const DEAL_SETTINGS = {
  defaultTemplates: {
    key: "deal.default_templates",
    label: "Bộ template mặc định của Quản lý Deal",
    description:
      "Danh sách bảng template (cột, công thức, vai trò, khoá phân chia) sinh cho mỗi cây khi Manager mới vào org chart. Sửa chỉ ảnh hưởng cây tạo sau; cây đang chạy sửa ở trang Template. Thứ tự bảng là thứ tự dựng: bảng được công thức đọc phải đứng trước.",
    schema: DefaultSetSchema,
    default: DefaultSetSchema.parse(BUILTIN_DEFAULT_SET),
  } satisfies SettingDef<Table[]>,
} as const;

type Ctx = ReturnType<typeof systemCtx>;

/** Builds one table of the set for a tree: the table, its columns (by the same code as any template column), its split lock and its default view. */
async function buildTable(ctx: Ctx, managerId: string, def: Table): Promise<string> {
  const { id, tableId } = await createTemplateCore(ctx, { name: def.name, kind: def.kind, scope: "tree", managerId, leaderId: null, memberPermission: def.member_permission, roleSet: def.role_set ?? null, actorId: managerId });
  if (def.leader_can_add_columns) await ctx.db.execute(sql`UPDATE dh_templates SET leader_can_add_columns = true WHERE /*scope:system*/ id = ${id}::uuid`);
  const tpl = (await loadTemplate(ctx.db, id))!;
  const acc = await masterAccess(ctx, tpl);
  for (const c of def.columns) {
    if (c.role) {
      const role = assertRoleOfSet(def.role_set ?? null, c.role);
      const shown = c.type === "formula" ? String((c.config as { result_type?: string } | undefined)?.result_type ?? "number") : c.type;
      if (!role.types.includes(shown)) throw new AppError("validation_error", `Bộ mặc định: cột "${c.name}" kiểu ${shown} không đúng vai trò "${role.label}".`);
    }
    await addTemplateColumn(
      ctx,
      tpl,
      acc,
      { name: c.name, type: c.type as never, config: c.config, required: c.required, default_value: c.default_value, description: c.description ?? null, allow_edit: c.allow_edit, layer: c.layer, layer_roles: c.layer_roles, storage: c.storage, role: c.role, autofill: c.autofill },
      null,
    );
  }
  if (def.split) await setShareOptions(ctx, { table_id: tableId, key_split: true, key_columns: def.split.columns, key_primary: def.split.primary ?? def.split.columns[0]!, members_bulk_create: false });
  const hidden = def.columns.filter((c) => c.hidden).map((c) => c.name);
  if (hidden.length) {
    await ctx.db.execute(sql`UPDATE dh_views SET config = jsonb_set(config, '{hidden}', coalesce((SELECT jsonb_agg(c.key) FROM dh_columns c WHERE /*scope:system*/ c.table_id = ${tableId}::uuid AND c.deleted_at IS NULL AND c.name = ANY(${`{${hidden.map((h) => `"${h.replace(/"/g, '\\"')}"`).join(",")}}`}::text[])), '[]'::jsonb))
      WHERE /*scope:system*/ table_id = ${tableId}::uuid AND owner_id IS NULL AND kind = 'grid'`);
  }
  return id;
}

/**
 * The default set for the tree of one Manager. Idempotent: a table whose name the tree already has (any template of that tree, live) is left alone, so a
 * rerun finishes a half-built set and never doubles a table. Returns the names it made.
 */
export async function ensureTreeTemplates(db: Executor, emit: Emit, managerId: string, setOverride?: DefaultTable[]): Promise<string[]> {
  const set = setOverride ? DefaultSetSchema.parse(setOverride) : await readSetting(db, DEAL_SETTINGS.defaultTemplates);
  const ctx = systemCtx(db, emit, managerId);
  const made: string[] = [];
  for (const def of set) {
    const have = await db.execute(sql`SELECT 1 FROM dh_templates WHERE /*scope:system*/ manager_id = ${managerId}::uuid AND scope = 'tree' AND deleted_at IS NULL AND lower(btrim(name)) = lower(btrim(${def.name}))`);
    if (have.rows.length) continue;
    await buildTable(ctx, managerId, def);
    made.push(def.name);
  }
  return made;
}

/** Every active Manager that has no tree templates yet gets the set; `only` limits it to one person. */
export async function ensureAllTrees(db: Db, only?: string): Promise<number> {
  const res = await db.execute(sql`SELECT u.id FROM users u WHERE /*scope:system*/ u.kind = 'person' AND u.status = 'active' AND 'manager' = ANY(u.roles) ${only ? sql`AND u.id = ${only}::uuid` : sql``}
    AND NOT EXISTS (SELECT 1 FROM dh_templates t WHERE t.manager_id = u.id AND t.scope = 'tree')`);
  let n = 0;
  for (const r of res.rows as { id: string }[]) {
    await db.transaction(async (tx) => {
      const emit = workerEmit(tx);
      await ensureTreeTemplates(tx, emit, r.id);
      await emit("org.member.changed", { aggregateType: "user", aggregateId: r.id, payload: { user_id: r.id, change: "default_templates" } });
    });
    n++;
  }
  return n;
}

/**
 * A new Manager in the org chart gets the default set (module4 3.1); an existing tree keeps what it has.
 * Building the set is heavy (several tables in one transaction), so it is NOT an outbox subscriber: the dispatcher handles events one after another, and
 * a build inside it delayed every later event (the activation code notification among them). A loop of its own picks up the Managers without a tree
 * (the query is the queue, so a crash loses nothing) and `ensureAllTrees` emits `org.member.changed` for each, so the template sync shares the new tables with the members.
 */
export function startDealDefaultsLoop(db: Db, log: Logger, intervalMs: number): { stop(): Promise<void> } {
  let stopped = false;
  let busy: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    busy = busy.then(() => ensureAllTrees(db)).catch((err) => log.error({ err }, "deal default templates loop error"));
  }, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await busy;
    },
  };
}
