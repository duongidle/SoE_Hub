import { describe, expect, it, vi } from "vitest";
import { GroupLayout } from "../src/lib/datahub/group-layout";
import { ViewAutosave } from "../src/lib/datahub/view-autosave";
import { applyPatch, buildQuery, normalizeConfig, countConditions, diffConfig, draftToFilter, filterToDraft, fullOrder, layoutColumns, moveColumn, pruneConfig, saveTarget, type ViewConfig } from "../src/lib/datahub/view-config";
import { currentPeriod, stepPeriod } from "../src/lib/datahub/time-ui";
import { parseCellText } from "../src/lib/datahub/cells";
import type { Column } from "../src/lib/datahub/types";

const col = (key: string, type: string, extra: Partial<Column> = {}): Column =>
  ({ id: key, key, name: key.toUpperCase(), type, config: {}, position: 0, required: false, unique: false, default_value: null, description: null, display: {}, version: 1, calc: null, ...extra }) as Column;

const columns: Column[] = [
  col("a", "text", { position: 0 }),
  col("b", "currency", { position: 1 }),
  col("c", "date", { position: 2 }),
  col("d", "single_select", { position: 3, config: { options: [{ id: "o1", name: "Mới" }, { id: "o2", name: "Chốt" }] } }),
  col("e", "multi_select", { position: 4, config: { options: [{ id: "x1", name: "X" }] } }),
  col("f", "formula", { position: 5, config: { result_type: "number" } }),
];

describe("buildQuery", () => {
  it("is empty for an empty view", () => {
    expect(buildQuery({}, columns)).toEqual({});
  });
  it("carries filter, sort, search, time filter and colour rules", () => {
    const cfg: ViewConfig = {
      filter: { field: "a", op: "contains", value: "x" },
      sort: [{ field: "b", dir: "desc", nulls: "last" }],
      time_filter: { columns: ["c"], range: { kind: "preset", preset: "this_month" } },
      colors: [{ filter: { field: "d", op: "eq", value: "o1" }, color: "red" }],
    };
    const q = buildQuery(cfg, columns, "  hân ");
    expect(q.filter).toEqual(cfg.filter);
    expect(JSON.parse(q.sort!)).toEqual([{ field: "b", dir: "desc", nulls: "last" }]);
    expect(q.search).toBe("hân");
    expect(q.timeFilter).toEqual(cfg.time_filter);
    expect(q.marks).toEqual([cfg.colors![0]!.filter]);
  });
  it("with a grouping the rows are sorted by the group columns first, empty last, then by the view sort", () => {
    const q = buildQuery({ group: [{ field: "d", dir: "desc" }], sort: [{ field: "d", dir: "asc" }, { field: "b", dir: "asc" }], group_aggs: { b: "sum" } }, columns);
    expect(JSON.parse(q.sort!)).toEqual([{ field: "d", dir: "desc", nulls: "last" }, { field: "b", dir: "asc" }]);
    expect(q.group).toEqual([{ field: "d", dir: "desc" }]);
    expect(q.aggs).toEqual({ b: "sum" });
  });
  it("leaves out settings that point at deleted columns instead of failing", () => {
    const cfg: ViewConfig = {
      filter: { and: [{ field: "gone", op: "eq", value: 1 }, { field: "a", op: "eq", value: "x" }] },
      sort: [{ field: "gone", dir: "asc" }, { field: "e", dir: "asc" }],
      group: [{ field: "gone" }],
      group_aggs: { gone: "sum" },
      time_filter: { columns: ["gone"], range: { kind: "preset", preset: "today" } },
    };
    const { config, dead } = pruneConfig(cfg, columns);
    expect(config).toEqual({ filter: { and: [{ field: "a", op: "eq", value: "x" }] } });
    expect(dead).toMatchObject({ filter: 1, sort: 2, group: 1, time: true, total: 5 });
    const q = buildQuery(cfg, columns);
    expect(q.sort).toBeUndefined();
    expect(q.group).toBeUndefined();
    expect(q.timeFilter).toBeUndefined();
  });
  it("keeps the meta date columns of a time filter", () => {
    const { config, dead } = pruneConfig({ time_filter: { columns: ["_created_at", "gone"], range: { kind: "preset", preset: "today" } } }, columns);
    expect(config.time_filter?.columns).toEqual(["_created_at"]);
    expect(dead.time).toBe(false);
  });
});

