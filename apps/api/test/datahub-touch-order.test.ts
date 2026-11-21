import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { processPendingColumns, claimNext } from "../src/modules/datahub/recalc";
import { columnTx, enqueue, lockColumnsAtFlush, nextChangeSeq, touchColumns } from "../src/modules/datahub/change-queue";

/**
 * Two writers that touch the same columns in several rounds and in opposite orders must not deadlock (seen for real in
 * the worker log: `SELECT ... FOR UPDATE` on `dh_columns` against another one, `datahub.formula` vs the tree build).
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("touching columns from concurrent transactions", () => {
  it("opposite orders over two rounds do not deadlock inside columnTx", async () => {
    const tb = await makeTable(a, { columns: [{ name: "A", type: "text" }, { name: "B", type: "text" }, { name: "C", type: "text" }] });
    const ids = [tb.cols["A"]!.id, tb.cols["B"]!.id, tb.cols["C"]!.id].sort();
    const db = t.c.db.db;
    for (let round = 0; round < 5; round++) {
      const g = gate();
      let waiting = 0;
      const sync = async () => {
        waiting++;
        if (waiting === 2) g.open();
        await g.p;
      };
      const run = (order: string[]) =>
        columnTx(db, async (tx) => {
          await touchColumns(tx, [order[0]!]);
          await sync();
          await touchColumns(tx, [order[1]!, order[2]!]);
          const seq = await nextChangeSeq(tx);
          await enqueue(tx, [{ columnId: order[0]!, seq, mode: "full" }]);
        });
      const res = await Promise.allSettled([run([ids[2]!, ids[0]!, ids[1]!]), run([ids[0]!, ids[1]!, ids[2]!])]);
      expect(res.map((r) => (r.status === "rejected" ? String((r.reason as { cause?: unknown }).cause ?? r.reason) : r.status))).toEqual(["fulfilled", "fulfilled"]);
    }
  });

  it("the own-column lock of a finishing run joins the sorted round", async () => {
    const tb = await makeTable(a, { columns: [{ name: "A", type: "text" }, { name: "B", type: "text" }] });
    const [x, y] = [tb.cols["A"]!.id, tb.cols["B"]!.id].sort() as [string, string];
    const db = t.c.db.db;
    const g = gate();
    let waiting = 0;
    const sync = async () => {
      waiting++;
      if (waiting === 2) g.open();
      await g.p;
    };
    const finisher = columnTx(db, async (tx) => {
      await sync();
      await touchColumns(tx, [y]);
      lockColumnsAtFlush(tx, [x]);
    });
    const writer = columnTx(db, async (tx) => {
      await sync();
      await touchColumns(tx, [y]);
      await touchColumns(tx, [x]);
    });
    expect((await Promise.allSettled([finisher, writer])).map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("what a person asked for is claimed before background building, even when the building asked first", async () => {
    const tb = await makeTable(a, { columns: [{ name: "A", type: "number" }, { name: "B", type: "number" }] });
    const f1 = await a("datahub.column.create", { table_id: tb.tableId, name: "F1", type: "formula", config: { formula: "=[A]+1" } });
    const f2 = await a("datahub.column.create", { table_id: tb.tableId, name: "F2", type: "formula", config: { formula: "=[B]+1" } });
    const db = t.c.db.db;
    await processPendingColumns(db, { parallel: 1 });
    await columnTx(db, (tx) => touchColumns(tx, [f1.id]), { bulk: true });
    await columnTx(db, (tx) => touchColumns(tx, [f2.id]));
    const first = await claimNext(db);
    expect(first?.id).toBe(f2.id);
    const second = await claimNext(db);
    expect(second?.id).toBe(f1.id);
    // A person's request on a column that building had queued turns it into a person's one.
    await columnTx(db, (tx) => touchColumns(tx, [f1.id]), { bulk: true });
    await columnTx(db, (tx) => touchColumns(tx, [f1.id]));
    expect((await t.c.db.db.execute(sql`SELECT calc_bulk FROM dh_columns WHERE /*scope:system*/ id = ${f1.id}::uuid`)).rows[0]).toMatchObject({ calc_bulk: false });
  });
});
