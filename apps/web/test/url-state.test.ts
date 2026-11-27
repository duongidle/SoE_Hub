import { describe, expect, it } from "vitest";
import { mergeSearch, readParams } from "../src/lib/use-url-state";

const defaults = { tab: "mine", q: "" };

describe("readParams", () => {
  it("fills defaults and turns parsed numbers back into text", () => {
    expect(readParams({}, defaults)).toEqual({ tab: "mine", q: "" });
    expect(readParams({ tab: "shared", q: 123, other: "x" }, defaults)).toEqual({ tab: "shared", q: "123" });
  });
});

describe("mergeSearch", () => {
  it("sets a value and keeps other params", () => {
    expect(mergeSearch({ row: "r1" }, { tab: "shared" }, defaults)).toEqual({ row: "r1", tab: "shared" });
  });
  it("removes a key that returns to its default or to empty", () => {
    expect(mergeSearch({ tab: "shared", q: "a" }, { tab: "mine", q: "" }, defaults)).toEqual({});
  });
});
