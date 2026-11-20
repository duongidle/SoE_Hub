import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import type { MTable } from "@soe/metrics";
import type { TableAccess } from "../datahub/access";
import { metricCache } from "./runner";

/**
 * Shared folds (design module4 decisions 4.1b). A key join folds the joined table to one row per normalised key. For a base narrowed by the split
 * lock that fold is the same for every reader, so it is made ONCE into an unlogged table of schema `mfold` and every reader's statement joins it
 * (a statement per reader no longer scans and groups the whole joined table).
 *
 * Who may share: only a table whose rows every reader sees with the same values (not narrowed by the split lock, no per-reader values) and that is
 * big enough to be worth it. The fold holds nothing a reader could not read from the table itself; readers reach it only through their own base rows,
 * and only after `resolveSource` has checked their access to the joined table.
 *
 * Validity: the name carries the answer-cache token of the table (`metricCache.token`), so a change of the table (rows, computed values, structure,
 * sharing) makes the next statement use another fold; the old one is dropped after a minute. The name also carries this process's nonce (a token
 * counts per process) and the day (tables left by a crashed process are dropped the next day).
 */
const NONCE = randomBytes(4).toString("hex");
const ymd = (d = new Date()): string => d.toISOString().slice(0, 10).replaceAll("-", "");
export const FOLD_NAME = /mfold\.f_[0-9a-f]{20}_\d{8}/g;

const minRows = (): number => Number(process.env.METRIC_FOLD_MIN_ROWS ?? 20_000);

const literal = (v: unknown): string => (typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

interface Def {
  select: string;
}
const defs = new Map<string, Def>();
const current = new Map<string, string>(); // signature -> name now in use
const ready = new Set<string>();
const pending = new Map<string, Promise<void>>();

/** The `fold` hook of an `MTable`, or undefined when its fold may not be shared. */
export function foldHook(access: TableAccess): MTable["fold"] {
  if (access.restricted || access.scopedKeys.length > 0 || access.table.kind === "merged" || access.table.rowCount < minRows()) return undefined;
  const token = metricCache.token([access.tableId]);
  return (q) => {
    const select = q.params.length === 0 ? q.sql : q.sql.replace(/\$(\d+)/g, (_m, i: string) => literal(q.params[Number(i) - 1]));
    const sig = createHash("sha256").update(select).update(NONCE).digest("hex").slice(0, 20);
    const name = `mfold.f_${createHash("sha256").update(select).update(token).update(NONCE).digest("hex").slice(0, 20)}_${ymd()}`;
    defs.set(name, { select });
    const old = current.get(sig);
    if (old && old !== name) {
      current.set(sig, name);
      const t = setTimeout(() => void drop(old), 60_000);
      t.unref();
    } else current.set(sig, name);
    return name;
  };
}

async function drop(name: string): Promise<void> {
  ready.delete(name);
  defs.delete(name);
  const db = dbRef;
  if (db) await db.execute(sql.raw(`DROP TABLE IF EXISTS ${name}`)).catch(() => {});
}

let dbRef: Executor | null = null;
let lastGc = 0;

/** Makes sure every fold a statement names exists (created once, even when many statements ask at the same time). */
export async function ensureFolds(db: Executor, statement: string): Promise<void> {
  const names = [...new Set(statement.match(FOLD_NAME) ?? [])];
  if (names.length === 0) return;
  dbRef = db;
  await Promise.all(names.map((n) => ensureOne(db, n)));
  if (Date.now() - lastGc > 6 * 3_600_000) {
    lastGc = Date.now();
    void gc(db);
  }
}

async function ensureOne(db: Executor, name: string): Promise<void> {
  if (ready.has(name)) return;
  let p = pending.get(name);
  if (!p) {
    p = (async () => {
      const def = defs.get(name);
      if (!def) throw new Error("fold not registered");
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${name}))`);
        const have = await tx.execute(sql`SELECT to_regclass(${name}) AS t`);
        if (!(have.rows[0] as { t: string | null }).t) {
          await tx.execute(sql.raw(`CREATE UNLOGGED TABLE ${name} AS ${def.select}`));
          await tx.execute(sql.raw(`CREATE INDEX ON ${name} (k)`));
          await tx.execute(sql.raw(`ANALYZE ${name}`));
        }
      });
      ready.add(name);
    })().finally(() => pending.delete(name));
    pending.set(name, p);
  }
  await p;
}

/** Drops the folds of earlier days (left by a process that stopped before it could drop them). */
async function gc(db: Executor): Promise<void> {
  const today = ymd();
  const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'mfold'`).catch(() => null);
  for (const r of (res?.rows ?? []) as { tablename: string }[]) {
    const day = /_(\d{8})$/.exec(r.tablename)?.[1];
    if (day && day < today) await db.execute(sql.raw(`DROP TABLE IF EXISTS mfold.${r.tablename}`)).catch(() => {});
  }
}

/** For tests: forget what this process made (the tables stay). */
export function resetFolds(): void {
  defs.clear();
  current.clear();
  ready.clear();
}
