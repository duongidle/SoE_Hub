import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCommand, defineQuery, Registry } from "../src/core/registry";
import { EventRegistry } from "../src/core/events";

const base = { summary: "s", aiAllowed: true, input: z.object({}), handler: async () => ({}) };

describe("command/query registry", () => {
  it("rejects malformed names, duplicate names and duplicate routes", () => {
    expect(() => defineQuery({ ...base, name: "Bad Name", permission: null, http: { method: "GET", path: "/a" } })).toThrow(/tên/i);
    expect(() => defineQuery({ ...base, name: "single", permission: null, http: { method: "GET", path: "/a" } })).toThrow();
    const a = defineQuery({ ...base, name: "m.o.get", permission: null, http: { method: "GET", path: "/x" } });
    const b = defineQuery({ ...base, name: "m.o.get", permission: null, http: { method: "GET", path: "/y" } });
    const c = defineQuery({ ...base, name: "m.o.other", permission: null, http: { method: "GET", path: "/x" } });
    expect(() => new Registry().register(a, b)).toThrow(/trùng/);
    expect(() => new Registry().register(a, c)).toThrow(/trùng đường dẫn/);
  });

  it("queries use GET and commands never do", () => {
    expect(() => defineQuery({ ...base, name: "m.o.q", permission: null, http: { method: "POST", path: "/q" } })).toThrow(/GET/);
    expect(() => defineCommand({ ...base, name: "m.o.c", permission: "x", http: { method: "GET", path: "/c" } })).toThrow(/GET/);
  });

  it("onboarding.*: aiAllowed=false is a hard ban, aiAllowed=true goes to the onboarding menu (design module9 10)", () => {
    const tick = defineCommand({ ...base, name: "onboarding.item.tick", permission: "x", aiAllowed: false, http: { method: "POST", path: "/o" } });
    expect(tick.ai).toMatchObject({ menu: "onboarding", forbidden: "hard" });
    expect(defineCommand({ ...base, name: "onboarding.plan.create", permission: "x", aiAllowed: true, http: { method: "POST", path: "/o2" } }).ai).toEqual({ menu: "onboarding", access: "write" });
  });

  it("commands default to audit=write, queries to audit=none", () => {
    expect(defineCommand({ ...base, name: "m.o.c", permission: "x", http: { method: "POST", path: "/c" } }).audit).toBe("write");
    expect(defineQuery({ ...base, name: "m.o.q", permission: "x", http: { method: "GET", path: "/q" } }).audit).toBe("none");
  });
});

describe("event registry", () => {
  it("requires <module>.<object>.<verb> names and unique registration", () => {
    const e = new EventRegistry();
    expect(() => e.register({ name: "bad", version: 1, schema: z.object({}), description: "" })).toThrow();
    e.register({ name: "deal.row.assigned", version: 1, schema: z.object({}), description: "" });
    expect(() => e.register({ name: "deal.row.assigned", version: 1, schema: z.object({}), description: "" })).toThrow(/trùng/);
  });
});
