import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { dhUserLimits, users } from "@soe/db";
import type { Actor } from "@soe/shared";
import { hashPassword } from "../auth/password";
import { createContainer, type Container } from "../bootstrap";
import { dispatchOutboxOnce } from "../core/outbox-dispatcher";
import { defaultSubscribers } from "../core/subscribers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../modules/deal";
import { processPendingColumns, processPendingMerges, processPendingRefills } from "../modules/datahub";
import { workerEmit } from "../modules/datahub/template-sync";

/**
 * Demo data for the DEV database (not the test database): five accounts in one tree and about 30 invented deals.
 *   pnpm --filter @soe/api demo:seed            create what is missing (a second run does nothing)
 *   pnpm --filter @soe/api demo:seed --reset    delete the deal data of the demo tree first, then seed again
 * Everything goes through the registry commands (the same ones the web and the API call), so formulas, split lock, commission
 * ledger and row history behave as in real use. Company names are invented. The real names and emails of the people are NOT in
 * the repository: they are read from the JSON file DEMO_PEOPLE_FILE (default: ../SoE_hub_demo-people.json next to the repo), and
 * without that file the placeholder people below are used. New passwords are appended to DEMO_ACCOUNTS_FILE (outside the repo).
 */
interface PersonDef { key: string; name: string; email: string; role: "manager" | "leader" | "user"; leader?: string; manager?: string }
const PLACEHOLDERS: PersonDef[] = [
  { key: "mgr", name: "Manager Demo Seed", email: "demo-seed.manager@base.vn", role: "manager" },
  { key: "ld1", name: "Leader Demo A", email: "demo-seed.leader-a@base.vn", role: "leader", manager: "mgr" },
  { key: "ld2", name: "Leader Demo B", email: "demo-seed.leader-b@base.vn", role: "leader", manager: "mgr" },
  { key: "us1", name: "User Demo A", email: "demo-seed.user-a@base.vn", role: "user", leader: "ld1" },
  { key: "us2", name: "User Demo B", email: "demo-seed.user-b@base.vn", role: "user", leader: "ld1" },
];
const repoParent = new URL("../../../../../", import.meta.url).pathname;
const PEOPLE_FILE = process.env.DEMO_PEOPLE_FILE ?? `${repoParent}SoE_hub_demo-people.json`;
const ACCOUNTS_FILE = process.env.DEMO_ACCOUNTS_FILE ?? `${repoParent}SoE_hub_tai-khoan-dev.txt`;

function loadPeople(): PersonDef[] {
  if (!existsSync(PEOPLE_FILE)) return PLACEHOLDERS;
  const j = JSON.parse(readFileSync(PEOPLE_FILE, "utf8")) as { people: PersonDef[] };
  return j.people;
}

const actorOf = (userId: string): Actor => ({ userId, via: "api", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null });
const as = (c: Container, userId: string) => async (name: string, input: Record<string, unknown> = {}): Promise<any> => // eslint-disable-line @typescript-eslint/no-explicit-any
  (await c.executor.execute(name, input, { actor: actorOf(userId), requestId: randomUUID() })).result;

async function drain(c: Container): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const n = await dispatchOutboxOnce(c.db.db, defaultSubscribers(c.events, c.config.AUTH_SECRET), c.logger, { batchSize: 500 });
    const m = await processPendingColumns(c.db.db);
    const g = await processPendingMerges(c.db.db);
    const f = await processPendingRefills(c.db.db);
    if (n === 0 && m === 0 && g === 0 && f === 0) return;
  }
}

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const M = 1_000_000;

