import { describe, expect, it } from "vitest";
import { collectDeps, findGroupable, inferType, parseFormula, toDisplayFormula, toStoredFormula, validateCalls, type FType, type Node } from "../src";
import { T1, compile } from "./helpers";

describe("parser", () => {
  it("parses literals, operators, precedence and percent", () => {
    const r = parseFormula("=1+2*3^2");
    expect(r.ok).toBe(true);
    const ast = (r as { ast: Node }).ast as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("+");
    expect((ast.r as Extract<Node, { t: "bin" }>).op).toBe("*");
    expect(parseFormula("20%").ok).toBe(true);
    expect(parseFormula('"a ""quoted"" b"&"c"').ok).toBe(true);
    expect(parseFormula("IF(TRUE, 1, 2)").ok).toBe(true);
    expect(parseFormula("A(1;2)").ok).toBe(true); // `;` separates arguments too
    expect(parseFormula("#N/A").ok).toBe(true);
  });

  it("parses the three reference forms", () => {
    const ast = (parseFormula("[A].[B]+[C].[D].[E]+[F]") as { ast: Node }).ast;
    const refs: string[][] = [];
    const walk = (n: Node) => {
      if (n.t === "ref") refs.push(n.parts);
      if (n.t === "bin") {
        walk(n.l);
        walk(n.r);
      }
    };
    walk(ast);
    expect(refs).toEqual([["A", "B"], ["C", "D", "E"], ["F"]]);
    expect(parseFormula("[a].[b].[c].[d]").ok).toBe(false);
  });

  it("allows Vietnamese names with spaces and dots inside [ ]", () => {
    const r = toStoredFormula("=[Doanh thu (VND)] + [Số deal.2]", (p) => ({ table: null, key: p[0] === "Doanh thu (VND)" ? "c_aaaa1111" : "c_bbbb2222" }));
    expect(r.ok && r.stored).toBe("{c_aaaa1111} + {c_bbbb2222}");
  });

  it("reports errors with position and a Vietnamese message", () => {
    const cases: [string, RegExp, number][] = [
      ["=IF(1,2", /Thiếu dấu đóng ngoặc/, 7],
      ['="abc', /dấu đóng ngoặc kép/, 1],
      ["=[A", /Thiếu dấu '\]'/, 1],
      ["=1 +", /chưa hoàn chỉnh|cần/, 4],
      ["=1 2", /Không hiểu/, 3],
      ["=@", /Ký tự không hợp lệ/, 1],
      ["=abc", /không phải hàm/, 1],
      ["=)", /Không mong đợi/, 1],
      ["=1)", /Thừa dấu đóng ngoặc/, 2],
      ["=", /đang trống/, 0],
    ];
    for (const [src, msg, start] of cases) {
      const r = parseFormula(src);
      expect(r.ok, src).toBe(false);
      if (!r.ok) {
        expect(r.error.message, src).toMatch(msg);
        expect(r.error.start, src).toBe(start);
      }
    }
  });

  it("validates function names and argument counts", () => {
    const ast = (parseFormula("FOO(1)+IF(1)+SUM()") as { ast: Node }).ast;
    const issues = validateCalls(ast);
    expect(issues.map((i) => i.code)).toEqual(["unknown_function", "arity", "arity"]);
    expect(issues[0]!.start).toBe(0);
  });
});

describe("references: names <-> keys", () => {
  const names: Record<string, string> = { "doanh thu": "c_aaaa1111", "số deal": "c_bbbb2222" };
  const resolve = (parts: string[]) => {
    if (parts.length === 1) {
      const k = names[parts[0]!.toLowerCase()];
      return k ? { table: null, key: k } : { error: `Không có cột "${parts[0]}"` };
    }
    return { table: T1, key: "c_cccc3333" };
  };

  it("stores keys (leading = dropped, layout kept) and shows current names", () => {
    const r = toStoredFormula("= [Doanh thu] / [Số deal]  +\n SUM([Bảng 2].[Tiền])", resolve);
    expect(r.ok).toBe(true);
    const stored = (r as { stored: string }).stored;
    expect(stored).toBe(`{c_aaaa1111} / {c_bbbb2222}  +\n SUM({${T1}.c_cccc3333})`);
    // After a rename the same stored text shows the new names.
    const shown = toDisplayFormula(stored, (t, k) => (t ? ["Bảng đổi tên", "Tiền mới"] : [k === "c_aaaa1111" ? "Doanh số" : "Số HĐ"]));
    expect(shown).toBe("=[Doanh số] / [Số HĐ]  +\n SUM([Bảng đổi tên].[Tiền mới])");
  });

  it("shows #REF! for a reference whose target is gone, and rejects unknown names at save", () => {
    expect(toDisplayFormula("{c_aaaa1111}+1", () => null)).toBe("=[#REF!]+1");
    const r = toStoredFormula("=[Không có]", resolve);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ start: 1, end: 11 });
  });
});

