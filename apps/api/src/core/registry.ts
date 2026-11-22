import type { z } from "zod";
import { resolveAiPolicy } from "./ai-policy";
import type { Operation, OperationDef, OperationKind } from "./types";

export type DefinedOperation = Operation;

function define<I extends z.ZodType, O, P extends string | null>(kind: OperationKind, d: OperationDef<I, O, P>): Operation {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/.test(d.name)) {
    throw new Error(`Tên thao tác không hợp lệ: "${d.name}" (dạng <module>.<đối tượng>.<động từ>)`);
  }
  if (kind === "query" && d.http.method !== "GET") throw new Error(`${d.name}: query phải dùng GET.`);
  if (kind === "command" && d.http.method === "GET") throw new Error(`${d.name}: command không dùng GET.`);
  return {
    kind,
    name: d.name,
    summary: d.summary,
    description: d.description,
    tags: d.tags ?? [d.name.split(".")[0]!],
    input: d.input,
    output: d.output,
    permission: d.permission,
    aiAllowed: d.aiAllowed,
    ai: resolveAiPolicy({ name: d.name, kind, aiAllowed: d.aiAllowed, menu: d.menu, access: d.access, forbidden: d.forbidden }),
    audit: d.audit ?? (kind === "command" ? "write" : "none"),
    emits: d.emits ?? [],
    http: { method: d.http.method, path: d.http.path, status: d.http.status ?? 200, respond: d.http.respond },
    list: d.list ?? false,
    listExtra: d.listExtra,
    handler: d.handler as Operation["handler"],
  };
}

/** Declares a write operation (runs in one transaction, audited, may emit events). */
export function defineCommand<I extends z.ZodType, O, P extends string | null>(d: OperationDef<I, O, P>): Operation {
  return define("command", d);
}

/** Declares a read operation (no transaction, no events). */
export function defineQuery<I extends z.ZodType, O, P extends string | null>(d: OperationDef<I, O, P>): Operation {
  return define("query", d);
}

/** All operations of the system. REST, OpenAPI, MCP (Stage 5) and Automation (later) read from here. */
export class Registry {
  private readonly ops = new Map<string, Operation>();

  register(...ops: Operation[]): this {
    for (const op of ops) {
      if (this.ops.has(op.name)) throw new Error(`Thao tác bị khai báo trùng: ${op.name}`);
      const dup = [...this.ops.values()].find((o) => o.http.method === op.http.method && o.http.path === op.http.path);
      if (dup) throw new Error(`${op.name} trùng đường dẫn ${op.http.method} ${op.http.path} với ${dup.name}`);
      this.ops.set(op.name, op);
    }
    return this;
  }

  get(name: string): Operation | undefined {
    return this.ops.get(name);
  }

  list(): Operation[] {
    return [...this.ops.values()];
  }
}
