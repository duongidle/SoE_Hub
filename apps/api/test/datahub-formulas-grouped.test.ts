import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * The grouped SQL path (one query per column, design module2 section 6.6) must give exactly what the row-by-row scan gives.
 * Every aggregate is written twice: with a plain equality criteria (grouped) and as `"="&key` (an operator, so it is scanned).
 */
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

describe("grouped SQL = row-by-row scan", () => {
  it("SUMIFS, COUNTIFS, AVERAGEIFS, MINIFS, MAXIFS, XLOOKUP, two criteria, numbers vs numeric text, dates, case, blanks", async () => {
    const dh = await a("datahub.datahub.create", { name: `Gom nhóm ${Math.random()}` });
    const src = await a("datahub.table.create", { datahub_id: dh.id, name: "Nguồn" });
    const dst = await a("datahub.table.create", { datahub_id: dh.id, name: "Đích" });
    for (const [n, ty] of [["k", "text"], ["v", "number"], ["d", "date"], ["s", "text"], ["w", "date"]] as const) await a("datahub.column.create", { table_id: src.id, name: n, type: ty });
    for (const [n, ty] of [["k", "text"], ["kn", "number"], ["d", "date"]] as const) await a("datahub.column.create", { table_id: dst.id, name: n, type: ty });
    const S = (name: string) => `[Nguồn].[${name}]`;
    const srcRows: Record<string, unknown>[] = [
      { k: "A", v: 10, d: "2026-01-05", s: "x", w: "2026-02-01" },
      { k: "a", v: 20, d: "2026-01-05", s: "y", w: "2026-03-01" },
      { k: "B", v: 5, d: "2026-02-10", s: "x" },
      { k: "5", v: 7, d: "2026-02-10", s: "z" },
      { k: "B", v: 1.5, d: "2026-03-01", s: "x", w: "2026-01-15" },
      { k: "C" },
      { v: 99, d: "2026-01-05" },
      { k: "Ê Đ", v: 3 },
      { k: "ê đ", v: 4 },
    ];
    await a("datahub.row.batch", { table_id: src.id, ops: srcRows.map((data) => ({ op: "create", data })) });
    const dstRows: Record<string, unknown>[] = [{ k: "A", d: "2026-01-05" }, { k: "b", d: "2026-02-10" }, { k: "C", d: "2026-03-01" }, { k: "zzz" }, { k: "5", kn: 5 }, { kn: 5 }, { k: "ê Đ" }, { k: "B", d: "2026-03-01" }];
    await a("datahub.row.batch", { table_id: dst.id, ops: dstRows.map((data) => ({ op: "create", data })) });

    const pairs: [string, string, string][] = [
      ["SUMIFS", `=SUMIFS(${S("v")}, ${S("k")}, [k])`, `=SUMIFS(${S("v")}, ${S("k")}, "="&[k])`],
      ["COUNTIFS", `=COUNTIFS(${S("k")}, [k])`, `=COUNTIFS(${S("k")}, "="&[k])`],
      ["AVERAGEIFS", `=AVERAGEIFS(${S("v")}, ${S("k")}, [k])`, `=AVERAGEIFS(${S("v")}, ${S("k")}, "="&[k])`],
      ["MINIFS", `=MINIFS(${S("v")}, ${S("k")}, [k])`, `=MINIFS(${S("v")}, ${S("k")}, "="&[k])`],
      ["MAXIFS", `=MAXIFS(${S("v")}, ${S("k")}, [k])`, `=MAXIFS(${S("v")}, ${S("k")}, "="&[k])`],
      ["MINIFS date", `=MINIFS(${S("w")}, ${S("k")}, [k])`, `=MINIFS(${S("w")}, ${S("k")}, "="&[k])`],
      ["two criteria", `=COUNTIFS(${S("k")}, [k], ${S("d")}, [d])`, `=COUNTIFS(${S("k")}, "="&[k], ${S("d")}, "="&[d])`],
      ["sum two criteria", `=SUMIFS(${S("v")}, ${S("k")}, [k], ${S("d")}, [d])`, `=SUMIFS(${S("v")}, ${S("k")}, "="&[k], ${S("d")}, "="&[d])`],
      ["number key vs numeric text", `=COUNTIFS(${S("k")}, [kn])`, `=COUNTIFS(${S("k")}, "="&[kn])`],
      ["SUMIF", `=SUMIF(${S("k")}, [k], ${S("v")})`, `=SUMIF(${S("k")}, "="&[k], ${S("v")})`],
      ["COUNTIF", `=COUNTIF(${S("k")}, [k])`, `=COUNTIF(${S("k")}, "="&[k])`],
      ["XLOOKUP", `=XLOOKUP([k], ${S("k")}, ${S("v")}, "-")`, `=XLOOKUP([k], ${S("k")}, ${S("v")}, "-", 2)`],
      ["XLOOKUP text result", `=XLOOKUP([k], ${S("k")}, ${S("s")}, "-")`, `=XLOOKUP([k], ${S("k")}, ${S("s")}, "-", 2)`],
      ["XLOOKUP date result", `=XLOOKUP([k], ${S("k")}, ${S("w")})`, `=XLOOKUP([k], ${S("k")}, ${S("w")}, , 2)`],
      // A range inside the lookup value (an empty suffix) makes the call ungroupable, so it is scanned.
      ["VLOOKUP", `=IFERROR(VLOOKUP([k], ${S("k")}, ${S("v")}), "none")`, `=IFERROR(VLOOKUP([k] & LEFT(COUNTA(${S("k")}), 0), ${S("k")}, ${S("v")}), "none")`],
      ["INDEX/MATCH", `=IFERROR(INDEX(${S("v")}, MATCH([k], ${S("k")}, 0)), "none")`, `=IFERROR(INDEX(${S("v")}, MATCH([k] & LEFT(COUNTA(${S("k")}), 0), ${S("k")}, 0)), "none")`],
      ["zero key SUM", `=SUM(${S("v")})`, `=SUMIFS(${S("v")}, ${S("v")}, ">-1000000")`],
      ["zero key COUNT", `=COUNT(${S("v")})`, `=COUNTIFS(${S("v")}, ">-1000000")`],
      ["zero key COUNTA", `=COUNTA(${S("k")})`, `=COUNTIFS(${S("k")}, "<>")`],
      ["zero key AVERAGE", `=AVERAGE(${S("v")})`, `=AVERAGEIFS(${S("v")}, ${S("v")}, ">-1000000")`],
      ["zero key MAX date", `=MAX(${S("w")})`, `=MAXIFS(${S("w")}, ${S("w")}, ">0")`],
      ["composite", `=IFERROR(SUMIFS(${S("v")}, ${S("k")}, [k]) / COUNTIFS(${S("k")}, [k]), 0) + 1`, `=IFERROR(SUMIFS(${S("v")}, ${S("k")}, "="&[k]) / COUNTIFS(${S("k")}, "="&[k]), 0) + 1`],
    ];
    const cols: [string, { key: string }, { key: string }][] = [];
    for (const [label, g, s] of pairs) {
      // VLOOKUP/XLOOKUP "approximate" variants return the nearest smaller value only when there is no exact match;
      // the data has exact matches or none, so the two paths must agree.
      cols.push([label, await a("datahub.column.create", { table_id: dst.id, name: `G ${label}`, type: "formula", config: { formula: g } }), await a("datahub.column.create", { table_id: dst.id, name: `S ${label}`, type: "formula", config: { formula: s } })]);
    }
    await drainOutbox(t);
    const rows = (await a("datahub.row.list", { table_id: dst.id, limit: 100 })).items as { data: Record<string, unknown> }[];
    expect(rows).toHaveLength(dstRows.length);
    const diffs: string[] = [];
    let compared = 0;
    for (const [label, g, s] of cols) {
      rows.forEach((r, i) => {
        // A blank key is a different question in the two forms ("" criteria vs a blank cell), so only keyed rows are compared.
        if (dstRows[i]!.k === undefined && !label.startsWith("number key") && !label.startsWith("zero key")) return;
        if (dstRows[i]!.kn === undefined && label.startsWith("number key")) return;
        // An empty criteria cell counts as 0 in the grouped form, as in Excel; `"="&blank` is a different question.
        if (dstRows[i]!.d === undefined && label.includes("two criteria")) return;
        compared++;
        if (JSON.stringify(r.data[g.key]) !== JSON.stringify(r.data[s.key])) diffs.push(`${label} row ${i} (${JSON.stringify(dstRows[i])}): grouped=${JSON.stringify(r.data[g.key])} scan=${JSON.stringify(r.data[s.key])}`);
      });
    }
    expect(diffs).toEqual([]);
    expect(compared).toBeGreaterThan(100);
    // Spot-check real values, so "both wrong in the same way" cannot pass.
    const byLabel = (label: string, i: number) => rows[i]!.data[cols.find((c) => c[0] === label)![1].key];
    expect(byLabel("SUMIFS", 0)).toBe(30); // "A" and "a" are the same key
    expect(byLabel("SUMIFS", 1)).toBe(6.5); // "b" matches "B" twice
    expect(byLabel("COUNTIFS", 3)).toBe(0);
    expect(byLabel("number key vs numeric text", 4)).toBe(1); // 5 matches the text "5"
    expect(byLabel("SUMIFS", 6)).toBe(7); // accents are significant, case is not
    expect(byLabel("XLOOKUP", 0)).toBe("10"); // first row wins (text: the fallback "-" makes the column mixed, so text)
    expect(byLabel("XLOOKUP", 3)).toBe("-");
    expect(byLabel("two criteria", 7)).toBe(1);
    expect(byLabel("zero key SUM", 0)).toBe(149.5);
  }, 60_000);
});
