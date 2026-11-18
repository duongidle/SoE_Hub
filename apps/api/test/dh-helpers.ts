import { randomUUID } from "node:crypto";
import type { Actor } from "@soe/shared";
import { isAppError } from "@soe/shared";
import { dispatchOutboxOnce } from "../src/core/outbox-dispatcher";
import { defaultSubscribers } from "../src/core/subscribers";
import { processPendingColumns } from "../src/modules/datahub";
import type { TestApp } from "./helpers";

export function actorOf(userId: string, via: Actor["via"] = "api"): Actor {
  return { userId, via, connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null };
}

/** Runs registry operations as one person (through the real executor: validation, permissions, audit, events). */
export function as(t: TestApp, userId: string, via: Actor["via"] = "api") {
  return async function call<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await t.c.executor.execute(name, input, { actor: actorOf(userId, via), requestId: randomUUID() });
    return r.result as T;
  };
}

/** The AppError a call throws (or fails the test when it succeeds). */
export async function fails(p: Promise<unknown>): Promise<{ code: string; message: string; details: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

/**
 * Delivers pending outbox events to the real subscribers (SQL views, SSE fan-out, formula dependants...) and runs the
 * recalculation queue the way the worker does, until both are quiet.
 */
export async function drainOutbox(t: TestApp, opts: { now?: Date; maxRatio?: number } = {}): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const n = await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
    const m = await processPendingColumns(t.c.db.db, { now: opts.now, maxRatio: opts.maxRatio });
    if (n === 0 && m === 0) return;
  }
}

/** A datahub with one table and the given columns; returns ids and column keys by name. */
export async function makeTable(call: ReturnType<typeof as>, o: { name?: string; columns?: { name: string; type: string; config?: unknown; unique?: boolean; required?: boolean; default_value?: unknown }[] } = {}) {
  const dh = await call("datahub.datahub.create", { name: o.name ?? `DH ${randomUUID().slice(0, 8)}` });
  const table = await call("datahub.table.create", { datahub_id: dh.id, name: "Bảng 1" });
  const cols: Record<string, { key: string; id: string }> = {};
  for (const c of o.columns ?? []) {
    const col = await call("datahub.column.create", { table_id: table.id, ...c });
    cols[c.name] = { key: col.key, id: col.id };
  }
  return { dh, table, cols, tableId: table.id as string, dhId: dh.id as string };
}

/** Raises the Datahub limits of a person so a test can create many objects (limits have their own tests). */
export async function unlimit(t: TestApp, userId: string, o: { datahubs?: number; tables?: number; columns?: number } = {}): Promise<void> {
  const { dhUserLimits } = await import("@soe/db");
  await t.c.db.db
    .insert(dhUserLimits)
    .values({ userId, maxDatahubs: o.datahubs ?? 100, maxTables: o.tables ?? 50, maxColumns: o.columns ?? 200 })
    .onConflictDoUpdate({ target: dhUserLimits.userId, set: { maxDatahubs: o.datahubs ?? 100, maxTables: o.tables ?? 50, maxColumns: o.columns ?? 200 } });
}
