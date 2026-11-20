import { ensureFolds } from "./folds";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "@soe/shared";
import type { Db } from "@soe/db";
import type { MTable } from "@soe/metrics";
import type { HandlerCtx } from "../../core/types";

/**
 * The ONE place a metric statement runs (design module3 section 6.1): cache, merging of identical requests in flight, a cap on how
 * many run at once for one person, and a time limit. Every statement of the engine (the grouped statement, join diagnosis, quartiles,
 * cohort sizes, the target table) goes through `runSql`; nothing else in `metrics` calls `ctx.db.execute` for data.
 *
 * Cache key = the statement as the database gets it (text + parameters) + the `scopeKey` of every table it reads. The statement
 * already holds everything that decides the answer: the metric (and, for a derived metric, the metrics it references, each one its own
 * statement), the parameters of the call (compare, cumulative, target, outliers, filter), the days a relative range resolved to
 * (so "today" is in it), the fiscal year start, the read expressions of the columns. `scopeKey` (datahub/access.ts) says which rows the
 * reader sees. So a full answer is cached as the set of its statements, and the key cannot miss a part.
 */
export type SqlCtx = Pick<HandlerCtx, "db" | "actor">;

export interface MetricLimits {
  /** Longest a metric statement may run (Postgres `statement_timeout`). */
  timeoutMs: number;
  /** Statements one person may have running at the same time; the rest wait. */
  perUser: number;
  /** Safety net: an answer older than this is dropped even when no event reached this process. */
  ttlMs: number;
  /** Most answers kept (oldest used dropped first). */
  maxEntries: number;
}

export const metricLimits: MetricLimits = { timeoutMs: 10_000, perUser: 6, ttlMs: 5 * 60_000, maxEntries: 2000 };

export interface InvalidateMessage {
  /** Drop every answer that read one of these tables. */
  tables?: string[];
  /** Drop everything (organization tree changed: who sees what changed for everyone). */
  all?: boolean;
}

interface Entry {
  rows: Record<string, unknown>[];
  tables: string[];
  expires: number;
}

export interface CacheStats {
  hits: number;
  /** Requests that waited for an identical statement already running. */
  joined: number;
  /** Statements really sent to the database. */
  executed: number;
  entries: number;
}

class MetricCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, { p: Promise<Record<string, unknown>[]>; tables: string[] }>();
  /** Bumped by every invalidation of a table: an answer computed while one happened is not stored (it may hold the old data). */
  private readonly epochs = new Map<string, number>();
  private globalEpoch = 0;
  stats = { hits: 0, joined: 0, executed: 0 };

  token(tableIds: string[]): string {
    return `${this.globalEpoch}|${tableIds.map((t) => this.epochs.get(t) ?? 0).join(",")}`;
  }

  get(key: string): Record<string, unknown>[] | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key); // refresh the position: the least recently used goes first
    this.entries.set(key, e);
    return e.rows;
  }

  set(key: string, rows: Record<string, unknown>[], tables: string[]): void {
    this.entries.set(key, { rows, tables, expires: Date.now() + metricLimits.ttlMs });
    while (this.entries.size > metricLimits.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }

  flight(key: string): Promise<Record<string, unknown>[]> | undefined {
    return this.inflight.get(key)?.p;
  }

  startFlight(key: string, p: Promise<Record<string, unknown>[]>, tables: string[]): void {
    this.inflight.set(key, { p, tables });
    const done = () => {
      if (this.inflight.get(key)?.p === p) this.inflight.delete(key);
    };
    p.then(done, done);
  }

  invalidate(m: InvalidateMessage): void {
    if (m.all) {
      this.globalEpoch++;
      this.entries.clear();
      this.inflight.clear(); // answers still running are not shared any more
      return;
    }
    const tables = new Set(m.tables ?? []);
    if (tables.size === 0) return;
    for (const t of tables) this.epochs.set(t, (this.epochs.get(t) ?? 0) + 1);
    for (const [k, e] of this.entries) if (e.tables.some((t) => tables.has(t))) this.entries.delete(k);
    // A statement started before the change must not be joined by requests made after it.
    for (const [k, f] of [...this.inflight]) if (f.tables.some((t) => tables.has(t))) this.inflight.delete(k);
  }

  clear(): void {
    this.invalidate({ all: true });
    this.stats = { hits: 0, joined: 0, executed: 0 };
  }

  size(): number {
    return this.entries.size;
  }
}

