import { describe, expect, it } from "vitest";
import { FORMULA_SAMPLES, activeCall, applySuggestion, fillSample, sampleReady, segments, suggest, syntaxParts, type FnInfo, type FormulaScope } from "../src/lib/datahub/formula-assist";

const fn = (name: string, syntax: string, max = 3): FnInfo => ({ name, group: "x", syntax, description: `Mô tả ${name}.`, example: "", example_result: "", min_args: 1, max_args: max });
const fns = [fn("IF", "IF(điều_kiện, nếu_đúng, [nếu_sai])"), fn("IFERROR", "IFERROR(giá_trị, nếu_lỗi)"), fn("SUM", "SUM(số1, ...)", 254), fn("TODAY", "TODAY()", 0)];

const scope: FormulaScope = {
  current: { id: "t1", name: "Deals", columns: ["Doanh thu", "Ngày chốt", "Đặng Khách"] },
  datahub: {
    id: "d1",
    name: "Bán hàng",
    tables: [
      { id: "t1", name: "Deals", columns: ["Doanh thu", "Ngày chốt", "Đặng Khách"] },
      { id: "t2", name: "Khách hàng", columns: ["Tên", "Mã"] },
      { id: "t3", name: "Thanh toán", columns: null },
    ],
  },
  others: [{ id: "d2", name: "Kho", tables: [{ id: "t9", name: "Tồn", columns: ["SKU"] }] }],
};
const at = (text: string) => suggest(text, text.length, scope, fns);

describe("suggestions after [", () => {
  it("offers the columns of this table, the tables of this datahub and other datahubs", () => {
    const r = at("=[")!;
    expect(r.items.map((i) => [i.kind, i.label])).toEqual([["column", "Doanh thu"], ["column", "Ngày chốt"], ["column", "Đặng Khách"], ["table", "Deals"], ["table", "Khách hàng"], ["table", "Thanh toán"], ["datahub", "Kho"]]);
    expect(r.from).toBe(2);
    expect(r.to).toBe(2);
  });
  it("filters by what is typed, without accents or case, putting names that start with it first", () => {
    expect(at("=[dang")!.items.map((i) => i.label)).toEqual(["Đặng Khách"]);
    expect(at("=[kh")!.items.map((i) => i.label)).toEqual(["Khách hàng", "Kho", "Đặng Khách"]);
    expect(at("=[zzz")).toBeNull();
  });
  it("after a table name offers the columns of that table, and asks for them when not loaded", () => {
    expect(at("=SUM([Khách hàng].[")!.items.map((i) => i.label)).toEqual(["Tên", "Mã"]);
    expect(at("=SUM([Thanh toán].[")).toEqual({ from: 19, to: 19, items: [], needs: "t3" });
  });
  it("after a datahub name offers its tables, then their columns", () => {
    expect(at("=[Kho].[")!.items.map((i) => [i.kind, i.label])).toEqual([["table", "Tồn"]]);
    expect(at("=[Kho].[Tồn].[")!.items.map((i) => i.label)).toEqual(["SKU"]);
  });
  it("closes the bracket for a column, and goes on to the next level for a table", () => {
    const r = at("=[doa")!;
    const col = r.items.find((i) => i.kind === "column")!;
    expect(applySuggestion("=[doa", r, col)).toEqual({ text: "=[Doanh thu]", caret: 12 });
    const r2 = at("=[khách")!;
    const t = r2.items.find((i) => i.kind === "table")!;
    expect(applySuggestion("=[khách", r2, t).text).toBe("=[Khách hàng].[");
  });
  it("does not double the closing bracket", () => {
    const text = "=[doa]";
    const r = suggest(text, 5, scope, fns)!;
    expect(applySuggestion(text, r, r.items[0]!).text).toBe("=[Doanh thu]");
  });
  it("is quiet inside a string", () => {
    expect(at('=IF([Doanh thu] > 1, "[Kh')).toBeNull();
  });
});

