import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findHits, optionRenames, rewriteStored } from "../src/modules/datahub/option-rename";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 4.1d (module4 19d): renaming an option finds the formulas that compare the column with the old name as text, and rewrites them on request. */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("finding and rewriting (the formula parser, not a text pattern)", () => {
  const T1 = "01a1f982-6f85-7517-b1cf-ccd5309324ec";
  const T2 = "01a1f982-6fad-74bb-aab0-37cf7ef7ab30";
  const target = { tableId: T1, key: "c_status" };
  const rn = [{ from: "Won", to: 'Thắng "lớn"' }];
  const hit = (s: string, table = T1) => findHits(s, target, table, rn).length;

  it("finds comparisons, criteria, SWITCH and lookups of exactly this column; ignores text that is not a comparison", () => {
    expect(hit('IF({c_status}="Won",1,0)')).toBe(1);
    expect(hit('IF("won"<>{c_status},1,0)')).toBe(1); // either side, any letter case
    expect(hit('COUNTIFS({c_status},"Won",{c_other},"Won")')).toBe(1); // only the criteria of THIS column
    expect(hit('COUNTIFS({c_status},"<>Won")')).toBe(1);
    expect(hit('SWITCH({c_status},"Won","W","Lost","L","?")')).toBe(1);
    expect(hit('XLOOKUP("Won",{c_status},{c_x})')).toBe(1);
    expect(hit('{c_status}&"Won"')).toBe(0); // concatenation is not a comparison
    expect(hit('IF({c_other}="Won",1,0)')).toBe(0); // another column
    expect(hit('IF({c_status}="Wonderful",1,0)')).toBe(0); // not the same text
    expect(hit(`IF({${T1}.c_status}="Won",1,0)`, T2)).toBe(1); // another table reading this column
    expect(hit('IF({c_status}="Won",1,0)', T2)).toBe(0); // the same key in a different table is another column
  });

  it("rewrites only the literals found, keeps the operator, doubles quotes", () => {
    const s = 'IF({c_status}="Won","Won",0)+COUNTIFS({c_status},"<>Won")';
    const out = rewriteStored(s, findHits(s, target, T1, rn));
    expect(out).toBe('IF({c_status}="Thắng ""lớn""","Won",0)+COUNTIFS({c_status},"<>Thắng ""lớn""")');
  });

  it("renames are options that kept their id and changed name", () => {
    expect(optionRenames([{ id: "o1", name: "Won" }, { id: "o2", name: "Lost" }], [{ id: "o1", name: "Thắng" }, { id: "o2", name: "Lost" }, { id: "o3", name: "Mới" }])).toEqual([{ from: "Won", to: "Thắng" }]);
    expect(optionRenames([{ id: "o1", name: "Won" }], [{ id: "o1", name: "Won" }])).toEqual([]);
  });
});

