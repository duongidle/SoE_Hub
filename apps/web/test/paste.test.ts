import { describe, expect, it } from "vitest";
import { cellError, displayText, parseCellText, readOnlyReason } from "../src/lib/datahub/cells";
import { parseTsv, planPaste } from "../src/lib/datahub/paste";
import type { Column, Row } from "../src/lib/datahub/types";

const col = (name: string, type: string, extra: Partial<Column> = {}): Column => ({
  id: `id-${name}`, key: `k_${name}`, name, type, config: {}, position: 0, required: false, unique: false, default_value: null, description: null, display: {}, version: 1, calc: null, ...extra,
});
const stage = col("Giai đoạn", "single_select", { config: { options: [{ id: "o_1", name: "Mới" }, { id: "o_2", name: "Đang chăm" }] } });
const source = col("Nguồn", "multi_select", { config: { options: [{ id: "o_a", name: "Facebook" }, { id: "o_b", name: "Sự kiện" }] } });
const ctx = { people: new Map([["u1", "Đặng Thị Ngọc Hân"]]), linked: new Map<string, string>() };

describe("parseTsv", () => {
  it("splits tabs and new lines, drops the trailing new line of a copy", () => {
    expect(parseTsv("a\tb\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("a\tb\r\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("reads quoted cells with tabs, new lines and doubled quotes", () => {
    expect(parseTsv('"a\tb"\t"dòng 1\ndòng 2"\t"nói ""xin chào"""\n')).toEqual([["a\tb", "dòng 1\ndòng 2", 'nói "xin chào"']]);
  });
  it("keeps empty cells", () => {
    expect(parseTsv("a\t\tc\n\t\t\n")).toEqual([["a", "", "c"], ["", "", ""]]);
  });
});

describe("parseCellText: what Excel and Sheets put on the clipboard", () => {
  it("numbers, money, percent in Vietnamese and English styles", () => {
    expect(parseCellText(col("n", "number"), "156,000,000")).toEqual({ ok: true, value: 156_000_000 });
    expect(parseCellText(col("n", "number"), "1.234.567,5")).toEqual({ ok: true, value: 1234567.5 });
    expect(parseCellText(col("m", "currency"), "156.000.000 ₫")).toEqual({ ok: true, value: 156_000_000 });
    expect(parseCellText(col("m", "currency"), "1,5")).toMatchObject({ ok: false });
    expect(parseCellText(col("p", "percent"), "12,5%")).toEqual({ ok: true, value: 0.125 });
    expect(parseCellText(col("p", "percent"), "30")).toEqual({ ok: true, value: 0.3 });
    expect(parseCellText(col("n", "number"), "abc")).toMatchObject({ ok: false, message: expect.stringContaining("không phải số") });
  });
  it("dates and date times", () => {
    expect(parseCellText(col("d", "date"), "18/11/2026")).toEqual({ ok: true, value: "2026-11-18" });
    expect(parseCellText(col("d", "date"), "31/02/2026")).toMatchObject({ ok: false });
    expect(parseCellText(col("d", "datetime"), "18/11/2026 09:30")).toEqual({ ok: true, value: "2026-11-18T02:30:00.000Z" });
  });
  it("empty text clears the cell; a checkbox reads Có / Không", () => {
    expect(parseCellText(col("n", "number"), "  ")).toEqual({ ok: true, value: null });
    expect(parseCellText(col("c", "checkbox"), "Có")).toEqual({ ok: true, value: true });
    expect(parseCellText(col("c", "checkbox"), "")).toEqual({ ok: true, value: false });
    expect(parseCellText(col("c", "checkbox"), "có thể")).toMatchObject({ ok: false });
  });
  it("selects by name, without caring for case or accents; unknown option is an error that names the column", () => {
    expect(parseCellText(stage, "đang chăm")).toEqual({ ok: true, value: "o_2" });
    expect(parseCellText(stage, "dang cham")).toEqual({ ok: true, value: "o_2" });
    expect(parseCellText(stage, "Thua")).toMatchObject({ ok: false, message: expect.stringContaining("Giai đoạn") });
    expect(parseCellText(source, "Facebook, Sự kiện")).toEqual({ ok: true, value: ["o_a", "o_b"] });
  });
  it("a person by name from the known people, or by id", () => {
    const byName = new Map([["dang thi ngoc han", "u1"]]);
    expect(parseCellText(col("u", "user"), "Đặng Thị Ngọc Hân", byName)).toEqual({ ok: true, value: "u1" });
    expect(parseCellText(col("u", "user"), "Ai đó", byName)).toMatchObject({ ok: false });
  });
});

describe("round trip: what the grid copies can be pasted back", () => {
  it.each([
    [col("n", "number"), 1234567.5],
    [col("m", "currency"), 156_000_000],
    [col("p", "percent"), 0.125],
    [col("d", "date"), "2026-11-18"],
    [col("d", "datetime"), "2026-11-18T02:30:00.000Z"],
    [col("c", "checkbox"), true],
    [stage, "o_2"],
    [source, ["o_a", "o_b"]],
  ])("%#", (c, value) => {
    const row: Row = { id: "r", data: { [c.key]: value } };
    expect(parseCellText(c, displayText(c, row, ctx))).toEqual({ ok: true, value });
  });
});

describe("display", () => {
  it("shows an error code only in computed columns, with a dash for empty", () => {
    const f = col("f", "formula", { config: { result_type: "number" } });
    expect(cellError(f, "#DIV/0!")).toBe("#DIV/0!");
    expect(cellError(col("t", "text"), "#DIV/0!")).toBeNull();
    expect(displayText(f, { id: "r", data: { k_f: "#DIV/0!" } }, ctx)).toBe("#DIV/0!");
    expect(displayText(col("n", "number"), { id: "r", data: {} }, ctx)).toBe("—");
    expect(displayText(col("n", "number"), { id: "r", data: { k_n: 12345678900 } }, ctx)).toBe("12.345.678.900");
  });
  it("only the owner may write a relation, and computed columns are never writable", () => {
    expect(readOnlyReason(col("f", "formula"), "owner")).not.toBeNull();
    expect(readOnlyReason(col("t", "text"), "view")).toBeNull();
    expect(readOnlyReason(col("r", "relation"), "edit_data")).not.toBeNull();
  });
});

describe("planPaste", () => {
  const columns = [col("Tên", "text"), col("Tiền", "currency"), col("Tính", "formula", { config: { result_type: "number" } }), col("Ngày", "date")];
  const rows: Row[] = [{ id: "r0", data: { k_Tên: "A", k_Tiền: 5 } }, { id: "r1", data: {} }];
  const base = { columns, rowAt: (i: number) => rows[i], rowCount: 2, level: "owner" as const };

  it("writes into existing rows, skips computed columns and unchanged cells", () => {
    const plan = planPaste({ ...base, startRow: 0, startCol: 0, matrix: [["A", "156,000,000", "x", "18/11/2026"]] });
    expect(plan.errors).toEqual([]);
    expect(plan.skipped).toBe(1);
    expect(plan.changes.map((c) => [c.rowId, c.key, c.value])).toEqual([["r0", "k_Tiền", 156_000_000], ["r0", "k_Ngày", "2026-11-18"]]);
  });
  it("rows below the last one become new rows", () => {
    const plan = planPaste({ ...base, startRow: 1, startCol: 0, matrix: [["B"], ["C"], ["D"]] });
    expect(plan.newRows).toBe(2);
    expect(plan.changes.map((c) => [c.rowIndex, c.newIndex, c.value])).toEqual([[1, null, "B"], [null, 0, "C"], [null, 1, "D"]]);
  });
  it("lists unreadable cells with their row and column", () => {
    const plan = planPaste({ ...base, startRow: 0, startCol: 1, matrix: [["abc"]] });
    expect(plan.errors).toEqual([{ row: 1, column: "Tiền", message: expect.stringContaining("không phải số") }]);
  });
  it("ignores cells to the right of the last column", () => {
    const plan = planPaste({ ...base, startRow: 0, startCol: 3, matrix: [["18/11/2026", "thừa"]] });
    expect(plan.changes).toHaveLength(1);
  });
  it("a row that is not loaded yet is reported, not guessed", () => {
    const plan = planPaste({ ...base, rowAt: () => undefined, startRow: 0, startCol: 0, matrix: [["X"]] });
    expect(plan.errors[0]!.message).toContain("chưa được tải");
  });
});
