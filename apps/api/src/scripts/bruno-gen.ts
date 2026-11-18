import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../config";
import type { Operation } from "../core/types";
import { buildRegistry } from "../modules";
import { createStorage } from "../storage";

/**
 * Adds a Bruno request for every registry operation that has none yet (never overwrites an existing file).
 *   pnpm docs:bruno
 * Requests authenticate with `Authorization: Bearer {{token}}` (an approved personal token, see the `dev` environment).
 * Example bodies are built from the input schema; edit the generated files freely afterwards.
 */
type Json = Record<string, unknown>;

const ROOT = path.resolve(import.meta.dirname, "../../../../docs/api/bruno");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function existing(): Set<string> {
  const have = new Set<string>();
  for (const f of walk(ROOT).filter((x) => x.endsWith(".bru") && !x.includes("environments"))) {
    const m = readFileSync(f, "utf8").match(/^(get|post|put|patch|delete) \{\s*\n\s*url: \{\{baseUrl\}\}([^\s?]+)/m);
    if (m) have.add(`${m[1]!.toUpperCase()} ${m[2]!.replace(/\{\{[^}]+\}\}/g, "{}")}`);
  }
  return have;
}

function example(name: string, s: Json): unknown {
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  const anyOf = (s.anyOf ?? s.oneOf) as Json[] | undefined;
  if (anyOf) return example(name, anyOf.find((x) => x.type !== "null") ?? anyOf[0]!);
  switch (s.type) {
    case "string":
      if (s.format === "uuid") return `{{${name}}}`;
      if (s.format === "email" || name.includes("email")) return "nguoi.dung@base.vn";
      if (s.format === "date-time") return "2027-01-01T00:00:00+07:00";
      if (name.includes("password")) return "mat-khau-cua-ban";
      if (name === "code") return "123456";
      return name;
    case "integer":
    case "number":
      return typeof s.minimum === "number" ? s.minimum : 1;
    case "boolean":
      return false;
    case "array":
      return [example(name.replace(/s$/, ""), (s.items as Json) ?? {})];
    case "object":
      return {};
    default:
      return null;
  }
}

function bru(op: Operation, seq: number): string {
  const schema = z.toJSONSchema(op.input, { io: "input", unrepresentable: "any" }) as Json;
  const props = (schema.properties ?? {}) as Record<string, Json>;
  const required = new Set((schema.required ?? []) as string[]);
  const params = [...op.http.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  const url = `{{baseUrl}}/api/v1${op.http.path.replace(/:(\w+)/g, "{{$1}}")}`;
  const isRead = op.http.method === "GET" || op.http.method === "DELETE";
  const query: string[] = [];
  const body: Json = {};
  for (const [k, v] of Object.entries(props)) {
    if (params.includes(k)) continue;
    if (isRead) query.push(`  ${required.has(k) ? "" : "~"}${k}: ${String(example(k, v) ?? "")}`);
    else body[k] = example(k, v);
  }
  const hasBody = !isRead && Object.keys(body).length > 0;
  const out = [`meta {\n  name: ${op.name}\n  type: http\n  seq: ${seq}\n}`, `${op.http.method.toLowerCase()} {\n  url: ${url}\n  body: ${hasBody ? "json" : "none"}\n  auth: none\n}`];
  if (query.length) out.push(`params:query {\n${query.join("\n")}\n}`);
  const headers: string[] = [];
  if (op.permission !== null) headers.push("  Authorization: Bearer {{token}}");
  if (hasBody) headers.push("  Content-Type: application/json");
  if (op.kind === "command" && op.permission !== null) headers.push("  Idempotency-Key: {{$guid}}");
  out.push(`headers {\n${headers.join("\n")}\n}`);
  if (hasBody) out.push(`body:json {\n${JSON.stringify(body, null, 2).replace(/^/gm, "  ")}\n}`);
  out.push(`docs {\n  ${op.summary}${op.permission ? `\n  Quyền: \`${op.permission}\`.` : "\n  Công khai (không cần đăng nhập)."}\n}`);
  return `${out.join("\n\n")}\n`;
}

const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgres://unused" });
const { registry } = buildRegistry({ config, storage: createStorage(config) });
const have = existing();
let n = 0;
const seqByDir = new Map<string, number>();
for (const op of registry.list()) {
  const key = `${op.http.method} /api/v1${op.http.path.replace(/:(\w+)/g, "{}")}`;
  if (have.has(key)) continue;
  const dir = path.join(ROOT, op.name.split(".")[0]!);
  mkdirSync(dir, { recursive: true });
  const seq = (seqByDir.get(dir) ?? readdirSync(dir).length) + 1;
  seqByDir.set(dir, seq);
  const file = path.join(dir, `${op.name.split(".").slice(1).join("-")}.bru`);
  if (existsSync(file)) continue;
  writeFileSync(file, bru(op, seq));
  n++;
}
console.log(`Đã thêm ${n} request Bruno.`);
