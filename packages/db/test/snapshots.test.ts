import { describe, expect, it } from "vitest";
import { createSnapshot, getSnapshotRows, newId } from "../src/index";
import { appDb } from "./helpers";

describe("snapshots", () => {
  it("stores a named copy of rows in one transaction", async () => {
    const { db } = appDb();
    const rows = Array.from({ length: 1500 }, (_, i) => ({ rowId: newId(), data: { n: i } }));
    const snap = await db.transaction((tx) => createSnapshot(tx, { name: "Pipeline đầu Q1/2027", kind: "deal_pipeline", rows }));
    expect(snap.rowCount).toBe(1500);
    expect(await getSnapshotRows(db, snap.id)).toHaveLength(1500);
  });
});