// ------------------------------------------------------------------------------------------------
// Deals (invented). who: m = Manager, k/p = Leaders, d/l = Users (d, l under k). Offsets are days from today.
// sched: [amount (million VND), due offset, paid?]. A paid instalment is confirmed on its due date.
// ------------------------------------------------------------------------------------------------
type Who = "m" | "k" | "p" | "d" | "l";
const GOOD = ["Có bằng chứng", "Có bằng chứng", "Có bằng chứng", "Có bằng chứng"];
const MIXED = ["Có bằng chứng", "Chưa rõ", "Có bằng chứng", "Chưa rõ"];
const WEAK = ["Chưa rõ", "Âm", "Chưa rõ", "Chưa rõ"];
interface DealDef { name: string; type: string; lead: Who; assoc?: Who; start: number; exp?: number; rev: number; status?: "Pending" | "Lost" | "Disqualified" | "Huỷ"; closed?: number; bant?: string[]; sched?: [number, number, boolean][]; note?: string }
const DEALS: DealDef[] = [
  // Won: first instalment received
  { name: "CTCP Thép Đại Hưng Thịnh", type: "POD bán mới", lead: "k", assoc: "d", start: -100, rev: 240, sched: [[120, -70, true], [120, -10, true]] },
  { name: "Công ty TNHH Logistics Sao Việt", type: "POD bán mới", lead: "d", assoc: "l", start: -95, rev: 180, sched: [[90, -60, true], [90, -5, false]] },
  { name: "CTCP Nội Thất Hoàng Gia Lâm", type: "POD CSM", lead: "l", start: -88, rev: 96, sched: [[96, -50, true]] },
  { name: "Công ty TNHH Dược Phẩm An Khang Việt", type: "POD bán mới", lead: "p", assoc: "k", start: -80, rev: 300, sched: [[100, -45, true], [100, -8, true], [100, 20, false]] },
  { name: "CTCP Xây Dựng Bình Minh Xanh", type: "PS kèm POD", lead: "k", start: -70, rev: 60, sched: [[60, -30, true]] },
  { name: "Công ty TNHH Thực Phẩm Vị Quê", type: "POD Express", lead: "d", start: -45, rev: 48, sched: [[48, -12, true]] },
  { name: "CTCP Vận Tải Biển Hải Long", type: "POD bán mới", lead: "m", assoc: "p", start: -60, rev: 420, sched: [[210, -25, true], [210, -3, false]] },
  { name: "Công ty TNHH Điện Lạnh Tân Phong", type: "POD CSM", lead: "l", assoc: "d", start: -52, rev: 84, sched: [[42, -20, true], [42, 10, false]] },
  // Signed, waiting for the first payment
  { name: "CTCP Phần Mềm Kim Cương", type: "POD bán mới", lead: "d", start: -40, exp: -6, rev: 150, bant: GOOD, sched: [[75, -6, false], [75, 25, false]] },
  { name: "Công ty TNHH Bao Bì Phương Nam", type: "POD bán mới", lead: "k", start: -35, exp: 8, rev: 110, bant: GOOD, sched: [[110, 8, false]] },
  { name: "CTCP Giáo Dục Trí Việt", type: "PS không kèm POD", lead: "l", start: -30, exp: -2, rev: 72, sched: [[36, -2, false], [36, 30, false]] },
  { name: "Công ty TNHH Cơ Khí Nam Thành", type: "POD Express", lead: "p", start: -28, exp: 14, rev: 55, sched: [[55, 14, false]] },
  // Open, Processing
  { name: "CTCP Du Lịch Sông Hương", type: "POD bán mới", lead: "d", start: -25, exp: 20, rev: 200, bant: GOOD },
  { name: "Công ty TNHH Nông Sản Cửu Long Xanh", type: "POD bán mới", lead: "l", start: -22, exp: 30, rev: 130, bant: MIXED },
  { name: "CTCP Bất Động Sản An Phú Gia", type: "POD bán mới", lead: "k", assoc: "d", start: -40, exp: 10, rev: 350, bant: GOOD },
  { name: "Công ty TNHH In Ấn Á Châu Plus", type: "POD CSM", lead: "p", start: -18, exp: 45, rev: 70, bant: MIXED },
  { name: "CTCP Thương Mại Đông Dương Việt", type: "POD bán mới", lead: "m", start: -15, exp: 60, rev: 500, bant: MIXED },
  { name: "Công ty TNHH Thiết Bị Y Tế Lạc Hồng", type: "POD bán mới", lead: "k", assoc: "l", start: -12, exp: 25, rev: 160, bant: GOOD },
  { name: "CTCP Mía Đường Tây Nguyên Xanh", type: "Data", lead: "d", start: -8, exp: 40, rev: 45 },
  { name: "Công ty TNHH Gỗ Xuất Khẩu Việt Mộc", type: "POD bán mới", lead: "p", start: -5, exp: 50, rev: 220 },
  { name: "Công ty TNHH Gốm Sứ Bát Tràng Việt", type: "PS kèm POD", lead: "m", start: -20, exp: 30, rev: 40 },
  // Open, Pending
  { name: "CTCP Cảng Container Phước An", type: "POD bán mới", lead: "d", start: -55, exp: -5, rev: 380, status: "Pending", bant: WEAK, note: "Khách hoãn quyết định chờ duyệt ngân sách quý sau." },
  { name: "Công ty TNHH Dệt May Thành Công Việt", type: "POD CSM", lead: "l", start: -48, exp: 15, rev: 90, status: "Pending", bant: MIXED },
  { name: "CTCP Chứng Khoán Đầu Tư Thiên Long", type: "POD bán mới", lead: "k", start: -30, exp: 35, rev: 270, status: "Pending", bant: MIXED },
  // Closed without money
  { name: "CTCP Nhựa Đồng Tâm Phát", type: "POD bán mới", lead: "d", start: -85, rev: 140, status: "Lost", closed: -40, note: "Khách chọn nhà cung cấp khác, giá thấp hơn." },
  { name: "Công ty TNHH Ô Tô Linh Kiện Sài Gòn", type: "POD bán mới", lead: "p", start: -70, rev: 260, status: "Lost", closed: -28 },
  { name: "CTCP Mỹ Phẩm Hoa Lan", type: "POD Express", lead: "l", start: -60, rev: 35, status: "Lost", closed: -20 },
  { name: "Công ty TNHH Cà Phê Cao Nguyên Gold", type: "Data", lead: "k", start: -75, rev: 30, status: "Disqualified", closed: -50, note: "Không đúng đối tượng khách hàng." },
  { name: "CTCP Vật Liệu Xây Dựng Hòa Bình Mới", type: "POD bán mới", lead: "d", start: -65, rev: 120, status: "Huỷ", closed: -33, note: "Trùng với deal đã có, Manager huỷ." },
];