export const metricCache = new MetricCache();
export const invalidateMetricCache = (m: InvalidateMessage): void => metricCache.invalidate(m);
export const resetMetricCache = (): void => metricCache.clear();
export const metricCacheStats = (): CacheStats => ({ ...metricCache.stats, entries: metricCache.size() });

// ------------------------------------------------------------------------------------------------
// at most `perUser` statements at the same time for one person
// ------------------------------------------------------------------------------------------------

interface Slot {
  active: number;
  queue: (() => void)[];
}
const slots = new Map<string, Slot>();

async function limited<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  let s = slots.get(userId);
  if (!s) slots.set(userId, (s = { active: 0, queue: [] }));
  if (s.active >= metricLimits.perUser) await new Promise<void>((resolve) => s!.queue.push(resolve));
  else s.active++;
  peak.value = Math.max(peak.value, s.active);
  try {
    return await fn();
  } finally {
    const next = s.queue.shift();
    if (next) next(); // the slot passes to the next one waiting
    else {
      s.active--;
      if (s.active === 0) slots.delete(userId);
    }
  }
}

/** Highest number of statements one person had running at once since `resetPeak` (for tests). */
export const peak = { value: 0 };
export const resetPeak = (): void => {
  peak.value = 0;
};

// ------------------------------------------------------------------------------------------------
// one statement, with the time limit
// ------------------------------------------------------------------------------------------------

const isCancelled = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "57014";
};

/** Runs a statement with `statement_timeout` set for it alone (a transaction, so the setting never leaks to the pooled connection). */
export async function timed(db: SqlCtx["db"], query: SQL): Promise<Record<string, unknown>[]> {
  try {
    return await (db as Db).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${String(metricLimits.timeoutMs)}, true)`);
      return (await tx.execute(query)).rows as Record<string, unknown>[];
    });
  } catch (e) {
    if (isCancelled(e)) {
      throw new AppError("validation_error", `Truy vấn quá nặng (quá ${Math.round(metricLimits.timeoutMs / 1000)} giây). Thu hẹp khoảng thời gian hoặc thêm bộ lọc rồi thử lại.`, {
        reason: "query_too_heavy",
        timeout_ms: metricLimits.timeoutMs,
        hint: "Chọn khoảng thời gian ngắn hơn (time.range), thêm bộ lọc, hoặc bỏ bớt phép ghép bảng.",
      });
    }
    throw e;
  }
}

const dialect = new PgDialect();
const stringify = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));

export interface SqlResult {
  rows: Record<string, unknown>[];
  /** Milliseconds spent in the database by THIS call (0 when the answer came from the cache or from an identical statement already running). */
  ms: number;
}

/**
 * Runs one statement that reads `tables`: from the cache when the same statement was answered for the same scope, else (merged with
 * any identical one in flight) once, under the per-person cap and the time limit. A table without `scopeKey` is never cached.
 */
export async function runSql(ctx: SqlCtx, query: SQL, tables: MTable[]): Promise<SqlResult> {
  const userId = ctx.actor.userId;
  const q = dialect.sqlToQuery(query);
  const run = () =>
    limited(userId, async () => {
      await ensureFolds(ctx.db as never, q.sql);
      return timed(ctx.db, query);
    });
  if (!tables.every((t) => t.scopeKey)) {
    const t0 = performance.now();
    return { rows: await run(), ms: Math.round(performance.now() - t0) };
  }
  const ids = [...new Set(tables.map((t) => t.id))];
  const key = createHash("sha256").update(stringify([tables.map((t) => t.scopeKey).sort(), q.sql, q.params])).digest("hex");
  const hit = metricCache.get(key);
  if (hit) {
    metricCache.stats.hits++;
    return { rows: hit, ms: 0 };
  }
  const running = metricCache.flight(key);
  if (running) {
    metricCache.stats.joined++;
    return { rows: await running, ms: 0 };
  }
  const token = metricCache.token(ids);
  const t0 = performance.now();
  metricCache.stats.executed++;
  const p = run().then((rows) => {
    if (metricCache.token(ids) === token) metricCache.set(key, rows, ids);
    return rows;
  });
  metricCache.startFlight(key, p, ids);
  const rows = await p;
  return { rows, ms: Math.round(performance.now() - t0) };
}
