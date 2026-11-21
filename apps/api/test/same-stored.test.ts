import { describe, expect, it } from "vitest";
import { sameStored } from "../src/modules/datahub/cell-values";

describe("sameStored", () => {
  it("compares plain values directly, null and undefined are the same empty value", () => {
    expect(sameStored(1, 1)).toBe(true);
    expect(sameStored(1, 2)).toBe(false);
    expect(sameStored("1", 1)).toBe(false);
    expect(sameStored(undefined, null)).toBe(true);
    expect(sameStored(null, 0)).toBe(false);
    expect(sameStored(false, null)).toBe(false);
  });
  it("objects and arrays ignore the order of keys (jsonb reads them back in another order)", () => {
    expect(sameStored({ a: 1, b: { y: 2, x: 1 } }, { b: { x: 1, y: 2 }, a: 1 })).toBe(true);
    expect(sameStored([{ id: "1", attrs: { p: 1, q: 2 } }], [{ attrs: { q: 2, p: 1 }, id: "1" }])).toBe(true);
    expect(sameStored([1, 2], [2, 1])).toBe(false);
    expect(sameStored({ a: 1 }, null)).toBe(false);
    expect(sameStored({ a: 1 }, "x")).toBe(false);
  });
});
