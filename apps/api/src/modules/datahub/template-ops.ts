import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, COLUMN_TYPES, DhNameSchema, type Role } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { Subscriber } from "../../core/outbox-dispatcher";
import type { HandlerCtx } from "../../core/types";
import type { Principal } from "../../auth/access";
import { loadTableAccess, type TableAccess } from "./access";
import { isComputedType } from "./cell-values";
import { columnTypeDef } from "./column-types";
import { changeColumnType, createColumn, deleteColumn, restoreColumn, updateColumn, type ColumnExtra } from "./columns";
import { assertRoleOfSet, columnUsage, fitsRole, ROLE_SETS, type ColumnUsage } from "./column-roles";
import { rethrowNameConflict } from "./errors";
import { DH_SETTINGS, quotaExceeded } from "./limits";
import { Id, STRUCTURE_EVENT } from "./shared";
import { columnOut, ColumnOut, indexFor, tablesOf } from "./structure";
import { columnFromDb, TableSchema } from "./table-schema";
import { ensureDealDatahub, insertTemplateTable, loadTemplate, templateFromDb, renameCustomColumnsTaking, renameOwnTablesTaking, scopeMembers, syncAllTemplates, syncCopyColumns, syncTemplate, systemCtx, TEMPLATE_CONFLICT_EVENT, type Emit, type Template } from "./template-sync";
import { readSetting } from "../system/settings-catalog";
import type { Autofill, DhColumn } from "./types";
import { refillRows } from "./pushdown";
import { userAttrs } from "./user-values";

type Raw = Record<string, unknown>;
type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId" | "access">;
/** What the template code that needs no principal uses (the default set of a new tree runs it as the Manager, without a request). */
type CoreCtx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;

const EMITS = [STRUCTURE_EVENT, "datahub.share.changed", TEMPLATE_CONFLICT_EVENT];

// ================================================================================================
// who may do what (design module4 3.1, 3.5, 3.8): Manager for the tree, Leader for the team; Admin has no say (no business permissions)
// ================================================================================================

const has = (p: Principal, r: Role) => p.roles.includes(r);

/** Admin and Manager edit every layer of a template of their tree; a Leader the templates of their own team. */
function canEditTemplate(p: Principal, t: Template): boolean {
  if (t.scope === "tree") return has(p, "manager") && p.userId === t.managerId;
  return (has(p, "manager") && p.userId === t.managerId) || (has(p, "leader") && p.userId === t.leaderId);
}

/** May this person add or change a column of this layer in this template? `team` columns: the Manager, or the Leader of that team when the table lets Leaders add columns. */
function canEditLayer(p: Principal, t: Template, layer: "basic" | "role" | "team", teamLeader: string | null): boolean {
  if (layer === "team") return t.scope === "tree" && (canEditTemplate(p, t) || (has(p, "leader") && p.userId === teamLeader && t.leaderCanAddColumns));
  return canEditTemplate(p, t);
}

function notAllowed(what: string): never {
  throw new AppError("forbidden", `Bạn không có quyền ${what}.`, { reason: "template_forbidden" });
}

async function loadEditable(ctx: Ctx, templateId: string, opts: { withDeleted?: boolean } = {}): Promise<{ tpl: Template; p: Principal }> {
  const p = await ctx.access.requirePrincipal();
  const tpl = await loadTemplate(ctx.db, templateId, opts);
  // A template of another tree does not exist for you.
  const visible = tpl && (tpl.managerId === p.managerId || tpl.managerId === p.userId || (tpl.leaderId !== null && (tpl.leaderId === p.userId || tpl.leaderId === p.leaderId)));
  if (!tpl || !visible) throw new AppError("not_found", "Không tìm thấy template.");
  return { tpl, p };
}

/** The master table as its OWNER sees it: the template commands change the template on the owner's behalf, so every layer is in view. */
async function masterAccess(ctx: CoreCtx, tpl: Template): Promise<TableAccess> {
  const res = await ctx.db.execute(sql`SELECT d.owner_id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tpl.masterTableId!}::uuid`);
  const owner = (res.rows[0] as { owner_id: string }).owner_id;
  return loadTableAccess(systemCtx(ctx.db, ctx.emit as Emit, owner), tpl.masterTableId!, "owner");
}

async function copiesOf(db: Executor, tpl: Template): Promise<{ id: string; ownerId: string }[]> {
  const res = await db.execute(sql`SELECT t.id, t.template_user_id FROM dh_tables t WHERE /*scope:system*/ t.template_id = ${tpl.id}::uuid AND t.template_user_id IS NOT NULL AND t.id <> ${tpl.masterTableId!}::uuid AND t.deleted_at IS NULL`);
  return (res.rows as { id: string; template_user_id: string }[]).map((r) => ({ id: r.id, ownerId: r.template_user_id }));
}

// ================================================================================================
// output
// ================================================================================================

const TemplateOut = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["shared", "personal"]).describe("`shared` = một bảng chung, khoá phân chia quyết định dòng; `personal` = mỗi người một bảng cùng cấu trúc."),
  scope: z.enum(["tree", "team"]).describe("`tree` = cả cây của Manager; `team` = team của một Leader."),
  manager_id: Id,
  leader_id: Id.nullable(),
  master_table_id: Id.nullable().describe("Bảng giữ định nghĩa template (của người tạo)."),
  my_table_id: Id.nullable().describe("Bảng của bạn thuộc template này (bảng chung nếu bạn là thành viên, hoặc bản của bạn với bảng riêng)."),
  member_permission: z.enum(["view", "edit_data"]),
  leader_can_add_columns: z.boolean(),
  role_set: z.string().nullable(),
  can_edit: z.boolean().describe("Bạn sửa được template này."),
  archived: z.boolean(),
  members: z.number().int().describe("Số người nhận template (theo cây hiện tại)."),
});

