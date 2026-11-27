import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { defineCommand, defineQuery } from "../../core/registry";
import { scopeSql } from "../../auth/access";
import { loadTableAccess, readableRows } from "./access";
import { resolveLinkTarget } from "./link-targets";
import { restoreRows } from "./rows";
import { Id, ROW_EVENTS } from "./shared";
import { TableSchema } from "./table-schema";
import { assertColumnKey } from "./types";

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PersonOut = z.object({
  id: Id,
  full_name: z.string(),
  email: z.string().nullable(),
  status: z.string().describe("active = đang làm; locked = đã nghỉ (khoá); inactive = chưa kích hoạt."),
  roles: z.array(z.string()).nullable().describe("Vai trò; null khi người này ngoài cây tổ chức của bạn."),
  team_id: Id.nullable().describe("Mã Leader của team (Leader thì là chính họ); null khi không có team hoặc ngoài cây của bạn."),
  team: z.string().nullable().describe("Tên Leader của team; null khi không có team hoặc ngoài cây của bạn."),
  member: z.boolean().optional().describe("Chỉ có khi gửi `table_id`: người này là chủ hoặc thành viên của bảng."),
});

const RowBrief = z.object({ id: Id, row_no: z.number().int().optional(), version: z.number().int().optional(), data: z.record(z.string(), z.unknown()) });

/**
 * Small helpers the grid needs to show and pick cells of the kinds that hold ids: people (user columns) and linked rows
 * (relation columns), plus restoring many rows at once (undo of a delete).
 */
