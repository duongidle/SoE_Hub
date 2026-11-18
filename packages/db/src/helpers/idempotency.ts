import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "../client";
import { idempotencyKeys } from "../schema/idempotency";

export const IDEMPOTENCY_TTL_HOURS = 24;

export function hashRequest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input ?? null)).digest("hex");
}

export type IdempotencyState =
  | { state: "new"; id: string }
  | { state: "replay"; status: number; body: unknown };

/**
 * Claims an Idempotency-Key inside the command transaction.
 * A concurrent request with the same key waits on the unique index until the first one commits,
 * then sees the stored result. If the first one rolls back, the second one proceeds normally.
 */
export async function beginIdempotent(
  ex: Executor,
  i: { scope: string; key: string; command: string; requestHash: string },
): Promise<IdempotencyState> {
  const inserted = await ex
    .insert(idempotencyKeys)
    .values(i)
    .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });
  if (inserted[0]) return { state: "new", id: inserted[0].id };

  const [existing] = await ex
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, i.scope), eq(idempotencyKeys.key, i.key)))
    .limit(1);
  if (!existing) throw new AppError("internal_error", "Idempotency key vừa bị xoá.");

  const ageMs = Date.now() - existing.createdAt.getTime();
  if (ageMs > IDEMPOTENCY_TTL_HOURS * 3600 * 1000) {
    // Expired but not purged yet: reuse the row as a fresh claim.
    await ex
      .update(idempotencyKeys)
      .set({
        command: i.command,
        requestHash: i.requestHash,
        responseStatus: null,
        responseBody: null,
        createdAt: sql`now()`,
      })
      .where(eq(idempotencyKeys.id, existing.id));
    return { state: "new", id: existing.id };
  }

  if (existing.command !== i.command || existing.requestHash !== i.requestHash) {
    throw new AppError("idempotency_key_reuse");
  }
  if (existing.responseStatus == null) throw new AppError("internal_error", "Yêu cầu trùng khoá chưa có kết quả.");
  return { state: "replay", status: existing.responseStatus, body: existing.responseBody };
}

export async function finishIdempotent(ex: Executor, id: string, status: number, body: unknown): Promise<void> {
  await ex.update(idempotencyKeys).set({ responseStatus: status, responseBody: body ?? null }).where(eq(idempotencyKeys.id, id));
}

/** Removes keys older than the TTL. Run by the worker. */
export async function purgeIdempotencyKeys(ex: Executor): Promise<number> {
  const res = await ex.execute(
    sql`DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`,
  );
  return res.rowCount ?? 0;
}