async function templateOut(ctx: Ctx, p: Principal, t: Template): Promise<z.infer<typeof TemplateOut>> {
  const members = await scopeMembers(ctx.db, t);
  let mine: string | null = null;
  if (t.masterTableId) {
    const res = await ctx.db.execute(sql`SELECT t.id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.template_id = ${t.id}::uuid AND t.deleted_at IS NULL AND (
      (${t.kind} = 'shared' AND t.id = ${t.masterTableId}::uuid AND (d.owner_id = ${p.userId}::uuid OR EXISTS (SELECT 1 FROM dh_shares s WHERE s.table_id = t.id AND s.grantee_id = ${p.userId}::uuid)))
      OR (${t.kind} = 'personal' AND t.template_user_id = ${p.userId}::uuid)) LIMIT 1`);
    mine = (res.rows[0] as { id: string } | undefined)?.id ?? null;
  }
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    scope: t.scope,
    manager_id: t.managerId,
    leader_id: t.leaderId,
    master_table_id: t.masterTableId,
    my_table_id: mine,
    member_permission: t.memberPermission,
    leader_can_add_columns: t.leaderCanAddColumns,
    role_set: t.roleSet,
    can_edit: canEditTemplate(p, t),
    archived: t.deleted,
    members: members.length,
  };
}

const UsageOut = z.object({
  role: z.object({ key: z.string(), label: z.string(), used_by: z.array(z.string()) }).nullable(),
  formulas: z.array(z.object({ table_id: Id, table_name: z.string(), column_id: Id, column_name: z.string() })),
  views: z.array(z.object({ view_id: Id, view_name: z.string() })),
  metrics: z.array(z.object({ metric_id: Id, metric_name: z.string() })),
  dashboards: z.array(z.object({ dashboard_id: Id, dashboard_name: z.string() })),
  key_column: z.boolean(),
});

async function usageOf(ctx: Ctx, acc: TableAccess, col: DhColumn): Promise<ColumnUsage> {
  return columnUsage(ctx.db, acc.tableId, col, acc.table.roleSet, acc.table.split.keys);
}

// ================================================================================================
// roles
// ================================================================================================

