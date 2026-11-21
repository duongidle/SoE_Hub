import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@soe/shared";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { CYCLE_DEFAULT_DAYS, cycleStats, matureCutoff, percentile, waitDays } from "../src/modules/deal/cycle";
import { workerEmit } from "../src/modules/datahub/template-sync";

/** Stage 4.6B: the cycle of the deals and the cut-off of mature cohorts (design module4 10.2). Invented figures only. */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const tplOf = async (call: ReturnType<typeof as>, name: string) => (await call("datahub.template.list")).find((x: { name: string }) => x.name === name);
const person = (id: string) => ({ id, attrs: { vai_tro: "Leading", ty_le_com: 0.15, ty_le_dt: 1 } });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = businessDate(new Date());

/** One deal of `type` received `cycle` days before the day its first instalment is paid (`daysAgo` days ago): that day is its Closing date. */
async function wonDeal(type: string, cycle: number, daysAgo: number, tag: string) {
  const closing = addDays(today, -daysAgo);
  const d = await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": `Công ty ${tag}`, "Loại deal": type, "Start date": addDays(closing, -cycle), "Người tham gia": [person(org.userA1.id)] } });
  const s = await mgrA("payment.schedule", { deal_id: d.id, payments: [{ amount: 1_000_000, due: closing }] });
  await mgrA("payment.confirm", { received_on: closing, receipt: { amount: 1_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 1_000_000 }] });
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userB1 = as(t, org.userB1.id);
  admin = as(t, org.admin.id);
  guest = as(t, org.guestData.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = (await tplOf(mgrA, d.name)).master_table_id;
  // 11 Won deals of "POD bán mới" with cycles 10, 20 .. 110 days, and 3 Won deals of "Data" (fewer than 10: the default applies)
  for (let i = 1; i <= 11; i++) await wonDeal("POD bán mới", i * 10, 3, `P${i}`);
  for (let i = 1; i <= 3; i++) await wonDeal("Data", 5, 3, `D${i}`);
  await drainOutbox(t);
}, 180_000);
afterAll(async () => {
  await t.close();
});

describe("the pure parts", () => {
  it("percentile interpolates between ranks and the stats round up to whole days", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    const s = cycleStats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110])!;
    expect(s).toEqual({ n: 11, median: 60, mean: 60, p75: 85, p90: 100 });
    expect(cycleStats([1, 2])!.median).toBe(2); // 1.5 rounds up
    expect(cycleStats([])).toBeNull();
  });
  it("the wait is the milestone, 90 days under 10 Won deals, none for 'none'", () => {
    const s = cycleStats(Array.from({ length: 10 }, (_, i) => (i + 1) * 10))!;
    expect(waitDays("p90", s)).toEqual({ days: s.p90, defaulted: false });
    expect(waitDays("median", cycleStats([10, 20, 30]))).toEqual({ days: CYCLE_DEFAULT_DAYS, defaulted: true });
    expect(waitDays("median", null)).toEqual({ days: CYCLE_DEFAULT_DAYS, defaulted: true });
    expect(waitDays("none", cycleStats([10, 20, 30]))).toEqual({ days: 0, defaulted: false });
  });
  it("the cut-off is the last month that ends on or before today minus the wait", () => {
    expect(matureCutoff("2026-11-21", 90)).toEqual({ cutoff: "2026-08-23", mature_through: "2026-07-31", mature_month: "2026-07" });
    expect(matureCutoff("2026-11-30", 30)).toEqual({ cutoff: "2026-10-31", mature_through: "2026-10-31", mature_month: "2026-10" }); // the cut-off is itself a month end
    expect(matureCutoff("2026-03-01", 0)).toEqual({ cutoff: "2026-03-01", mature_through: "2026-02-28", mature_month: "2026-02" }); // 'none': every month already over
    expect(matureCutoff("2027-01-20", 20).mature_through).toBe("2026-12-31"); // crosses a year
    expect(matureCutoff("2027-01-10", 20).mature_through).toBe("2026-11-30"); // 21 Dec is not a month end: December is not mature yet
  });
});

describe("deal.cycle", () => {
  it("gives median, mean, P75, P90 of the Won deals and the cut-off of the milestone (all types together)", async () => {
    const r = await mgrA("deal.cycle", { milestone: "p75" });
    expect(r.won_count).toBe(14);
    expect(r.stats).toMatchObject({ median: expect.any(Number) });
    const all = cycleStats([...Array.from({ length: 11 }, (_, i) => (i + 1) * 10), 5, 5, 5])!;
    expect(r.stats).toEqual({ median: all.median, mean: all.mean, p75: all.p75, p90: all.p90 });
    expect(r.days).toBe(all.p75);
    expect(r.defaulted).toBe(false);
    expect(r.today).toBe(today);
    expect(r).toMatchObject(matureCutoff(today, all.p75));
  });
  it("is by deal type: 11 Won deals use their own cycle, 3 fall back to 90 days; 'none' waits for nothing", async () => {
    const r = await mgrA("deal.cycle", { milestone: "median" });
    const pod = r.by_type.find((x: { type: string }) => x.type === "POD bán mới");
    const data = r.by_type.find((x: { type: string }) => x.type === "Data");
    expect(pod).toMatchObject({ won_count: 11, days: 60, defaulted: false, stats: { median: 60, mean: 60, p75: 85, p90: 100 } });
    expect(data).toMatchObject({ won_count: 3, days: CYCLE_DEFAULT_DAYS, defaulted: true });
    const one = await mgrA("deal.cycle", { milestone: "p90", deal_type: "POD bán mới" });
    expect(one).toMatchObject({ deal_type: "POD bán mới", days: 100, won_count: 11 });
    const small = await mgrA("deal.cycle", { milestone: "mean", deal_type: "Data" });
    expect(small).toMatchObject({ days: CYCLE_DEFAULT_DAYS, defaulted: true });
    const none = await mgrA("deal.cycle", { milestone: "none" });
    expect(none).toMatchObject({ days: 0, cutoff: today, defaulted: false });
  });
  it("a member of the tree reads it too (durations only); another tree, Admin and Guest do not", async () => {
    const a = await userA1("deal.cycle", { milestone: "median" });
    const l = await leaderA("deal.cycle", { milestone: "median" });
    const m = await mgrA("deal.cycle", { milestone: "median" });
    expect(a.stats).toEqual(m.stats);
    expect(l.days).toBe(m.days);
    expect(Object.keys(a).sort()).toEqual(Object.keys(m).sort());
    for (const who of [admin, guest]) expect((await fails(who("deal.cycle", { milestone: "median" }))).code).toBe("forbidden");
    // a member of another tree sees the cycle of THEIR tree: no Manager here has Won deals in it, so only the default applies
    const b = await userB1("deal.cycle", { milestone: "median" });
    expect(b).toMatchObject({ won_count: 0, stats: null, days: CYCLE_DEFAULT_DAYS, defaulted: true });
  });
});
