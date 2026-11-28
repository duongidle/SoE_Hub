import { sql } from "drizzle-orm";
import { BUSINESS_TIMEZONE, businessDate } from "@soe/shared";
import type { Db, OutboxRow } from "@soe/db";
import { decrypt } from "../../auth/crypto";
import { CODE_TTL_HOURS } from "../auth/codes";
import { rowAudience } from "../datahub/access";
import { notifyOptionsOf } from "../datahub/notify-option";
import { entriesOf, userIdsOf } from "../datahub/user-values";
import { adminIds, defineNotification, notify, stableId, type NotifyDeps } from "./notify";

/**
 * Every notification type of Stages 1-6 (design module6 3.2 and 14). Bodies are written per recipient: nothing here carries a cell value or another
 * person's commission. To add a type: `defineNotification` below, one render, add the type to `NOTIFICATION_TYPES` and to the `notification_types` test.
 */
export const NOTIFICATION_TYPES = {
  authCode: "auth.code",
  datahubReconcile: "datahub.reconcile",
  datahubTemplateConflict: "datahub.template.conflict",
  aiRequested: "ai.connection.requested",
  aiApproved: "ai.connection.approved",
  aiRejected: "ai.connection.rejected",
  aiRevoked: "ai.connection.revoked",
  aiExpiring: "ai.connection.expiring",
  accountLocked: "account.locked",
  dealParticipantAdded: "deal.participant.added",
  dealParticipantChanged: "deal.participant.changed",
  dealParticipantRemoved: "deal.participant.removed",
  kpiEditedAfterCommit: "deal.kpi.edited_after_commit",
  cellChanged: "datahub.cell.changed",
  dealPaymentConfirmed: "deal.payment.confirmed",
  datahubShared: "datahub.shared",
  dashboardShared: "dashboard.shared",
  importDone: "datahub.import.done",
  exportDone: "datahub.export.done",
  reminderDue: "reminder.due",
  morningDigest: "digest.morning",
  dealDue: "deal.due",
  announcement: "announcement",
  formGradePending: "form.grade.pending",
  formGraded: "form.graded",
  formQuestionOff: "form.question.off",
  postPending: "post.pending",
  postApproved: "post.approved",
  postReturned: "post.returned",
  feedbackNew: "feedback.new",
  feedbackUpdate: "feedback.update",
  onboardingDaily: "onboarding.daily",
  onboardingDue: "onboarding.due",
  onboardingOverdue: "onboarding.overdue",
  onboardingWeekMissed: "onboarding.week_missed",
} as const;

const vnTime = (iso: string): string =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));

// ---- Stage 1 types ---------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.authCode,
  category: "account",
  label: "Yêu cầu mã kích hoạt hoặc đặt lại mật khẩu",
  description: "Có người xin mã kích hoạt tài khoản hoặc đặt lại mật khẩu và bạn là người duyệt.",
  on: "auth.code.requested",
  mandatory: true,
  priority: "important",
  recipients: (ev) => (ev.payload as { recipient_ids: string[] }).recipient_ids,
  render: (ev, _r, _by, _c, { secret }) => {
    const p = ev.payload as { purpose: string; email: string; full_name: string; requested_at: string; expires_at: string; code_enc: string; code_id: string };
    const code = decrypt(secret, p.code_enc);
    const what = p.purpose === "activate" ? "kích hoạt tài khoản" : "đặt lại mật khẩu";
    return {
      title: p.purpose === "activate" ? "Yêu cầu kích hoạt tài khoản" : "Yêu cầu đặt lại mật khẩu",
      body: `${p.full_name} (${p.email}) yêu cầu ${what} lúc ${vnTime(p.requested_at)}. Mã: ${code}. Mã hết hạn sau ${CODE_TTL_HOURS} giờ. Chỉ đưa mã khi chắc chắn đúng người.`,
      data: { code, email: p.email, purpose: p.purpose, code_id: p.code_id, expires_at: p.expires_at },
    };
  },
});

/** Nightly reconciliation found stored values that a full recomputation does not give (design module2 6.7). Column names only, never values. */
defineNotification({
  type: NOTIFICATION_TYPES.datahubReconcile,
  category: "datahub",
  label: "Đối soát Datahub phát hiện ô tính sai",
  description: "Báo cho Admin khi việc đối soát ban đêm thấy ô công thức khác kết quả tính lại.",
  on: "datahub.reconcile.mismatch",
  mandatory: true,
  recipients: (ev) => (ev.payload as { recipient_ids: string[] }).recipient_ids,
  render: (ev) => {
    const p = ev.payload as { cells: number; columns: { table_id: string; column_key: string; column_name: string; cells: number }[] };
    const list = p.columns.slice(0, 10).map((c) => `"${c.column_name}" (${c.cells} ô)`).join(", ");
    const more = p.columns.length > 10 ? ` và ${p.columns.length - 10} cột khác` : "";
    return {
      title: "Đối soát Datahub phát hiện ô tính sai",
      body: `${p.cells} ô công thức khác kết quả tính lại cả cột, ở ${p.columns.length} cột: ${list}${more}. Giá trị đã được sửa lại cho đúng. Cần tìm nguyên nhân gốc.`,
      data: { cells: p.cells, columns: p.columns },
    };
  },
});

