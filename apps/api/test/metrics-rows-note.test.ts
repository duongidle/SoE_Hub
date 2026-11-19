import { describe, expect, it } from "vitest";
import { rowsNote } from "../src/modules/metrics/chart-ops";

// 3E-2: the rows note is shown to people next to numbers written with thousands dots (1.234), so it must write them the same way.
describe("rowsNote", () => {
  it("writes large counts with thousands dots like every other number", () => {
    expect(rowsNote(12, 40)).toBe("Bạn thấy 12/40 dòng tạo nên con số này.");
    expect(rowsNote(10_000, 10_000)).toBe("Bạn thấy 10.000/10.000 dòng tạo nên con số này.");
    expect(rowsNote(0, 123_456)).toBe("Bạn thấy 0/123.456 dòng tạo nên con số này.");
  });
});
