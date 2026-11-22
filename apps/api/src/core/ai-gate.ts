/**
 * The check a call must pass when it comes through a connection (personal token on REST, or `via = mcp`):
 * connection status, rate limit, emergency switch, forbidden group, menu and level (design module5 3.5).
 * The owner's own permission is checked by the authorizer in the executor; this adds the other layers.
 */
import { sql } from "drizzle-orm";
import { AppError, type Actor } from "@soe/shared";
import { apiTokens, type Executor } from "@soe/db";
import { eq } from "drizzle-orm";
import { readSetting, SETTINGS } from "../modules/system/settings-catalog";
import { AI_LEVELS, GROUP_LABELS, LEVEL_LABELS, MENU_LABELS, accessOfInput, type AiAccess, type AiMenu } from "./ai-policy";
import type { Operation } from "./types";

export const AI_RATE_CALLS_PER_MIN = 120;
export const AI_RATE_WRITES_PER_MIN = 30;

/** True when the call is subject to connection rules. */
export const isConnectionActor = (a: Actor): boolean => a.via === "mcp" || a.connectionKind === "personal";

export interface ConnectionInfo {
  id: string;
  userId: string;
  name: string;
  status: string;
  menus: Record<string, AiAccess>;
  expiresAt: Date;
}

export async function loadConnection(ex: Executor, id: string): Promise<ConnectionInfo | null> {
  const [t] = await ex.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
  if (!t || t.kind !== "personal") return null;
  return { id: t.id, userId: t.userId, name: t.name, status: t.status, menus: (t.menus ?? {}) as Record<string, AiAccess>, expiresAt: t.expiresAt };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_KEYS = ["table_id", "datahub_id", "view_id", "job_id", "chart_id", "dashboard_id", "metric_id", "source_id"] as const;

/** SQL (marked `scope:system`: it reads only the kind of the datahub, never a row; the owner check is the handler's) that returns the `system_key` of the datahub behind one id (null column = an ordinary datahub; no row = unknown id). */
const LOOKUP: Record<(typeof TARGET_KEYS)[number], (id: string) => ReturnType<typeof sql>> = {
  table_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE t.id = ${id}::uuid`,
  datahub_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM dh_datahubs d WHERE d.id = ${id}::uuid`,
  view_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM dh_views v JOIN dh_tables t ON t.id = v.table_id JOIN dh_datahubs d ON d.id = t.datahub_id WHERE v.id = ${id}::uuid`,
  job_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM dh_jobs j LEFT JOIN dh_tables t ON t.id = j.table_id JOIN dh_datahubs d ON d.id = COALESCE(j.datahub_id, t.datahub_id) WHERE j.id = ${id}::uuid`,
  chart_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM mt_charts c JOIN mt_dashboards b ON b.id = c.dashboard_id JOIN dh_datahubs d ON d.id = b.datahub_id WHERE c.id = ${id}::uuid`,
  dashboard_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM mt_dashboards b JOIN dh_datahubs d ON d.id = b.datahub_id WHERE b.id = ${id}::uuid`,
  metric_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM mt_metrics m JOIN dh_datahubs d ON d.id = m.datahub_id WHERE m.id = ${id}::uuid`,
  source_id: (id) => sql`/*scope:system*/ SELECT d.system_key FROM mt_sources s JOIN dh_datahubs d ON d.id = s.datahub_id WHERE s.id = ${id}::uuid`,
};

/** Table ids named deeper in the input (an inline metric's `source`, the `table_id` of a merge source...). Depth and count are bounded. */
function nestedTableIds(v: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 5 || out.length >= 50 || v === null || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((k === "table_id" || k === "source") && typeof x === "string" && UUID_RE.test(x)) out.push(x);
    else if (x && typeof x === "object") nestedTableIds(x, depth + 1, out);
  }
  return out;
}

/**
 * `datahub.import.start`: the target is in the mapping, not in a top-level id. Any table or datahub of "Quản lý Deal" -> `deal`;
 * new datahub/tables or other datahubs -> `datahub`. A malformed id closes the door (null).
 */
async function importMenu(ex: Executor, mapping: Record<string, unknown>): Promise<"deal" | "datahub" | null> {
  const isDeal = async (q: ReturnType<typeof sql>): Promise<boolean | null> => {
    const row = (await ex.execute(q)).rows[0] as { system_key: string | null } | undefined;
    return row ? row.system_key === "deal" : null;
  };
  const ids: { key: "datahub_id" | "table_id"; id: string }[] = [];
  const dh = mapping.datahub as { id?: unknown } | undefined;
  if (dh && typeof dh === "object" && "id" in dh) ids.push({ key: "datahub_id", id: String(dh.id) });
  for (const sh of Array.isArray(mapping.sheets) ? (mapping.sheets as { table?: { mode?: string; table_id?: unknown } }[]) : []) {
    if (sh?.table?.mode === "existing") ids.push({ key: "table_id", id: String(sh.table.table_id) });
  }
  for (const { key, id } of ids) {
    if (!UUID_RE.test(id)) return null;
    const r = await isDeal(LOOKUP[key](id));
    if (r === null) return null;
    if (r) return "deal";
  }
  return "datahub";
}

/**
 * The menu of a call aimed at a datahub: "Quản lý Deal" -> `deal`, any other datahub -> `datahub` (module5 3.1).
 * Looks at every id in the input: the top-level ones (table, datahub, view, job, chart, dashboard, metric, source) must all be known,
 * and tables named deeper (inline metric source, merge sources) count too. If one of them belongs to the Deal datahub the whole call is
 * `deal`. Returns null when the input names no known target: the caller keeps the door closed.
 */
export async function menuOfTarget(ex: Executor, input: unknown): Promise<"deal" | "datahub" | null> {
  const i = (input ?? {}) as Record<string, unknown>;
  if (i.mapping && typeof i.mapping === "object") return importMenu(ex, i.mapping as Record<string, unknown>);
  let found: "deal" | "datahub" | null = null;
  const system = async (key: (typeof TARGET_KEYS)[number], id: string): Promise<"deal" | "datahub" | "unknown"> => {
    const res = await ex.execute(LOOKUP[key](id));
    const row = res.rows[0] as { system_key: string | null } | undefined;
    return !row ? "unknown" : row.system_key === "deal" ? "deal" : "datahub";
  };
  for (const key of TARGET_KEYS) {
    const v = i[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || !UUID_RE.test(v)) return null;
    const m = await system(key, v);
    if (m === "unknown") return null;
    if (m === "deal") return "deal";
    found = "datahub";
  }
  for (const id of nestedTableIds(i)) {
    const m = await system("table_id", id);
    if (m === "deal") return "deal";
  }
  return found;
}

/** Per-connection counters of the current minute (in memory: one API process; a restart resets them, which is harmless). */
export class AiRateLimiter {
  private readonly buckets = new Map<string, { minute: number; calls: number; writes: number }>();
  hit(connectionId: string, isWrite: boolean, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const minute = Math.floor(now / 60_000);
    let b = this.buckets.get(connectionId);
    if (!b || b.minute !== minute) {
      b = { minute, calls: 0, writes: 0 };
      this.buckets.set(connectionId, b);
      if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.minute !== minute) this.buckets.delete(k);
    }
    b.calls++;
    if (isWrite) b.writes++;
    if (b.calls > AI_RATE_CALLS_PER_MIN || b.writes > AI_RATE_WRITES_PER_MIN) return { ok: false, retryAfterSeconds: 60 - Math.floor((now % 60_000) / 1000) };
    return { ok: true };
  }
}

const rank = (a: AiAccess) => AI_LEVELS.indexOf(a);

/** Part of the check that needs no connection: the operation itself and the Admin's policy. Throws `ai_not_allowed`. */
export async function checkAiPolicy(ex: Executor, op: Operation): Promise<void> {
  const f = op.ai?.forbidden;
  if (!op.aiAllowed || f === "hard") throw new AppError("ai_not_allowed", "Thao tác này không cho phép AI gọi.");
  if (await readSetting(ex, SETTINGS.aiKilled)) throw new AppError("ai_not_allowed", "Admin đã tạm tắt kết nối AI. Thử lại sau khi Admin bật lại.");
  if (f && !(await readSetting(ex, SETTINGS.aiGroups)).includes(f)) throw new AppError("ai_not_allowed", `Admin chưa bật nhóm ${GROUP_LABELS[f]} cho AI.`, { group: f });
  if (!op.ai) throw new AppError("ai_not_allowed", "Thao tác này chưa được khai báo menu cho AI.");
}

/** The connection layers: status, rate limit. Returns the connection. */
export async function checkConnection(ex: Executor, actor: Actor, op: Operation, limiter: AiRateLimiter): Promise<ConnectionInfo> {
  if (!actor.connectionId) throw new AppError("unauthenticated", "Thiếu kết nối hợp lệ.");
  const c = await loadConnection(ex, actor.connectionId);
  if (!c || c.userId !== actor.userId) throw new AppError("unauthenticated", "Kết nối không hợp lệ.");
  if (c.status === "pending") throw new AppError("connection_pending", "Kết nối đang chờ Admin duyệt. Báo Admin của bạn rồi thử lại.");
  if (c.status !== "active") throw new AppError("unauthenticated", "Kết nối đã bị thu hồi hoặc bị từ chối.");
  if (c.expiresAt.getTime() <= Date.now()) throw new AppError("unauthenticated", "Kết nối đã hết hạn.");
  const hit = limiter.hit(c.id, op.kind === "command");
  if (!hit.ok) throw new AppError("rate_limited", `Kết nối này gọi quá nhanh. Chờ ${hit.retryAfterSeconds} giây rồi thử lại.`, { retry_after_seconds: hit.retryAfterSeconds });
  return c;
}

/** The menu and level of the connection against what the call needs. Throws `forbidden` with a message the AI can act on. */
export async function checkMenuAndLevel(ex: Executor, c: ConnectionInfo, op: Operation, input: unknown): Promise<void> {
  const ai = op.ai!;
  if (ai.menu === "none") return;
  let menu: AiMenu;
  if (ai.menu === "by_target") {
    const m = await menuOfTarget(ex, input);
    if (!m) throw new AppError("forbidden", "Không xác định được datahub của lệnh gọi này, nên kết nối không được phép. Gửi kèm table_id hoặc datahub_id hợp lệ.", { reason: "connection_target" });
    menu = m;
  } else menu = ai.menu;
  const needed = accessOfInput(op.name, input) ?? ai.access;
  const held = c.menus[menu];
  const label = MENU_LABELS[menu];
  if (!held) throw new AppError("forbidden", `Kết nối này chưa có menu ${label}. Vào Cài đặt → Kết nối AI để tạo kết nối mới có menu này.`, { reason: "connection_menu", menu, needed });
  if (rank(held) < rank(needed)) {
    throw new AppError("forbidden", `Kết nối này chỉ có mức ${LEVEL_LABELS[held]} cho ${label}, thao tác này cần mức ${LEVEL_LABELS[needed]}. Vào Cài đặt → Kết nối AI để tạo kết nối mới có mức cao hơn.`, { reason: "connection_level", menu, held, needed });
  }
}
