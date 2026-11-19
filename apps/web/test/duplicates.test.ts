import { describe, expect, it } from "vitest";
import { defaultChoice, fillPicks, groupRequest, mergeableColumns } from "../src/lib/datahub/duplicates";
import type { Column, Row } from "../src/lib/datahub/types";

const col = (key: string, type = "text"): Column => ({ id: key, key, name: key, type, config: {}, position: 0, required: false, unique: false, default_value: null, description: null, display: {}, version: 1, calc: null });
const cols = [col("a"), col("b"), col("c", "number")];
const row = (id: string, data: Record<string, unknown>): Row => ({ id, data });

describe("duplicate merge choices", () => {
  const rows = [row("r1", { a: "X" }), row("r2", { a: "X", b: "ghi chú" }), row("r3", { a: "X", b: "khác", c: 5 })];

  it("keeps the first row by default and removes the others without merging", () => {
    const ch = defaultChoice(rows, cols, false);
    expect(groupRequest(rows, cols, ch)).toEqual({ keep_id: "r1", remove_ids: ["r2", "r3"] });
  });

  it("merging fills the empty cells of the kept row from the first row that has a value", () => {
    const ch = defaultChoice(rows, cols, true);
    expect(ch.pick).toEqual({ b: "r2", c: "r3" });
    expect(groupRequest(rows, cols, ch).values).toEqual({ b: "ghi chú", c: 5 });
  });

  it("an explicit pick wins, and a pick equal to the current value writes nothing", () => {
    const ch = { keepId: "r2", merge: true, pick: { b: "r3", a: "r1" } };
    expect(groupRequest(rows, cols, ch).values).toEqual({ b: "khác" });
    expect(fillPicks(rows, cols, "r3")).toEqual({});
  });

  it("clearing a cell picks an empty row's value", () => {
    const ch = { keepId: "r2", merge: true, pick: { b: "r1" } };
    expect(groupRequest(rows, cols, ch).values).toEqual({ b: null });
  });

  it("only hand-written columns can be merged; links only for the owner", () => {
    const all = [col("a"), col("f", "formula"), col("t", "created_time"), col("p", "attachment"), col("l", "relation")];
    expect(mergeableColumns(all, "edit_data").map((c) => c.key)).toEqual(["a"]);
    expect(mergeableColumns(all, "owner").map((c) => c.key)).toEqual(["a", "l"]);
  });
});
