import { sql } from "drizzle-orm";
import { BUSINESS_TIMEZONE } from "@soe/shared";
import type { Db, OutboxRow } from "@soe/db";
import { decrypt } from "../../auth/crypto";
import { CODE_TTL_HOURS } from "../auth/codes";
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
  dealPaymentConfirmed: "deal.payment.confirmed",
  datahubShared: "datahub.shared",
  dashboardShared: "dashboard.shared",
  importDone: "datahub.import.done",
  exportDone: "datahub.export.done",
  reminderDue: "reminder.due",
  morningDigest: "digest.morning",
  dealDue: "deal.due",
  announcement: "announcement",
} as const;

const vnTime = (iso: string): string =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));

// ---- Stage 1 types ---------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.authCode,
  category: "account",
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

const decided = (type: string, status: "active" | "rejected" | "revoked", title: string, text: (name: string) => string, important = false) =>
  defineNotification({
    type,
    category: "ai",
    on: "auth.token.decided",
    mandatory: true,
    priority: important ? "important" : "normal",
    recipients: (ev) => ((ev.payload as { status: string }).status === status ? [(ev.payload as { user_id: string }).user_id] : []),
    object: (ev) => ({ type: "api_token", id: (ev.payload as { token_id: string }).token_id }),
    render: async (ev, _r, _by, _c, { db }) => ({ title, body: text((await tokenInfo(db, (ev.payload as { token_id: string }).token_id))?.name ?? ""), link: "/tai-khoan/token" }),
  });
decided(NOTIFICATION_TYPES.aiApproved, "active", "Kết nối AI được duyệt", (n) => `Kết nối "${n}" đã được duyệt, dùng được ngay.`);
decided(NOTIFICATION_TYPES.aiRejected, "rejected", "Kết nối AI bị từ chối", (n) => `Kết nối "${n}" bị từ chối. Xem lại và tạo kết nối khác nếu cần.`);
decided(NOTIFICATION_TYPES.aiRevoked, "revoked", "Kết nối AI bị thu hồi", (n) => `Kết nối "${n}" đã bị thu hồi, không dùng được nữa.`, true);

defineNotification({
  type: NOTIFICATION_TYPES.aiExpiring,
  category: "ai",
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

for (const [kind, type, title, text] of [
  ["added", NOTIFICATION_TYPES.dealParticipantAdded, "Bạn được thêm vào deal", (d: string) => `Bạn được thêm vào deal "${d}". Xem vai trò và tỉ lệ của bạn trong deal.`],
  ["changed", NOTIFICATION_TYPES.dealParticipantChanged, "Vai trò hoặc tỉ lệ của bạn ở deal đã đổi", (d: string) => `Vai trò hoặc tỉ lệ của bạn ở deal "${d}" vừa được cập nhật.`],
  ["removed", NOTIFICATION_TYPES.dealParticipantRemoved, "Bạn không còn trong deal", (d: string) => `Bạn đã được bỏ khỏi deal "${d}".`],
] as const) {
  defineNotification({
    type,
    category: "deal",
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

// ---- Deal payments ---------------------------------------------------------------------------------------------------------------------------

defineNotification({
  type: NOTIFICATION_TYPES.dealPaymentConfirmed,
  category: "deal",
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

defineNotification({ type: NOTIFICATION_TYPES.importDone, category: "datahub", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.exportDone, category: "datahub", render: () => null });
defineNotification({ type: NOTIFICATION_TYPES.reminderDue, category: "reminder", priority: "important", mandatory: true, selfNotify: true, render: () => null });

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
defineNotification({ type: NOTIFICATION_TYPES.morningDigest, category: "digest", render: () => null });
/** A due-date reminder of the tree's rules (6.4): the Manager's rule, so the people it names cannot switch it off. */
defineNotification({ type: NOTIFICATION_TYPES.dealDue, category: "deal", mandatory: true, render: () => null });
/** A general announcement sent by hand (7): cannot be switched off. */
defineNotification({ type: NOTIFICATION_TYPES.announcement, category: "announcement", mandatory: true, render: () => null });