export const lookupOperations = [
  defineQuery({
    name: "datahub.people.lookup",
    summary: "Tìm người để chọn vào cột Người dùng, hoặc đổi mã người thành tên: theo `ids`, theo `q` (tên hoặc email) hoặc theo `team_id` (cả team).",
    description:
      "Chỉ người đang hoạt động trong org chart (trừ khi tra theo `ids`). Tối đa 200 `ids` một lần; `q` trả tối đa `limit` người (mặc định 20). " +
      "`team_id` (mã Leader, lấy từ `datahub.people.teams`) trả cả team đang làm việc, Leader và thành viên, tối đa 200 người, chỉ những người trong cây bạn thấy. " +
      "Có `table_id`: `q` và `team_id` chỉ trả chủ bảng và thành viên của bảng (ô Người dùng chỉ nhận thành viên), còn `ids` vẫn đổi mã ra tên cho mọi người kèm `member` (false = \"không còn quyền\"). Không có `table_id`: dùng để chọn người khi chia sẻ. " +
      "Mỗi người kèm `status` (active = đang làm, locked/inactive = đã nghỉ hoặc chưa kích hoạt). `roles`, `team`, `team_id` chỉ có khi người đó nằm trong cây tổ chức của bạn (cùng phạm vi xem org chart), ngoài cây thì null.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({
      ids: z.string().max(8000).optional().describe("Các mã người, ngăn cách bằng dấu phẩy."),
      q: z.string().trim().max(100).optional(),
      team_id: Id.optional().describe("Mã Leader của team cần lấy cả team."),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      table_id: Id.optional().describe("Bảng có ô Người dùng đang chọn: giới hạn gợi ý ở thành viên của bảng."),
    }),
    output: z.array(PersonOut),
    http: { method: "GET", path: "/datahub/people" },
    handler: async (ctx, i) => {
      const ids = (i.ids ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (ids.length > 200) throw new AppError("validation_error", "Tối đa 200 mã người mỗi lần.");
      if (ids.some((x) => !UUID_RE.test(x))) throw new AppError("validation_error", "Mã người không hợp lệ.");
      const where = [sql`u.kind = 'person'`];
      const acc = i.table_id ? await loadTableAccess(ctx, i.table_id) : null;
      // Members of a table: its owner and everyone it is shared with (the whole datahub or this table).
      const member = acc
        ? sql`(u.id = ${acc.datahub.ownerId}::uuid OR EXISTS (SELECT 1 FROM dh_shares s WHERE /*scope*/ s.datahub_id = ${acc.datahub.id}::uuid AND (s.table_id IS NULL OR s.table_id = ${acc.tableId}::uuid) AND s.grantee_id = u.id))`
        : null;
      const scope = await ctx.access.scope("org");
      let limit = i.limit;
      if (ids.length) {
        where.push(sql`u.id = ANY(${uuidArray(ids)}::uuid[])`);
        limit = 200;
      } else if (i.team_id) {
        if (!UUID_RE.test(i.team_id)) throw new AppError("validation_error", "Mã team không hợp lệ.");
        // Only people inside the viewer's own org scope: a team outside it comes back empty.
        where.push(sql`u.status = 'active'`, sql`(u.id = ${i.team_id}::uuid OR m.leader_id = ${i.team_id}::uuid)`, scopeSql(sql`u.id`, scope));
        if (member) where.push(member);
        limit = 200;
      } else {
        if (!i.q) return [];
        const like = `%${likeEscape(i.q)}%`;
        where.push(sql`u.status = 'active'`, sql`(soe_unaccent(lower(u.full_name)) LIKE soe_unaccent(lower(${like})) ESCAPE '\\' OR lower(u.email) LIKE lower(${like}) ESCAPE '\\')`);
        if (member) where.push(member);
      }
      const inScope = scope.all ? sql`true` : scope.userIds.length ? sql`u.id = ANY(${uuidArray(scope.userIds)}::uuid[])` : sql`false`;
      const res = await ctx.db.execute(sql`SELECT u.id, u.full_name, u.email, u.status, u.roles, ${inScope} AS in_scope, tu.id AS team_id, tu.full_name AS team${member ? sql`, ${member} AS member` : sql``}
        FROM users u
        LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
        LEFT JOIN users tu ON tu.id = CASE WHEN 'leader' = ANY(u.roles) THEN u.id ELSE m.leader_id END
        WHERE ${sql.join(where, sql` AND `)} ORDER BY u.full_name, u.id LIMIT ${limit}`);
      // Role and team are org chart facts: shown only for people inside the viewer's own org scope (same rule as org.member.get).
      return (res.rows as { id: string; full_name: string; email: string | null; status: string; roles: string[]; in_scope: boolean; team_id: string | null; team: string | null; member?: boolean }[]).map(({ in_scope, roles, team_id, team, ...r }) => ({
        ...r,
        roles: in_scope ? roles : null,
        team_id: in_scope ? team_id : null,
        team: in_scope ? team : null,
      }));
    },
  }),

  defineQuery({
    name: "datahub.people.teams",
    summary: "Danh sách team (Leader kèm số người đang làm) trong cây tổ chức của bạn, để chọn cả team vào một ô nhiều người.",
    description: "Chỉ team có Leader nằm trong phạm vi xem org chart của bạn (Admin thấy tất cả, người khác thấy cây của mình). `member_count` gồm Leader. Lấy thành viên bằng `datahub.people.lookup` với `team_id`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ id: Id, name: z.string(), member_count: z.number().int() })),
    http: { method: "GET", path: "/datahub/people/teams" },
    handler: async (ctx) => {
      const scope = await ctx.access.scope("org");
      const res = await ctx.db.execute(sql`SELECT l.id, l.full_name AS name,
          1 + (SELECT count(*)::int FROM org_memberships m JOIN users x ON x.id = m.user_id WHERE m.leader_id = l.id AND m.valid_to IS NULL AND m.user_id <> l.id AND x.status = 'active' AND x.kind = 'person' AND ${scopeSql(sql`x.id`, scope)}) AS member_count
        FROM users l WHERE l.kind = 'person' AND l.status = 'active' AND 'leader' = ANY(l.roles) AND ${scopeSql(sql`l.id`, scope)} ORDER BY l.full_name, l.id`);
      return res.rows as { id: string; name: string; member_count: number }[];
    },
  }),

  defineQuery({
    name: "datahub.relation.labels",
    summary: "Tên hiển thị của các dòng được liên kết ở một cột Liên kết (giá trị cột đầu tiên dạng chữ của bảng đích, không có thì `#<mã dòng>`).",
    description: "Bảng đích là bảng của cùng chủ (cùng datahub hoặc datahub khác của chủ). Người được chia sẻ bảng nguồn thấy tên hiển thị này (là giá trị trong ô), nhưng không mở được dòng ở bảng đích.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, column: z.string().min(1).max(100).describe("Mã hoặc tên cột Liên kết."), ids: z.string().max(8000).describe("Các mã dòng đích, ngăn cách bằng dấu phẩy (tối đa 200).") }),
    output: z.array(z.object({ id: Id, row_no: z.number().int(), label: z.string() })),
    http: { method: "GET", path: "/tables/:table_id/relation-labels" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const schema = await TableSchema.load(ctx.db, acc);
      const col = schema.tryResolve(i.column);
      if (!col || col.type !== "relation") throw new AppError("validation_error", "Cột này không phải cột Liên kết.");
      const ids = i.ids.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (ids.length > 200) throw new AppError("validation_error", "Tối đa 200 mã dòng mỗi lần.");
      if (ids.some((x) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x))) throw new AppError("validation_error", "Mã dòng không hợp lệ.");
      if (ids.length === 0) return [];
      const target = col.config.target_table_id as string;
      const cols = await ctx.db.execute(sql`SELECT key FROM dh_columns WHERE /*scope*/ table_id = ${target}::uuid AND deleted_at IS NULL AND type IN ('text', 'long_text', 'email', 'phone', 'url') ORDER BY position, created_at, id LIMIT 1`);
      const key = (cols.rows[0] as { key: string } | undefined)?.key;
      const label = key ? sql`COALESCE(NULLIF(r.data->>${sql.raw(`'${assertColumnKey(key)}'`)}, ''), '#' || r.row_no::text)` : sql`'#' || r.row_no::text`;
      const lt = await resolveLinkTarget(ctx, acc.datahub.ownerId, target);
      if (!lt) return [];
      // A template table of someone else: labels only of rows its linking owner sees.
      const cond = lt.own ? sql`d.owner_id = ${acc.datahub.ownerId}::uuid` : readableRows(lt.acc, "r");
      const res = await ctx.db.execute(sql`SELECT r.id, r.row_no, ${label} AS label FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
        WHERE /*scope:rows*/ r.table_id = ${target}::uuid AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND ${cond} AND r.id = ANY(${uuidArray(ids)}::uuid[])`);
      return res.rows as { id: string; row_no: number; label: string }[];
    },
  }),

  defineQuery({
    name: "datahub.relation.search",
    summary: "Tìm dòng của bảng đích để chọn vào ô Liên kết: theo từ khoá (chữ trong dòng) hoặc số dòng, phân trang theo số dòng. Chỉ chủ datahub.",
    description:
      "Chỉ chủ datahub ghi được ô Liên kết nên chỉ chủ tìm được. Trả `label` (cột chữ đầu tiên của bảng đích, không có thì `#<số dòng>`) giống `datahub.relation.labels`. " +
      "Phân trang: gửi `next_after` của trang trước vào `after`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({
      table_id: Id,
      column: z.string().min(1).max(100).describe("Mã hoặc tên cột Liên kết."),
      q: z.string().trim().max(100).optional(),
      after: z.coerce.number().int().min(0).optional().describe("Chỉ lấy dòng có số dòng lớn hơn giá trị này."),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    output: z.object({ data: z.array(z.object({ id: Id, row_no: z.number().int(), label: z.string() })), next_after: z.number().int().nullable() }),
    http: { method: "GET", path: "/tables/:table_id/relation-search" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      const schema = await TableSchema.load(ctx.db, acc);
      const col = schema.tryResolve(i.column);
      if (!col || col.deletedAt || col.type !== "relation") throw new AppError("validation_error", "Cột này không phải cột Liên kết.");
      const target = col.config.target_table_id as string;
      const cols = await ctx.db.execute(sql`SELECT key FROM dh_columns WHERE /*scope*/ table_id = ${target}::uuid AND deleted_at IS NULL AND type IN ('text', 'long_text', 'email', 'phone', 'url') ORDER BY position, created_at, id LIMIT 1`);
      const key = (cols.rows[0] as { key: string } | undefined)?.key;
      const label = key ? sql`COALESCE(NULLIF(r.data->>${sql.raw(`'${assertColumnKey(key)}'`)}, ''), '#' || r.row_no::text)` : sql`'#' || r.row_no::text`;
      const lt = await resolveLinkTarget(ctx, acc.datahub.ownerId, target);
      if (!lt) return { data: [], next_after: null };
      const where = [sql`/*scope:rows*/ r.table_id = ${target}::uuid`, sql`r.deleted_at IS NULL`, sql`t.deleted_at IS NULL`, sql`d.deleted_at IS NULL`, lt.own ? sql`d.owner_id = ${acc.datahub.ownerId}::uuid` : readableRows(lt.acc, "r")];
      if (i.after !== undefined) where.push(sql`r.row_no > ${i.after}::bigint`);
      const q = (i.q ?? "").trim();
      if (q) {
        const num = /^#?(\d{1,15})$/.exec(q);
        const like = `%${likeEscape(q)}%`;
        const byText = sql`soe_unaccent(lower(r.search)) LIKE soe_unaccent(lower(${like})) ESCAPE '\\'`;
        where.push(num ? sql`(${byText} OR r.row_no = ${Number(num[1])}::bigint)` : byText);
      }
      const res = await ctx.db.execute(sql`SELECT r.id, r.row_no::int AS row_no, ${label} AS label FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
        WHERE ${sql.join(where, sql` AND `)} ORDER BY r.row_no LIMIT ${i.limit + 1}`);
      const rows = res.rows as { id: string; row_no: number; label: string }[];
      const more = rows.length > i.limit;
      const data = more ? rows.slice(0, i.limit) : rows;
      return { data, next_after: more ? data[data.length - 1]!.row_no : null };
    },
  }),

  defineCommand({
    name: "datahub.row.restore_batch",
    summary: "Khôi phục nhiều dòng từ thùng rác trong một giao dịch (tối đa 500). Dùng cho \"Hoàn tác\" sau khi xoá nhiều dòng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, row_ids: z.array(Id).min(1).max(500) }),
    output: z.object({ rows: z.array(RowBrief), seq: z.number().int() }),
    http: { method: "POST", path: "/tables/:table_id/rows/restore-batch" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      return restoreRows(ctx, acc, schema, [...new Set(i.row_ids)]);
    },
  }),
];