describe("column references", () => {
  it("turns column names (as an API or an AI writes them) into keys, and leaves unknown ones", () => {
    const cfg: ViewConfig = {
      filter: { and: [{ field: " b ", op: "gt", value: 1 }, { or: [{ field: "Gone", op: "is_empty" }] }] },
      sort: [{ field: "B", dir: "desc" }],
      hidden: ["a"],
      time_filter: { columns: ["_created_at", "C"], range: { kind: "preset", preset: "today" } },
    };
    const n = normalizeConfig(cfg, columns);
    expect(n.filter).toEqual({ and: [{ field: "b", op: "gt", value: 1 }, { or: [{ field: "Gone", op: "is_empty" }] }] });
    expect(n.sort).toEqual([{ field: "b", dir: "desc" }]);
    expect(n.time_filter?.columns).toEqual(["_created_at", "c"]);
    expect(pruneConfig(n, columns).dead.filter).toBe(1);
  });
  it("a single condition needs no group around it", () => {
    const draft = filterToDraft({ field: "a", op: "eq", value: "x" }, columns);
    expect(draftToFilter(draft, columns, (c, t) => parseCellText(c, t))).toEqual({ field: "a", op: "eq", value: "x" });
  });
});

describe("filter draft", () => {
  const parse = (c: Column, t: string) => parseCellText(c, t);
  it("round-trips a nested filter and keeps only finished conditions", () => {
    const node = { and: [{ field: "b", op: "between" as const, value: [1000, 2000] }, { or: [{ field: "d", op: "in" as const, value: ["o1", "o2"] }, { field: "a", op: "is_empty" as const }] }] };
    const draft = filterToDraft(node, columns);
    expect(draftToFilter(draft, columns, parse)).toEqual(node);
    expect(countConditions(node)).toBe(3);
  });
  it("drops unfinished and invalid conditions", () => {
    const draft = filterToDraft({ and: [{ field: "a", op: "contains", value: "x" }, { field: "b", op: "gt", value: 5 }] }, columns);
    // The two children of the root are the two conditions: one lost its text, the other holds text that is not a number.
    (draft.children[0] as { text: string }).text = "";
    (draft.children[1] as { text: string }).text = "abc";
    expect(draftToFilter(draft, columns, parse)).toBeUndefined();
  });
  it("reads Vietnamese numbers, percent points and dates", () => {
    const pct = col("p", "percent");
    const cols = [...columns, pct];
    const draft = filterToDraft({ and: [{ field: "p", op: "gte", value: 0.125 }, { field: "c", op: "lt", value: "2026-11-18" }] }, cols);
    expect((draft.children[0] as { text: string }).text).toBe("12,5");
    expect((draft.children[1] as { text: string }).text).toBe("18/11/2026");
    expect(draftToFilter(draft, cols, parse)).toEqual({ and: [{ field: "p", op: "gte", value: 0.125 }, { field: "c", op: "lt", value: "2026-11-18" }] });
  });
});