/** After a change to a column that holds a role it must still act as a type the role needs (design module4 3.7: never a role without a column). */
async function assertRoleStillFits(ctx: Ctx, acc: TableAccess, columnId: string): Promise<void> {
  const res = await ctx.db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ id = ${columnId}::uuid`);
  const col = columnFromDb(res.rows[0] as Raw);
  if (!col.role) return;
  const def = assertRoleOfSet(acc.table.roleSet, col.role);
  if (!fitsRole(col, def)) {
    throw new AppError("conflict", `Cột "${col.name}" đang giữ vai trò "${def.label}" nên phải là kiểu ${def.types.join(" / ")}. Chuyển vai trò sang cột khác đúng kiểu trước.`, { reason: "role_type", role: col.role, column: col.name });
  }
}

// ================================================================================================
// commands
// ================================================================================================

const ColumnFields = {
  name: DhNameSchema,
  type: z.enum(COLUMN_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  default_value: z.unknown().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  display: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  allow_edit: z.boolean().optional().describe("Thành viên có quyền Sửa có được sửa ô của cột này không (mặc định không, với cột template)."),
};

/** The body of `datahub.template.create` after the checks; the default template set of a new tree calls it as the Manager of that tree (no principal needed). */
export async function createTemplateCore(
  ctx: CoreCtx,
  o: { name: string; kind: "shared" | "personal"; scope: "tree" | "team"; managerId: string; leaderId: string | null; memberPermission: "view" | "edit_data"; roleSet: string | null; actorId: string },
): Promise<{ id: string; tableId: string }> {
  const id = newId();
  try {
    await ctx.db.execute(sql`INSERT INTO dh_templates (id, kind, scope, manager_id, leader_id, name, member_permission, role_set, created_by, updated_by)
      VALUES (${id}::uuid, ${o.kind}, ${o.scope}, ${o.managerId}::uuid, ${o.leaderId}::uuid, ${o.name}, ${o.memberPermission}, ${o.roleSet}, ${o.actorId}::uuid, ${o.actorId}::uuid)`);
  } catch (e) {
    rethrowNameConflict(e);
  }
  const emit = ctx.emit as Emit;
  const dhId = await ensureDealDatahub(ctx.db, emit, o.actorId, { id, name: o.name });
  await renameOwnTablesTaking(ctx.db, emit, { id, name: o.name }, o.actorId, dhId);
  const tableId = await insertTemplateTable(ctx.db, { datahubId: dhId, name: o.name, templateId: id, userId: o.kind === "personal" ? o.actorId : null, roleSet: o.roleSet, actorId: o.actorId });
  await ctx.db.execute(sql`UPDATE dh_templates SET master_table_id = ${tableId}::uuid WHERE /*scope:system*/ id = ${id}::uuid`);
  await syncTemplate(ctx, id);
  ctx.audit({ type: "datahub_template", id, details: { name: o.name, kind: o.kind, scope: o.scope, leader_id: o.leaderId } });
  await ctx.emit(STRUCTURE_EVENT, { aggregateType: "datahub_table", aggregateId: tableId, payload: { datahub_id: dhId, table_id: tableId, change: "table_created" } });
  return { id, tableId };
}

type NewTemplateColumn = z.output<z.ZodObject<typeof ColumnFields>> & {
  layer: "basic" | "role" | "team";
  layer_roles?: ("manager" | "leader" | "user")[];
  storage: "shared" | "person";
  role?: string;
  autofill?: { column: string; attr: string; sum?: "team" | "tree" };
};

/** Adds a column to the master table of a template (and to the copies of a personal one). The checks of who may are the caller's; the default set of a new tree calls this as the Manager. */
export async function addTemplateColumn(ctx: CoreCtx, tpl: Template, acc: TableAccess, i: NewTemplateColumn, teamLeader: string | null) {
  let autofill: Autofill | null = null;
  if (i.autofill) autofill = await resolveAutofill(ctx, acc, i.autofill, i.type, i.storage);
  await renameCustomColumnsTaking(ctx.db, ctx.emit as Emit, tpl, acc.tableId, acc.datahub.id, tpl.name, [i.name]);
  const { autofill: _af, ...colInput } = i;
  const extra: ColumnExtra = { layer: i.layer, layerRef: teamLeader, layerRoles: i.layer === "role" ? i.layer_roles! : null, storage: i.storage, role: i.role ?? null, autofill, protectedColumn: true };
  const created = await createColumn(ctx, acc, colInput, extra);
  if (autofill) await refillRows(ctx.db, acc.tableId, "all");
  if (tpl.kind === "personal") for (const c of await copiesOf(ctx.db, tpl)) await syncCopyColumns(ctx, tpl, { id: acc.tableId, datahubId: acc.datahub.id }, c, new Set([created.id]));
  return created;
}

/** The master table of a template as its OWNER sees it (exported for the default template set). */
export { masterAccess };

export const templateOperations = [
  defineCommand({
    name: "datahub.template.create",
    summary: "Tạo bảng template cho cả cây (Manager) hoặc cho team (Leader): bảng chung hoặc bảng riêng mỗi người một bản.",
    description:
      "Bảng template là bảng có sẵn cột, hệ thống giữ nó trong datahub \"Quản lý Deal\" của mọi người trong phạm vi (cây hoặc team, theo cây tổ chức hiện tại, tự cập nhật khi đổi cây). " +
      "`kind: shared`: một bảng chung (người tạo là chủ, người nhận là thành viên với `member_permission`; bật khoá phân chia bằng `datahub.table.share_options.set`). `kind: personal`: mỗi người một bảng cùng cấu trúc. " +
      "Manager: `scope: tree` (mặc định) hoặc `team` kèm `leader_id` của một Leader trong cây. Leader: chỉ `team` của chính mình. Admin không tạo template (không có quyền nghiệp vụ). " +
      "Tên bảng tự tạo trùng tên template của người nhận sẽ được đổi thành `<tên> (riêng)` kèm thông báo.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({
      name: DhNameSchema,
      kind: z.enum(["shared", "personal"]),
      scope: z.enum(["tree", "team"]).optional(),
      leader_id: Id.optional().describe("Với `scope: team` do Manager tạo: Leader của team."),
      member_permission: z.enum(["view", "edit_data"]).default("view"),
      role_set: z.enum(Object.keys(ROLE_SETS) as [string, ...string[]]).optional().describe("Bộ vai trò cột của bảng (Module 4 mục 3.7); chỉ Manager đặt."),
    }),
    output: TemplateOut,
    http: { method: "POST", path: "/datahub/templates", status: 201 },
    handler: async (ctx, i) => {
      const p = await ctx.access.requirePrincipal();
      let scope: "tree" | "team";
      let managerId: string;
      let leaderId: string | null = null;
      if (has(p, "manager")) {
        scope = i.scope ?? "tree";
        managerId = p.userId;
        if (scope === "team") {
          if (!i.leader_id) throw new AppError("validation_error", "Template của team cần `leader_id`.");
          const ok = await ctx.db.execute(sql`SELECT 1 FROM org_memberships m JOIN users u ON u.id = m.user_id WHERE /*scope:system*/ m.user_id = ${i.leader_id}::uuid AND m.manager_id = ${p.userId}::uuid AND m.valid_to IS NULL AND 'leader' = ANY(u.roles)`);
          if (!ok.rows.length) throw new AppError("validation_error", "Người này không phải Leader trong cây của bạn.");
          leaderId = i.leader_id;
        }
      } else if (has(p, "leader")) {
        if (i.scope === "tree") notAllowed("tạo template cho cả cây (chỉ Manager)");
        if (!p.managerId) throw new AppError("validation_error", "Bạn chưa thuộc cây nào.");
        scope = "team";
        managerId = p.managerId;
        leaderId = p.userId;
        if (i.role_set) notAllowed("đặt bộ vai trò cột (chỉ Manager)");
      } else notAllowed("tạo template");
      const limit = await readSetting(ctx.db, DH_SETTINGS.templatesPerScope);
      const used = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_templates WHERE /*scope:system*/ deleted_at IS NULL AND manager_id = ${managerId}::uuid AND scope = ${scope} AND leader_id IS NOT DISTINCT FROM ${leaderId}::uuid`);
      if ((used.rows[0] as { n: number }).n >= limit) quotaExceeded(scope === "tree" ? "bảng template mỗi cây" : "bảng template mỗi team", limit);
      const { id } = await createTemplateCore(ctx, { name: i.name, kind: i.kind, scope, managerId, leaderId, memberPermission: i.member_permission, roleSet: i.role_set ?? null, actorId: p.userId });
      return templateOut(ctx, p, (await loadTemplate(ctx.db, id))!);
    },
  }),

  defineQuery({
    name: "datahub.template.list",
    summary: "Các bảng template bạn thuộc phạm vi (cả cây của bạn, team của bạn) và bạn sửa được hay không.",
    description: "Manager thấy mọi template của cây (kể cả của các team); Leader thấy template của team mình và của cả cây; người khác thấy template của cây và team mình. `include_archived` chỉ cho người sửa được.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ include_archived: z.enum(["true", "false"]).default("false").transform((v) => v === "true") }),
    output: z.array(TemplateOut),
    http: { method: "GET", path: "/datahub/templates" },
    handler: async (ctx, i) => {
      const p = await ctx.access.requirePrincipal();
      if (!has(p, "manager") && !has(p, "leader") && !has(p, "user")) return [];
      const res = await ctx.db.execute(sql`SELECT * FROM dh_templates WHERE /*scope:system*/ ${i.include_archived ? sql`true` : sql`deleted_at IS NULL`} AND (
        (scope = 'tree' AND manager_id = ${p.managerId ?? p.userId}::uuid)
        OR (scope = 'team' AND (leader_id = ${p.userId}::uuid OR leader_id = ${p.leaderId ?? p.userId}::uuid OR manager_id = ${p.userId}::uuid))) ORDER BY created_at`);
      const out = [];
      for (const r of res.rows as Raw[]) {
        const t = templateFromDb(r);
        if (t.deleted && !canEditTemplate(p, t)) continue;
        out.push(await templateOut(ctx, p, t));
      }
      return out;
    },
  }),

  defineQuery({
    name: "datahub.deal.home",
    summary: "Các bảng của menu Quản lý Deal: bảng template bạn thấy (Deals, Index...) và bảng tự tạo trong datahub \"Quản lý Deal\" của bạn.",
    description:
      "Datahub \"Quản lý Deal\" không nằm trong `datahub.datahub.list`. Lệnh này trả datahub của chính bạn (`datahub_id`, null với Admin và Guest) và mọi bảng bạn mở được trong các datahub \"Quản lý Deal\" (của bạn và của người chia sẻ template cho bạn). " +
      "Bảng template (có `template_id`) đứng trước, theo thứ tự tạo template; bảng tự tạo theo vị trí.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({
      datahub_id: Id.nullable(),
      tables: z.array(z.object({ id: Id, datahub_id: Id, name: z.string(), row_count: z.number().int(), access: z.enum(["owner", "edit_data", "view"]), kind: z.enum(["normal", "merged"]), template_id: Id.nullable(), template_kind: z.enum(["shared", "personal"]).nullable(), template_scope: z.enum(["tree", "team"]).nullable(), role_set: z.string().nullable() })),
    }),
    http: { method: "GET", path: "/datahub/deal-home" },
    handler: async (ctx) => {
      const me = ctx.actor.userId;
      const mine = await ctx.db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope*/ owner_id = ${me}::uuid AND system_key = 'deal' AND deleted_at IS NULL`);
      const myId = (mine.rows[0] as { id: string } | undefined)?.id ?? null;
      const shared = await ctx.db.execute(sql`SELECT d.id FROM dh_datahubs d WHERE /*scope*/ d.system_key = 'deal' AND d.deleted_at IS NULL AND d.owner_id <> ${me}::uuid
        AND EXISTS (SELECT 1 FROM dh_shares s WHERE s.datahub_id = d.id AND s.grantee_id = ${me}::uuid)`);
      const dhIds = [...(myId ? [myId] : []), ...(shared.rows as { id: string }[]).map((r) => r.id)];
      const byDh = await tablesOf(ctx.db, me, dhIds);
      const all = dhIds.flatMap((d) => (byDh.get(d) ?? []).map((t) => ({ ...t, datahub_id: d })));
      if (!all.length) return { datahub_id: myId, tables: [] };
      const meta = await ctx.db.execute(sql`SELECT t.id, t.template_id, t.role_set, tp.kind AS tkind, tp.scope AS tscope, tp.created_at AS tcreated
        FROM dh_tables t LEFT JOIN dh_templates tp ON tp.id = t.template_id WHERE /*scope*/ t.id = ANY(${`{${all.map((t) => t.id).join(",")}}`}::uuid[])`);
      const info = new Map((meta.rows as Raw[]).map((r) => [r.id as string, r]));
      const rows = all.map((t) => {
        const m = info.get(t.id);
        return { t, role_set: (m?.role_set as string | null) ?? null, tpl: (m?.template_id as string | null) ?? null, kind: (m?.tkind as "shared" | "personal" | null) ?? null, scope: (m?.tscope as "tree" | "team" | null) ?? null, created: m?.tcreated ? new Date(m.tcreated as string).getTime() : 0 };
      });
      rows.sort((a, b) => (a.tpl && !b.tpl ? -1 : !a.tpl && b.tpl ? 1 : a.tpl ? a.created - b.created : a.t.position - b.t.position));
      return {
        datahub_id: myId,
        tables: rows.map(({ t, tpl, kind, scope, role_set }) => ({ role_set, id: t.id, datahub_id: t.datahub_id, name: t.name, row_count: t.row_count, access: t.access, kind: t.kind, template_id: tpl, template_kind: kind, template_scope: scope })),
      };
    },
  }),

  defineQuery({
    name: "datahub.template.impact",
    summary: "Một cột (hoặc một thay đổi) của template áp dụng cho bao nhiêu người: dùng cho màn xem trước \"Áp dụng cho N người\".",
    description: "`layer`: `basic` (mọi thành viên), `role` (thành viên có một trong `layer_roles`), `team` (Leader `team_leader_id` và team của họ). Không đưa `layer` thì tính mọi thành viên của template. Chỉ người sửa được template.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ template_id: Id, layer: z.enum(["basic", "role", "team"]).optional(), layer_roles: z.array(z.enum(["manager", "leader", "user"])).optional(), team_leader_id: Id.optional() }),
    output: z.object({ count: z.number().int(), names: z.array(z.string()).describe("Tối đa 8 tên đầu, theo thứ tự chữ cái.") }),
    http: { method: "GET", path: "/datahub/templates/:template_id/impact" },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id);
      if (!canEditTemplate(p, tpl) && !(has(p, "leader") && tpl.leaderCanAddColumns)) notAllowed("xem ảnh hưởng của template này");
      const members = await scopeMembers(ctx.db, tpl);
      if (!members.length) return { count: 0, names: [] };
      const res = await ctx.db.execute(sql`SELECT u.id, u.full_name, u.roles, m.leader_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
        WHERE /*scope:system*/ u.id = ANY(${`{${members.map((m) => m.id).join(",")}}`}::uuid[]) ORDER BY u.full_name`);
      let list = res.rows as { id: string; full_name: string; roles: string[]; leader_id: string | null }[];
      if (i.layer === "role") {
        if (!i.layer_roles?.length) throw new AppError("validation_error", "Lớp `role` cần `layer_roles`.");
        list = list.filter((u) => u.roles.some((r) => i.layer_roles!.includes(r as never)));
      } else if (i.layer === "team") {
        const leader = i.team_leader_id ?? (has(p, "leader") ? p.userId : null);
        if (!leader) throw new AppError("validation_error", "Lớp `team` cần `team_leader_id`.");
        list = list.filter((u) => u.id === leader || u.leader_id === leader);
      }
      return { count: list.length, names: list.slice(0, 8).map((u) => u.full_name) };
    },
  }),

  defineQuery({
    name: "datahub.template.get",
    summary: "Một template và các cột của nó theo lớp (cột bạn thấy; người sửa được thấy mọi cột mẫu).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ template_id: Id }),
    output: z.object({
      template: TemplateOut,
      columns: z.array(ColumnOut),
      members: z.array(z.object({ id: Id, full_name: z.string(), view_only: z.boolean() })),
      roles: z.array(z.object({ key: z.string(), label: z.string(), types: z.array(z.string()), required: z.boolean(), used_by: z.array(z.string()), column: z.string().nullable().describe("Mã cột đang giữ vai trò (null = chưa có)." ) })).describe("Bộ vai trò cột của bảng (rỗng khi bảng không dùng vai trò)."),
    }),
    http: { method: "GET", path: "/datahub/templates/:template_id" },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id, { withDeleted: true });
      const editable = canEditTemplate(p, tpl);
      const out = await templateOut(ctx, p, tpl);
      if (tpl.deleted && !editable) throw new AppError("not_found", "Không tìm thấy template.");
      let list: DhColumn[] = [];
      if (tpl.masterTableId) {
        const acc = editable ? await masterAccess(ctx, tpl) : out.my_table_id ? await loadTableAccess(ctx, out.my_table_id) : null;
        if (acc) list = (await TableSchema.load(ctx.db, acc)).alive.filter((c) => c.layer !== "custom");
      }
      const ix = editable ? await indexFor(ctx.db, p.userId, list) : null;
      const members = await scopeMembers(ctx.db, tpl);
      const names = members.length ? await ctx.db.execute(sql`SELECT id, full_name FROM users WHERE /*scope:system*/ id = ANY(${`{${members.map((m) => m.id).join(",")}}`}::uuid[]) ORDER BY full_name`) : { rows: [] };
      const viewOnly = new Map(members.map((m) => [m.id, m.viewOnly]));
      const roles = (tpl.roleSet ? (ROLE_SETS[tpl.roleSet]?.roles ?? []) : []).map((r) => ({ key: r.key, label: r.label, types: r.types, required: r.required, used_by: r.usedBy, column: list.find((c) => c.role === r.key && !c.deletedAt)?.key ?? null }));
      return { template: out, roles, columns: list.map((c) => columnOut(c, ix)), members: editable ? (names.rows as { id: string; full_name: string }[]).map((r) => ({ id: r.id, full_name: r.full_name, view_only: viewOnly.get(r.id) ?? false })) : [] };
    },
  }),

  defineCommand({
    name: "datahub.template.update",
    summary: "Đổi tên template, quyền mặc định của thành viên, hoặc \"Leader được thêm cột team\" (chỉ Manager đặt tuỳ chọn Leader).",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id, name: DhNameSchema.optional(), member_permission: z.enum(["view", "edit_data"]).optional(), leader_can_add_columns: z.boolean().optional(), version: z.number().int().min(1).optional() }),
    output: TemplateOut,
    http: { method: "PATCH", path: "/datahub/templates/:template_id" },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id);
      if (!canEditTemplate(p, tpl)) notAllowed("sửa template này");
      if (i.version !== undefined && i.version !== tpl.version) throw new AppError("conflict", undefined, { current_version: tpl.version, sent_version: i.version });
      if (i.leader_can_add_columns !== undefined && !has(p, "manager")) notAllowed("đổi tuỳ chọn \"Leader được thêm cột team\" (chỉ Manager)");
      const name = i.name ?? tpl.name;
      try {
        await ctx.db.execute(sql`UPDATE dh_templates SET name = ${name}, member_permission = ${i.member_permission ?? tpl.memberPermission}, leader_can_add_columns = ${i.leader_can_add_columns ?? tpl.leaderCanAddColumns},
          version = version + 1, updated_at = now(), updated_by = ${p.userId}::uuid WHERE /*scope:system*/ id = ${tpl.id}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      if (name !== tpl.name) {
        // The tables follow the template's name; a person's own table that already has it gives way.
        const emit = ctx.emit as Emit;
        const tables = await ctx.db.execute(sql`SELECT t.id, t.datahub_id, d.owner_id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.template_id = ${tpl.id}::uuid AND t.deleted_at IS NULL`);
        for (const t of tables.rows as { id: string; datahub_id: string; owner_id: string }[]) {
          if (tpl.kind === "personal" || t.id === tpl.masterTableId) await renameOwnTablesTaking(ctx.db, emit, { id: tpl.id, name }, t.owner_id, t.datahub_id);
          await ctx.db.execute(sql`UPDATE dh_tables SET name = ${name}, version = version + 1, updated_at = now(), updated_by = ${p.userId}::uuid WHERE /*scope:system*/ id = ${t.id}::uuid`);
          await ctx.emit(STRUCTURE_EVENT, { aggregateType: "datahub_table", aggregateId: t.id, payload: { datahub_id: t.datahub_id, table_id: t.id, change: "table_updated" } });
        }
      }
      await syncTemplate(ctx, tpl.id);
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { name: i.name, member_permission: i.member_permission, leader_can_add_columns: i.leader_can_add_columns } });
      return templateOut(ctx, p, (await loadTemplate(ctx.db, tpl.id))!);
    },
  }),

  defineCommand({
    name: "datahub.template.archive",
    summary: "Bỏ bảng template: lưu trữ (ẩn với mọi người), không xoá hẳn, khôi phục được.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id }),
    output: TemplateOut,
    http: { method: "POST", path: "/datahub/templates/:template_id/archive" },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id);
      if (!canEditTemplate(p, tpl)) notAllowed("bỏ template này");
      await ctx.db.execute(sql`UPDATE dh_templates SET deleted_at = now(), deleted_by = ${p.userId}::uuid, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${tpl.id}::uuid`);
      const tables = await ctx.db.execute(sql`UPDATE dh_tables SET archived = true, deleted_at = now(), deleted_by = ${p.userId}::uuid, version = version + 1, updated_at = now() WHERE /*scope:system*/ template_id = ${tpl.id}::uuid AND deleted_at IS NULL RETURNING id, datahub_id`);
      for (const t of tables.rows as { id: string; datahub_id: string }[]) await ctx.emit(STRUCTURE_EVENT, { aggregateType: "datahub_table", aggregateId: t.id, payload: { datahub_id: t.datahub_id, table_id: t.id, change: "table_deleted" } });
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { name: tpl.name } });
      return templateOut(ctx, p, (await loadTemplate(ctx.db, tpl.id, { withDeleted: true }))!);
    },
  }),

  defineCommand({
    name: "datahub.template.restore",
    summary: "Khôi phục bảng template đã lưu trữ.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id }),
    output: TemplateOut,
    http: { method: "POST", path: "/datahub/templates/:template_id/restore" },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id, { withDeleted: true });
      if (!canEditTemplate(p, tpl)) notAllowed("khôi phục template này");
      if (!tpl.deleted) return templateOut(ctx, p, tpl);
      try {
        await ctx.db.execute(sql`UPDATE dh_templates SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${tpl.id}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      const tables = await ctx.db.execute(sql`UPDATE dh_tables SET archived = false, deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_at = now() WHERE /*scope:system*/ template_id = ${tpl.id}::uuid AND archived RETURNING id, datahub_id`);
      for (const t of tables.rows as { id: string; datahub_id: string }[]) await ctx.emit(STRUCTURE_EVENT, { aggregateType: "datahub_table", aggregateId: t.id, payload: { datahub_id: t.datahub_id, table_id: t.id, change: "table_restored" } });
      // People who left the scope while it was archived stay hidden: the sync archives their copies again.
      await syncTemplate(ctx, tpl.id);
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { name: tpl.name } });
      return templateOut(ctx, p, (await loadTemplate(ctx.db, tpl.id))!);
    },
  }),

  // ---------------------------------------------------------------------------------------- columns of a template
  defineCommand({
    name: "datahub.template.column.create",
    summary: "Thêm cột vào template (lớp Cơ bản, Theo vai trò, Theo team), có thể kèm vai trò cột. Áp ngay cho mọi người trong phạm vi.",
    description:
      "`layer`: `basic` (mọi người, Manager sửa), `role` (chỉ người có `layer_roles`), `team` (chỉ team của `team_leader_id`; Manager, hoặc Leader đó khi template cho phép \"Leader được thêm cột team\"). " +
      "`storage`: `shared` (một giá trị mỗi dòng) hoặc `person` (mỗi người một giá trị, kiểu nhập tay). `role`: vai trò cột (Module 4 mục 3.7) của bộ vai trò của bảng. " +
      "Cột riêng của ai đó trùng tên sẽ được đổi thành `<tên> (riêng)` kèm thông báo. Bảng riêng (mỗi người một bản) chưa nhận cột liên kết, lookup, rollup.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({
      template_id: Id,
      ...ColumnFields,
      layer: z.enum(["basic", "role", "team"]).default("basic"),
      layer_roles: z.array(z.enum(["manager", "leader", "user"])).min(1).optional(),
      team_leader_id: Id.optional(),
      storage: z.enum(["shared", "person"]).default("shared"),
      role: z.string().min(1).max(60).optional(),
      autofill: z
        .object({ column: z.string().min(1).max(100), attr: z.string().min(1).max(30), sum: z.enum(["team", "tree"]).optional() })
        .optional()
        .describe("\"Gửi xuống\" (Module 4 mục 4.5): hệ thống tự điền cột (storage `person`) từ thuộc tính `attr` của mỗi người trong cột Người dùng có thuộc tính `column` của cùng dòng. `sum: team|tree`: Leader/Manager nhận tổng của team/cây."),
    }),
    output: ColumnOut,
    http: { method: "POST", path: "/datahub/templates/:template_id/columns", status: 201 },
    handler: async (ctx, i) => {
      const { tpl, p } = await loadEditable(ctx, i.template_id);
      if (!tpl.masterTableId) throw new AppError("conflict", "Template chưa có bảng.");
      if (!canEditLayer(p, tpl, i.layer, i.team_leader_id ?? p.userId)) notAllowed(i.layer === "team" ? "thêm cột team vào template này" : "thêm cột vào template này");
      if (i.layer === "role" && !i.layer_roles) throw new AppError("validation_error", "Cột lớp `role` cần `layer_roles`.");
      let teamLeader: string | null = null;
      if (i.layer === "team") {
        teamLeader = i.team_leader_id ?? (has(p, "leader") ? p.userId : null);
        if (!teamLeader) throw new AppError("validation_error", "Cột lớp `team` cần `team_leader_id`.");
        if (has(p, "manager")) {
          const ok = await ctx.db.execute(sql`SELECT 1 FROM org_memberships WHERE /*scope:system*/ user_id = ${teamLeader}::uuid AND manager_id = ${tpl.managerId}::uuid AND valid_to IS NULL`);
          if (!ok.rows.length) throw new AppError("validation_error", "Người này không phải Leader trong cây của template.");
        }
      }
      if (i.storage === "person" && (!columnTypeDef(i.type).writable || isComputedType(i.type) || i.type === "relation")) throw new AppError("validation_error", "Cột mỗi người một giá trị chỉ dùng kiểu nhập tay (chưa có công thức theo người).", { reason: "person_column_type" });
      if (tpl.kind === "personal" && ["relation", "lookup", "rollup"].includes(i.type)) throw new AppError("validation_error", "Bảng template riêng (mỗi người một bản) chưa nhận cột liên kết, lookup, rollup.", { reason: "personal_template_column_type" });
      const acc = await masterAccess(ctx, tpl);
      if (i.role) {
        const def = assertRoleOfSet(acc.table.roleSet, i.role);
        if (!def.types.includes(i.type === "formula" ? String(i.config?.result_type ?? "number") : i.type)) throw new AppError("validation_error", `Vai trò "${def.label}" cần cột kiểu ${def.types.join(" / ")}.`, { reason: "role_type" });
      }
      const created = await addTemplateColumn(ctx, tpl, acc, i, teamLeader);
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { column: created.name, layer: i.layer, role: i.role ?? null } });
      return created;
    },
  }),

  defineCommand({
    name: "datahub.template.column.update",
    summary: "Sửa cột template (tên, công thức, định dạng, lựa chọn, quyền sửa ô...). Trả kèm nơi đang dùng cột để cảnh báo.",
    description: "Đổi tên, công thức, định dạng, lựa chọn đều được (kèm danh sách nơi đang dùng cột trong `usage`). Cột đang giữ vai trò phải còn đúng kiểu của vai trò. Đổi kiểu dùng `datahub.template.column.type_change`.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({
      template_id: Id,
      column: z.string().min(1).max(100),
      name: DhNameSchema.optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      required: z.boolean().optional(),
      allow_edit: z.boolean().optional(),
      unique: z.boolean().optional(),
      default_value: z.unknown().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      display: z.record(z.string(), z.unknown()).optional(),
      position: z.number().int().min(0).max(1000).optional(),
      version: z.number().int().min(1).optional(),
      update_formulas: z.boolean().optional().describe("Khi đổi tên lựa chọn: viết lại cả công thức của mọi người đang so chữ với tên cũ (xem `datahub.column.option_impact`)."),
    }),
    output: z.object({ column: ColumnOut, usage: UsageOut }),
    http: { method: "PATCH", path: "/datahub/templates/:template_id/columns/:column" },
    handler: async (ctx, i) => {
      const { acc, col, tpl, p } = await loadTemplateColumn(ctx, i.template_id, i.column);
      const usage = await usageOf(ctx, acc, col);
      if (i.name !== undefined && i.name.trim() !== col.name) await renameCustomColumnsTaking(ctx.db, ctx.emit as Emit, tpl, acc.tableId, acc.datahub.id, tpl.name, [i.name]);
      const { template_id: _t, column: _c, ...rest } = i;
      const column = await updateColumn(ctx, acc, col, rest);
      await assertRoleStillFits(ctx, acc, col.id);
      if (tpl.kind === "personal") for (const c of await copiesOf(ctx.db, tpl)) await syncCopyColumns(ctx, tpl, { id: acc.tableId, datahubId: acc.datahub.id }, c, new Set([col.id]));
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { column: col.name, by: p.userId } });
      return { column, usage };
    },
  }),

  defineCommand({
    name: "datahub.template.column.type_change",
    summary: "Đổi kiểu cột template (theo luồng đổi kiểu của Module 2). Cột đang giữ vai trò chỉ đổi sang kiểu vai trò cần.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id, column: z.string().min(1).max(100), type: z.enum(COLUMN_TYPES), config: z.record(z.string(), z.unknown()).optional(), accept_data_loss: z.boolean().default(false) }),
    output: z.object({ column: ColumnOut, usage: UsageOut, cannot_convert: z.number().int() }),
    http: { method: "POST", path: "/datahub/templates/:template_id/columns/:column/type" },
    handler: async (ctx, i) => {
      const { acc, col, tpl } = await loadTemplateColumn(ctx, i.template_id, i.column);
      if (col.storage === "person") throw new AppError("forbidden", "Cột mỗi người một giá trị không đổi kiểu được (giá trị nằm riêng từng người). Thêm cột mới rồi bỏ cột cũ.", { reason: "person_column_type" });
      if (tpl.kind === "personal") throw new AppError("forbidden", "Bảng template riêng chưa đổi kiểu cột được (mỗi người một bản). Thêm cột mới rồi bỏ cột cũ.", { reason: "personal_template_column_type" });
      if (col.role) {
        const def = assertRoleOfSet(acc.table.roleSet, col.role);
        if (!def.types.includes(i.type)) throw new AppError("conflict", `Cột "${col.name}" đang giữ vai trò "${def.label}" nên chỉ đổi sang kiểu ${def.types.join(" / ")}. Chuyển vai trò sang cột khác trước.`, { reason: "role_type", role: col.role });
      }
      const usage = await usageOf(ctx, acc, col);
      const schema = await TableSchema.load(ctx.db, acc);
      const r = await changeColumnType(ctx, acc, schema, col, i);
      return { column: r.column, usage, cannot_convert: r.report.cannot_convert };
    },
  }),

  defineCommand({
    name: "datahub.template.column.delete",
    summary: "Bỏ cột template: lưu trữ (dữ liệu và lịch sử giữ nguyên, khôi phục được), không xoá hẳn. Cột đang giữ vai trò bắt buộc thì phải chuyển vai trò trước.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id, column: z.string().min(1).max(100) }),
    output: z.object({ id: Id, deleted: z.literal(true), usage: UsageOut }),
    http: { method: "DELETE", path: "/datahub/templates/:template_id/columns/:column" },
    handler: async (ctx, i) => {
      const { acc, col, tpl } = await loadTemplateColumn(ctx, i.template_id, i.column);
      const usage = await usageOf(ctx, acc, col);
      if (col.role) {
        const def = assertRoleOfSet(acc.table.roleSet, col.role);
        if (def.required) throw new AppError("conflict", `Cột "${col.name}" đang giữ vai trò "${def.label}" (${def.usedBy.join(", ")} dùng). Chuyển vai trò sang cột khác trước khi bỏ cột.`, { reason: "role_required", role: col.role });
        await ctx.db.execute(sql`UPDATE dh_columns SET role = NULL WHERE /*scope:system*/ id = ${col.id}::uuid`);
      }
      const r = await deleteColumn(ctx, acc, col);
      if (tpl.kind === "personal") for (const c of await copiesOf(ctx.db, tpl)) await syncCopyColumns(ctx, tpl, { id: acc.tableId, datahubId: acc.datahub.id }, c, new Set([col.id]));
      return { ...r, usage };
    },
  }),

  defineCommand({
    name: "datahub.template.column.restore",
    summary: "Khôi phục cột template đã lưu trữ. Tên đã bị dùng thì gửi `name` mới.",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id, column: z.string().min(1).max(100), name: DhNameSchema.optional() }),
    output: ColumnOut,
    http: { method: "POST", path: "/datahub/templates/:template_id/columns/:column/restore" },
    handler: async (ctx, i) => {
      const { acc, col, tpl } = await loadTemplateColumn(ctx, i.template_id, i.column, "trashed");
      await renameCustomColumnsTaking(ctx.db, ctx.emit as Emit, tpl, acc.tableId, acc.datahub.id, tpl.name, [i.name ?? col.name]);
      const r = await restoreColumn(ctx, acc, col, i.name);
      if (tpl.kind === "personal") for (const c of await copiesOf(ctx.db, tpl)) await syncCopyColumns(ctx, tpl, { id: acc.tableId, datahubId: acc.datahub.id }, c, new Set([col.id]));
      return r;
    },
  }),

  defineCommand({
    name: "datahub.template.column.set_role",
    summary: "Gắn hoặc chuyển vai trò cột (Module 4 mục 3.7) sang một cột khác đúng kiểu. Trả danh sách nơi đang dùng vai trò.",
    description:
      "Một vai trò luôn có đúng một cột: gắn vai trò vào cột mới thì cột cũ tự thả. Bỏ hẳn vai trò (`role: null`) chỉ được với vai trò không bắt buộc. " +
      "Cột phải đúng kiểu của vai trò. Chặn chuyển khi làm đổi số kỳ đã chốt: làm ở bước Chốt kỳ (chưa có kỳ).",
    permission: "datahub:template:write",
    aiAllowed: true,
    emits: EMITS,
    input: z.object({ template_id: Id, column: z.string().min(1).max(100), role: z.string().min(1).max(60).nullable() }),
    output: z.object({ column: ColumnOut, previous: ColumnOut.nullable(), usage: UsageOut }),
    http: { method: "PUT", path: "/datahub/templates/:template_id/columns/:column/role" },
    handler: async (ctx, i) => {
      const { acc, col, tpl } = await loadTemplateColumn(ctx, i.template_id, i.column);
      if (col.layer === "custom") throw new AppError("validation_error", "Cột riêng không giữ vai trò.");
      let previous: DhColumn | null = null;
      if (i.role === null) {
        if (!col.role) return { column: columnOut(col, null), previous: null, usage: await usageOf(ctx, acc, col) };
        const def = assertRoleOfSet(acc.table.roleSet, col.role);
        if (def.required) throw new AppError("conflict", `Vai trò "${def.label}" luôn phải có một cột. Gắn nó vào cột khác thay vì bỏ.`, { reason: "role_required", role: col.role });
        await ctx.db.execute(sql`UPDATE dh_columns SET role = NULL, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${col.id}::uuid`);
      } else {
        const def = assertRoleOfSet(acc.table.roleSet, i.role);
        if (!fitsRole(col, def)) throw new AppError("validation_error", `Cột "${col.name}" không đúng kiểu của vai trò "${def.label}" (${def.types.join(" / ")}).`, { reason: "role_type" });
        const holder = await ctx.db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ table_id = ${acc.tableId}::uuid AND role = ${i.role} AND deleted_at IS NULL AND id <> ${col.id}::uuid`);
        if (holder.rows[0]) {
          previous = columnFromDb(holder.rows[0] as Raw);
          await ctx.db.execute(sql`UPDATE dh_columns SET role = NULL, version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${previous.id}::uuid`);
        }
        // A role of a column that was set to leave another is taken first; the column now holds only this one.
        await ctx.db.execute(sql`UPDATE dh_columns SET role = ${i.role}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope:system*/ id = ${col.id}::uuid`);
      }
      if (tpl.kind === "personal") for (const c of await copiesOf(ctx.db, tpl)) await syncCopyColumns(ctx, tpl, { id: acc.tableId, datahubId: acc.datahub.id }, c, new Set([col.id, ...(previous ? [previous.id] : [])]));
      await ctx.emit(STRUCTURE_EVENT, { aggregateType: "datahub_table", aggregateId: acc.tableId, payload: { datahub_id: acc.datahub.id, table_id: acc.tableId, change: "column_updated" } });
      ctx.audit({ type: "datahub_template", id: tpl.id, details: { column: col.name, role: i.role, previous: previous?.name ?? null } });
      const after = columnFromDb(((await ctx.db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ id = ${col.id}::uuid`)).rows[0]) as Raw);
      const usage = await usageOf(ctx, acc, previous ?? after);
      return { column: columnOut(after, null), previous: previous ? columnOut(columnFromDb(((await ctx.db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ id = ${previous.id}::uuid`)).rows[0]) as Raw), null) : null, usage };
    },
  }),

  defineQuery({
    name: "datahub.column.usage",
    summary: "Cột này đang được dùng ở đâu: vai trò và chức năng đọc nó, công thức, view, chỉ số, dashboard. Dùng để cảnh báo trước khi đổi tên, công thức, kiểu, bỏ cột.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, column: z.string().min(1).max(100) }),
    output: UsageOut,
    http: { method: "GET", path: "/tables/:table_id/columns/:column/usage" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      const schema = await TableSchema.load(ctx.db, acc);
      const col = schema.tryResolve(i.column);
      if (!col || col.deletedAt) throw new AppError("not_found", `Không tìm thấy cột "${i.column}".`);
      return usageOf(ctx, acc, col);
    },
  }),
];

