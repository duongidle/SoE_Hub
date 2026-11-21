import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { users } from "@soe/db";
import { processJobs } from "../src/modules/datahub";
import type { LocalStorageDriver } from "../src/storage";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 4.7A: people by email in user cells (row API and import), import of Người and Liên kết columns, the message for formula columns.
 * Invented data only.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });
const twin = `Trùng Tên ${randomUUID().slice(0, 6)}`;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.mgrA.id);
  for (const k of ["1", "2"]) await t.c.db.db.insert(users).values({ email: `twin${k}.${org.tag}@base.vn`, fullName: twin, roles: ["user"], status: "active" });
});
afterAll(async () => {
  await t.close();
});

async function upload(call: ReturnType<typeof as>, rows: (string | number | null)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  rows.forEach((r) => ws.addRow(r));
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const init = await call("file.upload.init", { filename: "x.xlsx", content_type: XLSX, size_bytes: bytes.length });
  await (t.c.storage as LocalStorageDriver).write(`files/${init.file.id}`, bytes);
  await call("file.upload.complete", { id: init.file.id });
  return (await call("datahub.import.analyze", { file_id: init.file.id })).job.id as string;
}
const named = async (call: ReturnType<typeof as>, tableId: string) => {
  const cols = (await call("datahub.table.get", { table_id: tableId })).columns as { name: string; key: string }[];
  const r = await call("datahub.row.list", { table_id: tableId, limit: 500, consistent: "true" });
  return (r.items as { data: Record<string, unknown> }[]).map((x) => Object.fromEntries(cols.filter((c) => x.data[c.key] !== undefined).map((c) => [c.name, x.data[c.key]])));
};
const ids = (v: unknown) => (Array.isArray(v) ? v.map((e) => (typeof e === "string" ? e : (e as { id: string }).id)) : [v as string]);

describe("user cells accept emails (row API)", () => {
  it("email becomes the id; unknown email and non-member are errors on the right row", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }, { name: "Phụ trách", type: "user" }, { name: "Nhóm", type: "user", config: { attrs: [{ key: "pct", label: "%", kind: "percent", default: 0 }] } }] });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA1.id, permission: "edit_data" });
    const ok = await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "a", "Phụ trách": org.userA1.email.toUpperCase(), Nhóm: [{ email: org.userA1.email, attrs: { pct: 0.5 } }, org.mgrA.email] } });
    const row = (await named(owner, x.tableId))[0]!;
    expect(row["Phụ trách"]).toBe(org.userA1.id);
    expect(row["Nhóm"]).toEqual([{ id: org.userA1.id, attrs: { pct: 0.5 } }, { id: org.mgrA.id, attrs: { pct: 0 } }]);
    expect(ok.id).toBeTruthy();
    const unknown = await fails(owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "b" } }, { op: "create", data: { Tên: "c", "Phụ trách": "khong.co@base.vn" } }] }));
    expect(unknown.details.issues).toEqual([{ row: 1, column: "Phụ trách", message: expect.stringContaining("không có trong hệ thống") }]);
    const stranger = await fails(owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "d", "Phụ trách": org.userB1.email } }));
    expect(stranger.message).toContain("chưa là thành viên");
  });
});

