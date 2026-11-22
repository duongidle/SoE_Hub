import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
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
 * Demo data for the DEV database (not the test database): five accounts in one tree; deals and commission policy come from the sample workbook in examples/ (read at run time, names replaced).
 *   pnpm --filter @soe/api demo:seed            create what is missing (a second run does nothing)
 *   pnpm --filter @soe/api demo:seed --reset    delete the deal data of the demo tree first, then seed again
 * Everything goes through the registry commands (the same ones the web and the API call), so formulas, split lock, commission
 * ledger and row history behave as in real use. The real names and emails of the people are NOT in
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

// ------------------------------------------------------------------------------------------------
// Deals and commission policy come from the sample workbook on this machine (examples/Quản lý Deal SoE (Dương TVD).xlsx):
// sheet "Raw PODPS" (deals) and "BC-ML Com Policy", "BC-SH Com Policy" (commission policy). The file is read at run time and
// nothing from it is stored in the repository. Company names, sale names and payer names are replaced by generated names;
// the SoE people are mapped to the five demo accounts by a fixed rule (most deals first). Money, dates, status stay as in the file.
// ------------------------------------------------------------------------------------------------
const DEALS_FILE = process.env.DEMO_DEALS_FILE ?? fileURLToPath(new URL("../../../../examples/Quản lý Deal SoE (Dương TVD).xlsx", import.meta.url));
/** Demo accounts in the order the SoE people are assigned to them (by key of the people file). */
const SOE_ORDER = ["ld1", "us2", "ld2", "mgr", "us1"];
const LEAD_COM = 0.15; // Leading SoE: share of the sale's commission
const ASSOC_COM = 0.05; // Associate SoE
const POLICY_FROM = "2021-01-01"; // the workbook has no effective date; early enough to cover every deal

const cellValue = (c: ExcelJS.Cell): unknown => {
  const v = c.value as unknown;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if ("result" in o) return o.result;
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("text" in o) return o.text;
  }
  return v;
};
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
};
const toDate = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};
const toStr = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const addDays = (iso: string, n: number): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

interface PolicyRow { lead: "ML" | "SH"; level: string; perf: string; min: number | null; rate: number }
interface RawDeal { wf: string; company: string; salesman: string | null; soe: string | null; assoc: string | null; service: string | null; status: string; start: string | null; forecast: number | null; expected: string | null; revenue: number | null; closing: string | null; payCount: number | null; payPct: number | null }