/** "Gửi xuống": the source column must be a user column with that attribute, and the column that receives must be person-stored and fit the attribute. */
async function resolveAutofill(ctx: CoreCtx, acc: TableAccess, a: { column: string; attr: string; sum?: "team" | "tree" }, type: string, storage: string): Promise<Autofill> {
  const bad = (m: string, reason = "autofill_invalid"): never => {
    throw new AppError("validation_error", m, { reason });
  };
  if (storage !== "person") bad("Cột tự điền từ Người tham gia phải là cột mỗi người một giá trị (`storage: person`).");
  const src = (await TableSchema.load(ctx.db, acc)).tryResolve(a.column);
  if (!src || src.deletedAt || src.type !== "user") return bad(`Không có cột Người dùng "${a.column}" để lấy thuộc tính.`);
  const attr = userAttrs(src).find((x) => x.key === a.attr);
  if (!attr) return bad(`Cột "${src.name}" không có thuộc tính "${a.attr}".`);
  const fits = a.sum ? attr.kind === "percent" && ["percent", "number"].includes(type) : attr.kind === "select" ? type === "text" : attr.kind === "percent" ? ["percent", "number"].includes(type) : type === "checkbox";
  if (!fits) bad(`Thuộc tính "${attr.label}" (${attr.kind}) không điền được vào cột kiểu ${type}${a.sum ? " theo tổng team/cây" : ""}.`);
  return { column: src.key, attr: attr.key, ...(a.sum ? { sum: a.sum } : {}) };
}

