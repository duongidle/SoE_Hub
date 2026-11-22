/**
 * `/mcp`: the AI channel (design module5 1, 4, 12). Streamable HTTP, stateless, JSON-RPC 2.0 by hand (initialize, ping, tools/list, tools/call).
 * Auth is ONLY the personal token `soe_pat_` of a connection; a token waiting for approval can shake hands and every tool answers `connection_pending`.
 * Every tool goes through `executor.execute` with an actor `via: "mcp"`, so the owner's permission, the connection's menus and level, the Admin's
 * policy, the split lock and column masking apply exactly as on REST. This file holds NO permission rule of its own.
 */
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, isAppError, type Actor } from "@soe/shared";
import type { Db } from "@soe/db";
import type { Config } from "../config";
import { SessionTokenResolver } from "../auth/sessions";
import { loadConnection, type ConnectionInfo } from "../core/ai-gate";
import { AI_LEVELS, LIBRARY_OPS, MENU_LABELS, type AiAccess, type AiMenu } from "../core/ai-policy";
import type { OperationExecutor } from "../core/executor";
import type { Registry } from "../core/registry";
import type { Operation } from "../core/types";
import { readSetting, SETTINGS } from "../modules/system/settings-catalog";
import { selectiveTools } from "./mcp-tools";

export const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ToolResult {
  data: unknown;
}