async function readWorkbook(): Promise<{ policy: PolicyRow[]; deals: RawDeal[] }> {
  if (!existsSync(DEALS_FILE)) throw new Error(`Không thấy file mẫu: ${DEALS_FILE}. Dữ liệu deal demo lấy từ file này (đặt đường dẫn khác bằng DEMO_DEALS_FILE). Dừng, không dựng dữ liệu bịa.`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(DEALS_FILE);
  const policy: PolicyRow[] = [];
  const seen = new Set<string>();
  const addPolicy = (lead: "ML" | "SH", level: unknown, perf: unknown, min: unknown, rate: unknown) => {
    const l = toStr(level), p = toStr(perf), r = toNum(rate);
    if (!l || !/^Level \d$/.test(l) || !p || r === null || r <= 0) return;
    const k = `${lead}|${l}|${p}`;
    if (seen.has(k)) return;
    seen.add(k);
    policy.push({ lead, level: l, perf: p, min: toNum(min), rate: r });
  };
  const ml = wb.getWorksheet("BC-ML Com Policy");
  const sh = wb.getWorksheet("BC-SH Com Policy");
  if (!ml || !sh) throw new Error("File mẫu thiếu sheet BC-ML Com Policy hoặc BC-SH Com Policy.");
  ml.eachRow((row) => addPolicy("ML", cellValue(row.getCell(3)), cellValue(row.getCell(4)), cellValue(row.getCell(5)), cellValue(row.getCell(6))));
  sh.eachRow((row) => addPolicy("SH", cellValue(row.getCell(2)), cellValue(row.getCell(3)), cellValue(row.getCell(4)), cellValue(row.getCell(5))));
  const raw = wb.getWorksheet("Raw PODPS");
  if (!raw) throw new Error("File mẫu thiếu sheet Raw PODPS.");
  const col: Record<string, number> = {};
  raw.getRow(1).eachCell((c, i) => { col[String(cellValue(c) ?? "").replace(/\s+/g, " ").trim()] = i; });
  const need = (n: string) => { const i = col[n]; if (!i) throw new Error(`Raw PODPS thiếu cột "${n}".`); return i; };
  const idx = {
    wf: need("Workflow ID"), company: need("Tên công ty"), salesman: need("Salesman"), soe: need("SoE"), assoc: need("SoE Associate"), service: need("Dịch vụ"), status: need("Trạng thái deal"),
    start: need("Ngày tiếp nhận"), forecast: need("Forecast Revenue"), expected: need("Expected Day"), revenue: need("Total Revenue (Non VAT)"), closing: need("Closing Day"),
    payCount: need("Số lần thanh toán"), payPct: need("% Thanh toán"),
  };
  const deals: RawDeal[] = [];
  raw.eachRow((row, n) => {
    if (n === 1) return;
    const g = (i: number) => cellValue(row.getCell(i));
    const company = toStr(g(idx.company));
    const status = toStr(g(idx.status));
    if (!company || !status) return;
    deals.push({
      wf: toStr(g(idx.wf)) ?? `r${n}`, company, salesman: toStr(g(idx.salesman)), soe: toStr(g(idx.soe)), assoc: toStr(g(idx.assoc)), service: toStr(g(idx.service)), status,
      start: toDate(g(idx.start)), forecast: toNum(g(idx.forecast)), expected: toDate(g(idx.expected)), revenue: toNum(g(idx.revenue)), closing: toDate(g(idx.closing)),
      payCount: toNum(g(idx.payCount)), payPct: toNum(g(idx.payPct)),
    });
  });
  return { policy, deals };
}

const BANT_SETS = [
  ["Có bằng chứng", "Có bằng chứng", "Có bằng chứng", "Có bằng chứng"],
  ["Có bằng chứng", "Chưa rõ", "Có bằng chứng", "Chưa rõ"],
  ["Chưa rõ", "Âm", "Chưa rõ", "Chưa rõ"],
];

async function main() {
  const reset = process.argv.includes("--reset");
  const dry = process.argv.includes("--check"); // only the reconciliation: nothing is written
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
        const W = { m: ids[mgrKey]! };
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
        cursor = r.nextCursor ?? r.next_cursor ?? undefined; // the executor returns nextCursor, REST returns next_cursor
        if (!cursor || r.items.length === 0) break;
      }
      return out;
    };
    if (dry) {
      // reconciliation only
    } else if (reset) {
      for (const name of ["Sổ com", "Đợt thanh toán", "Tiền về", "Deals"]) for (const r of await rowsOf(tables[name]!)) await mgr("datahub.row.delete", { table_id: tables[name]!, row_id: r.id });
      await drain(c);
      console.log("Đã xoá dữ liệu Deal của cây demo.");
    } else if ((await rowsOf(tables["Deals"]!)).length > 0) {
      console.log("Cây demo đã có deal: không làm gì (chạy lại với --reset để dựng lại).");
      return;
    }

    // 3. commission policy from the workbook ------------------------------------------------------
    const { policy, deals } = await readWorkbook();
    if (reset && !dry) {
      for (const name of ["Chính sách com", "Tham số com"]) for (const r of await rowsOf(tables[name]!)) await mgr("datahub.row.delete", { table_id: tables[name]!, row_id: r.id });
    }
    if (!dry && (await rowsOf(tables["Tham số com"]!)).length === 0) {
      // Tỉ lệ SoE is the ceiling of the SoE shares (Leading + Associate). PS has no rate in the workbook, so "Tỉ lệ PS POD" is not set.
      await mgr("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": POLICY_FROM, "Tên tham số": "Tỉ lệ SoE", "Giá trị": LEAD_COM + ASSOC_COM } });
      for (const p of policy) await mgr("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": POLICY_FROM, "Nguồn lead": p.lead, Level: p.level, Performance: p.perf, ...(p.min ? { "Doanh thu tối thiểu": p.min } : {}), "Tỉ lệ": p.rate } });
      console.log(`Đã nạp ${policy.length} dòng chính sách com (ML ${policy.filter((p) => p.lead === "ML").length}, SH ${policy.filter((p) => p.lead === "SH").length}) và Tỉ lệ SoE ${(LEAD_COM + ASSOC_COM) * 100}%.`);
    }

    // 4. deals from the workbook ------------------------------------------------------------------
    // SoE people -> demo accounts: most deals first, in SOE_ORDER (wraps around when there are more people than accounts).
    const soeCount = new Map<string, number>();
    for (const d of deals) for (const p of [d.soe, d.assoc]) if (p) soeCount.set(p, (soeCount.get(p) ?? 0) + 1);
    const soeRanked = [...soeCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
    const accountKeys = SOE_ORDER.filter((k) => ids[k]);
    const nameOf: Record<string, string> = Object.fromEntries(defs.map((p) => [p.key, p.name]));
    const soeUser = new Map<string, string>();
    console.log("Ánh xạ người trong file -> tài khoản demo (chỉ in ra màn hình):");
    soeRanked.forEach((p, i) => {
      const key = accountKeys[i % accountKeys.length]!;
      soeUser.set(p, ids[key]!);
      console.log(`  ${p} (${soeCount.get(p)} deal) -> ${nameOf[key]}`);
    });
    const fakeCompany = new Map<string, string>();
    const fakeSale = new Map<string, string>();
    const fake = (m: Map<string, string>, key: string, prefix: string) => { if (!m.has(key)) m.set(key, `${prefix} ${String(m.size + 1).padStart(3, "0")}`); return m.get(key)!; };

    const keyOf = async (t: string): Promise<(r: { data: Record<string, unknown> }, name: string) => unknown> => {
      const cols = (await mgr("datahub.table.get", { table_id: t })).columns as { key: string; name: string }[];
      const m = new Map(cols.map((x) => [x.name, x.key]));
      return (r, name) => r.data[m.get(name) ?? name];
    };
    const person = (id: string, vai_tro: string, dt: number, com: number) => ({ id, attrs: { vai_tro, ty_le_dt: dt, ty_le_com: com, tinh_deal: vai_tro === "Leading" } });
    const closeNow = async (id: string, data: Record<string, unknown>) => {
      const cur = await mgr("datahub.row.get", { table_id: tables["Deals"]!, row_id: id });
      await mgr("datahub.row.update", { table_id: tables["Deals"]!, row_id: id, data, version: cur.version });
    };
    const byLead = { ML: policy.filter((p) => p.lead === "ML"), SH: policy.filter((p) => p.lead === "SH") };
    interface Won { rowId: string; company: string; amount: number; closing: string; pod: boolean; lead?: string; level?: string; perf?: string; soe?: string; assoc?: string }
    const wonList: Won[] = [];
    const expectedByMonth = new Map<string, { file: number; first: number }>();
    const stat: Record<string, number> = {};
    const bump = (k: string) => { stat[k] = (stat[k] ?? 0) + 1; };
    const dealIdByKey = new Map<string, string>(); // check mode: a company can have several deals, so the key also has Start date and revenue
    if (dry) { const val = await keyOf(tables["Deals"]!); for (const r of await rowsOf(tables["Deals"]!)) dealIdByKey.set(`${val(r, "Tên công ty")}|${val(r, "Start date")}|${val(r, "Doanh thu dự kiến") ?? ""}`, r.id); }
    let n = 0, won = 0, payments = 0, skipped = 0;
    for (const d of deals) {
      const company = fake(fakeCompany, d.company.toLowerCase(), "Công ty Demo");
      const isWon = d.status === "Won";
      const start = d.start ?? d.closing ?? d.expected;
      const money = d.revenue ?? d.forecast;
      if (!start || (isWon && (!d.revenue || !d.closing))) { skipped++; continue; } // Won needs money and a date; Start date is required
      const pod = d.service === "Sale POD";
      const h = hash(d.wf);
      const status = isWon ? "Won" : d.status;
      const people: ReturnType<typeof person>[] = [];
      const soeId = d.soe ? soeUser.get(d.soe) : undefined;
      const assocId = d.assoc ? soeUser.get(d.assoc) : undefined;
      if (soeId) people.push(person(soeId, "Leading", 1, LEAD_COM));
      if (assocId && assocId !== soeId) people.push(person(assocId, "Associate", 0, ASSOC_COM));
      const lead = pod ? (h % 2 === 0 ? "ML" : "SH") : undefined;
      const combo = lead ? byLead[lead][(h >>> 4) % byLead[lead].length]! : undefined;
      const data: Record<string, unknown> = {
        "Tên công ty": company,
        "Loại deal": pod ? "POD bán mới" : "PS không kèm POD",
        "Start date": start,
        ...(money ? { "Doanh thu dự kiến": money } : {}),
        ...(people.length ? { "Người tham gia": people } : {}),
        ...(d.salesman ? { Sale: fake(fakeSale, d.salesman, "Sale") } : {}),
        ...(combo ? { "Nguồn lead": combo.lead, "Level BC": combo.level, "Performance BC": combo.perf } : {}),
        ...(d.expected && !isWon && status === "Processing" ? { "Ngày dự kiến chốt": d.expected } : {}),
      };
      if (pod && status === "Processing") { const b = BANT_SETS[(h >>> 8) % 3]!; Object.assign(data, { Budget: b[0], Authority: b[1], Need: b[2], Timeline: b[3] }); }
      const row = dry ? { id: dealIdByKey.get(`${company}|${start}|${money ?? ""}`) ?? "none" } : await mgr("datahub.row.create", { table_id: tables["Deals"]!, data });
      n++;
      bump(status);
      if (isWon) {
        const total = d.revenue!, closing = d.closing!;
        const cnt = Math.max(1, Math.round(d.payCount ?? 1));
        const first = cnt > 1 && d.payPct && d.payPct > 0 && d.payPct < 1 ? Math.round(total * d.payPct) : Math.round(total / cnt);
        const amounts = [first];
        for (let k = 1; k < cnt; k++) amounts.push(k === cnt - 1 ? total - first - Math.round(((total - first) / (cnt - 1)) * (cnt - 2)) : Math.round((total - first) / (cnt - 1)));
        const s = dry ? null : await mgr("payment.schedule", { deal_id: row.id, payments: amounts.map((amt, k) => ({ legal_entity: company, contract_no: `HD-${d.wf}`, seq: k + 1, amount: amt, due: addDays(closing, 30 * k) })) });
        payments += amounts.length;
        const r = dry ? { won_deal_ids: [] } : await mgr("payment.confirm", { received_on: closing, receipt: { amount: Math.round(first * 1.08), payer_name: company.toUpperCase(), bank: "VCB", content: "Thanh toan dot 1" }, allocations: [{ payment_id: s!.payments[0].id, amount: first, amount_received: Math.round(first * 1.08) }] });
        won += r.won_deal_ids.length;
        const mo = closing.slice(0, 7);
        const e = expectedByMonth.get(mo) ?? { file: 0, first: 0 };
        e.file += total; e.first += first;
        expectedByMonth.set(mo, e);
        wonList.push({ rowId: row.id, company, amount: first, closing, pod, ...(combo ? { lead: combo.lead, level: combo.level, perf: combo.perf } : {}), ...(soeId ? { soe: soeId } : {}), ...(assocId && assocId !== soeId ? { assoc: assocId } : {}) });
      } else if (status !== "Processing" && !dry) {
        await closeNow(row.id, { Status: status, "Ngày đóng (sửa tay)": d.closing ?? start });
      }
      if (!dry) await drain(c);
      if (n % 50 === 0) console.log(`  ... ${n} deal`);
    }
    console.log(`Đã dựng ${n} deal (${Object.entries(stat).map(([k, v]) => `${k} ${v}`).join(", ")}), ${payments} đợt thanh toán, ${won} deal Won; bỏ qua ${skipped} dòng thiếu ngày hoặc thiếu doanh thu của deal Won.`);

    if (dry) console.log("(chế độ --check: chỉ đối chiếu, không ghi gì)");
    // 5. reconciliation (printed only) --------------------------------------------------------------
    const dots = await rowsOf(tables["Đợt thanh toán"]!);
    const dotVal = await keyOf(tables["Đợt thanh toán"]!);
    const hubByMonth = new Map<string, number>();
    for (const r of dots) {
      const dt = dotVal(r, "Ngày tiền về"), amt = Number(dotVal(r, "Số tiền về (chưa VAT)") ?? 0);
      if (dt && amt) { const mo = String(dt).slice(0, 7); hubByMonth.set(mo, (hubByMonth.get(mo) ?? 0) + amt); }
    }
    console.log("\nĐối chiếu doanh thu Won theo tháng closing (đồng): file = tổng Total Revenue của deal Won; đợt đầu = phần đợt 1 theo file; SoE Hub = tổng Số tiền về của Đợt thanh toán");
    let bad = 0;
    for (const mo of [...new Set([...expectedByMonth.keys(), ...hubByMonth.keys()])].sort()) {
      const e = expectedByMonth.get(mo) ?? { file: 0, first: 0 }, hub = hubByMonth.get(mo) ?? 0;
      const ok = Math.abs(hub - e.first) < 1;
      if (!ok) bad++;
      console.log(`  ${mo}  file ${e.file.toLocaleString("en-US")}  đợt đầu ${e.first.toLocaleString("en-US")}  SoE Hub ${hub.toLocaleString("en-US")}  ${ok ? "khớp" : "LỆCH"}`);
    }
    console.log(`  => ${bad === 0 ? "tất cả các tháng khớp" : `${bad} tháng lệch`}`);

    console.log(`Số dòng: Deals ${dealIdByKey.size || (await rowsOf(tables["Deals"]!)).length}, Đợt thanh toán ${dots.length}`);
    const ledger = await rowsOf(tables["Sổ com"]!);
    const led = await keyOf(tables["Sổ com"]!);
    console.log(`\nSổ com: ${ledger.length} dòng. Kiểm 5 deal Won POD mẫu (com sale = tỉ lệ chính sách × số tiền về; SoE Leading ${LEAD_COM * 100}%, Associate ${ASSOC_COM * 100}% của com sale):`);
    const pool = wonList.filter((w) => w.pod && w.lead && (w.soe || w.assoc));
    for (const w of pool.filter((_, i) => i % Math.max(1, Math.floor(pool.length / 5)) === 0).slice(0, 5)) {
      const pol = policy.find((p) => p.lead === w.lead && p.level === w.level && p.perf === w.perf)!;
      const comSale = Math.round(w.amount * pol.rate);
      const rows = ledger.filter((r) => JSON.stringify(led(r, "Deal") ?? "").includes(w.rowId));
      console.log(`  ${w.company}: ${w.lead} ${w.level} ${w.perf}, tiền về ${w.amount.toLocaleString("en-US")}, tỉ lệ ${pol.rate}, com sale kỳ vọng ${comSale.toLocaleString("en-US")}`);
      if (rows.length === 0) console.log("    (không thấy dòng Sổ com của deal này)");
      for (const r of rows) {
        const who = led(r, "Người"), pct = Number(led(r, "% com") ?? 0), com = Number(led(r, "Com") ?? 0);
        const whoId = Array.isArray(who) ? String((who[0] as { id?: string })?.id ?? who[0]) : String((who as { id?: string })?.id ?? who);
        const exp = Math.round(comSale * (whoId === w.soe ? LEAD_COM : ASSOC_COM));
        console.log(`    ${whoId === w.soe ? "Leading" : "Associate"}: % com ${pct}, Com sale ${Number(led(r, "Com sale")).toLocaleString("en-US")}, Com ${com.toLocaleString("en-US")} (kỳ vọng ${exp.toLocaleString("en-US")}) ${Math.abs(com - exp) <= 1 ? "khớp" : "LỆCH"}`);
      }
    }
  } finally {
    await c.db.close();
  }
}

await main();