/** A template column of the master table, for someone allowed to edit that layer. */
async function loadTemplateColumn(ctx: Ctx, templateId: string, ref: string, state: "alive" | "trashed" = "alive"): Promise<{ acc: TableAccess; col: DhColumn; tpl: Template; p: Principal }> {
  const { tpl, p } = await loadEditable(ctx, templateId);
  if (!tpl.masterTableId) throw new AppError("conflict", "Template chưa có bảng.");
  const acc = await masterAccess(ctx, tpl);
  const schema = await TableSchema.load(ctx.db, acc);
  const col = schema.tryResolve(ref);
  const ok = col && col.layer !== "custom" && col.layer !== null && (state === "alive" ? !col.deletedAt : !!col.deletedAt);
  if (!col || !ok) throw new AppError("not_found", `Không tìm thấy cột template "${ref}".`);
  if (!canEditLayer(p, tpl, col.layer as "basic" | "role" | "team", col.layerRef)) notAllowed("sửa cột này của template");
  return { acc, col, tpl, p };
}

/** The organization tree changed: every template follows it (design module4 3.5: members follow the tree). */
export const templateSubscriber: Subscriber = {
  name: "datahub.template",
  match: (e) => e === "org.member.changed",
  async handle(_ev, db) {
    await syncAllTemplates(db);
  },
};
