import { z } from "zod";
import { sql } from "drizzle-orm";
import type { HandlerCtx } from "../../core/types";

export const Id = z.uuid();

/** Raw SQL returns timestamps as strings; code paths that build a Date give a Date. Both serialise to ISO text. */
export const Ts = z.union([z.date(), z.string()]);

export const ROW_EVENTS = ["datahub.row.created", "datahub.row.updated", "datahub.row.deleted", "datahub.row.restored"];
export const STRUCTURE_EVENT = "datahub.structure.changed";

type StructureChange = "datahub_created" | "datahub_updated" | "datahub_deleted" | "datahub_restored" | "owner_changed" | "table_created" | "table_updated" | "table_deleted" | "table_restored" | "column_created" | "column_updated" | "column_deleted" | "column_restored" | "column_type_changed";

/** Structure changed: tells SSE listeners and the worker (which rebuilds the SQL export view). */
export async function emitStructure(ctx: Pick<HandlerCtx, "emit">, datahubId: string, tableId: string | null, change: StructureChange): Promise<void> {
  await ctx.emit(STRUCTURE_EVENT, { aggregateType: tableId ? "datahub_table" : "datahub", aggregateId: tableId ?? datahubId, payload: { datahub_id: datahubId, table_id: tableId, change } });
}

export const actorRefSql = (userId: string) => sql`${userId}::uuid`;

/** Optional boolean in a query string. */
export const boolParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");