async function main() {
  const reset = process.argv.includes("--reset");
  const defs = loadPeople();
  const c = createContainer({}, "demo-seed");
  const db = c.db.db;
  try {
    // 1. accounts ------------------------------------------------------------------------------
    const [admin] = await db.select({ id: users.id }).from(users).where(and(sql`'admin' = ANY(${users.roles})`, eq(users.status, "active"))).limit(1);
    if (!admin) throw new Error("Cần một Admin đã kích hoạt trong database dev (pnpm cli admin:create).");
    const adminCall = as(c, admin.id);
    const ids: Record<string, string> = {};
    const created: { email: string; password: string }[] = [];
    for (const p of defs) {
      const [have] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.email)).limit(1);
      if (have) { ids[p.key] = have.id; continue; }
      const u = await adminCall("org.member.create", { email: p.email, full_name: p.name, roles: [p.role], manager_id: p.role === "manager" ? null : ids[p.manager ?? defs.find((x) => x.key === p.leader)!.manager!], leader_id: p.leader ? ids[p.leader] : null });
      const password = `Dm-${randomBytes(6).toString("hex")}-${randomBytes(2).toString("hex").toUpperCase()}`;
      await db.update(users).set({ status: "active", passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
      ids[p.key] = u.id;
      created.push({ email: p.email, password });
    }
    for (const id of Object.values(ids)) await db.insert(dhUserLimits).values({ userId: id, maxDatahubs: 100, maxTables: 50, maxColumns: 200 }).onConflictDoNothing();
    if (created.length) {
      appendFileSync(ACCOUNTS_FILE, `\nDữ liệu demo (${day(0)}, tạo bằng demo:seed):\n${created.map((x) => `  ${x.email} / ${x.password}`).join("\n")}\n`, { mode: 0o600 });
      console.log(`Đã tạo ${created.length} tài khoản; mật khẩu ghi vào file tài khoản dev (ngoài repo).`);
    }
    const mgrKey = defs.find((x) => x.role === "manager")!.key;
    const leaders = defs.filter((x) => x.role === "leader");
    const usersOf = defs.filter((x) => x.role === "user");
    // who -> user id: k, p = the two Leaders; d, l = the two Users; m = Manager
    const W: Record<Who, string> = { m: ids[mgrKey]!, k: ids[leaders[0]!.key]!, p: ids[leaders[1]!.key]!, d: ids[usersOf[0]!.key]!, l: ids[usersOf[1]!.key]! };

    // 2. tree templates ----------------------------------------------------------------------------
    await ensureTreeTemplates(db, workerEmit(db), W.m);
    await drain(c);
    const mgr = as(c, W.m);
    const tables: Record<string, string> = {};
    for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = ((await mgr("datahub.template.list")) as { name: string; master_table_id: string }[]).find((x) => x.name === d.name)!.master_table_id;

    const rowsOf = async (t: string): Promise<{ id: string; version: number; data: Record<string, unknown> }[]> => {
      const out: { id: string; version: number; data: Record<string, unknown> }[] = [];
      for (let cursor: string | undefined; ;) {
        const r = await mgr("datahub.row.list", { table_id: t, limit: 200, ...(cursor ? { cursor } : {}) });
        out.push(...r.items);
        cursor = r.next_cursor ?? undefined;
        if (!cursor || r.items.length === 0) break;
      }
      return out;
    };
    if (reset) {
      for (const name of ["Sổ com", "Đợt thanh toán", "Tiền về", "Deals"]) for (const r of await rowsOf(tables[name]!)) await mgr("datahub.row.delete", { table_id: tables[name]!, row_id: r.id });
      await drain(c);
      console.log("Đã xoá dữ liệu Deal của cây demo.");
    } else if ((await rowsOf(tables["Deals"]!)).length > 0) {
      console.log("Cây demo đã có deal: không làm gì (chạy lại với --reset để dựng lại).");
      return;
    }

    // 3. commission policy (invented figures) --------------------------------------------------------
    if ((await rowsOf(tables["Tham số com"]!)).length === 0) {
      for (const [n, v] of [["Tỉ lệ SoE", 0.5], ["Tỉ lệ PS POD", 0.07]] as const) await mgr("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": n, "Giá trị": v } });
      const base: Record<string, number> = { "Under KPI": 0.08, KPI: 0.12, Goal: 0.16, "Out performance": 0.2 };
      for (const src of ["ML", "SH"]) for (const lv of [1, 2, 3]) for (const [perf, rate] of Object.entries(base)) {
        await mgr("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": src, Level: `Level ${lv}`, Performance: perf, "Tỉ lệ": +(rate + (src === "SH" ? 0.02 : 0) - (lv - 1) * 0.01).toFixed(2) } });
      }
    }

    // 4. deals ------------------------------------------------------------------------------------
    const perfs = ["KPI", "Goal", "Under KPI", "Out performance"];
    const person = (id: string, vai_tro: string, dt: number, com: number) => ({ id, attrs: { vai_tro, ty_le_dt: dt, ty_le_com: com, tinh_deal: vai_tro === "Leading" } });
    const closeNow = async (id: string, data: Record<string, unknown>) => {
      const cur = await mgr("datahub.row.get", { table_id: tables["Deals"]!, row_id: id });
      await mgr("datahub.row.update", { table_id: tables["Deals"]!, row_id: id, data, version: cur.version });
    };
    let n = 0, won = 0, payments = 0;
    for (const [i, d] of DEALS.entries()) {
      const pod = d.type.startsWith("POD");
      const people = d.assoc && d.assoc !== d.lead ? [person(W[d.lead], "Leading", 0.7, 0.3), person(W[d.assoc], "Associate", 0.3, 0.15)] : [person(W[d.lead], "Leading", 1, 0.3)];
      const data: Record<string, unknown> = {
        "Tên công ty": d.name,
        "Loại deal": d.type,
        "Start date": day(d.start),
        "Doanh thu dự kiến": d.rev * M,
        "Người tham gia": people,
        Sale: "Sale demo",
        "Nguồn lead": i % 3 === 0 ? "SH" : "ML",
        ...(pod ? { "Level BC": `Level ${(i % 3) + 1}`, "Performance BC": perfs[i % 4] } : {}),
        ...(d.exp !== undefined ? { "Ngày dự kiến chốt": day(d.exp) } : {}),
        ...(d.note ? { "Ghi chú": d.note } : {}),
      };
      if (d.bant) Object.assign(data, { Budget: d.bant[0], Authority: d.bant[1], Need: d.bant[2], Timeline: d.bant[3] });
      if (d.status === "Pending") data["Status"] = "Pending";
      const row = await mgr("datahub.row.create", { table_id: tables["Deals"]!, data });
      n++;
      if (d.sched) {
        const s = await mgr("payment.schedule", { deal_id: row.id, payments: d.sched.map(([amt, due], k) => ({ legal_entity: d.name, contract_no: `HD-${2026}-${String(i + 1).padStart(3, "0")}`, seq: k + 1, amount: amt * M, due: day(due) })) });
        payments += d.sched.length;
        for (const [k, [amt, due, paid]] of d.sched.entries()) {
          if (!paid) continue;
          const r = await mgr("payment.confirm", { received_on: day(due), receipt: { amount: Math.round(amt * M * 1.08), payer_name: d.name.toUpperCase(), bank: "VCB", content: `Thanh toan dot ${k + 1}` }, allocations: [{ payment_id: s.payments[k].id, amount: amt * M, amount_received: Math.round(amt * M * 1.08) }] });
          won += r.won_deal_ids.length;
        }
      }
      if (d.status && d.status !== "Pending") await closeNow(row.id, { Status: d.status, "Ngày đóng (sửa tay)": day(d.closed!) });
      await drain(c);
    }
    console.log(`Đã dựng ${n} deal, ${payments} đợt thanh toán, ${won} deal Won.`);
  } finally {
    await c.db.close();
  }
}

await main();
