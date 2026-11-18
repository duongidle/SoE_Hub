import { eq } from "drizzle-orm";
import type { Executor } from "../client";
import { snapshotRows, snapshots } from "../schema/snapshots";

export interface CreateSnapshotInput {
  name: string;
  kind: string;
  tableId?: string;
  scope?: string;
  takenBy?: string | null;
  note?: string;
  rows: { rowId: string; data: unknown }[];
}

const CHUNK = 1000;

/** Creates a read-only snapshot. Run inside one transaction so the snapshot is all-or-nothing. */
export async function createSnapshot(ex: Executor, i: CreateSnapshotInput) {
  const [snap] = await ex
    .insert(snapshots)
    .values({
      name: i.name,
      kind: i.kind,
      tableId: i.tableId ?? null,
      scope: i.scope ?? "global",
      takenBy: i.takenBy ?? null,
      note: i.note ?? null,
      rowCount: i.rows.length,
    })
    .returning();
  for (let n = 0; n < i.rows.length; n += CHUNK) {
    const chunk = i.rows.slice(n, n + CHUNK).map((r) => ({ snapshotId: snap!.id, rowId: r.rowId, data: r.data }));
    await ex.insert(snapshotRows).values(chunk);
  }
  return snap!;
}

export async function getSnapshotRows(ex: Executor, snapshotId: string) {
  return ex.select().from(snapshotRows).where(eq(snapshotRows.snapshotId, snapshotId));
}
