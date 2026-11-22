import { z } from "zod";
import { AppError, isAppError, toActorRef, type Actor, type ErrorCode } from "@soe/shared";
import {
  beginIdempotent,
  enqueueOutbox,
  finishIdempotent,
  hashRequest,
  writeAudit,
  type AuditEntry,
  type Db,
  type Executor,
} from "@soe/db";
import { columnTx } from "../modules/datahub/change-queue";
import type { Logger } from "pino";
import { AccessContext, type PrincipalLoader } from "../auth/access";
import { AiRateLimiter, checkAiPolicy, checkConnection, checkMenuAndLevel, isConnectionActor } from "./ai-gate";
import { maskAuditDetails } from "./audit-privacy";
import type { EventRegistry } from "./events";
import type { Registry } from "./registry";
import type { AuditTarget, Authorizer, HandlerCtx, Operation } from "./types";

export interface ExecuteOptions {
  actor: Actor | null;
  requestId: string;
  idempotencyKey?: string | null;
  /** Channel / IP / user agent for audit rows of anonymous calls (no actor). */
  client?: AuditEntry["client"];
}

export interface ExecuteResult {
  result: unknown;
  status: number;
  /** True when the stored result of an earlier identical request was returned. */
  replayed: boolean;
}

export interface ExecutorDeps {
  db: Db;
  registry: Registry;
  events: EventRegistry;
  authorizer: Authorizer;
  principals: PrincipalLoader;
  logger: Logger;
  /** Validate handler results against `output` (on in dev and tests, off in production). */
  validateOutput: boolean;
}

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,200}$/;

function formatIssues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message }));
}

/**
 * The only way to run an operation. REST, MCP (Stage 5), the worker and Automation (later) all call `execute`.
 * Pipeline: find -> validate -> authenticate/authorize -> AI check -> run (transaction for commands)
 *           -> events (outbox) -> audit -> idempotent result.
 */
export class OperationExecutor {
  /** Per-connection call counters (module5 5). */
  private readonly aiLimiter = new AiRateLimiter();
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(name: string, rawInput: unknown, opts: ExecuteOptions): Promise<ExecuteResult> {
    const { registry, logger } = this.deps;
    const op = registry.get(name);
    if (!op) throw new AppError("not_found", `Không có thao tác "${name}".`);

    const parsed = op.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new AppError("validation_error", "Dữ liệu gửi lên không hợp lệ.", { issues: formatIssues(parsed.error) });
    }
    const input = parsed.data as unknown;

    await this.checkAccess(op, opts, input);

    // Public operations (login, codes) never use Idempotency-Key: there is no owner to scope the key to, and the
    // stored result could hold a session secret.
    const key = op.permission === null ? null : (opts.idempotencyKey ?? null);
    if (key !== null && !IDEMPOTENCY_KEY_RE.test(key)) {
      throw new AppError("idempotency_key_invalid", "Idempotency-Key phải dài 8-200 ký tự in được.");
    }

