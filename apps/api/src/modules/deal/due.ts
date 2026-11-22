import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError, BUSINESS_TIMEZONE, businessDate } from "@soe/shared";
import type { Db } from "@soe/db";
import { loadReader } from "../datahub/access";
import { entriesOf } from "../datahub/user-values";
import { defineCommand, defineQuery } from "../../core/registry";
import { NOTIFICATION_TYPES } from "../notification/catalog";
import { notify, stableId } from "../notification/notify";
import { roleTable, type RoleTable } from "./forecast";
import { entryRole, isLeadingRole } from "./participants";

/**
 * Deal due-date reminders and the morning digest (design module6 5.5, 6.4, 6.5, 14).
 *
 * Both read the Manager's tree by COLUMN ROLE from the master tables (system scope), like the forecast, and hand the people to `notify.send`, whose
 * `canView` keeps a person from hearing of a deal they do not read (the split lock: a key column holds them or someone they manage).
 * Rules: two built-in ones, switched on/off and given other milestones by the Manager (settings `deal.due_rules:<manager>`), one SQL per rule.
 */
export const RULE_KEYS = ["deal_expected_close", "payment_due"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export const WHO = ["leading", "participants", "leader", "manager"] as const;
export type Who = (typeof WHO)[number];
export const MAX_MILESTONES = 5;
/** More matching rows than this for one person: one grouped notification (design module6 6.5). */
export const GROUP_OVER = 50;

export interface Milestone {
  kind: "before" | "on" | "after";
  days: number;
  to: Who[];
}
export interface DueRule {
  key: RuleKey;
  enabled: boolean;
  milestones: Milestone[];
}

/** The built-in rules (design module6 6.4). */
export const DEFAULT_RULES: DueRule[] = [
  {
    key: "deal_expected_close",
    enabled: true,
    milestones: [
      { kind: "before", days: 3, to: ["leading"] },
      { kind: "after", days: 1, to: ["leading"] },
    ],
  },
  {
    key: "payment_due",
    enabled: true,
    milestones: [
      { kind: "before", days: 3, to: ["leading"] },
      { kind: "on", days: 0, to: ["leading"] },
      { kind: "after", days: 1, to: ["leading"] },
      { kind: "after", days: 7, to: ["leading", "leader"] },
    ],
  },
];

const MilestoneSchema = z.strictObject({
  kind: z.enum(["before", "on", "after"]),
  days: z.number().int().min(0).max(365),
  to: z.array(z.enum(WHO)).min(1).max(4),
});
export const RuleSchema = z.strictObject({ key: z.enum(RULE_KEYS), enabled: z.boolean(), milestones: z.array(MilestoneSchema).max(MAX_MILESTONES) });

const settingKey = (managerId: string) => `deal.due_rules:${managerId}`;
const lastRunKey = (managerId: string) => `deal.due_rules.last_run:${managerId}`;

async function readSetting<T>(db: Db, key: string): Promise<T | null> {
  const r = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${key}`);
  return ((r.rows[0] as { value: T } | undefined)?.value ?? null) as T | null;
}
async function writeSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.execute(sql`INSERT INTO system_settings (id, key, value, created_at, updated_at, version) VALUES (gen_random_uuid(), ${key}, ${JSON.stringify(value)}::jsonb, now(), now(), 1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = system_settings.version + 1`);
}

/** The rules of a tree: what the Manager saved, a rule they never touched keeps its default. */
export async function rulesOf(db: Db, managerId: string): Promise<DueRule[]> {
  const saved = (await readSetting<DueRule[]>(db, settingKey(managerId))) ?? [];
  return DEFAULT_RULES.map((d) => saved.find((s) => s.key === d.key) ?? d);
}

// ---- reading the tree ----------------------------------------------------------------------------------------------------------------------------

interface Tree {
  managerId: string;
  deals: RoleTable;
  pay: RoleTable | null;
  split: boolean;
  keyColumns: string[];
  /** Column key and name of every column holding `nguoi_tham_gia`. */
  peopleCols: { key: string; name: string }[];
  /** Option ids of the Status that are not "open" (won, lost...). */
  closed: string[];
}

async function loadTree(db: Db, managerId: string): Promise<Tree | null> {
  const deals = await roleTable(db, managerId, "deals");
  if (!deals) return null;
  const [t] = (await db.execute(sql`SELECT key_split, key_columns FROM dh_tables WHERE /*scope:system*/ id = ${deals.tableId}::uuid`)).rows as { key_split: boolean; key_columns: string[] | null }[];
  const cols = (await db.execute(sql`SELECT key, name FROM dh_columns WHERE /*scope:system*/ table_id = ${deals.tableId}::uuid AND role = 'nguoi_tham_gia' AND deleted_at IS NULL`)).rows as { key: string; name: string }[];
  const closed = [...deals.options("trang_thai")].filter(([, o]) => o.meaning && o.meaning !== "open").map(([id]) => id);
  return { managerId, deals, pay: await roleTable(db, managerId, "payments"), split: !!t?.key_split, keyColumns: t?.key_columns ?? [], peopleCols: cols, closed };
}

/** The Vietnam date of a stored date or datetime cell, as SQL. */
const dateOfCell = (key: string): SQL =>
  sql`(CASE WHEN length(data ->> ${key}::text) = 10 THEN (data ->> ${key}::text)::date ELSE ((data ->> ${key}::text)::timestamptz AT TIME ZONE ${BUSINESS_TIMEZONE}::text)::date END)`;

const openCond = (tree: Tree, statusKey: string | null): SQL => (statusKey && tree.closed.length ? sql`coalesce(data ->> ${statusKey}::text, '') <> ALL(${`{${tree.closed.join(",")}}`}::text[])` : sql`true`);

interface Dealt {
  id: string;
  name: string;
  people: string[];
  leading: string[];
}
const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** The people of a deal row, and who is Leading (the role of the person's entry, read as the money commands read it). */
function dealOf(tree: Tree, id: string, data: Record<string, unknown>): Dealt {
  const nameKey = tree.deals.key("ten_cong_ty");
  const people = new Set<string>();
  const leading = new Set<string>();
  for (const c of tree.peopleCols)
    for (const e of entriesOf(data[c.key])) {
      people.add(e.id);
      if (isLeadingRole(entryRole(e.attrs))) leading.add(e.id);
    }
  return { id, name: nameKey && typeof data[nameKey] === "string" && data[nameKey] ? (data[nameKey] as string) : "(chưa đặt tên)", people: [...people], leading: [...leading] };
}

async function dealsByIds(db: Db, tree: Tree, ids: string[]): Promise<Map<string, Dealt>> {
  const out = new Map<string, Dealt>();
  if (ids.length === 0) return out;
  const rows = (await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ table_id = ${tree.deals.tableId}::uuid AND deleted_at IS NULL AND id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).rows as { id: string; data: Record<string, unknown> }[];
  for (const r of rows) out.set(r.id, dealOf(tree, r.id, r.data));
  return out;
}

async function orgOf(db: Db, ids: string[]): Promise<Map<string, { leader: string | null; manager: string | null }>> {
  const m = new Map<string, { leader: string | null; manager: string | null }>();
  if (ids.length === 0) return m;
  const rows = (await db.execute(sql`SELECT user_id, leader_id, manager_id FROM org_memberships WHERE valid_to IS NULL AND user_id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).rows as { user_id: string; leader_id: string | null; manager_id: string | null }[];
  for (const r of rows) m.set(r.user_id, { leader: r.leader_id, manager: r.manager_id });
  return m;
}

/** Does this person read the deal: the Manager of the tree, anyone when there is no split lock, else a person who sees someone on the deal (themselves, or a person they manage). */
function visibility(db: Db, tree: Tree) {
  const readers = new Map<string, Promise<Set<string>>>();
  return async (userId: string, people: string[]): Promise<boolean> => {
    if (userId === tree.managerId || !tree.split) return true;
    let ids = readers.get(userId);
    if (!ids) readers.set(userId, (ids = loadReader(db, userId).then((r) => new Set(r.ids))));
    const mine = await ids;
    return people.some((p) => mine.has(p));
  };
}

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const vnShow = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

// ---- due-date rules ------------------------------------------------------------------------------------------------------------------------------

/** The due date a milestone fires on when the job runs for `day`. */
const dueFor = (m: Milestone, day: string): string => (m.kind === "before" ? addDays(day, m.days) : m.kind === "on" ? day : addDays(day, -m.days));

interface DueRow {
  id: string;
  due: string;
  deal: Dealt;
  /** Payment rule: the table the row is in (for the link). */
  tableId: string;
}

/** One SQL for one rule: the rows (open deals, or unpaid instalments) whose date is one of the wanted dates. */
async function rowsDue(db: Db, tree: Tree, rule: RuleKey, dates: string[]): Promise<DueRow[]> {
  const arr = `{${dates.join(",")}}`;
  if (rule === "deal_expected_close") {
    const kExp = tree.deals.key("ngay_du_kien_chot");
    if (!kExp) return [];
    const rows = (await db.execute(sql`SELECT id, data, due::text AS due FROM (SELECT id, data, ${dateOfCell(kExp)} AS due FROM dh_rows WHERE /*scope:system*/ table_id = ${tree.deals.tableId}::uuid AND deleted_at IS NULL AND ${openCond(tree, tree.deals.key("trang_thai"))}) x WHERE due = ANY(${arr}::date[])`)).rows as { id: string; data: Record<string, unknown>; due: string }[];
    return rows.map((r) => ({ id: r.id, due: r.due, deal: dealOf(tree, r.id, r.data), tableId: tree.deals.tableId }));
  }
  const pay = tree.pay;
  const kDue = pay?.key("han");
  const kPaid = pay?.key("ngay_tien_ve");
  const kDeal = pay?.key("deal");
  if (!pay || !kDue || !kDeal) return [];
  const rows = (await db.execute(sql`SELECT id, data -> ${kDeal} -> 0 AS deal_id, due::text AS due FROM (SELECT id, data, ${dateOfCell(kDue)} AS due FROM dh_rows WHERE /*scope:system*/ table_id = ${pay.tableId}::uuid AND deleted_at IS NULL${kPaid ? sql` AND coalesce(data ->> ${kPaid}::text, '') = ''` : sql``}) x WHERE due = ANY(${arr}::date[])`)).rows as { id: string; deal_id: string | null; due: string }[];
  const deals = await dealsByIds(db, tree, [...new Set(rows.map((r) => r.deal_id).filter((x): x is string => typeof x === "string"))]);
  const out: DueRow[] = [];
  for (const r of rows) {
    const deal = typeof r.deal_id === "string" ? deals.get(r.deal_id) : undefined;
    if (deal) out.push({ id: r.id, due: r.due, deal, tableId: tree.deals.tableId });
  }
  return out;
}

const TEXT: Record<RuleKey, { what: string; verb: string }> = {
  deal_expected_close: { what: "Deal", verb: "dự kiến chốt" },
  payment_due: { what: "Đợt thanh toán của deal", verb: "đến hạn" },
};

function whenText(m: Milestone): string {
  return m.kind === "before" ? `còn ${m.days} ngày` : m.kind === "on" ? "đến hạn hôm nay" : `quá ${m.days} ngày`;
}

/** Sends one milestone of one rule for one day. Returns notifications created. */
async function sendMilestone(db: Db, tree: Tree, rule: RuleKey, m: Milestone, day: string, rows: DueRow[], canSee: ReturnType<typeof visibility>, org: Awaited<ReturnType<typeof orgOf>>): Promise<number> {
  const byPerson = new Map<string, DueRow[]>();
  for (const r of rows) {
    const to = new Set<string>();
    for (const w of m.to) {
      if (w === "leading") r.deal.leading.forEach((u) => to.add(u));
      else if (w === "participants") r.deal.people.forEach((u) => to.add(u));
      else if (w === "leader") r.deal.leading.forEach((u) => org.get(u)?.leader && to.add(org.get(u)!.leader!));
      else to.add(tree.managerId);
    }
    for (const u of to) byPerson.set(u, [...(byPerson.get(u) ?? []), r]);
  }
  const text = TEXT[rule];
  const source = stableId("deal.due", rule, `${m.kind}:${m.days}`, day);
  const link = `/quan-ly-deal/${tree.deals.tableId}`;
  const single: { userId: string; key: string; ctx: DueRow }[] = [];
  const grouped: { userId: string; key: string; ctx: DueRow[] }[] = [];
  for (const [userId, list] of byPerson) {
    if (list.length > GROUP_OVER) grouped.push({ userId, key: "all", ctx: list });
    else for (const r of list) single.push({ userId, key: r.id, ctx: r });
  }
  let n = 0;
  if (single.length)
    n += await notify.send(db, {
      type: NOTIFICATION_TYPES.dealDue,
      recipients: single,
      sourceEventId: source,
      canView: (u, ctx) => canSee(u, (ctx as DueRow).deal.people),
      render: (_u, _by, ctx) => {
        const r = ctx as DueRow;
        return { title: `${text.what} "${r.deal.name}" ${m.kind === "after" ? `${text.verb} ${whenText(m)}` : `${whenText(m)} ${text.verb}`}`, body: `${text.what} "${r.deal.name}" ${text.verb} ngày ${vnShow(r.due)} (${whenText(m)}).`, link, data: { row_id: r.id, rule } };
      },
    });
  if (grouped.length)
    n += await notify.send(db, {
      type: NOTIFICATION_TYPES.dealDue,
      recipients: grouped,
      sourceEventId: source,
      canView: async (u, ctx) => (await Promise.all((ctx as DueRow[]).map((r) => canSee(u, r.deal.people)))).some(Boolean),
      render: (u, _by, ctx) => {
        const list = ctx as DueRow[];
        return { title: `${list.length} ${rule === "deal_expected_close" ? "deal" : "đợt thanh toán"} ${text.verb} ${whenText(m)}`, body: `Bạn có ${list.length} ${rule === "deal_expected_close" ? "deal" : "đợt thanh toán"} ${text.verb} ${whenText(m)}. Mở danh sách để xem.`, link, data: { rule, count: list.length, user: u } };
      },
    });
  return n;
}

async function runTreeDay(db: Db, tree: Tree, rules: DueRule[], day: string): Promise<number> {
  let n = 0;
  const canSee = visibility(db, tree);
  for (const rule of rules) {
    if (!rule.enabled || rule.milestones.length === 0) continue;
    const dates = [...new Set(rule.milestones.map((m) => dueFor(m, day)))];
    const rows = await rowsDue(db, tree, rule.key, dates);
    if (rows.length === 0) continue;
    const org = await orgOf(db, [...new Set(rows.flatMap((r) => r.deal.leading))]);
    for (const m of rule.milestones) {
      const due = dueFor(m, day);
      const mine = rows.filter((r) => r.due === due);
      if (mine.length) n += await sendMilestone(db, tree, rule.key, m, day, mine, canSee, org);
    }
  }
  return n;
}

async function treeManagers(db: Db): Promise<string[]> {
  const r = await db.execute(sql`SELECT DISTINCT manager_id FROM dh_templates WHERE /*scope:system*/ role_set = 'deals' AND scope = 'tree' AND deleted_at IS NULL AND master_table_id IS NOT NULL`);
  return (r.rows as { manager_id: string }[]).map((x) => x.manager_id);
}

/**
 * The 08:30 job (design module6 6.5): every tree, every enabled rule, for today and, when the last run was missed, for yesterday too (24-hour catch-up).
 * Safe to run twice: a notification of (rule, milestone, day, row) is made once per person (unique source id), and a run marker skips days already done.
 */
export async function runDueRules(db: Db, now = new Date()): Promise<number> {
  const today = businessDate(now);
  let n = 0;
  for (const managerId of await treeManagers(db)) {
    const tree = await loadTree(db, managerId);
    if (!tree) continue;
    const last = await readSetting<string>(db, lastRunKey(managerId));
    if (last && last >= today) continue;
    const from = last ? (addDays(last, 1) > addDays(today, -1) ? addDays(last, 1) : addDays(today, -1)) : today;
    const rules = await rulesOf(db, managerId);
    for (let d = from; d <= today; d = addDays(d, 1)) n += await runTreeDay(db, tree, rules, d);
    await writeSetting(db, lastRunKey(managerId), today);
  }
  return n;
}

// ---- morning digest ------------------------------------------------------------------------------------------------------------------------------

interface DigestRow {
  kind: "recheck" | "expected" | "payment";
  due: string | null;
  people: string[];
}

/** Rows that can count in a digest of `day`, read once per tree by role: the queue "Cần chấm lại", open deals with an expected closing date within 7 days or past, unpaid instalments due within 7 days or past. */
async function digestRows(db: Db, tree: Tree, day: string): Promise<DigestRow[]> {
  const horizon = addDays(day, 7);
  const out: DigestRow[] = [];
  const kStatus = tree.deals.key("trang_thai");
  const kExp = tree.deals.key("ngay_du_kien_chot");
  const kRe = tree.deals.key("can_cham_lai");
  const exp = kExp ? dateOfCell(kExp) : sql`NULL::date`;
  const re = kRe ? sql`coalesce(data ->> ${kRe}::text, '') <> ''` : sql`false`;
  const deals = (await db.execute(sql`SELECT id, data, due::text AS due, recheck FROM (SELECT id, data, ${exp} AS due, ${re} AS recheck FROM dh_rows WHERE /*scope:system*/ table_id = ${tree.deals.tableId}::uuid AND deleted_at IS NULL AND ${openCond(tree, kStatus)}) x
    WHERE recheck OR due <= ${horizon}::date`)).rows as { id: string; data: Record<string, unknown>; due: string | null; recheck: boolean }[];
  for (const r of deals) {
    const people = dealOf(tree, r.id, r.data).people;
    if (r.recheck) out.push({ kind: "recheck", due: null, people });
    if (r.due && r.due <= horizon) out.push({ kind: "expected", due: r.due, people });
  }
  const pay = tree.pay;
  const kDue = pay?.key("han");
  const kPaid = pay?.key("ngay_tien_ve");
  const kDeal = pay?.key("deal");
  if (pay && kDue && kDeal) {
    const rows = (await db.execute(sql`SELECT deal_id, due::text AS due FROM (SELECT data -> ${kDeal} -> 0 AS deal_id, ${dateOfCell(kDue)} AS due FROM dh_rows WHERE /*scope:system*/ table_id = ${pay.tableId}::uuid AND deleted_at IS NULL${kPaid ? sql` AND coalesce(data ->> ${kPaid}::text, '') = ''` : sql``}) x WHERE due <= ${horizon}::date`)).rows as { deal_id: string | null; due: string }[];
    const dl = await dealsByIds(db, tree, [...new Set(rows.map((r) => r.deal_id).filter((x): x is string => typeof x === "string"))]);
    for (const r of rows) {
      const d = typeof r.deal_id === "string" ? dl.get(r.deal_id) : undefined;
      if (d) out.push({ kind: "payment", due: r.due, people: d.people });
    }
  }
  return out;
}

interface DigestCounts {
  recheck: number;
  soon: number;
  overdue: number;
  dotSoon: number;
  dotOver: number;
  reminders: number;
  table: string | null;
}

/** The text of a digest, or null when there is nothing to say (design module6 5.5). */
function digestText(c: DigestCounts): string | null {
  const lines: string[] = [];
  if (c.recheck) lines.push(`${c.recheck} deal cần chấm lại hôm nay.`);
  if (c.soon) lines.push(`${c.soon} deal dự kiến chốt trong 7 ngày tới.`);
  if (c.overdue) lines.push(`${c.overdue} deal đã quá ngày dự kiến chốt mà vẫn mở.`);
  if (c.dotSoon) lines.push(`${c.dotSoon} đợt thanh toán đến hạn trong 7 ngày tới.`);
  if (c.dotOver) lines.push(`${c.dotOver} đợt thanh toán đã quá hạn.`);
  if (c.reminders) lines.push(`${c.reminders} nhắc hẹn trong ngày.`);
  return lines.length ? lines.join("\n") : null;
}

/**
 * The 08:00 job (design module6 5.5): one digest per person per day for everyone whose flag is on, counted on the deals that person reads.
 * Nothing to say, nothing sent. Returns the number sent.
 */
export async function runMorningDigest(db: Db, now = new Date()): Promise<number> {
  const day = businessDate(now);
  const people = (await db.execute(sql`SELECT u.id, m.manager_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
    LEFT JOIN notification_settings s ON /*scope:system*/ s.user_id = u.id WHERE u.kind = 'person' AND u.status = 'active' AND coalesce(s.morning_digest, true)`)).rows as { id: string; manager_id: string | null }[];
  if (people.length === 0) return 0;
  // Reminders of the day, per person (Vietnam day).
  const start = new Date(Date.parse(`${day}T00:00:00+07:00`));
  const rem = (await db.execute(sql`SELECT user_id, count(*)::int AS n FROM reminders WHERE /*scope:system*/ status = 'pending' AND due_at >= ${start.toISOString()}::timestamptz AND due_at < ${new Date(start.getTime() + 86_400_000).toISOString()}::timestamptz GROUP BY user_id`)).rows as { user_id: string; n: number }[];
  const reminders = new Map(rem.map((r) => [r.user_id, r.n]));
  const counts = new Map<string, DigestCounts>();
  const byTree = new Map<string, string[]>();
  for (const p of people) {
    counts.set(p.id, { recheck: 0, soon: 0, overdue: 0, dotSoon: 0, dotOver: 0, reminders: reminders.get(p.id) ?? 0, table: null });
    if (p.manager_id) byTree.set(p.manager_id, [...(byTree.get(p.manager_id) ?? []), p.id]);
  }
  for (const [managerId, members] of byTree) {
    const tree = await loadTree(db, managerId);
    if (!tree) continue;
    const rows = await digestRows(db, tree, day);
    const canSee = visibility(db, tree);
    for (const id of members) {
      const c = counts.get(id)!;
      c.table = tree.deals.tableId;
      for (const r of rows) {
        if (!(await canSee(id, r.people))) continue;
        if (r.kind === "recheck") c.recheck++;
        else if (r.kind === "expected") c[r.due! < day ? "overdue" : "soon"]++;
        else c[r.due! < day ? "dotOver" : "dotSoon"]++;
      }
    }
  }
  const ready = [...counts].filter(([, c]) => digestText(c));
  return notify.send(db, {
    type: NOTIFICATION_TYPES.morningDigest,
    recipients: ready.map(([id, c]) => ({ userId: id, ctx: c })),
    sourceEventId: stableId("digest.morning", day),
    render: (_u, _by, ctx) => {
      const c = ctx as DigestCounts;
      return { title: "Bản tin buổi sáng: việc cần làm hôm nay", body: digestText(c)!, link: c.table ? `/quan-ly-deal/${c.table}?quick=priority` : "/nhac-hen", data: { ...c, day } };
    },
  });
}

// ---- commands ------------------------------------------------------------------------------------------------------------------------------------

const RulesOut = z.object({ rules: z.array(RuleSchema), can_edit: z.boolean() });

export const dueRuleOperations = [
  defineQuery({
    name: "deal.due_rules.get",
    summary: "Hai quy tắc nhắc hạn của cây (deal quá ngày dự kiến chốt, đợt thanh toán đến hạn): bật/tắt và các mốc.",
    description: "Mốc: `before` (trước N ngày), `on` (đúng ngày), `after` (quá N ngày) và người nhận (`leading`, `participants`, `leader`, `manager`). Cột đọc theo vai trò `ngay_du_kien_chot` và `han`.",
    permission: "deal:deal:read",
    aiAllowed: true,
    input: z.object({}),
    output: RulesOut,
    http: { method: "GET", path: "/deals/due-rules" },
    handler: async (ctx) => {
      const p = await ctx.access.requirePrincipal();
      if (!p.managerId) return { rules: DEFAULT_RULES, can_edit: false };
      return { rules: await rulesOf(ctx.db, p.managerId), can_edit: p.managerId === p.userId && p.roles.includes("manager") };
    },
  }),
  defineCommand({
    name: "deal.due_rules.set",
    summary: "Manager của cây bật/tắt và sửa mốc của hai quy tắc nhắc hạn.",
    description: "Gửi các quy tắc muốn đổi (theo `key`); quy tắc không gửi giữ nguyên. Tối đa 5 mốc mỗi quy tắc; mốc `on` luôn là 0 ngày.",
    permission: "deal:payment:write",
    aiAllowed: true,
    audit: "write",
    input: z.object({ rules: z.array(RuleSchema).min(1).max(RULE_KEYS.length) }),
    output: RulesOut,
    http: { method: "PUT", path: "/deals/due-rules" },
    handler: async (ctx, i) => {
      const p = await ctx.access.requirePrincipal();
      if (!p.managerId || p.managerId !== p.userId || !p.roles.includes("manager")) throw new AppError("forbidden", "Chỉ Manager của cây sửa quy tắc nhắc hạn.");
      const next = new Map((await rulesOf(ctx.db, p.managerId)).map((r) => [r.key, r]));
      for (const r of i.rules) next.set(r.key, { ...r, milestones: r.milestones.map((m) => (m.kind === "on" ? { ...m, days: 0 } : m)) });
      const rules = DEFAULT_RULES.map((d) => next.get(d.key)!);
      await writeSetting(ctx.db, settingKey(p.managerId), rules);
      return { rules, can_edit: true };
    },
  }),
];
