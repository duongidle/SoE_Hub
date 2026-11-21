import { describe, expect, it } from "vitest";
import { rewriteDateText } from "../src/modules/datahub/excel-formula";

const fm = (name: string, fmt: string) => new Map<string, string | undefined>([[name.toLowerCase(), fmt]]);

describe("rewriteDateText (LEFT/RIGHT/MID on a date column become TEXT)", () => {
  it("rewrites the spans that are whole parts of the shown format", () => {
    const mmyyyy = fm("Ngày", "mm/yyyy");
    expect(rewriteDateText("LEFT([Ngày], 2)", mmyyyy).text).toBe('TEXT([Ngày], "mm")');
    expect(rewriteDateText("RIGHT([Ngày],4)", mmyyyy).text).toBe('TEXT([Ngày], "yyyy")');
    expect(rewriteDateText("MID([Ngày], 4, 4)", mmyyyy).text).toBe('TEXT([Ngày], "yyyy")');
    expect(rewriteDateText("LEFT([Ngày], 7)", mmyyyy).text).toBe('TEXT([Ngày], "mm/yyyy")');
    const dmy = fm("Ngày", "dd/mm/yyyy");
    expect(rewriteDateText("MID([Ngày], 4, 2)&\"-\"&LEFT([Ngày], 2)", dmy).text).toBe('TEXT([Ngày], "mm")&"-"&TEXT([Ngày], "dd")');
    expect(rewriteDateText("LEFT([Ngày], 5)", dmy).text).toBe('TEXT([Ngày], "dd/mm")');
    expect(rewriteDateText("VALUE(LEFT([ngày], 2))+1", fm("ngày", "yyyy-mm-dd")).text).toBe("VALUE(LEFT([ngày], 2))+1"); // "yy" is not a month here: LEFT 2 cuts the year
  });

  it("leaves alone what it cannot map: unknown or variable-width format, a span that cuts a part, other functions, other columns", () => {
    const keep = (t: string, f: Map<string, string | undefined>) => expect(rewriteDateText(t, f).text).toBe(t);
    keep("LEFT([Ngày], 2)", fm("Ngày", "d/m/yyyy"));
    keep("LEFT([Ngày], 2)", fm("Ngày", "mmm-yy"));
    keep("LEFT([Ngày], 2)", fm("Ngày", "m/d/yyyy"));
    keep("LEFT([Ngày], 3)", fm("Ngày", "mm/yyyy")); // cuts the separator and the year
    keep("RIGHT([Ngày], 2)", fm("Ngày", "mm/yyyy")); // half a year
    keep("LEN([Ngày])", fm("Ngày", "mm/yyyy"));
    keep("LEFT([Tên], 2)", fm("Ngày", "mm/yyyy"));
    keep("LEFT([Ngày], 1+1)", fm("Ngày", "mm/yyyy"));
    keep("LEFT([Ngày], 2)", new Map());
  });

  it("reports what it rewrote", () => {
    expect(rewriteDateText("LEFT([Ngày], 2)&LEFT([Ngày], 2)", fm("Ngày", "mm/yyyy")).rewritten).toEqual(['LEFT([Ngày], 2) -> TEXT([Ngày], "mm")']);
  });
});