    const log = logger.child({ op: op.name, requestId: opts.requestId });
    const state = { target: null as AuditTarget | null };
    try {
      return op.kind === "command"
        ? await this.runCommand(op, input, opts, key, log, state)
        : await this.runQuery(op, input, opts, log, state);
    } catch (err) {
      await this.auditFailure(op, opts, err, state.target);
      throw err instanceof Error && !isAppError(err) ? this.wrapUnexpected(err, log) : err;
    }
  }

  private wrapUnexpected(err: Error, log: Logger): AppError {
    log.error({ err }, "unexpected error in operation");
    return new AppError("internal_error");
  }

  private async checkAccess(op: Operation, opts: ExecuteOptions, input: unknown): Promise<void> {
    if (op.permission === null) return;
    const deny = async (code: ErrorCode, reason: string, details?: unknown): Promise<never> => {
      // An anonymous read (for example the page asking "who am I" before login) is not worth a row; anonymous writes are.
      if (!(code === "unauthenticated" && op.kind === "query")) await this.safeAudit({ command: op.name, result: "denied", actor: opts.actor, requestId: opts.requestId, client: opts.client, errorCode: code, details: { reason, permission: op.permission } });
      throw new AppError(code, code === "unauthenticated" ? undefined : reason, details);
    };
    const actor = opts.actor;
    if (!actor) return deny("unauthenticated", "Chưa xác định được người dùng.");
    // A personal token (REST) or an AI connection (/mcp): the operation, the Admin's policy and the connection come first.
    const viaConnection = isConnectionActor(actor);
    let conn: Awaited<ReturnType<typeof checkConnection>> | null = null;
    if (viaConnection) {
      try {
        await checkAiPolicy(this.deps.db, op);
        conn = await checkConnection(this.deps.db, actor, op, this.aiLimiter);
      } catch (e) {
        if (isAppError(e)) return deny(e.code, e.message, e.details);
        throw e;
      }
    }
    const decision = await this.deps.authorizer.authorize(actor, { name: op.name, kind: op.kind, permission: op.permission });
    if (!decision.allowed) return deny(decision.code ?? "forbidden", decision.reason);
    if (conn) {
      try {
        await checkMenuAndLevel(this.deps.db, conn, op, input);
      } catch (e) {
        if (isAppError(e)) return deny(e.code, e.message, e.details);
        throw e;
      }
    }
  }

  private makeCtx(op: Operation, opts: ExecuteOptions, ex: Executor, log: Logger, state: { target: AuditTarget | null }, canEmit: boolean): HandlerCtx<Actor | null> {
    const { events } = this.deps;
    return {
      actor: opts.actor,
      requestId: opts.requestId,
      db: ex,
      log,
      access: new AccessContext(opts.actor, ex, this.deps.principals),
      outside: this.deps.db,
      client: opts.client ? { via: String(opts.client.via ?? ""), ip: opts.client.ip ?? null, userAgent: opts.client.userAgent ?? null } : undefined,
      audit: (t) => {
        state.target = t;
      },
      emit: async (event, input) => {
        if (!canEmit) throw new Error(`${op.name}: query không được phát sự kiện.`);
        if (!op.emits.includes(event)) throw new Error(`${op.name}: sự kiện "${event}" chưa khai báo trong emits.`);
        const def = events.get(event);
        if (!def) throw new Error(`Sự kiện "${event}" chưa có trong danh mục sự kiện.`);
        const payload = def.schema.parse(input.payload);
        await enqueueOutbox(ex as never, {
          event,
          eventVersion: def.version,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload,
          actor: opts.actor ? toActorRef(opts.actor) : null,
          requestId: opts.requestId,
          coalesce: def.coalesce,
        });
      },
    };
  }

  private checkOutput(op: Operation, result: unknown): void {
    // With an HTTP `respond` hook, `output` documents the HTTP data, not the raw handler result.
    if (!this.deps.validateOutput || !op.output || op.http.respond) return;
    const schema = op.list ? z.array(op.output) : op.output;
    const target = op.list ? (result as { items: unknown[] }).items : result;
    const r = schema.safeParse(target);
    if (!r.success) throw new Error(`${op.name}: kết quả không khớp output schema: ${JSON.stringify(formatIssues(r.error))}`);
  }

  private async runQuery(op: Operation, input: unknown, opts: ExecuteOptions, log: Logger, state: { target: AuditTarget | null }): Promise<ExecuteResult> {
    const ctx = this.makeCtx(op, opts, this.deps.db, log, state, false);
    const result = await op.handler(ctx, input);
    this.checkOutput(op, result);
    if (op.audit === "always") {
      await writeAudit(this.deps.db, {
        command: op.name, result: "success", actor: opts.actor, requestId: opts.requestId, client: opts.client,
        targetType: state.target?.type, targetId: state.target?.id, details: maskAuditDetails(state.target?.type, state.target?.details),
      });
    }
    return { result, status: op.http.status, replayed: false };
  }

  private async runCommand(op: Operation, input: unknown, opts: ExecuteOptions, key: string | null, log: Logger, state: { target: AuditTarget | null }): Promise<ExecuteResult> {
    return columnTx(this.deps.db, async (tx) => {
      let idemId: string | null = null;
      if (key !== null) {
        const s = await beginIdempotent(tx, {
          scope: opts.actor?.userId ?? "anonymous",
          key,
          command: op.name,
          requestHash: hashRequest(input),
        });
        if (s.state === "replay") return { result: s.body, status: s.status, replayed: true };
        idemId = s.id;
      }
      const ctx = this.makeCtx(op, opts, tx, log, state, true);
      const result = await op.handler(ctx, input);
      this.checkOutput(op, result);
      if (op.audit !== "none") {
        await writeAudit(tx, {
          command: op.name, result: "success", actor: opts.actor, requestId: opts.requestId, client: opts.client,
          targetType: state.target?.type, targetId: state.target?.id, details: maskAuditDetails(state.target?.type, state.target?.details),
        });
      }
      if (idemId) await finishIdempotent(tx, idemId, op.http.status, result);
      return { result, status: op.http.status, replayed: false };
    });
  }

  private async auditFailure(op: Operation, opts: ExecuteOptions, err: unknown, target: AuditTarget | null): Promise<void> {
    // Failed commands are audited (their transaction rolled back, so use a separate connection).
    // Failed queries and rejected idempotency replays are not: they changed nothing.
    if (op.kind !== "command") return;
    const code = isAppError(err) ? err.code : "internal_error";
    await this.safeAudit({
      command: op.name, result: "error", actor: opts.actor, requestId: opts.requestId, client: opts.client, errorCode: code,
      targetType: target?.type, targetId: target?.id,
      details: {
        // Error details can carry cell values (for example the current value of a conflicting cell): mask them for private targets.
        ...(isAppError(err) ? { message: err.message, details: maskAuditDetails(target?.type, err.details) } : { message: "unexpected error" }),
        ...(target?.details !== undefined ? { target: maskAuditDetails(target.type, target.details) } : {}),
      },
    });
  }

  private async safeAudit(entry: Parameters<typeof writeAudit>[1]): Promise<void> {
    try {
      await writeAudit(this.deps.db, entry);
    } catch (e) {
      // Never hide the original error behind an audit failure; but make the failure loud.
      this.deps.logger.error({ err: e, command: entry.command }, "failed to write audit log");
    }
  }
}
