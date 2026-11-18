import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ERROR_CODES } from "@soe/shared";
import { buildOpenApi } from "../src/http/openapi";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

type Spec = { openapi: string; paths: Record<string, Record<string, Record<string, unknown>>>; components: { schemas: { Error: { properties: { error: { properties: { code: { enum: string[] } } } } } } } };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("OpenAPI 3.1 generated from the registry", () => {
  const spec = () => buildOpenApi(t.c.registry, "http://localhost:3000") as unknown as Spec;

  it("is OpenAPI 3.1 and contains every registered operation with its metadata", () => {
    const s = spec();
    expect(s.openapi).toBe("3.1.0");
    for (const op of t.c.registry.list()) {
      const p = `/api/v1${op.http.path.replace(/:(\w+)/g, "{$1}")}`;
      const item = s.paths[p]?.[op.http.method.toLowerCase()];
      expect(item, `${op.name} missing from OpenAPI`).toBeDefined();
      expect(item!.operationId).toBe(op.name);
      expect(item!["x-ai-allowed"]).toBe(op.aiAllowed);
    }
  });

  it("documents commands with Idempotency-Key and the standard error body", () => {
    const s = spec();
    const put = s.paths["/api/v1/system/settings/{key}"]!.put as { parameters: { name: string }[]; responses: Record<string, unknown> };
    expect(put.parameters.map((p) => p.name)).toContain("Idempotency-Key");
    expect(Object.keys(put.responses)).toEqual(expect.arrayContaining(["200", "400", "409", "422", "429"]));
    expect(s.components.schemas.Error.properties.error.properties.code.enum.sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it("includes infrastructure endpoints", () => {
    const s = spec();
    for (const p of ["/health", "/api/v1/events", "/api/v1/storage/local/put", "/api/v1/storage/local/get"]) expect(s.paths[p], p).toBeDefined();
  });

  it("is served at /api/openapi.json and /api/docs renders the reference page", async () => {
    const j = await t.app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(j.statusCode).toBe(200);
    expect(j.json().openapi).toBe("3.1.0");
    const docs = await t.app.inject({ method: "GET", url: "/api/docs/" });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
    expect(docs.body).toContain("Scalar");
    const js = await t.app.inject({ method: "GET", url: "/api/docs/js/scalar.js" });
    expect(js.statusCode).toBe(200);
  });
});

describe("Bruno collection covers every endpoint", () => {
  it("has a request for each OpenAPI path + method", () => {
    const dir = path.resolve(__dirname, "../../../docs/api/bruno");
    const have = new Set<string>();
    for (const f of walk(dir).filter((x) => x.endsWith(".bru") && !x.includes("environments"))) {
      const src = readFileSync(f, "utf8");
      const m = src.match(/^(get|post|put|patch|delete) \{\s*\n\s*url: \{\{baseUrl\}\}([^\s?]+)/m);
      expect(m, `${f}: no request block`).toBeTruthy();
      have.add(`${m![1]!.toUpperCase()} ${m![2]!.replace(/\{\{[^}]+\}\}/g, "{}")}`);
    }
    const spec = buildOpenApi(t.c.registry, "http://localhost:3000") as unknown as Spec;
    const missing: string[] = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      if (p === "/api/docs") continue;
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${p.replace(/\{[^}]+\}/g, "{}")}`;
        if (!have.has(key)) missing.push(key);
      }
    }
    expect(missing, `Bruno requests missing for: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("exported OpenAPI file for handover", () => {
  it("docs/api/openapi.json matches the registry (run `pnpm docs:openapi` after changing operations)", async () => {
    const { exportedSpecJson } = await import("../src/scripts/print-openapi");
    const file = readFileSync(path.resolve(__dirname, "../../../docs/api/openapi.json"), "utf8");
    expect(JSON.parse(file), "docs/api/openapi.json is stale: run `pnpm docs:openapi`").toEqual(JSON.parse(exportedSpecJson()));
  });
});