/** A template table or column took the name of the person's own: theirs was renamed (design module4 3.1, 3.5). Names only. */
defineNotification({
  type: NOTIFICATION_TYPES.datahubTemplateConflict,
  category: "datahub",
  label: "Bảng hoặc cột của bạn bị đổi tên",
  description: "Tên bảng hoặc cột của bạn trùng template nên được đổi tên, dữ liệu giữ nguyên.",
  on: "datahub.template.conflict",
  mandatory: true,
  recipients: (ev) => [(ev.payload as { recipient_id: string }).recipient_id],
  render: (ev) => {
    const p = ev.payload as { template_name: string; object: "table" | "column" | "datahub"; old_name: string; new_name: string; table_name?: string };
    const what = p.object === "table" ? "Bảng" : p.object === "column" ? "Cột" : "Datahub";
    const where = p.object === "column" && p.table_name ? ` trong bảng "${p.table_name}"` : "";
    return {
      title: `${what} của bạn được đổi tên`,
      body: `${what} "${p.old_name}"${where} trùng tên với template "${p.template_name}" nên được đổi thành "${p.new_name}". Dữ liệu và công thức giữ nguyên.`,
      data: { object: p.object, old_name: p.old_name, new_name: p.new_name, template_name: p.template_name },
    };
  },
});

// ---- AI connections --------------------------------------------------------------------------------------------------------------------------

const tokenInfo = async (db: Db, id: string): Promise<{ name: string; ownerName: string | null } | null> => {
  const [r] = (await db.execute(sql`SELECT t.name, u.full_name AS owner_name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE /*scope:system*/ t.id = ${id}::uuid`)).rows as { name: string; owner_name: string | null }[];
  return r ? { name: r.name, ownerName: r.owner_name } : null;
};

defineNotification({
  type: NOTIFICATION_TYPES.aiRequested,
  category: "ai",
  label: "Kết nối AI chờ duyệt",
  description: "Có người xin kết nối AI mới, Admin vào duyệt.",
  on: "auth.token.requested",
  mandatory: true,
  priority: "important",
  recipients: (_ev, { db }) => adminIds(db),
  object: (ev) => ({ type: "api_token", id: (ev.payload as { token_id: string }).token_id }),
  render: async (ev, _r, by, _c, { db }) => {
    const t = await tokenInfo(db, (ev.payload as { token_id: string }).token_id);
    return { title: "Kết nối AI chờ duyệt", body: `${t?.ownerName ?? by} xin kết nối AI "${t?.name ?? (ev.payload as { name: string }).name}". Vào Quản trị, Kết nối AI để duyệt.`, link: "/quan-tri/token" };
  },
});

const decided = (type: string, label: string, description: string, status: "active" | "rejected" | "revoked", title: string, text: (name: string) => string, important = false) =>
  defineNotification({
    type,
    category: "ai",
    label,
    description,
    on: "auth.token.decided",
    mandatory: true,
    priority: important ? "important" : "normal",
    recipients: (ev) => ((ev.payload as { status: string }).status === status ? [(ev.payload as { user_id: string }).user_id] : []),
    object: (ev) => ({ type: "api_token", id: (ev.payload as { token_id: string }).token_id }),
    render: async (ev, _r, _by, _c, { db }) => ({ title, body: text((await tokenInfo(db, (ev.payload as { token_id: string }).token_id))?.name ?? ""), link: "/tai-khoan/token" }),
  });
decided(NOTIFICATION_TYPES.aiApproved, "Kết nối AI được duyệt", "Kết nối AI của bạn đã được duyệt và dùng được ngay.", "active", "Kết nối AI được duyệt", (n) => `Kết nối "${n}" đã được duyệt, dùng được ngay.`);
decided(NOTIFICATION_TYPES.aiRejected, "Kết nối AI bị từ chối", "Kết nối AI của bạn bị từ chối.", "rejected", "Kết nối AI bị từ chối", (n) => `Kết nối "${n}" bị từ chối. Xem lại và tạo kết nối khác nếu cần.`);
decided(NOTIFICATION_TYPES.aiRevoked, "Kết nối AI bị thu hồi", "Kết nối AI của bạn bị thu hồi, không dùng được nữa.", "revoked", "Kết nối AI bị thu hồi", (n) => `Kết nối "${n}" đã bị thu hồi, không dùng được nữa.`, true);

defineNotification({
  type: NOTIFICATION_TYPES.aiExpiring,
  category: "ai",
  label: "Kết nối AI sắp hết hạn",
  description: "Nhắc trước 7 ngày khi kết nối AI của bạn sắp hết hạn.",
  mandatory: true,
  render: () => null,
});

export const EXPIRY_WARN_DAYS = 7;