describe("suggestions for function names", () => {
  it("offers the functions that start with the typed letters", () => {
    expect(at("=if")!.items.map((i) => i.label)).toEqual(["IF", "IFERROR"]);
    expect(at("=if")!.items[0]!.insert).toBe("IF(");
  });
  it("closes a function without arguments and keeps an existing (", () => {
    expect(at("=tod")!.items[0]!.insert).toBe("TODAY()");
    const text = "=IF([A], 1, 2) + SU(1)";
    const r = suggest(text, 18, scope, fns)!;
    expect(r.items[0]!.insert).toBe("SUM");
    expect(applySuggestion(text, r, r.items[0]!).text).toBe("=IF([A], 1, 2) + SUM(1)");
  });
  it("is quiet for a number, a plain word with no match, and inside a string", () => {
    expect(at("=12")).toBeNull();
    expect(at("=xyz")).toBeNull();
    expect(at('="su')).toBeNull();
  });
});

describe("the function the caret is in", () => {
  it("finds the call and the argument", () => {
    expect(activeCall("=IF(", 4)).toEqual({ name: "IF", arg: 0 });
    expect(activeCall("=IF([A] > 1, ", 13)).toEqual({ name: "IF", arg: 1 });
    expect(activeCall('=IF(x, "a,b", ', 14)).toEqual({ name: "IF", arg: 2 });
    expect(activeCall("=IF([A, B], ", 12)).toEqual({ name: "IF", arg: 1 });
  });
  it("takes the innermost open call and leaves a closed one", () => {
    expect(activeCall("=IF(SUM(1, 2", 12)).toEqual({ name: "SUM", arg: 1 });
    expect(activeCall("=IF(SUM(1, 2), ", 15)).toEqual({ name: "IF", arg: 1 });
    expect(activeCall("=(1 + 2", 7)).toBeNull();
    expect(activeCall("=1 + 2", 6)).toBeNull();
  });
});

describe("syntax line", () => {
  it("marks the argument being typed", () => {
    const parts = syntaxParts("IF(điều_kiện, nếu_đúng, [nếu_sai])", 1);
    expect(parts.map((p) => p.text).join("")).toBe("IF(điều_kiện, nếu_đúng, [nếu_sai])");
    expect(parts.filter((p) => p.active).map((p) => p.text)).toEqual(["nếu_đúng"]);
  });
  it("keeps the last argument marked past the end of a repeating list, and none for a fixed list", () => {
    expect(syntaxParts("SUM(số1, ...)", 5).filter((p) => p.active).map((p) => p.text)).toEqual(["số1"]);
    expect(syntaxParts("IFERROR(giá_trị, nếu_lỗi)", 4).filter((p) => p.active)).toEqual([]);
    expect(syntaxParts("TODAY()", 0).map((p) => p.text).join("")).toBe("TODAY()");
  });
});

describe("underlining the errors the server found", () => {
  it("cuts the text at the marked parts", () => {
    const s = segments("[Doanh thu] * Sai", [{ message: "Không có cột.", start: 14, end: 17 }]);
    expect(s.map((x) => x.text).join("")).toBe("[Doanh thu] * Sai");
    expect(s.filter((x) => x.issue).map((x) => x.text)).toEqual(["Sai"]);
  });
  it("shifts positions when the leading = is not in the box, and marks one character for an empty range", () => {
    const s = segments("1 +", [{ message: "Thiếu giá trị.", start: 3, end: 3 }], 1);
    expect(s.filter((x) => x.issue).map((x) => x.text)).toEqual(["+"]);
  });
  it("gives one plain segment when there is nothing wrong", () => {
    expect(segments("1 + 1", [])).toEqual([{ text: "1 + 1", issue: null }]);
  });
});

describe("sample formulas", () => {
  it("fills the blanks with the picked names", () => {
    const s = FORMULA_SAMPLES.find((x) => x.id === "lookup")!;
    const picks = { key: "Mã KH", table: "Khách hàng", tkey: "Mã", tval: "Tên" };
    expect(fillSample(s, picks)).toBe("=XLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên])");
    expect(sampleReady(s, picks)).toBe(true);
    expect(sampleReady(s, { key: "Mã KH" })).toBe(false);
    expect(fillSample(s, { key: "Mã KH" })).toContain("{table}");
  });
  it("has a description and a slot for every blank of every sample", () => {
    for (const s of FORMULA_SAMPLES) {
      expect(s.description.length).toBeGreaterThan(5);
      const used = [...s.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const u of used) expect(s.slots.some((x) => x.id === u), `${s.id}:${u}`).toBe(true);
      for (const slot of s.slots) if (slot.kind === "tcol") expect(s.slots.some((x) => x.id === slot.of && x.kind === "table")).toBe(true);
    }
  });
});
