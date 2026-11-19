import { describe, expect, it } from "vitest";
import { convertCell, mergedType, normalizeKeyPart, planMerge, type MergeConfig, type PlanSource } from "../src/modules/datahub/merge-plan";

/** The pure part of the merged table (Module 3 section 4): column types that go together, key folding, de-duplication, diagnostics. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const src = (tableId: string, name: string, rows: { id: string; no: number; at: number; mst: string | null; name?: string | null; money?: number | null }[]): PlanSource => ({
  tableId,
  name,
  columns: new Map([["k_mst", { type: "text" }], ["k_name", { type: "text" }], ["k_money", { type: "number" }]]),
  rows: rows.map((r) => ({ id: r.id, rowNo: r.no, updatedAt: r.at, data: { k_mst: r.mst, k_name: r.name ?? null, k_money: r.money ?? null } })),
});
const cfg = (dedup: MergeConfig["dedup"], ids = [A, B]): MergeConfig => ({
  sources: ids.map((table_id) => ({ table_id })),
  columns: [
    { key: "c_mst", name: "MST", type: "text", from: Object.fromEntries(ids.map((i) => [i, "k_mst"])) },
    { key: "c_name", name: "Tên", type: "text", from: Object.fromEntries(ids.map((i) => [i, "k_name"])) },
    { key: "c_money", name: "Tiền", type: "number", from: Object.fromEntries(ids.map((i) => [i, "k_money"])) },
  ],
  dedup,
});
const r = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, "0")}`;

describe("normalizeKeyPart", () => {
  it("drops accents, case and extra spaces (đ too)", () => {
    expect(normalizeKeyPart("  Đức   ANH ")).toBe("duc anh");
    expect(normalizeKeyPart("0101 ")).toBe("0101");
    expect(normalizeKeyPart(null)).toBe("");
    expect(normalizeKeyPart(12)).toBe("12");
  });
});

describe("mergedType", () => {
  it("same type stays, one family becomes the plain member, selects become text", () => {
    expect(mergedType(["number", "number"])).toEqual({ ok: true, type: "number" });
    expect(mergedType(["currency", "number"])).toEqual({ ok: true, type: "number" });
    expect(mergedType(["text", "long_text"])).toEqual({ ok: true, type: "long_text" });
    expect(mergedType(["email", "email"])).toEqual({ ok: true, type: "email" });
    expect(mergedType(["single_select", "multi_select"])).toEqual({ ok: true, type: "text" });
    expect(mergedType(["single_select", "text"])).toEqual({ ok: true, type: "text" });
    expect(mergedType(["date"])).toEqual({ ok: true, type: "date" });
  });
  it("refuses different families and types that cannot be merged", () => {
    expect(mergedType(["number", "text"]).ok).toBe(false);
    expect(mergedType(["date", "datetime"]).ok).toBe(false);
    expect(mergedType(["single_select", "number"]).ok).toBe(false);
    expect(mergedType(["attachment"]).ok).toBe(false);
  });
});

describe("convertCell", () => {
  it("turns select ids into names and drops anything that is not a plain value", () => {
    const sel = { type: "single_select", options: new Map([["o_1", "POD"]]) };
    expect(convertCell(sel, "o_1")).toBe("POD");
    expect(convertCell(sel, "o_x")).toBeNull();
    expect(convertCell({ type: "multi_select", options: new Map([["o_1", "A"], ["o_2", "B"]]) }, ["o_1", "o_2"])).toBe("A, B");
    expect(convertCell({ type: "number" }, 0)).toBe(0);
    expect(convertCell({ type: "checkbox" }, false)).toBe(false);
    expect(convertCell({ type: "text" }, "")).toBeNull();
    expect(convertCell(undefined, "x")).toBeNull();
  });
});

describe("planMerge", () => {
  const a = src(A, "Nguồn A", [{ id: r("1"), no: 1, at: 100, mst: "0101", name: "An", money: 10 }, { id: r("2"), no: 2, at: 100, mst: "Đức Anh", name: null, money: 5 }, { id: r("3"), no: 3, at: 100, mst: null, name: "Không khoá" }]);
  const b = src(B, "Nguồn B", [{ id: r("4"), no: 1, at: 200, mst: "0101 ", name: "An (B)", money: null }, { id: r("5"), no: 2, at: 50, mst: "duc anh", name: "Đức Anh B", money: 7 }, { id: r("6"), no: 3, at: 300, mst: "0909", name: "Mới", money: 1 }]);

  it("without a key keeps every row and warns", () => {
    const p = planMerge(cfg(null), [a, b]);
    expect(p.rows).toHaveLength(6);
    expect(p.diagnostics.warnings.map((w) => w.code)).toContain("no_key");
    expect(p.diagnostics.dropped).toBe(0);
    expect(new Set(p.rows.map((x) => x.ident)).size).toBe(6);
  });

  it("priority: the row of the higher source wins; key match folds accents, case, spaces; rows without a key never merge", () => {
    const p = planMerge(cfg({ columns: ["c_mst"], strategy: "priority" }), [a, b]);
    expect(p.diagnostics).toMatchObject({ total_read: 6, total_kept: 4, dropped: 2, duplicate_groups: 2, empty_key_rows: 1 });
    const won = p.rows.map((x) => x.sourceRowId).sort();
    expect(won).toEqual([r("1"), r("2"), r("3"), r("6")].sort());
    expect(p.diagnostics.sources.map((s) => [s.kept, s.dropped])).toEqual([[3, 0], [1, 2]]);
    const g = p.groups.find((x) => x.rows.length === 2 && x.key === "0101")!;
    expect(g.rows.map((x) => [x.row_no, x.kept])).toEqual([[1, true], [1, false]]);
  });

  it("latest: the row edited last wins, ties go to the higher source", () => {
    const p = planMerge(cfg({ columns: ["c_mst"], strategy: "latest" }), [a, b]);
    const won = p.rows.map((x) => x.sourceRowId);
    expect(won).toContain(r("4")); // 200 > 100
    expect(won).toContain(r("2")); // 100 > 50
    expect(won).not.toContain(r("1"));
    expect(won).not.toContain(r("5"));
  });

  it("cell_merge: every empty cell takes the first non-empty value in priority order", () => {
    const p = planMerge(cfg({ columns: ["c_mst"], strategy: "cell_merge" }), [a, b]);
    const duc = p.rows.find((x) => x.sourceRowId === r("2"))!;
    expect(duc.data).toMatchObject({ c_name: "Đức Anh B", c_money: 5 }); // name empty in A, taken from B; money kept from A
    const an = p.rows.find((x) => x.sourceRowId === r("1"))!;
    expect(an.data).toMatchObject({ c_name: "An", c_money: 10 });
  });

  it("the identity of a merged row is its key, so the winner can change without the row changing", () => {
    const first = planMerge(cfg({ columns: ["c_mst"], strategy: "priority" }), [a, b]);
    const b2 = src(B, "Nguồn B", b.rows.map((x) => ({ id: x.id, no: x.rowNo, at: x.updatedAt, mst: x.data.k_mst as string | null })));
    const a2 = src(A, "Nguồn A", a.rows.filter((x) => x.id !== r("1")).map((x) => ({ id: x.id, no: x.rowNo, at: x.updatedAt, mst: x.data.k_mst as string | null })));
    const second = planMerge(cfg({ columns: ["c_mst"], strategy: "priority" }), [a2, b2]);
    const identOf = (rows: typeof first.rows, rowId: string) => rows.find((x) => x.sourceRowId === rowId)?.ident;
    expect(identOf(first.rows, r("1"))).toBeDefined();
    expect(identOf(second.rows, r("4"))).toBe(identOf(first.rows, r("1"))); // same 0101, other source row now wins
  });

  it("a mapped column missing in a source is reported and gives empty cells; a source that is not listed is skipped", () => {
    const broken: PlanSource = { ...b, columns: new Map([["k_mst", { type: "text" }]]) };
    const p = planMerge(cfg(null), [a, broken]);
    expect(p.diagnostics.warnings.filter((w) => w.code === "missing_column").map((w) => w.column).sort()).toEqual(["Tiền", "Tên"]);
    expect(p.rows.filter((x) => x.sourceTableId === B).every((x) => x.data.c_name === null)).toBe(true);
    expect(planMerge(cfg(null, [A, B, C]), [a, b]).rows).toHaveLength(6);
  });

  it("is deterministic and orders by source priority then row number", () => {
    const x = planMerge(cfg(null), [b, a]);
    expect(x.rows.map((q) => q.sourceRowId)).toEqual([r("1"), r("2"), r("3"), r("4"), r("5"), r("6")]);
  });
});