describe("type inference", () => {
  const typeOf = (src: string, refs: Record<string, FType> = {}): FType => {
    const { ast } = compile(src);
    return inferType(ast, (n) => (n.t === "key" ? (refs[n.key] ?? "unknown") : "unknown"));
  };
  it("infers numbers, text, booleans and dates", () => {
    expect(typeOf("1+2")).toBe("number");
    expect(typeOf('"a"&"b"')).toBe("text");
    expect(typeOf("1>2")).toBe("boolean");
    expect(typeOf("TODAY()")).toBe("date");
    expect(typeOf("NOW()")).toBe("datetime");
    expect(typeOf("[d]+30", { d: "date" })).toBe("date");
    expect(typeOf("[a]-[b]", { a: "date", b: "date" })).toBe("number");
    expect(typeOf("[a]-7", { a: "date" })).toBe("date");
    expect(typeOf("EOMONTH([d],0)", { d: "date" })).toBe("date");
    expect(typeOf('IF([x]>1,"a","b")', { x: "number" })).toBe("text");
    expect(typeOf('IF([x]>1,"a",0)', { x: "number" })).toBe("mixed");
    expect(typeOf("IFERROR([x]/2,0)", { x: "number" })).toBe("number");
    expect(typeOf('IFERROR([x]/2,"")', { x: "number" })).toBe("number"); // "" is blank, not a text type
    expect(typeOf('IF([x]>1,"",TODAY())', { x: "number" })).toBe("date");
    expect(typeOf('""')).toBe("blank");
    expect(typeOf("MAX([a],[b])", { a: "date", b: "date" })).toBe("date");
    expect(typeOf("XLOOKUP([x], [T1].[a], [T1].[b])", { b: "date" })).toBe("date");
    expect(typeOf("YEAR([d])", { d: "date" })).toBe("number");
  });
});

describe("dependencies and grouped-call analysis", () => {
  it("collects cells, ranges and volatility", () => {
    const { ast } = compile("IF([a]>TODAY(), SUMIFS([T1].[x], [T1].[y], [b]), ROW_NO())");
    const deps = collectDeps(ast);
    expect(deps.cells.sort()).toEqual(["a", "b"]);
    expect(deps.ranges.map((r) => r.key).sort()).toEqual(["x", "y"]);
    expect(deps.volatile).toBe("today");
    expect(deps.usesRowInfo).toBe(true);
    expect(collectDeps(compile("NOW()+TODAY()").ast).volatile).toBe("now");
  });

  it("finds calls a grouped SQL query can answer", () => {
    const g = (src: string) => findGroupable(compile(src).ast);
    expect(g("COUNTIFS([T1].[a], [k], [T1].[b], \"Won\")")).toMatchObject([{ fn: "COUNTIFS", agg: "count", keyColumns: ["a", "b"], target: null }]);
    expect(g("SUMIFS([T1].[amount], [T1].[deal], [deal])")).toMatchObject([{ fn: "SUMIFS", agg: "sum", target: "amount", keyColumns: ["deal"] }]);
    expect(g("XLOOKUP([k], [T1].[code], [T1].[name], \"-\")")).toMatchObject([{ kind: "lookup", target: "name", notFoundArg: 3 }]);
    expect(g("INDEX([T1].[name], MATCH([k], [T1].[code], 0))")).toMatchObject([{ fn: "INDEX", kind: "lookup", keyColumns: ["code"] }]);
    expect(g("SUM([T1].[amount])")).toMatchObject([{ agg: "sum", keyColumns: [], target: "amount" }]);
    // Not groupable: operators, wildcards, ranges in the criteria, mixed tables, approximate match.
    expect(g('COUNTIFS([T1].[a], ">="&[d])')).toEqual([]);
    expect(g('COUNTIFS([T1].[a], "POD*")')).toEqual([]);
    expect(g('COUNTIFS([T1].[a], "<>"&"x")')).toEqual([]);
    expect(g("COUNTIFS([T1].[a], SUM([T1].[b]))")).toHaveLength(1); // only the inner SUM
    expect(g('XLOOKUP([k], [T1].[code], [T1].[name], "-", 1)')).toEqual([]);
    expect(g("COUNTIFS([a], [k])")).toEqual([]);
  });
});
