import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { evaluate, FError, parseFormula, RangeValue, validateCalls, ymdToSerial, type EvalContext, type Scalar, type Value } from "@soe/formula";

/**
 * Golden test (design module2 section 6.2, "Mọi công thức trong file deal mẫu ... phải chạy được").
 *
 * Reads Base's sample workbook straight from `examples/` (real data: never copied, never committed; the test skips itself
 * when the file is absent). Every formula of every sheet is translated by a small test-only adapter from Excel A1 /
 * table references to the engine's reference tokens, parsed, checked and EVALUATED by the engine from the cached input
 * values of the file, and the result is compared with the value Excel cached for that cell.
 *
 * The real Excel-to-column import (stage 2D) is a different, bigger job; this adapter only proves the engine
 * understands every function, operator and criteria the file uses and computes the same numbers.
 */
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/Quản lý Deal SoE (Dương TVD).xlsx");
const present = fs.existsSync(FILE);

const TABLE_ID = "00000000-0000-4000-8000-000000000000";

type Cached = Scalar;

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
const colLetters = (n: number): string => {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const unxml = (t: string) =>
  t.replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Cached values straight from the sheets' XML (exceljs drops the cached result of shared-formula cells). */
async function readCached(file: string): Promise<Map<string, Map<string, Cached>>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const text = async (p: string) => (await zip.file(p)!.async("string")) as string;
  const shared: string[] = [];
  if (zip.file("xl/sharedStrings.xml")) {
    for (const si of (await text("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }
  const rels = new Map<string, string>();
  for (const m of (await text("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship [^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target);
  }
  const out = new Map<string, Map<string, Cached>>();
  for (const m of (await text("xl/workbook.xml")).matchAll(/<sheet [^>]*>/g)) {
    const name = unxml(/name="([^"]+)"/.exec(m[0])![1]!);
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])![1]!)!;
    const xml = await text(`xl/${target.replace(/^\/?(xl\/)?/, "")}`);
    const cells = new Map<string, Cached>();
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = /t="([^"]+)"/.exec(c[2] ?? "")?.[1];
      const inner = c[3] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val: Cached = null;
      if (type === "inlineStr") val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (v === undefined) val = null;
      else if (type === "s") val = shared[Number(v)] ?? null;
      // The file comes from an export that stores errors as text ("#DIV/0!" with t="str"): they are errors for the engine.
      else if (type === "str") val = /^#(DIV\/0!|N\/A|VALUE!|REF!|NUM!|NAME\?)$/.test(unxml(v)) ? new FError(unxml(v) as never) : unxml(v);
      else if (type === "b") val = v === "1";
      else if (type === "e") val = new FError(unxml(v) as never);
      else val = Number(v);
      cells.set(c[1]!, val);
    }
    out.set(name, cells);
  }
  return out;
}

interface Sheet {
  name: string;
  ws: ExcelJS.Worksheet;
  rows: number;
}

interface Translated {
  formula: string;
  cells: Map<string, Cached>;
  ranges: Map<string, Value[]>;
  /** Number format of each referenced cell (to see which cells are shown as dates). */
  formats: Map<string, string>;
  /** `LEFT(date, 2)` rewritten as the month the cell displays (see the note in the test). */
  displayRewrites: number;
}

