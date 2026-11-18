import type pg from "pg";

/**
 * Enforcement of "every query on owned data goes through the scoped query helpers" (design module1 section 10).
 *
 * Tables listed here hold data that belongs to a person. Any SELECT/UPDATE/DELETE that touches them must carry the
 * marker that `scopeSql`, `ownedBy` or `systemScope` (auth/access.ts) put in the SQL. A query without it is a bug:
 * it would read or change other people's data without the scope check. Inserts are allowed (the owner is set by code).
 *
 * The guard is on outside production (dev and every test run), so the whole test suite proves the rule. Later modules
 * add their tables (datahub rows, deals...) with `registerOwnedTable`.
 */
const owned = new Set<string>(["files", "notifications"]);

export function registerOwnedTable(name: string): void {
  owned.add(name);
}

export function ownedTables(): string[] {
  return [...owned];
}

export class UnscopedQueryError extends Error {
  constructor(table: string, text: string) {
    super(`Truy vấn thẳng bảng có chủ "${table}" mà không qua bộ truy vấn có phạm vi: ${text.slice(0, 200)}`);
    this.name = "UnscopedQueryError";
  }
}

/** Throws when `text` reads or changes an owned table without a scope marker. */
export function checkScopedQuery(text: string): void {
  if (text.includes("/*scope")) return;
  for (const t of owned) {
    const re = new RegExp(`\\b(from|join|update)\\s+(only\\s+)?("?public"?\\.)?"?${t}"?(\\s|$|,|\\))`, "i");
    if (re.test(text)) throw new UnscopedQueryError(t, text);
  }
}

function queryText(arg: unknown): string | null {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && typeof (arg as { text?: unknown }).text === "string") return (arg as { text: string }).text;
  return null;
}

/** Wraps every client of the pool so each query is checked before it is sent. */
export function installQueryGuard(pool: pg.Pool): void {
  pool.on("connect", (client) => {
    const c = client as pg.PoolClient & { __soeGuard?: boolean };
    if (c.__soeGuard) return;
    c.__soeGuard = true;
    const original = c.query.bind(c) as (...args: unknown[]) => unknown;
    (c as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      const text = queryText(args[0]);
      if (text) {
        try {
          checkScopedQuery(text);
        } catch (e) {
          const cb = args.find((a) => typeof a === "function") as ((err: Error) => void) | undefined;
          if (cb) {
            cb(e as Error);
            return undefined;
          }
          return Promise.reject(e);
        }
      }
      return original(...args);
    };
  });
}