describe("import: Người and Liên kết columns", () => {
  it("emails and full names become ids; unknown, ambiguous and unmatched values are row errors; formula columns are refused with a clear message", async () => {
    const cust = await makeTable(owner, { columns: [{ name: "Mã KH", type: "text", unique: true }] });
    for (const c of ["KH1", "KH2", "KH3"]) await owner("datahub.row.create", { table_id: cust.tableId, data: { "Mã KH": c } });
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    await owner("datahub.column.create", { table_id: x.tableId, name: "Phụ trách", type: "user" });
    await owner("datahub.column.create", { table_id: x.tableId, name: "Nhóm", type: "user", config: { attrs: [{ key: "pct", label: "%", kind: "percent", default: 0 }] } });
    await owner("datahub.column.create", { table_id: x.tableId, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });
    await owner("datahub.column.create", { table_id: x.tableId, name: "Tính", type: "formula", config: { formula: "=1+1" } });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA1.id, permission: "edit_data" });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    const job = await upload(owner, [
      ["Tên", "Phụ trách", "Nhóm", "Khách"],
      ["r1", org.userA1.email, `${org.userA1.name}; ${org.userA2.email}`, "KH1; KH3"],
      ["r2", org.userA2.name, null, "KH2"],
      ["r3", "khong.co@base.vn", null, null],
      ["r4", twin, null, null],
      ["r5", null, null, "KH9"],
      ["r6", org.userB1.email, null, null],
    ]);
    const cols = ["Tên", "Phụ trách", "Nhóm", "Khách"].map((target, index) => ({ index, target }));
    const mapping = { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: cols }] };
    const pv = await owner("datahub.import.preview", { job_id: job, mapping });
    expect(pv.sheets[0]).toMatchObject({ valid: 3, invalid: 3 });
    expect(pv.sheets[0].errors.map((e: { row: number; message: string }) => [e.row, e.message])).toEqual([
      [4, expect.stringContaining("Không có người dùng nào có email")],
      [5, expect.stringContaining("người dùng tên")],
      [6, expect.stringContaining('"Mã KH" = "KH9"')],
    ]);
    // r6 (a non-member) passes the preview: whether a person may be in the cell is the row writer's check.
    await owner("datahub.import.start", { job_id: job, mapping });
    await processJobs(env());
    await drainOutbox(t);
    const done = await owner("datahub.job.get", { job_id: job });
    expect(done.report.sheets[0]).toMatchObject({ created: 2, skipped: 4 });
    expect(done.report.sheets[0].errors.map((e: { row: number }) => e.row).sort()).toEqual([4, 5, 6, 7]);
    expect(done.report.sheets[0].errors.find((e: { row: number }) => e.row === 7).message).toContain("chưa là thành viên");
    const rows = await named(owner, x.tableId);
    const r1 = rows.find((r) => r["Tên"] === "r1")!;
    const r2 = rows.find((r) => r["Tên"] === "r2")!;
    expect(r1["Phụ trách"]).toBe(org.userA1.id);
    expect(ids(r1["Nhóm"])).toEqual([org.userA1.id, org.userA2.id]);
    expect((r1["Khách"] as string[]).length).toBe(2);
    expect(r2["Phụ trách"]).toBe(org.userA2.id);
    expect((r2["Khách"] as string[]).length).toBe(1);

    // A formula column is refused with its own words.
    const bad = await upload(owner, [["A"], ["1"]]);
    const e = await fails(owner("datahub.import.preview", { job_id: bad, mapping: { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Tính" }] }] } }));
    expect(e.message).toContain('cột "Tính" là cột công thức, không nhập được');
  });

  it("link_by picks the matching column of the target; no unique column and no link_by is an error", async () => {
    const cust = await makeTable(owner, { columns: [{ name: "Tên KH", type: "text" }, { name: "MST", type: "text" }] });
    await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên KH": "Công ty A", MST: "0101" } });
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    await owner("datahub.column.create", { table_id: x.tableId, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });
    const job = await upload(owner, [["Tên", "Khách"], ["r1", "0101"]]);
    const map = (link_by?: string) => ({ datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Tên" }, { index: 1, target: "Khách", ...(link_by ? { link_by } : {}) }] }] });
    const none = await owner("datahub.import.preview", { job_id: job, mapping: map() });
    expect(none.sheets[0].errors[0].message).toContain("link_by");
    const ok = await owner("datahub.import.preview", { job_id: job, mapping: map("MST") });
    expect(ok.sheets[0]).toMatchObject({ valid: 1, invalid: 0 });
  });
});
