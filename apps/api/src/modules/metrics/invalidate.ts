import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, OutboxRow } from "@soe/db";
import type { EventDef } from "../../core/events";
import type { Subscriber } from "../../core/outbox-dispatcher";
import type { SseSignal } from "../../http/sse";
import { CACHE_CHANNEL, SSE_CHANNEL } from "../../http/sse";
import { datahubAudience } from "../datahub/access";
import type { InvalidateMessage } from "./runner";

/** Postgres channel the worker uses to tell every api process which cached metric answers to drop. */
export const METRIC_CACHE_CHANNEL = CACHE_CHANNEL;

/**
 * Signal for open dashboards (design module3 section 6): the numbers that read these tables may have changed, load them again.
 * It carries ids only. Sent after the cache was cleared, so a reload gets fresh numbers.
 */
export const metricsEvents: EventDef[] = [
  {
    name: "metrics.data.changed",
    version: 1,
    description: "Dữ liệu một bảng (dòng, cột, công thức tính lại, cấu trúc), chia sẻ của datahub hoặc cây tổ chức đổi: các con số của chỉ số/dashboard đọc bảng đó có thể đã đổi, tải lại. Worker xoá cache của api rồi phát sự kiện này; chỉ mang mã, không mang giá trị.",
    schema: z.object({ datahub_id: z.uuid().nullable(), table_ids: z.array(z.uuid()), reason: z.enum(["rows", "recalculated", "structure", "share", "org"]) }),
    audience: async (p: { datahub_id: string | null; table_ids: string[] }, db) => {
      // Organization tree changes: who sees what changed for everyone, so every holder of the permission reloads.
      if (!p.datahub_id) return { permission: "datahub:datahub:use" };
      return { users: await datahubAudience(db, p.datahub_id) };
    },
  },
];

const MAX_PER_NOTIFY = 100; // pg_notify payloads are limited to 8000 bytes; a uuid is 38 bytes with quotes

async function tablesOfDatahub(db: Db, datahubId: string): Promise<string[]> {
  const r = await db.execute(sql`SELECT id FROM dh_tables WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

async function datahubOfTable(db: Db, tableId: string): Promise<string | null> {
  const r = await db.execute(sql`SELECT datahub_id FROM dh_tables WHERE /*scope:system*/ id = ${tableId}::uuid`);
  return (r.rows[0] as { datahub_id: string } | undefined)?.datahub_id ?? null;
}

interface Change {
  reason: "rows" | "recalculated" | "structure" | "share" | "org";
  datahubId: string | null;
  tables: string[];
  all: boolean;
}

async function changeOf(ev: OutboxRow, db: Db): Promise<Change | null> {
  const p = ev.payload as Record<string, unknown>;
  if (ev.event.startsWith("datahub.row.")) {
    const t = p.table_id as string;
    return { reason: "rows", datahubId: await datahubOfTable(db, t), tables: [t], all: false };
  }
  if (ev.event === "datahub.formula.recalculated") {
    if (p.state === "pending") return null; // nothing changed yet
    const t = p.table_id as string;
    return { reason: "recalculated", datahubId: await datahubOfTable(db, t), tables: [t], all: false };
  }
  if (ev.event === "datahub.structure.changed") {
    const dh = p.datahub_id as string;
    const t = p.table_id as string | null;
    return { reason: "structure", datahubId: dh, tables: t ? [t] : await tablesOfDatahub(db, dh), all: false };
  }
  if (ev.event === "datahub.share.changed") {
    const dh = p.datahub_id as string;
    return { reason: "share", datahubId: dh, tables: await tablesOfDatahub(db, dh), all: false };
  }
  if (ev.event === "org.member.changed") return { reason: "org", datahubId: null, tables: [], all: true };
  return null;
}

/**
 * Outbox subscriber (worker): a change that can alter a metric number clears the cached answers that read the table, in every api
 * process, then tells the dashboards that are open. Covers rows, computed values recalculated, structure, sharing of the source
 * (who sees which rows changes) and the organization tree (the same, for everyone).
 */
export const metricCacheSubscriber: Subscriber = {
  name: "metrics.cache",
  match: (e) => e.startsWith("datahub.row.") || e === "datahub.formula.recalculated" || e === "datahub.structure.changed" || e === "datahub.share.changed" || e === "org.member.changed",
  async handle(ev, db) {
    const c = await changeOf(ev, db);
    if (!c) return;
    if (c.all) {
      const m: InvalidateMessage = { all: true };
      await db.execute(sql`SELECT pg_notify(${METRIC_CACHE_CHANNEL}, ${JSON.stringify(m)})`);
    }
    for (let i = 0; i < c.tables.length; i += MAX_PER_NOTIFY) {
      const m: InvalidateMessage = { tables: c.tables.slice(i, i + MAX_PER_NOTIFY) };
      await db.execute(sql`SELECT pg_notify(${METRIC_CACHE_CHANNEL}, ${JSON.stringify(m)})`);
    }
    // org changes have no datahub; rows of a table whose datahub is gone have nobody to tell
    if (!c.all && !c.datahubId) return;
    const def = metricsEvents[0]!;
    const payload = { datahub_id: c.datahubId, table_ids: c.tables.slice(0, 100), reason: c.reason };
    const audience = await def.audience!(payload, db);
    if (!audience) return;
    const signal: SseSignal = { id: ev.id, event: def.name, aggregate_type: c.datahubId ? "datahub" : null, aggregate_id: c.datahubId, at: ev.createdAt.toISOString(), audience };
    await db.execute(sql`SELECT pg_notify(${SSE_CHANNEL}, ${JSON.stringify(signal)})`);
  },
};