/** Daily job: tells the owner of every active connection that ends within a week. Once per connection (idempotent by a stable id). */
export async function notifyExpiringConnections(db: Db): Promise<number> {
  const rows = (await db.execute(sql`SELECT id, user_id, name, expires_at FROM api_tokens WHERE /*scope:system*/ kind = 'personal' AND status = 'active' AND expires_at > now() AND expires_at < now() + make_interval(days => ${EXPIRY_WARN_DAYS})`)).rows as { id: string; user_id: string; name: string; expires_at: Date }[];
  let n = 0;
  for (const t of rows) {
    n += await notify.send(db, {
      type: NOTIFICATION_TYPES.aiExpiring,
      recipients: [t.user_id],
      object: { type: "api_token", id: t.id },
      sourceEventId: stableId("ai.expiring", t.id),
      render: () => ({ title: "Kết nối AI sắp hết hạn", body: `Kết nối "${t.name}" hết hạn ngày ${new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIMEZONE }).format(new Date(t.expires_at))}. Tạo kết nối mới trước khi hết hạn.`, link: "/tai-khoan/token" }),
    });
  }
  return n;
}

// ---- Account ---------------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.accountLocked,
  category: "account",
  label: "Tài khoản bị khoá tạm thời",
  description: "Tài khoản của bạn bị khoá 15 phút vì nhập sai mật khẩu nhiều lần.",
  on: "auth.account.locked",
  mandatory: true,
  priority: "important",
  recipients: (ev) => [(ev.payload as { user_id: string }).user_id],
  render: (ev) => ({ title: "Tài khoản bị khoá tạm thời", body: `Có người nhập sai mật khẩu quá nhiều lần, tài khoản của bạn bị khoá ${(ev.payload as { minutes: number }).minutes} phút. Nếu không phải bạn, hãy đổi mật khẩu sau khi mở khoá.` }),
});

// ---- Rows: participants of a deal, Probation KPI ---------------------------------------------------------------------------------------------

interface RowEvent {
  table_id: string;
  row_ids: string[];
  columns: string[];
}
type HistoryRow = { row_id: string; op: string; changes: { field: string; old: unknown; new: unknown }[] };
interface ParticipantChange {
  rowId: string;
  userId: string;
  kind: "added" | "changed" | "removed";
  deal: string;
  tableId: string;
}

/** The history rows the event's own transaction wrote (history and outbox rows share the transaction time, to the millisecond). */
async function historyOf(ev: OutboxRow, db: Db): Promise<HistoryRow[]> {
  const p = ev.payload as RowEvent;
  if (!p.row_ids?.length) return [];
  return (await db.execute(sql`SELECT row_id, op, changes FROM row_history WHERE table_id = ${p.table_id} AND row_id = ANY(${`{${p.row_ids.join(",")}}`}::uuid[])
    AND date_trunc('milliseconds', at) = date_trunc('milliseconds', ${ev.createdAt.toISOString()}::timestamptz) AND op IN ('create', 'update')`)).rows as HistoryRow[];
}

/** Role set of a table, remembered for a minute: most row events are on plain tables and must cost no more than this one lookup (and none when cached). */
const setCache = new Map<string, { set: string | null; at: number }>();
async function roleSetOfTable(db: Db, tableId: string): Promise<string | null> {
  const hit = setCache.get(tableId);
  if (hit && Date.now() - hit.at < 60_000) return hit.set;
  const [t] = (await db.execute(sql`SELECT role_set FROM dh_tables WHERE /*scope:system*/ id = ${tableId}::uuid`)).rows as { role_set: string | null }[];
  const set = t?.role_set ?? null;
  setCache.set(tableId, { set, at: Date.now() });
  if (setCache.size > 2000) setCache.delete(setCache.keys().next().value!);
  return set;
}

