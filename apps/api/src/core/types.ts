import type { z } from "zod";
import type { Actor } from "@soe/shared";
import type { Db, Executor } from "@soe/db";
import type { AccessContext } from "../auth/access";
import type { Logger } from "pino";

export type AuditMode =
  /** Query that is not logged. */
  | "none"
  /** Successful write is logged (default for commands). */
  | "write"
  /** Always logged, including reads: export, bulk reads, sensitive reads. */
  | "always";

export interface HttpBinding {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path below `/api/v1`, with `:param` placeholders. */
  path: string;
  /** Success status. Default 200. */
  status?: 200 | 201 | 202 | 204;
  /** Turns the handler result into the HTTP response (for example: set cookies, strip secrets). Returns the `data`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  respond?: (result: any, res: HttpResponder) => unknown;
}

export interface EmitInput {
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
}

export interface AuditTarget {
  type?: string;
  id?: string;
  /** For example field changes `{ field, old, new }`. */
  details?: unknown;
}

export interface HandlerCtx<A = Actor> {
  actor: A;
  requestId: string;
  /** Transaction for commands; plain db for queries. */
  db: Executor;
  log: Logger;
  /** Writes an event to the outbox in the same transaction. Only events declared in `emits`. Commands only. */
  emit(event: string, input: EmitInput): Promise<void>;
  /** Sets the object and details recorded in the audit log for this call (also on failure). */
  audit(target: AuditTarget): void;
  /** Permissions, roles and data scopes of the actor (design module1 section 10). */
  access: AccessContext;
  /**
   * Plain database handle OUTSIDE the command transaction. Only for writes that must persist even when the command
   * fails afterwards (failed-login counter, wrong-code attempts). Never use it for the command's own data.
   */
  outside: Db;
}

/** Lets an operation adjust the HTTP response (cookies, file download). Ignored by other channels. */
export interface HttpResponder {
  setCookie(name: string, value: string, opts: { maxAgeSeconds?: number; httpOnly: boolean }): void;
  clearCookie(name: string): void;
  /** Sends a raw body instead of `{ data }`. */
  sendRaw(body: string, contentType: string, filename?: string): void;
}

/** Result of a list query. REST maps it to `{ data, next_cursor, total }`. */
export interface ListOutput<T = unknown> {
  items: T[];
  nextCursor: string | null;
  total?: number;
  /** Extra top-level fields of the REST envelope (declared by the operation's `listExtra`), e.g. `consistency`. */
  extra?: Record<string, unknown>;
}

export interface OperationDef<I extends z.ZodType, O, P extends string | null> {
  /** Stable name `<module>.<object>.<verb>`; used by API, MCP, audit and automation. */
  name: string;
  summary: string;
  description?: string;
  tags?: string[];
  input: I;
  /** Zod schema of the result (for OpenAPI and dev-time validation). For lists: schema of ONE item. */
  output?: z.ZodType;
  /** Permission string checked by `authorize`. `null` = public (no actor needed). */
  permission: P;
  /** False = AI channels (mcp) are refused. `onboarding.*` must be false. */
  aiAllowed: boolean;
  audit?: AuditMode;
  /** Events this command may emit. */
  emits?: string[];
  http: HttpBinding;
  /** Marks a list query: handler returns ListOutput and REST adds `next_cursor`/`total`. */
  list?: boolean;
  /** Fields a list adds next to `data` / `next_cursor` / `total` (documented in OpenAPI). Returned in `ListOutput.extra`. */
  listExtra?: z.ZodType;
  handler: (ctx: HandlerCtx<P extends string ? Actor : Actor | null>, input: z.output<I>) => Promise<O>;
}

export type OperationKind = "command" | "query";

export interface Operation {
  kind: OperationKind;
  name: string;
  summary: string;
  description?: string;
  tags: string[];
  input: z.ZodType;
  output?: z.ZodType;
  permission: string | null;
  aiAllowed: boolean;
  audit: AuditMode;
  emits: string[];
  http: Required<Omit<HttpBinding, "respond">> & Pick<HttpBinding, "respond">;
  list: boolean;
  listExtra?: z.ZodType;
  handler: (ctx: HandlerCtx<Actor | null>, input: unknown) => Promise<unknown>;
}

/** What the authorizer sees. Deliberately small so Module 1 can replace the implementation freely. */
export interface AuthTarget {
  name: string;
  kind: OperationKind;
  permission: string;
}

export type AuthDecision = { allowed: true } | { allowed: false; reason: string; code?: "unauthenticated" | "forbidden" | "password_setup_required" };

/**
 * Pluggable permission check. Stage 1 (Module 1) provides the real engine
 * (roles x org tree x data grants x token scopes). Until then see `auth/dev.ts` and `auth/production.ts`.
 */
export interface Authorizer {
  authorize(actor: Actor, target: AuthTarget): Promise<AuthDecision> | AuthDecision;
}

export interface RequestInfo {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  userAgent: string | null;
}

/** Turns an incoming request into an actor. Stage 1 provides session cookie / token implementations. */
export interface ActorResolver {
  resolve(req: RequestInfo): Promise<Actor | null> | Actor | null;
}