/** What one tool call can use. `call` runs a registry operation as the connection's actor. */
export interface McpCtx {
  actor: Actor;
  conn: ConnectionInfo;
  groups: string[];
  registry: Registry;
  db: Db;
  call: (operation: string, input: Record<string, unknown>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Full result of an operation (list shape kept). */
  callRaw: (operation: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
  /** The tool is listed when the connection holds one of these menus at this level or above. `null` = always listed. */
  need: { menus: AiMenu[]; access: AiAccess } | null;
  run: (ctx: McpCtx, args: Record<string, unknown>) => Promise<unknown>;
}

const rank = (a: AiAccess) => AI_LEVELS.indexOf(a);
const holds = (conn: ConnectionInfo, menus: AiMenu[], access: AiAccess) => menus.some((m) => conn.menus[m] !== undefined && rank(conn.menus[m]!) >= rank(access));

/** Can this connection call the operation at all (menu, level, forbidden group)? The executor decides again at call time; this only shapes the lists. */
export function operationOpen(op: Operation, conn: ConnectionInfo, groups: string[]): boolean {
  const ai = op.ai;
  if (!op.aiAllowed || !ai || ai.forbidden === "hard") return false;
  if (ai.forbidden && !groups.includes(ai.forbidden)) return false;
  if (ai.menu === "none") return true;
  if (ai.menu === "by_target") return holds(conn, ["deal", "datahub"], ai.access);
  if (LIBRARY_OPS.test(op.name)) return holds(conn, ["knowledge", "aihub"], ai.access);
  return holds(conn, [ai.menu], ai.access);
}

const text = (s: unknown): string => (typeof s === "string" ? s : JSON.stringify(s));

const HINTS: Record<string, string> = {
  validation_error: "Fix the input as described in details (issues, valid names) and call again. soe_describe shows an operation's input schema.",
  forbidden: "The user or this connection lacks the right. Tell the user; a wider connection is made in Cài đặt → Kết nối AI.",
  ai_not_allowed: "This operation is closed to AI (hard ban, a group Admin has not enabled, or the emergency switch). Do not retry; tell the user.",
  connection_pending: "The connection waits for an Admin to approve it. Tell the user and stop.",
  unauthenticated: "The token is revoked or expired. Tell the user to make a new connection.",
  rate_limited: "Too many calls. Wait details.retry_after_seconds, then retry.",
  not_found: "Check the id or name. Use rows_query, deals_list or soe_operations to find it.",
  conflict: "Someone changed it first. Read the current value (details), then write again.",
};

export function toolError(e: unknown): { code: string; message: string; hint: string; details: unknown } {
  if (isAppError(e)) return { code: e.code, message: e.message, hint: HINTS[e.code] ?? "", details: e.details ?? null };
  return { code: "internal_error", message: "Lỗi hệ thống.", hint: "Retry once; if it persists, tell the user.", details: null };
}

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

function genericTools(): ToolDef[] {
  const who: ToolDef = {
    name: "soe_whoami",
    description: "Who am I: user, role, tree/team, this connection's menus and levels, today, current quarter, closed months. Call first.",
    inputSchema: OBJ({}),
    annotations: { readOnlyHint: true, title: "Who am I" },
    need: null,
    async run(ctx) {
      const me = await ctx.call("auth.me", {});
      const u = me.user as Record<string, unknown>;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      const y = Number(today.slice(0, 4));
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
      const pad = (n: number) => String(n).padStart(2, "0");
      const endDay = new Date(Date.UTC(y, q * 3 + 3, 0)).getUTCDate();
      let locked: string[] | null = null;
      try {
        locked = ((await ctx.call("period.list", {})) as { month: string }[]).map((p) => p.month);
      } catch (e) {
        // Closed months are optional here: a connection without the Deal menu, or a person who cannot read them, simply has none to show.
        if (!isAppError(e) || !["forbidden", "ai_not_allowed"].includes(e.code)) throw e;
      }
      return {
        user: { id: u.id, name: u.full_name, email: u.email, roles: u.roles, title: u.title },
        tree: { manager_id: u.manager_id, leader_id: u.leader_id },
        connection: { name: ctx.conn.name, status: ctx.conn.status, menus: ctx.conn.menus, expires_at: ctx.conn.expiresAt.toISOString() },
        today,
        quarter: { id: `${y}-Q${q + 1}`, start: `${y}-${pad(q * 3 + 1)}-01`, end: `${y}-${pad(q * 3 + 3)}-${pad(endDay)}` },
        month: today.slice(0, 7),
        closed_months: locked,
      };
    },
  };

  const operations: ToolDef = {
    name: "soe_operations",
    description: "List the operations this connection may call: name | level | short summary. Filter with q (substring) or menu. Then soe_describe, then soe_call.",
    inputSchema: OBJ({
      q: { type: "string", description: "Substring of the name or summary." },
      menu: { type: "string", enum: Object.keys(MENU_LABELS), description: "Only operations of this menu." },
      limit: { type: "integer", minimum: 1, maximum: 1000, description: "Default 300." },
    }),
    annotations: { readOnlyHint: true, title: "List operations" },
    need: null,
    async run(ctx, args) {
      const q = typeof args.q === "string" ? args.q.toLowerCase() : "";
      const menu = typeof args.menu === "string" ? args.menu : "";
      const limit = typeof args.limit === "number" ? args.limit : 300;
      const open = ctx.registry.list().filter((op) => operationOpen(op, ctx.conn, ctx.groups) && (!menu || op.ai!.menu === menu || (op.ai!.menu === "by_target" && (menu === "deal" || menu === "datahub") && holds(ctx.conn, [menu], op.ai!.access))));
      const matched = open.filter((op) => !q || op.name.includes(q) || op.summary.toLowerCase().includes(q));
      const lines = matched.slice(0, limit).map((op) => `${op.name}|${op.ai!.access}|${op.summary.replace(/\s+/g, " ").slice(0, 80)}`);
      return { total: matched.length, shown: lines.length, format: "name|level|summary", operations: lines };
    },
  };

  const describe: ToolDef = {
    name: "soe_describe",
    description: "Input JSON schema of one operation (from soe_operations), with its summary and level.",
    inputSchema: OBJ({ operation: { type: "string" } }, ["operation"]),
    annotations: { readOnlyHint: true, title: "Describe operation" },
    need: null,
    async run(ctx, args) {
      const name = String(args.operation ?? "");
      const op = ctx.registry.get(name);
      if (!op) throw new AppError("not_found", `Không có thao tác "${name}". Dùng soe_operations để xem danh sách.`);
      if (!operationOpen(op, ctx.conn, ctx.groups)) throw new AppError("forbidden", `Kết nối này không dùng được thao tác "${name}" (thiếu menu, mức hoặc bị cấm cho AI).`, { reason: "not_open" });
      const js = z.toJSONSchema(op.input, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline" }) as Record<string, unknown>;
      delete js["$schema"];
      return { name: op.name, kind: op.kind, level: op.ai!.access, summary: op.summary, ...(op.description ? { description: op.description } : {}), list: op.list, input_schema: js };
    },
  };

  const callTool: ToolDef = {
    name: "soe_call",
    description: "Call any operation by name with its input (see soe_describe). Rights are checked per call. Lists return {items,next_cursor,total}.",
    inputSchema: OBJ({ operation: { type: "string" }, input: { type: "object", description: "The operation's input." } }, ["operation"]),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: "Call operation" },
    need: null,
    async run(ctx, args) {
      const name = String(args.operation ?? "");
      if (!name) throw new AppError("validation_error", "Thiếu tên thao tác (operation).");
      const input = (args.input ?? {}) as Record<string, unknown>;
      if (typeof input !== "object" || Array.isArray(input)) throw new AppError("validation_error", "input phải là một object.");
      const op = ctx.registry.get(name);
      const r = await ctx.callRaw(name, input);
      if (op?.list) {
        const l = r as { items: unknown[]; nextCursor: string | null; total?: number; extra?: Record<string, unknown> };
        return { items: l.items, next_cursor: l.nextCursor, ...(l.total !== undefined ? { total: l.total } : {}), ...(l.extra ?? {}) };
      }
      return r ?? { ok: true };
    },
  };
  return [who, operations, describe, callTool];
}

export interface McpDeps {
  config: Config;
  db: Db;
  registry: Registry;
  executor: OperationExecutor;
}

export function registerMcp(app: FastifyInstance, deps: McpDeps): void {
  const resolver = new SessionTokenResolver(deps.db, deps.config);
  const tools = [...genericTools(), ...selectiveTools()];
  const byName = new Map(tools.map((t) => [t.name, t]));

  const listed = (conn: ConnectionInfo) => tools.filter((t) => t.need === null || holds(conn, t.need.menus, t.need.access));

  function ctxFor(req: FastifyRequest, actor: Actor, conn: ConnectionInfo, groups: string[]): McpCtx {
    const client = { via: "mcp" as const, ip: req.ip, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null };
    const callRaw = async (operation: string, input: Record<string, unknown>) => (await deps.executor.execute(operation, input, { actor, requestId: req.id, client })).result;
    return { actor, conn, groups, registry: deps.registry, db: deps.db, call: callRaw as McpCtx["call"], callRaw };
  }

  const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  async function handle(req: FastifyRequest, actor: Actor, msg: Record<string, unknown>): Promise<unknown | null> {
    const id = msg.id;
    const method = msg.method;
    if (typeof method !== "string") return err(id, -32600, "Invalid Request");
    if (id === undefined) return null; // a notification (initialized, cancelled...): no answer
    const params = (msg.params ?? {}) as Record<string, unknown>;
    if (method === "initialize") {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: (MCP_PROTOCOLS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "soe-hub", version: "1.0.0" },
        instructions: "SoE Hub (Base). Start with soe_whoami. Use deals_list, deal_get, deal_metrics, rows_query, rows_write, metrics_query for common work; anything else through soe_operations, soe_describe, soe_call. Data and errors are Vietnamese.",
      });
    }
    if (method === "ping") return ok(id, {});
    const conn = await loadConnection(deps.db, actor.connectionId!);
    if (!conn) return err(id, -32001, "Kết nối không hợp lệ.");
    const groups = await readSetting(deps.db, SETTINGS.aiGroups);
    if (method === "tools/list") {
      return ok(id, { tools: listed(conn).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
    }
    if (method === "tools/call") {
      const t = byName.get(String(params.name ?? ""));
      if (!t) return err(id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const data = await t.run(ctxFor(req, actor, conn, groups), (params.arguments ?? {}) as Record<string, unknown>);
        return ok(id, { content: [{ type: "text", text: text(data) }], structuredContent: data !== null && typeof data === "object" && !Array.isArray(data) ? data : { result: data } });
      } catch (e) {
        if (!isAppError(e)) req.log.error({ err: e, tool: t.name }, "mcp tool failed");
        const body = toolError(e);
        return ok(id, { isError: true, content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body });
      }
    }
    return err(id, -32601, `Method not found: ${method}`);
  }

  app.post("/mcp", async (req, reply) => {
    let actor: Actor;
    try {
      actor = await resolver.resolveMcp({ headers: req.headers, ip: req.ip, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null });
    } catch (e) {
      if (isAppError(e)) {
        reply.header("www-authenticate", 'Bearer realm="soe-hub", error="invalid_token"');
        return reply.code(401).send(e.toBody(req.id));
      }
      throw e;
    }
    req.actor = actor;
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(req, actor, (m ?? {}) as Record<string, unknown>)))).filter((x) => x !== null);
      return out.length ? out : reply.code(202).send();
    }
    if (body === null || typeof body !== "object") return reply.code(400).send(err(null, -32700, "Parse error"));
    const out = await handle(req, actor, body as Record<string, unknown>);
    return out === null ? reply.code(202).send() : out;
  });
  // Stateless server: no server-initiated stream, no sessions to close.
  for (const method of ["GET", "DELETE"] as const) {
    app.route({ method, url: "/mcp", handler: async (_req, reply) => reply.code(405).header("allow", "POST").send({ error: { code: "method_not_allowed", message: "Chỉ nhận POST (Streamable HTTP không trạng thái)." } }) });
  }
}