const cache = new Map<string, Promise<ParticipantChange[]>>();
/** Who joined, left or had their role/share changed on the deals of a row event. Computed once per event for the three types. */
function participantChanges(ev: OutboxRow, db: Db): Promise<ParticipantChange[]> {
  let p = cache.get(ev.id);
  if (!p) {
    p = computeParticipantChanges(ev, db);
    cache.set(ev.id, p);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function computeParticipantChanges(ev: OutboxRow, db: Db): Promise<ParticipantChange[]> {
  const payload = ev.payload as RowEvent;
  if ((await roleSetOfTable(db, payload.table_id)) !== "deals") return [];
  const cols = (await db.execute(sql`SELECT key, role FROM dh_columns WHERE /*scope:system*/ table_id = ${payload.table_id}::uuid AND deleted_at IS NULL AND role IN ('nguoi_tham_gia', 'ten_cong_ty') AND (role = 'ten_cong_ty' OR type = 'user')`)).rows as { key: string; role: string }[];
  const people = cols.filter((c) => c.role === "nguoi_tham_gia").map((c) => c.key);
  if (people.length === 0) return [];
  const nameKey = cols.find((c) => c.role === "ten_cong_ty")?.key;
  const history = (await historyOf(ev, db)).filter((h) => h.changes.some((c) => people.includes(c.field)));
  if (history.length === 0) return [];
  const rows = (await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ id = ANY(${`{${history.map((h) => h.row_id).join(",")}}`}::uuid[])`)).rows as { id: string; data: Record<string, unknown> }[];
  const dealName = new Map(rows.map((r) => [r.id, nameKey && typeof r.data[nameKey] === "string" ? (r.data[nameKey] as string) : "(chưa đặt tên)"]));
  const out: ParticipantChange[] = [];
  for (const h of history) {
    const side = (pick: "old" | "new"): Map<string, string> => {
      const m = new Map<string, string[]>();
      for (const k of people) {
        const ch = h.changes.find((c) => c.field === k);
        // An unchanged people column is not in the changes; its entries are the same on both sides, so it adds nothing to the comparison.
        for (const e of entriesOf(ch ? ch[pick] : null)) m.set(e.id, [...(m.get(e.id) ?? []), `${k}:${JSON.stringify(e.attrs ?? {})}`]);
      }
      return new Map([...m].map(([id, v]) => [id, v.sort().join("|")]));
    };
    const before = side("old");
    const after = side("new");
    const deal = dealName.get(h.row_id) ?? "";
    for (const [id, v] of after) {
      if (!before.has(id)) out.push({ rowId: h.row_id, userId: id, kind: "added", deal, tableId: payload.table_id });
      else if (before.get(id) !== v) out.push({ rowId: h.row_id, userId: id, kind: "changed", deal, tableId: payload.table_id });
    }
    for (const id of before.keys()) if (!after.has(id)) out.push({ rowId: h.row_id, userId: id, kind: "removed", deal, tableId: payload.table_id });
  }
  return out;
}

for (const [kind, type, label, description, title, text] of [
  ["added", NOTIFICATION_TYPES.dealParticipantAdded, "Bạn được thêm vào deal", "Có người thêm bạn làm người tham gia một deal.", "Bạn được thêm vào deal", (d: string) => `Bạn được thêm vào deal "${d}". Xem vai trò và tỉ lệ của bạn trong deal.`],
  ["changed", NOTIFICATION_TYPES.dealParticipantChanged, "Vai trò hoặc tỉ lệ của bạn ở deal đổi", "Vai trò hoặc tỉ lệ chia com của bạn ở một deal vừa được cập nhật.", "Vai trò hoặc tỉ lệ của bạn ở deal đã đổi", (d: string) => `Vai trò hoặc tỉ lệ của bạn ở deal "${d}" vừa được cập nhật.`],
  ["removed", NOTIFICATION_TYPES.dealParticipantRemoved, "Bạn không còn trong deal", "Bạn bị bỏ khỏi danh sách người tham gia một deal.", "Bạn không còn trong deal", (d: string) => `Bạn đã được bỏ khỏi deal "${d}".`],
] as const) {
  defineNotification({
    type,
    category: "deal",
    label,
    description,
    on: ["datahub.row.created", "datahub.row.updated"],
    mandatory: true,
    recipients: async (ev, { db }) => (await participantChanges(ev, db)).filter((c) => c.kind === kind).map((c) => ({ userId: c.userId, key: c.rowId, ctx: c })),
    render: (_ev, _r, _by, c) => {
      const ch = c as ParticipantChange;
      return { title, body: text(ch.deal), link: `/quan-ly-deal/${ch.tableId}`, data: { row_id: ch.rowId, table_id: ch.tableId } };
    },
  });
}

/** Probation KPI: a committed plan was changed (only the Manager can). Told to the person the row is about (the key columns of the table). */
defineNotification({
  type: NOTIFICATION_TYPES.kpiEditedAfterCommit,
  category: "deal",
  label: "KPI thử việc bị sửa sau khi chốt",
  description: "Manager sửa kế hoạch KPI thử việc của bạn sau khi đã chốt.",
  on: "datahub.row.updated",
  mandatory: true,
  recipients: async (ev, { db }) => {
    const payload = ev.payload as RowEvent;
    if ((await roleSetOfTable(db, payload.table_id)) !== "kpi") return [];
    const [t] = (await db.execute(sql`SELECT t.key_columns, t.name FROM dh_tables t WHERE /*scope:system*/ t.id = ${payload.table_id}::uuid`)).rows as { key_columns: string[] | null; name: string }[];
    const [status] = (await db.execute(sql`SELECT key, config FROM dh_columns WHERE /*scope:system*/ table_id = ${payload.table_id}::uuid AND deleted_at IS NULL AND role = 'trang_thai_commit' AND type = 'single_select'`)).rows as { key: string; config: { options?: { id: string; meaning?: string }[] } }[];
    if (!t || !status || !t.key_columns?.length) return [];
    const reason = (await db.execute(sql`SELECT key FROM dh_columns WHERE /*scope:system*/ table_id = ${payload.table_id}::uuid AND deleted_at IS NULL AND role = 'ly_do_sua'`)).rows as { key: string }[];
    const committed = new Set((status.config.options ?? []).filter((o) => o.meaning === "committed").map((o) => o.id));
    const history = (await historyOf(ev, db)).filter((h) => h.op === "update" && h.changes.some((c) => c.field !== reason[0]?.key));
    if (history.length === 0) return [];
    const rows = (await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ id = ANY(${`{${history.map((h) => h.row_id).join(",")}}`}::uuid[])`)).rows as { id: string; data: Record<string, unknown> }[];
    const data = new Map(rows.map((r) => [r.id, r.data]));
    const out: { userId: string; key: string; ctx: unknown }[] = [];
    for (const h of history) {
      const change = h.changes.find((c) => c.field === status.key);
      const wasCommitted = change ? committed.has(change.old as string) : committed.has(data.get(h.row_id)?.[status.key] as string);
      if (!wasCommitted) continue;
      for (const k of t.key_columns) for (const id of userIdsOf(data.get(h.row_id)?.[k])) out.push({ userId: id, key: h.row_id, ctx: { table: t.name, tableId: payload.table_id, rowId: h.row_id } });
    }
    return out;
  },
  render: (_ev, _r, by, c) => {
    const x = c as { table: string; tableId: string; rowId: string };
    return { title: "Kế hoạch KPI đã commit của bạn bị sửa", body: `${by} đã sửa kế hoạch đã commit của bạn (bảng "${x.table}"). Xem lịch sử dòng để biết chi tiết.`, link: `/datahub`, data: { row_id: x.rowId, table_id: x.tableId } };
  },
});

