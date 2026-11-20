import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processJobs } from "../src/modules/datahub";
import { as, makeTable, unlimit, fails } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 4.1d (module4 19b): a summary export carries the group lines and totals of the grid, scoped to who exports, split lock included. */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });

async function exportSheet(call: ReturnType<typeof as>, body: Record<string, unknown>) {
  const job = await call("datahub.export.create", { table_id: x.tableId, ...body });
  await processJobs(env());
  const done = await call("datahub.job.get", { job_id: job.id });
  expect(done.status).toBe("done");
  const r = (await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE id = ${job.id}::uuid`)).rows[0] as { result_key: string };
  const chunks: Buffer[] = [];
  for await (const c of (t.c.storage as unknown as { read(k: string): AsyncIterable<Buffer> }).read(r.result_key)) chunks.push(c as Buffer);
  return { bytes: Buffer.concat(chunks), job: done };
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.userA2.id);
  x = await makeTable(owner, {
    name: "Deals tổng hợp",
    columns: [
      { name: "Tên", type: "text" },
      { name: "Phụ trách", type: "user" },
      { name: "Giai đoạn", type: "single_select", config: { options: [{ id: "o_aaaa", name: "Mới" }, { id: "o_bbbb", name: "Thắng" }] } },
      { name: "Vùng", type: "text" },
      { name: "Doanh thu", type: "number" },
    ],
  });
  for (const p of [org.userA1, org.leaderA, org.mgrA]) await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: p.id, permission: "edit_data" });
  const mk = (name: string, who: string, stage: string, region: string, money: number) => owner("datahub.row.create", { table_id: x.tableId, data: { Tên: name, "Phụ trách": who, "Giai đoạn": stage, Vùng: region, "Doanh thu": money } });
  await mk("d1", org.userA1.id, "Mới", "Bắc", 100);
  await mk("d2", org.userA1.id, "Thắng", "Bắc", 250);
  await mk("d3", org.userA1.id, "Thắng", "Nam", 50);
  await mk("d4", org.leaderA.id, "Mới", "Nam", 1000);
  await mk("d5", org.userA2.id, "Thắng", "Bắc", 7);
  await mk("d6", org.userA2.id, "Thắng", "Bắc", 8);
  await owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: true, key_columns: ["Phụ trách"] });
});
afterAll(async () => {
  await t.close();
});

const GROUP = [{ field: "Giai đoạn", dir: "asc" }, { field: "Vùng", dir: "asc" }];
const AGGS = { "Doanh thu": "sum" };

async function lines(call: ReturnType<typeof as>) {
  const grid = await call("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify(GROUP), aggs: JSON.stringify(AGGS) });
  const { bytes } = await exportSheet(call, { format: "xlsx", groups_only: true, group: JSON.stringify(GROUP), aggs: JSON.stringify(AGGS) });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const ws = wb.worksheets[0]!;
  const rows: unknown[][] = [];
  ws.eachRow((r, n) => {
    if (n > 1) rows.push((r.values as unknown[]).slice(1));
  });
  return { grid: grid.groups as { depth: number; path: unknown[]; count: number; aggs: Record<string, number | null> }[], head: (ws.getRow(1).values as unknown[]).slice(1), rows };
}

describe("summary export (groups_only)", () => {
  it("owner: header = group levels, Số dòng, totals; every line equals the grid's group line", async () => {
    const { grid, head, rows } = await lines(owner);
    expect(head).toEqual(["Giai đoạn", "Vùng", "Số dòng", "Doanh thu (Tổng)"]);
    expect(rows).toHaveLength(grid.length);
    grid.forEach((g, i) => {
      const r = rows[i]!;
      expect(r[2]).toBe(g.count);
      expect(r[3]).toBe(Object.values(g.aggs)[0]);
      // The group's value sits under its own level; the other level is empty.
      expect(r[g.depth] ?? null).not.toBeNull();
      expect(r[1 - g.depth] ?? null).toBeNull();
    });
    expect(grid.reduce((s, g) => s + (g.depth === 0 ? g.count : 0), 0)).toBe(6);
  });

  it("a member under the split lock gets only the groups of the rows they see, same numbers as their grid", async () => {
    const mine = await lines(as(t, org.userA1.id));
    expect(mine.grid.filter((g) => g.depth === 0).reduce((s, g) => s + g.count, 0)).toBe(3);
    expect(mine.grid.filter((g) => g.depth === 0).reduce((s, g) => s + Number(Object.values(g.aggs)[0]), 0)).toBe(400);
    mine.grid.forEach((g, i) => {
      expect(mine.rows[i]![2]).toBe(g.count);
      expect(mine.rows[i]![3]).toBe(Object.values(g.aggs)[0]);
    });
    // The leader sees own + team: d1..d4 = 4 rows, 1400.
    const lead = await lines(as(t, org.leaderA.id));
    expect(lead.grid.filter((g) => g.depth === 0).reduce((s, g) => s + g.count, 0)).toBe(4);
    expect(lead.rows.filter((_, i) => lead.grid[i]!.depth === 0).reduce((s, r) => s + Number(r[3]), 0)).toBe(1400);
  });

  it("CSV works too; groups_only needs a group; bad columns are refused at once", async () => {
    const { bytes } = await exportSheet(owner, { format: "csv", groups_only: true, group: JSON.stringify([{ field: "Vùng" }]) });
    const text = bytes.toString("utf8").slice(1).split("\r\n");
    expect(text[0]).toBe("Vùng,Số dòng");
    expect(text.slice(1).filter(Boolean).sort()).toEqual(["Bắc,4", "Nam,2"]);
    expect((await fails(owner("datahub.export.create", { table_id: x.tableId, format: "csv", groups_only: true }))).code).toBe("validation_error");
    expect((await fails(owner("datahub.export.create", { table_id: x.tableId, format: "csv", groups_only: true, group: JSON.stringify([{ field: "Không có" }]) }))).code).toBeTruthy();
  });
});