describe("columns of a view", () => {
  it("hides, orders and freezes", () => {
    const l = layoutColumns({ hidden: ["b"], order: ["c", "a"], frozen: 2 }, columns);
    expect(l.columns.map((c) => c.key)).toEqual(["c", "a", "d", "e", "f"]);
    expect(l.frozen).toBe(2);
    expect(fullOrder({ order: ["c", "zz"] }, columns)).toEqual(["c", "a", "b", "d", "e", "f"]);
    expect(moveColumn(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });
  it("never freezes every column", () => {
    expect(layoutColumns({ frozen: 99 }, columns).frozen).toBe(5);
  });
});

describe("autosave", () => {
  it("diffs only what changed and removes a setting with null", () => {
    expect(diffConfig({ frozen: 1, hidden: ["a"] }, { frozen: 1 })).toEqual({ hidden: null });
    expect(diffConfig({ frozen: 1 }, { frozen: 1 })).toBeNull();
    expect(applyPatch({ frozen: 1, hidden: ["a"] }, { hidden: null, row_height: "tall" })).toEqual({ frozen: 1, row_height: "tall" });
  });
  it("sends several quick changes as one request and shows them at once", async () => {
    vi.useFakeTimers();
    const sent: Record<string, unknown>[] = [];
    const a = new ViewAutosave({}, { save: async (p) => (sent.push(p), applyPatch({}, p)), onError: () => undefined, delay: 100 });
    a.change({ frozen: 1 });
    a.change({ row_height: "tall" });
    expect(a.config).toEqual({ frozen: 1, row_height: "tall" });
    await vi.advanceTimersByTimeAsync(150);
    expect(sent).toEqual([{ frozen: 1, row_height: "tall" }]);
    expect(a.status).toBe("saved");
    vi.useRealTimers();
  });
  it("a change made while a save is running is sent right after it", async () => {
    let release!: () => void;
    const sent: Record<string, unknown>[] = [];
    let saved: ViewConfig = {};
    const a = new ViewAutosave({}, {
      save: async (p) => {
        sent.push(p);
        if (sent.length === 1) await new Promise<void>((r) => (release = r));
        saved = applyPatch(saved, p);
        return saved;
      },
      onError: () => undefined,
      delay: 0,
    });
    a.change({ frozen: 1 });
    const first = a.flush();
    await Promise.resolve();
    a.change({ row_height: "tall" });
    release();
    await first;
    await a.flush();
    expect(sent).toEqual([{ frozen: 1 }, { row_height: "tall" }]);
    expect(a.config).toEqual({ frozen: 1, row_height: "tall" });
  });
  it("goes back to what the server holds when a save is refused", async () => {
    const onError = vi.fn();
    const a = new ViewAutosave({ frozen: 1 }, { save: async () => { throw new Error("no"); }, onError, delay: 0 });
    a.change({ frozen: 2 });
    await a.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(a.config).toEqual({ frozen: 1 });
    expect(a.status).toBe("error");
  });
  it("tells who a change lands on", () => {
    expect(saveTarget({ shared: true, has_override: false }, "owner")).toBe("shared");
    expect(saveTarget({ shared: true, has_override: false }, "edit_data")).toBe("copy");
    expect(saveTarget({ shared: false, has_override: false }, "view")).toBe("personal");
  });
});

describe("time filter steps", () => {
  it("moves a period across the year", () => {
    expect(stepPeriod({ kind: "period", unit: "month", year: 2026, index: 12 }, 1)).toEqual({ kind: "period", unit: "month", year: 2027, index: 1 });
    expect(stepPeriod({ kind: "period", unit: "month", year: 2026, index: 1 }, -1)).toEqual({ kind: "period", unit: "month", year: 2025, index: 12 });
    expect(stepPeriod({ kind: "period", unit: "quarter", year: 2026, index: 4 }, 1)).toEqual({ kind: "period", unit: "quarter", year: 2027, index: 1 });
    expect(stepPeriod({ kind: "period", unit: "year", year: 2026 }, -1)).toEqual({ kind: "period", unit: "year", year: 2025 });
  });
  it("takes the current period from the server's answer", () => {
    const info = { year: 2026, month: 11, fiscal_year: 2026, fiscal_quarter: 4 };
    expect(currentPeriod("month", info)).toEqual({ kind: "period", unit: "month", year: 2026, index: 11 });
    expect(currentPeriod("quarter", info)).toEqual({ kind: "period", unit: "quarter", year: 2026, index: 4 });
    expect(currentPeriod("year", info)).toEqual({ kind: "period", unit: "year", year: 2026 });
  });
});

describe("group layout", () => {
  const g = (depth: number, path: (string | null)[], count: number) => ({ depth, path, count, aggs: {} });
  const groups = [g(0, ["A"], 5), g(1, ["A", "x"], 3), g(1, ["A", "y"], 2), g(0, ["B"], 4), g(1, ["B", "x"], 4)];
  it("lists a header per group and the rows of the deepest groups", () => {
    const l = new GroupLayout(groups, 2, new Set());
    expect(l.count).toBe(5 + 9);
    expect(l.at(0)).toMatchObject({ type: "header", key: '["A"]' });
    expect(l.at(1)).toMatchObject({ type: "header", leaf: true });
    expect(l.at(2)).toEqual({ type: "row", pos: 0 });
    expect(l.at(4)).toEqual({ type: "row", pos: 2 });
    expect(l.at(5)).toMatchObject({ type: "header", key: '["A","y"]' });
    expect(l.at(6)).toEqual({ type: "row", pos: 3 });
    expect(l.at(8)).toMatchObject({ type: "header", key: '["B"]' });
    expect(l.at(10)).toEqual({ type: "row", pos: 5 });
    expect(l.at(14)).toBeUndefined();
    expect(l.indexOfRow(5)).toBe(10);
  });
  it("a closed group keeps its header, and the rows after it keep their positions", () => {
    const l = new GroupLayout(groups, 2, new Set(['["A"]']));
    expect(l.count).toBe(2 + 5);
    expect(l.at(1)).toMatchObject({ type: "header", key: '["B"]' });
    expect(l.at(3)).toEqual({ type: "row", pos: 5 });
    const l2 = new GroupLayout(groups, 2, new Set(['["A","x"]']));
    expect(l2.at(2)).toMatchObject({ type: "header", key: '["A","y"]' });
    expect(l2.at(3)).toEqual({ type: "row", pos: 3 });
    expect(l2.rowRanges(0, 100)).toEqual([[3, 4], [5, 8]]);
  });
});