/**
 * Common column option "tell the people in column X when this column is edited" (design module9 5). Only a write of a person, the API or a form
 * reaches `datahub.row.updated` (a recalculation has its own event). A table without the option costs one remembered lookup. The body names the
 * columns, never a value; one notification per person and row within 10 minutes.
 */
const CELL_GROUP_MINUTES = 10;
defineNotification({
  type: NOTIFICATION_TYPES.cellChanged,
  category: "datahub",
  label: "Có người sửa ô bạn theo dõi",
  description: "Ai đó đổi giá trị ở dòng deal mà bạn là Leading (Status, doanh thu dự kiến, ngày dự kiến chốt).",
  on: "datahub.row.updated",
  recipients: async (ev, { db }) => {
    const payload = ev.payload as RowEvent;
    const opts = await notifyOptionsOf(db, payload.table_id);
    if (opts.length === 0) return [];
    const history = (await historyOf(ev, db)).filter((h) => h.op === "update" && h.changes.some((c) => opts.some((o) => o.key === c.field)));
    if (history.length === 0) return [];
    const rows = (await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ id = ANY(${`{${history.map((h) => h.row_id).join(",")}}`}::uuid[])`)).rows as { id: string; data: Record<string, unknown> }[];
    const data = new Map(rows.map((r) => [r.id, r.data]));
    const [t] = (await db.execute(sql`SELECT name, datahub_id FROM dh_tables WHERE /*scope:system*/ id = ${payload.table_id}::uuid`)).rows as { name: string; datahub_id: string }[];
    const out: { userId: string; key: string; ctx: unknown }[] = [];
    for (const h of history) {
      const changed = opts.filter((o) => h.changes.some((c) => c.field === o.key));
      const row = data.get(h.row_id);
      if (!row) continue;
      const people = new Set(changed.flatMap((o) => userIdsOf(row[o.peopleKey])));
      if (people.size === 0) continue;
      const seeing = new Set(await rowAudience(db, payload.table_id, [h.row_id]));
      const ids = [...people].filter((id) => seeing.has(id));
      if (ids.length === 0) continue;
      const recent = (await db.execute(sql`SELECT user_id FROM notifications WHERE /*scope:system*/ type = ${NOTIFICATION_TYPES.cellChanged} AND user_id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND data->>'row_id' = ${h.row_id}
        AND created_at > now() - make_interval(mins => ${CELL_GROUP_MINUTES}::int)`)).rows as { user_id: string }[];
      const skip = new Set(recent.map((r) => r.user_id));
      for (const id of ids) if (!skip.has(id)) out.push({ userId: id, key: h.row_id, ctx: { table: t?.name ?? "", datahubId: t?.datahub_id ?? "", tableId: payload.table_id, rowId: h.row_id, columns: changed.map((o) => o.name) } });
    }
    return out;
  },
  render: (_ev, _r, by, c) => {
    const x = c as { table: string; datahubId: string; tableId: string; rowId: string; columns: string[] };
    return { title: "Một dòng của bạn vừa được cập nhật", body: `${by} đã sửa ${x.columns.length === 1 ? "cột" : "các cột"} ${x.columns.map((n) => `"${n}"`).join(", ")} ở một dòng của bạn (bảng "${x.table}").`, link: `/datahub/${x.datahubId}/${x.tableId}`, data: { row_id: x.rowId, table_id: x.tableId } };
  },
});

// ---- Deal payments ---------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.dealPaymentConfirmed,
  category: "deal",
  label: "Xác nhận tiền về của deal",
  description: "Tiền về được xác nhận cho một đợt thanh toán của deal bạn tham gia.",
  on: "deal.payment.confirmed",
  recipients: (ev) => (ev.payload as { deals: { deal_id: string; user_ids: string[]; payments: number }[] }).deals.flatMap((d) => d.user_ids.map((u) => ({ userId: u, key: d.deal_id, ctx: d }))),
  object: () => null,
  render: (ev, _r, _by, c) => {
    const d = c as { deal_id: string; deal: string; payments: number };
    const table = (ev.payload as { table_id: string }).table_id;
    return { title: "Tiền về của deal đã được xác nhận", body: d.payments === 1 ? `Một đợt thanh toán của deal "${d.deal}" đã được xác nhận tiền về.` : `${d.payments} đợt thanh toán của deal "${d.deal}" đã được xác nhận tiền về.`, link: `/quan-ly-deal/${table}`, data: { deal_id: d.deal_id } };
  },
});

// ---- Sharing ---------------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.datahubShared,
  category: "datahub",
  label: "Datahub được chia sẻ với bạn",
  description: "Có người chia sẻ datahub hoặc bảng cho bạn.",
  on: "datahub.share.changed",
  recipients: (ev) => [(ev.payload as { grantee_id: string }).grantee_id],
  object: (ev) => ({ type: "datahub", id: (ev.payload as { datahub_id: string }).datahub_id }),
  // Removed again before the event was handled: nothing to tell.
  canView: async (ev, r, _c, { db }) => {
    const p = ev.payload as { datahub_id: string; table_id: string | null };
    const res = await db.execute(sql`SELECT 1 FROM dh_shares WHERE /*scope:system*/ datahub_id = ${p.datahub_id}::uuid AND grantee_id = ${r}::uuid AND ${p.table_id ? sql`table_id = ${p.table_id}::uuid` : sql`table_id IS NULL`}`);
    return res.rows.length > 0;
  },
  render: async (ev, _r, by, _c, { db }) => {
    const p = ev.payload as { datahub_id: string; table_id: string | null };
    const [d] = (await db.execute(sql`SELECT d.name AS datahub, t.name AS tbl FROM dh_datahubs d LEFT JOIN dh_tables t ON t.id = ${p.table_id}::uuid WHERE /*scope:system*/ d.id = ${p.datahub_id}::uuid`)).rows as { datahub: string; tbl: string | null }[];
    return { title: p.table_id ? "Bạn được chia sẻ một bảng" : "Bạn được chia sẻ một datahub", body: `${by} chia sẻ ${p.table_id ? `bảng "${d?.tbl ?? ""}" của datahub` : "datahub"} "${d?.datahub ?? ""}" cho bạn.`, link: p.table_id ? `/datahub/${p.datahub_id}/${p.table_id}` : `/datahub/${p.datahub_id}` };
  },
});

defineNotification({
  type: NOTIFICATION_TYPES.dashboardShared,
  category: "datahub",
  label: "Dashboard được chia sẻ với bạn",
  description: "Có người chia sẻ dashboard cho bạn.",
  on: "metrics.dashboard.share.changed",
  recipients: (ev) => [(ev.payload as { grantee_id: string }).grantee_id],
  object: (ev) => ({ type: "dashboard", id: (ev.payload as { dashboard_id: string }).dashboard_id }),
  canView: async (ev, r, _c, { db }) => {
    const res = await db.execute(sql`SELECT 1 FROM mt_dashboard_shares WHERE /*scope:system*/ dashboard_id = ${(ev.payload as { dashboard_id: string }).dashboard_id}::uuid AND grantee_id = ${r}::uuid`);
    return res.rows.length > 0;
  },
  render: (ev, _r, by) => {
    const p = ev.payload as { dashboard_id: string; name: string };
    return { title: "Bạn được chia sẻ một dashboard", body: `${by} chia sẻ dashboard "${p.name}" cho bạn.`, link: `/dashboard/${p.dashboard_id}` };
  },
});

// ---- Import and export jobs, reminders (sent directly, no event) -----------------------------------------------------------------------------

defineNotification({ type: NOTIFICATION_TYPES.importDone, category: "datahub", label: "Nhập dữ liệu xong", description: "Kết quả khi file bạn nhập vào Datahub chạy xong hoặc có dòng lỗi.", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.exportDone, category: "datahub", label: "Xuất dữ liệu xong", description: "Báo khi file xuất lớn của bạn đã sẵn sàng.", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.reminderDue, category: "reminder", label: "Nhắc hẹn đến giờ", description: "Nhắc hẹn do chính bạn đặt đã đến giờ.", priority: "important", mandatory: true, selfNotify: true, render: () => null });

interface JobRow {
  id: string;
  kind: string;
  status: string;
  ownerId: string;
  error: string | null;
  report: unknown;
  datahubId: string | null;
  tableId: string | null;
  resultName: string | null;
  sourceName: string | null;
}

/** Called by the job runner when an import or export ends. The person who started it is told, whatever the outcome (never by value). */
export async function notifyJobEnd(db: Db, job: JobRow): Promise<void> {
  if (job.kind !== "import" && job.kind !== "export") return;
  if (job.status === "cancelled") return;
  const link = job.datahubId ? (job.tableId ? `/datahub/${job.datahubId}/${job.tableId}` : `/datahub/${job.datahubId}`) : "/datahub";
  const sheets = ((job.report as { sheets?: { error_count?: number; created?: number; updated?: number }[] } | null)?.sheets ?? []).filter((s) => typeof s.error_count === "number");
  const errors = sheets.reduce((n, s) => n + (s.error_count ?? 0), 0);
  const type = job.kind === "import" ? NOTIFICATION_TYPES.importDone : NOTIFICATION_TYPES.exportDone;
  const what = job.kind === "import" ? "Nhập" : "Xuất";
  const name = job.kind === "import" ? job.sourceName : job.resultName;
  await notify.send(db, {
    type,
    recipients: [job.ownerId],
    object: { type: "dh_job", id: job.id },
    sourceEventId: stableId("job.end", job.id),
    render: () => {
      if (job.status === "failed") return { title: `${what} dữ liệu bị lỗi`, body: `${what} ${name ? `"${name}"` : "file"} không xong: ${job.error ?? "lỗi không rõ"}.`, link };
      if (errors > 0) return { title: `${what} xong, có dòng lỗi`, body: `${what} ${name ? `"${name}"` : "file"} xong, ${errors} dòng lỗi không vào được. Mở báo cáo để xem.`, link };
      return { title: `${what} dữ liệu xong`, body: `${what} ${name ? `"${name}"` : "file"} đã xong.`, link };
    },
  });
}

export type { NotifyDeps };

// ---- 6A2: morning digest, deal due reminders, announcements (sent directly with `notify.send`, no outbox event) ------------------------------

/** Morning digest (design module6 5.5): one per person per day, can be switched off with the digest flag (not with the type list). */
defineNotification({ type: NOTIFICATION_TYPES.morningDigest, category: "digest", label: "Bản tin buổi sáng", description: "Tóm tắt việc cần làm hôm nay, gửi lúc 08:00.", render: () => null });
/** A due-date reminder of the tree's rules (6.4): the Manager's rule, so the people it names cannot switch it off. */
defineNotification({ type: NOTIFICATION_TYPES.dealDue, category: "deal", label: "Deal hoặc đợt thanh toán đến hạn", description: "Nhắc theo quy tắc hạn: deal quá ngày dự kiến chốt, đợt thanh toán đến hạn.", mandatory: true, render: () => null });
/** A general announcement sent by hand (7): cannot be switched off. */
defineNotification({ type: NOTIFICATION_TYPES.announcement, category: "announcement", label: "Thông báo chung", description: "Thông báo từ Admin hoặc Manager gửi cho cả nhóm.", mandatory: true, render: () => null });

// ---- 7A2: quiz (sent directly with `notify.send`, no outbox event) -----------------------------------------------------------------------
/** A quiz response waits for a grader (design module7 7). */
defineNotification({ type: NOTIFICATION_TYPES.formGradePending, category: "form", label: "Bài làm chờ chấm", description: "Có người nộp bài cần bạn chấm điểm.", priority: "important", render: () => null });
/** A quiz was graded and the person may see the score (design module7 7). */
defineNotification({ type: NOTIFICATION_TYPES.formGraded, category: "form", label: "Bài của bạn đã được chấm", description: "Bài làm của bạn đã có điểm.", render: () => null });

/** Knowledge / AI Hub posts (design module8 2): waiting for a reviewer, approved, returned with a reason. Sent by the post engine (`publish/engine.ts`). */
defineNotification({ type: NOTIFICATION_TYPES.postPending, category: "library", label: "Bài chờ duyệt", description: "Có bài Knowledge hoặc AI Hub chờ bạn duyệt.", priority: "important", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.postApproved, category: "library", label: "Bài của bạn được duyệt", description: "Bài bạn đăng đã được duyệt và xuất bản.", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.postReturned, category: "library", label: "Bài của bạn bị trả lại", description: "Bài bạn đăng bị trả lại kèm lý do để sửa.", priority: "important", render: () => null });

/** Feedback (design module11 2): to the handlers of the inbox (new feedback, the sender wrote again); to the sender (a reply, a new status). Sent by `modules/feedback`. */
defineNotification({ type: NOTIFICATION_TYPES.feedbackNew, category: "feedback", label: "Feedback mới hoặc người gửi nhắn lại", description: "Có góp ý mới, hoặc người gửi nhắn lại, cho người xử lý feedback.", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.feedbackUpdate, category: "feedback", label: "Góp ý của bạn có cập nhật", description: "Góp ý bạn gửi có trả lời mới hoặc đổi trạng thái.", render: () => null });

/** A column a question writes to was deleted: the question is switched off and the owner must know (design module7 1.3, mandatory). */
defineNotification({
  type: NOTIFICATION_TYPES.formQuestionOff,
  category: "form",
  label: "Câu hỏi form bị tắt",
  description: "Cột mà một câu hỏi ghi vào đã bị xoá nên câu hỏi bị tắt.",
  on: "datahub.column.deleted",
  mandatory: true,
  priority: "important",
  selfNotify: true,
  recipients: async (ev, { db }) => {
    const p = ev.payload as { table_id?: string | null; column_key?: string; column_name?: string };
    if (!p.table_id || !p.column_key) return [];
    const r = await db.execute(sql`SELECT id, owner_id, name, draft FROM forms WHERE /*scope:system*/ table_id = ${p.table_id}::uuid AND deleted_at IS NULL`);
    const out: { userId: string; key: string; ctx: unknown }[] = [];
    for (const f of r.rows as { id: string; owner_id: string; name: string; draft: unknown }[]) {
      const hit = JSON.stringify(f.draft).includes(`"column_id":"${p.column_key}"`);
      if (hit) out.push({ userId: f.owner_id, key: f.id, ctx: { form_id: f.id, form_name: f.name } });
    }
    return out;
  },
  object: (ev) => ({ type: "datahub_table", id: ((ev.payload as { table_id?: string }).table_id ?? "") }),
  render: (ev, _r, _by, c) => {
    const p = ev.payload as { column_name?: string };
    const x = c as { form_id: string; form_name: string };
    return { title: "Một câu hỏi của form bị tắt", body: `Cột "${p.column_name ?? ""}" bị xoá nên câu hỏi nối với nó trong form "${x.form_name}" đã bị tắt. Form vẫn nhận các câu còn lại; khôi phục cột hoặc nối câu hỏi với cột khác.`, link: `/form/${x.form_id}`, data: { form_id: x.form_id } };
  },
});

// ---- 9C: onboarding (design module9 9) ---------------------------------------------------------------------------------------------------
/**
 * What a person on a plan did today, told to their direct Leader (the Manager when they have no Leader): one notification per person per day, rewritten as more comes in
 * (merge key = person + day). Names of things only: no answer, no score.
 */
defineNotification({
  type: NOTIFICATION_TYPES.onboardingDaily,
  category: "onboarding",
  label: "Tiến độ onboarding trong ngày",
  description: "Tóm tắt việc và checkpoint onboarding mà người bạn dẫn dắt vừa hoàn thành.",
  on: ["onboarding.item.ticked", "onboarding.checkpoint.passed"],
  mandatory: true,
  mergeKey: (ev) => `onb.daily|${(ev.payload as { staff_id: string }).staff_id}|${businessDate(ev.createdAt)}`,
  recipients: (ev) => {
    const p = ev.payload as { notify_id: string | null };
    return p.notify_id ? [p.notify_id] : [];
  },
  object: (ev) => ({ type: "onboarding_plan", id: (ev.payload as { plan_id: string }).plan_id }),
  render: async (ev, _r, _by, _c, { db }) => {
    const p = ev.payload as { plan_id: string; staff_id: string };
    const day = businessDate(ev.createdAt);
    const [u] = (await db.execute(sql`SELECT full_name FROM users WHERE /*scope:system*/ id = ${p.staff_id}::uuid`)).rows as { full_name: string }[];
    const [t] = (await db.execute(sql`/*scope:system*/ SELECT count(*)::int AS n FROM onb_occurrences WHERE plan_id = ${p.plan_id}::uuid AND (done_at AT TIME ZONE ${BUSINESS_TIMEZONE})::date = ${day}::date`)).rows as { n: number }[];
    const cps = (await db.execute(sql`/*scope:system*/ SELECT name FROM onb_checkpoints WHERE plan_id = ${p.plan_id}::uuid AND (passed_notified_at AT TIME ZONE ${BUSINESS_TIMEZONE})::date = ${day}::date ORDER BY position`)).rows as { name: string }[];
    const parts = [`xong ${t?.n ?? 0} việc`];
    if (cps.length) parts.push(`checkpoint đạt: ${cps.map((c) => `"${c.name}"`).join(", ")}`);
    return { title: `${u?.full_name ?? "Nhân sự"} hôm nay`, body: `${u?.full_name ?? "Nhân sự"}: ${parts.join("; ")}.`, link: "/onboarding/theo-doi", data: { plan_id: p.plan_id, staff_id: p.staff_id, day, items_done: t?.n ?? 0, checkpoints: cps.map((c) => c.name) } };
  },
});
/** Job-sent (no event): a work item reaches its reminder time, goes overdue, or a checkpoint of the week is still not met on Sunday evening. */
defineNotification({ type: NOTIFICATION_TYPES.onboardingDue, category: "onboarding", label: "Việc onboarding sắp đến hạn", description: "Nhắc việc onboarding sắp đến hạn.", priority: "important", mandatory: true, render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.onboardingOverdue, category: "onboarding", label: "Việc onboarding quá hạn", description: "Việc onboarding đã quá hạn.", priority: "important", mandatory: true, render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.onboardingWeekMissed, category: "onboarding", label: "Tuần onboarding bị lỡ", description: "Một tuần trong lộ trình onboarding không hoàn thành.", priority: "important", mandatory: true, render: () => null });