describe("the commands", () => {
  async function setup() {
    const x = await makeTable(a, {
      columns: [
        { name: "Status", type: "single_select", config: { options: [{ id: "o_won1", name: "Won" }, { id: "o_lost", name: "Lost" }] } },
        { name: "Ghi chú", type: "text" },
      ],
    });
    const f = async (name: string, formula: string, tableId = x.tableId) => (await a("datahub.column.create", { table_id: tableId, name, type: "formula", config: { formula } })).id as string;
    const ids = {
      iff: await f("Là Won", '=IF([Status]="Won",1,0)'),
      cnt: await f("Số Won", '=COUNTIFS([Bảng 1].[Status],"Won")'),
      sw: await f("Chữ", '=SWITCH([Status],"Won","W","Lost","L","?")'),
      other: await f("Ghi chú Won", '=IF([Ghi chú]="Won",1,0)'),
      concat: await f("Nối", '=[Status]&"Won"'),
    };
    const t2 = await a("datahub.table.create", { datahub_id: x.dhId, name: "Bảng 2" });
    await a("datahub.column.create", { table_id: t2.id, name: "Tên", type: "text" });
    const cross = await f("Số Won chéo", '=COUNTIFS([Bảng 1].[Status],"Won")', t2.id);
    await a("datahub.row.create", { table_id: x.tableId, data: { Status: "Won" } });
    await a("datahub.row.create", { table_id: x.tableId, data: { Status: "Lost" } });
    await a("datahub.row.create", { table_id: t2.id, data: { Tên: "x" } });
    await drainOutbox(t);
    return { x, ids, cross, t2 };
  }
  const newOptions = [{ id: "o_won1", name: "Thắng" }, { id: "o_lost", name: "Lost" }];
  const formulaOf = async (tableId: string, col: string) => ((await a("datahub.table.get", { table_id: tableId })).columns as { name: string; config: { formula?: string } }[]).find((c) => c.name === col)!.config.formula;

  it("option_impact lists the formulas that would silently go wrong, including another table; changes nothing", async () => {
    const { x } = await setup();
    const r = await a("datahub.column.option_impact", { table_id: x.tableId, column: "Status", options: newOptions });
    expect(r.renames).toEqual([{ from: "Won", to: "Thắng" }]);
    expect(r.formulas.map((f: { column_name: string }) => f.column_name).sort()).toEqual(["Chữ", "Là Won", "Số Won", "Số Won chéo"]);
    const sw = r.formulas.find((f: { column_name: string }) => f.column_name === "Chữ");
    expect(sw.before).toContain('"Won"');
    expect(sw.after).toContain('"Thắng"');
    expect(await formulaOf(x.tableId, "Là Won")).toBe('=IF([Status]="Won",1,0)');
    // No rename, nothing to list.
    expect((await a("datahub.column.option_impact", { table_id: x.tableId, column: "Status", options: [{ id: "o_won1", name: "Won" }, { id: "o_lost", name: "Lost" }] })).formulas).toEqual([]);
  });

  it("update without the flag leaves the formulas alone; with it they are rewritten and give the same numbers", async () => {
    const { x, t2, cross } = await setup();
    await a("datahub.column.update", { table_id: x.tableId, column: "Status", config: { options: newOptions } });
    expect(await formulaOf(x.tableId, "Là Won")).toBe('=IF([Status]="Won",1,0)'); // still the old name: now answers 0, as the warning said
    // Put the name back, then rename again asking for the rewrite.
    await a("datahub.column.update", { table_id: x.tableId, column: "Status", config: { options: [{ id: "o_won1", name: "Won" }, { id: "o_lost", name: "Lost" }] } });
    await a("datahub.column.update", { table_id: x.tableId, column: "Status", config: { options: newOptions }, update_formulas: true });
    await drainOutbox(t);
    expect(await formulaOf(x.tableId, "Là Won")).toBe('=IF([Status]="Thắng",1,0)');
    expect(await formulaOf(x.tableId, "Số Won")).toBe('=COUNTIFS([Bảng 1].[Status],"Thắng")');
    expect(await formulaOf(x.tableId, "Chữ")).toBe('=SWITCH([Status],"Thắng","W","Lost","L","?")');
    expect(await formulaOf(x.tableId, "Ghi chú Won")).toBe('=IF([Ghi chú]="Won",1,0)'); // another column: untouched
    expect(await formulaOf(x.tableId, "Nối")).toBe('=[Status]&"Won"'); // not a comparison: untouched
    expect(await formulaOf(t2.id, "Số Won chéo")).toBe('=COUNTIFS([Bảng 1].[Status],"Thắng")');
    // The numbers are the ones before the rename (one Won row).
    const rows = await a("datahub.row.list", { table_id: x.tableId, labels: "true" });
    const cols = (await a("datahub.table.get", { table_id: x.tableId })).columns as { name: string; key: string }[];
    const key = (n: string) => cols.find((c) => c.name === n)!.key;
    const won = (rows.items as { data: Record<string, unknown> }[]).find((r) => r.data[key("Status")] === "Thắng")!;
    expect(won.data[key("Là Won")]).toBe(1);
    expect(won.data[key("Số Won")]).toBe(1);
    expect(won.data[key("Chữ")]).toBe("W");
    const t2rows = await a("datahub.row.list", { table_id: t2.id });
    const ckey = ((await a("datahub.table.get", { table_id: t2.id })).columns as { name: string; key: string }[]).find((c) => c.name === "Số Won chéo")!.key;
    expect((t2rows.items as { data: Record<string, unknown> }[])[0]!.data[ckey]).toBe(1);
    void cross;
  });
});