describe.skipIf(!present)("golden: every formula of the sample workbook parses and evaluates like Excel", () => {
  it("runs", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(FILE);
    const sheets = new Map<string, Sheet>();
    wb.eachSheet((ws) => sheets.set(ws.name, { name: ws.name, ws, rows: ws.rowCount }));

    // Excel tables (`Deals[Start date]`): name -> sheet, header names and data rows.
    interface Tbl {
      sheet: Sheet;
      headers: string[];
      firstCol: number;
      top: number;
      bottom: number;
    }
    const tables = new Map<string, Tbl>();
    for (const sh of sheets.values()) {
      const tbls = (sh.ws as unknown as { tables?: Record<string, { table: { name: string; tableRef: string; columns: { name: string }[] } }> }).tables ?? {};
      for (const t of Object.values(tbls)) {
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(t.table.tableRef)!;
        tables.set(t.table.name, { sheet: sh, headers: t.table.columns.map((c) => c.name), firstCol: colIndex(m[1]!), top: Number(m[2]), bottom: Number(m[4]) });
      }
    }

    const cachedByAddress = await readCached(FILE);
    const cellValue = (sh: Sheet, col: number, row: number): Cached => cachedByAddress.get(sh.name)?.get(`${colLetters(col)}${row}`) ?? null;
    const columnValues = (sh: Sheet, col: number, r1: number, r2: number): Value[] => {
      const out: Value[] = [];
      for (let r = r1; r <= r2; r++) out.push(cellValue(sh, col, r));
      return out;
    };

    /** Translates one Excel formula to engine syntax. References become `{x..}` cells and `{<table>.r..}` columns. */
    function translate(formula: string, here: Sheet): Translated {
      const cells = new Map<string, Cached>();
      const ranges = new Map<string, Value[]>();
      const formats = new Map<string, string>();
      let n = 0;
      const cellTok = (sh: Sheet, col: number, row: number) => {
        const key = `x${++n}`;
        cells.set(key, cellValue(sh, col, row));
        formats.set(key, String(sh.ws.getCell(row, col).numFmt ?? ""));
        return `{${key}}`;
      };
      const rangeTok = (values: Value[]) => {
        const key = `r${++n}`;
        ranges.set(key, values);
        return `{${TABLE_ID}.${key}}`;
      };
      const sheetOf = (quoted: string | undefined, bare: string | undefined): Sheet => {
        const name = quoted ?? bare;
        if (!name) return here;
        const s = sheets.get(name);
        if (!s) throw new Error(`sheet "${name}" not found`);
        return s;
      };
      // Walk the formula; text inside "..." is left alone.
      let out = "";
      let i = 0;
      const f = formula.replace(/_xlfn\.(_xlws\.)?/g, "");
      const refRe = new RegExp(
        [
          `(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\\$?([A-Z]{1,3})\\$?(\\d+):\\$?([A-Z]{1,3})\\$?(\\d+)`, // A1:B2
          `(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\\$?([A-Z]{1,3}):\\$?([A-Z]{1,3})(?![A-Za-z0-9_(])`, // A:A
          `(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\\$?([A-Z]{1,3})\\$?(\\d+)(?![A-Za-z0-9_(])`, // A1
          `([A-Za-z_][A-Za-z0-9_]*)\\[([^\\]]+)\\]`, // Table[Column]
        ].join("|"),
        "y",
      );
      while (i < f.length) {
        const ch = f[i]!;
        if (ch === '"') {
          let j = i + 1;
          while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1;
          out += f.slice(i, j + 1);
          i = j + 1;
          continue;
        }
        // Only try a reference at a token boundary (not inside a function name).
        const prev = out[out.length - 1] ?? "";
        if (!/[A-Za-z0-9_.]/.test(prev)) {
          refRe.lastIndex = i;
          const m = refRe.exec(f);
          if (m) {
            const text = m[0];
            if (m[3] !== undefined) {
              const sh = sheetOf(m[1], m[2]);
              const [c1, r1, c2, r2] = [colIndex(m[3]), Number(m[4]), colIndex(m[5]!), Number(m[6])];
              if (c1 === c2) out += rangeTok(columnValues(sh, c1, r1, r2));
              else if (r1 === r2) out += Array.from({ length: c2 - c1 + 1 }, (_, k) => cellTok(sh, c1 + k, r1)).join(",");
              else throw new Error(`2-D range ${text}`);
            } else if (m[9] !== undefined) {
              const sh = sheetOf(m[7], m[8]);
              out += rangeTok(columnValues(sh, colIndex(m[9]), 1, sh.rows));
            } else if (m[13] !== undefined) {
              const sh = sheetOf(m[11], m[12]);
              out += cellTok(sh, colIndex(m[13]), Number(m[14]));
            } else {
              const t = tables.get(m[15]!);
              if (!t) throw new Error(`table ${m[15]} not found`);
              const norm = (x: string) => x.replace(/_x000A_|_x000D_/gi, " ").replace(/\s+/g, " ").trim();
              const k = t.headers.findIndex((h) => norm(h) === norm(m[16]!));
              if (k < 0) throw new Error(`column "${m[16]}" not in table ${m[15]}`);
              out += rangeTok(columnValues(t.sheet, t.firstCol + k, t.top + 1, t.bottom));
            }
            i += text.length;
            continue;
          }
        }
        out += ch;
        i++;
      }
      // The file asks for the MONTH of a date shown as MM/yyyy with LEFT(date, 2) (quarter-end test). Excel's LEFT works on the
      // serial number ("44805" -> "44"), so Excel semantics (and this engine) cannot give that; the value Excel cached comes from
      // the displayed text. The adapter makes the intent explicit, TEXT(date, "mm"), so the rest of the formula is still checked.
      let displayRewrites = 0;
      out = out.replace(/LEFT\(\{(x\d+)\},2\)/g, (whole, key: string) => {
        if (/m+[^a-z]*y+|y+[^a-z]*m+/i.test(formats.get(key) ?? "")) {
          displayRewrites++;
          return `TEXT({${key}},"mm")`;
        }
        return whole;
      });
      return { formula: out, cells, ranges, formats, displayRewrites };
    }

    function ctxFor(t: Translated, now: Date): EvalContext {
      return {
        now,
        cell: (k) => (t.cells.get(k) ?? null) as Value,
        range: (table, k) => new RangeValue(table, k, () => t.ranges.get(k) ?? []),
        rowInfo: () => ({ id: "", rowNo: 0, createdAt: null, modifiedAt: null }),
      };
    }

    const same = (want: Cached, got: Scalar): boolean => {
      const w = want instanceof FError ? want.code : want;
      const g = got instanceof FError ? got.code : got;
      if (typeof w === "number" && typeof g === "number") return Math.abs(w - g) <= 1e-9 * Math.max(1, Math.abs(w));
      const blank = (x: unknown) => x === null || x === "" || x === undefined;
      if (blank(w) && blank(g)) return true;
      return w === g;
    };

    const stats = { formulas: 0, parsed: 0, evaluated: 0, matched: 0, skippedVolatile: 0, withErrorResult: 0, displayFormatRewrites: 0 };
    const perSheet: Record<string, { formulas: number; matched: number }> = {};
    const fns = new Set<string>();
    const problems: string[] = [];
    const now = new Date("2026-11-18T10:00:00+07:00");

    for (const sh of sheets.values()) {
      sh.ws.eachRow((row) => {
        row.eachCell((cell) => {
          const raw = cell.value as unknown as { formula?: string; sharedFormula?: string } | null;
          const formula = raw && typeof raw === "object" && !(raw instanceof Date) ? (cell.formula as string | undefined) : undefined;
          if (!formula) return;
          stats.formulas++;
          const s = (perSheet[sh.name] ??= { formulas: 0, matched: 0 });
          s.formulas++;
          const where = `${sh.name}!${cell.address}`;
          let t: Translated;
          try {
            t = translate(formula, sh);
          } catch (e) {
            problems.push(`${where}: cannot translate (${(e as Error).message}): ${formula.slice(0, 120)}`);
            return;
          }
          const parsed = parseFormula(t.formula);
          if (!parsed.ok) {
            problems.push(`${where}: PARSE ${parsed.error.message} @${parsed.error.start}: ${t.formula.slice(0, 120)}`);
            return;
          }
          stats.parsed++;
          stats.displayFormatRewrites += t.displayRewrites;
          const issues = validateCalls(parsed.ast);
          if (issues.length) {
            problems.push(`${where}: ${issues[0]!.message}`);
            return;
          }
          for (const m of formula.matchAll(/([A-Z][A-Z0-9.]*)\(/g)) fns.add(m[1]!.replace(/^_XLFN\./, ""));
          const got = evaluate(parsed.ast, ctxFor(t, now));
          stats.evaluated++;
          const want = cellValue(sh, colIndex(cell.address.replace(/\d+/g, "")), Number(cell.address.replace(/\D+/g, "")));
          if (want instanceof FError) stats.withErrorResult++;
          // TODAY() depends on the day the file was saved: only parsing and evaluation are checked.
          if (/TODAY\(|NOW\(/.test(formula)) {
            stats.skippedVolatile++;
            s.matched++;
            return;
          }
          if (same(want, got)) {
            stats.matched++;
            s.matched++;
          } else {
            problems.push(`${where}: expected ${JSON.stringify(want instanceof FError ? want.code : want)} but got ${JSON.stringify(got instanceof FError ? got.code : got)}: ${t.formula.slice(0, 140)}`);
          }
        });
      });
    }
    console.warn(`[golden] ${JSON.stringify(stats)}`);
    console.warn(`[golden] per sheet: ${JSON.stringify(perSheet)}`);
    console.warn(`[golden] functions used by the file: ${[...fns].sort().join(", ")}`);
    if (problems.length) console.warn(`[golden] problems (${problems.length}):\n${problems.slice(0, 40).join("\n")}`);
    expect(stats.formulas).toBeGreaterThan(2000);
    expect(problems).toEqual([]);
    expect(stats.evaluated).toBe(stats.formulas);
    // Every function the file uses exists in the catalogue.
    for (const name of ["COUNTIFS", "SUMIFS", "DATEDIF", "IFS", "EOMONTH", "ROUNDUP", "ROUNDDOWN", "EDATE", "IFERROR", "MOD", "LEFT", "TODAY"]) expect(fns.has(name), name).toBe(true);
  }, 180_000);

  it("the Index formulas count real deals correctly (synthetic Deals rows, same headers as the file)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(FILE);
    const ws = wb.getWorksheet("Index")!;
    const b2 = (ws.getCell("B2").value as { formula: string }).formula.replace(/_xlfn\./g, "");
    // Index!B2: Start date in the month of A2, type "POD*", not flagged "*Số deal*".
    expect(b2).toContain("Deals[Start date]");
    // Synthetic deals (made up here, not from the file).
    const deals = [
      { start: ymdToSerial(2021, 9, 3), type: "POD Express", flag: null },
      { start: ymdToSerial(2021, 9, 30), type: "POD", flag: "" },
      { start: ymdToSerial(2021, 9, 30), type: "PS", flag: null },
      { start: ymdToSerial(2021, 10, 1), type: "POD", flag: null },
      { start: ymdToSerial(2021, 9, 15), type: "POD", flag: "Không tính Số deal" },
      { start: ymdToSerial(2021, 8, 31), type: "POD", flag: null },
    ];
    const col = (k: "start" | "type" | "flag") => deals.map((d) => d[k] as Value);
    const month = ymdToSerial(2021, 9, 1);
    const ctx: EvalContext = {
      now: new Date(),
      cell: () => month,
      range: (_t, k) => new RangeValue(TABLE_ID, k, () => col(k === "r1" || k === "r2" ? "start" : k === "r3" ? "type" : "flag")),
      rowInfo: () => ({ id: "", rowNo: 0, createdAt: null, modifiedAt: null }),
    };
    const f = `COUNTIFS({${TABLE_ID}.r1},">="&{a},{${TABLE_ID}.r2},"<="&EOMONTH({a},0),{${TABLE_ID}.r3},"POD*",{${TABLE_ID}.r4},"<>"&"*Số deal*")`;
    const p = parseFormula(f);
    if (!p.ok) throw new Error(p.error.message);
    expect(evaluate(p.ast, ctx)).toBe(2); // Sep 3 (POD Express) and Sep 30 (POD); the PS deal, the flagged deal and other months do not count
    const sum = parseFormula(`SUMIFS({${TABLE_ID}.r1},{${TABLE_ID}.r2},">="&{a},{${TABLE_ID}.r3},"POD*")`);
    if (!sum.ok) throw new Error(sum.error.message);
    expect(typeof evaluate(sum.ast, ctx)).toBe("number");
  });
});
