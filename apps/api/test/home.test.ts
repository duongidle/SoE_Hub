import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 12D-1: per-person preferences (pinned dashboard tabs) and "Mở gần đây". Invented data only.
 * A person reads and writes only their own; a recent item the person may no longer open is filtered out when read.
 */
let t: TestApp;
let org: Org;
let a1: ReturnType<typeof as>;
let a2: ReturnType<typeof as>;
let dhId: string;
let dashId: string;
let dash2Id: string;
let formId: string;

const ids = (r: { items: { id: string }[] }) => r.items.map((x) => x.id);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  await unlimit(t, org.userA2.id);
  a1 = as(t, org.userA1.id);
  a2 = as(t, org.userA2.id);
  const x = await makeTable(a1, { name: "Bảng trang chủ", columns: [{ name: "Mã", type: "text" }] });
  dhId = x.dhId;
  dashId = (await a1("metrics.dashboard.create", { datahub_id: dhId, name: "Dash một" })).id;
  dash2Id = (await a1("metrics.dashboard.create", { datahub_id: dhId, name: "Dash hai" })).id;
  formId = (await a1("form.form.create", { name: "Form trang chủ" })).id;
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("pinned dashboard tabs (home.prefs, home.tabs.list)", () => {
  it("starts empty, keeps the order, drops duplicates", async () => {
    expect((await a1("home.prefs.get", { key: "home.dashboard_tabs" })).value).toEqual([]);
    const set = await a1("home.prefs.set", { key: "home.dashboard_tabs", value: [dash2Id, dashId, dash2Id] });
    expect(set.value).toEqual([dash2Id, dashId]);
    expect((await a1("home.prefs.get", { key: "home.dashboard_tabs" })).value).toEqual([dash2Id, dashId]);
    const tabs = await a1("home.tabs.list");
    expect(tabs.items.map((x: { id: string; name: string; role: string }) => [x.id, x.name, x.role])).toEqual([[dash2Id, "Dash hai", "owner"], [dashId, "Dash một", "owner"]]);
  });

  it("lists my own dashboards across datahubs, nobody else's", async () => {
    expect(ids(await a1("home.dashboards.mine"))).toEqual(expect.arrayContaining([dashId, dash2Id]));
    expect(ids(await a2("home.dashboards.mine"))).not.toContain(dashId);
  });

  it("another person has their own, empty preferences and cannot pin a dashboard that is not theirs", async () => {
    expect((await a2("home.prefs.get", { key: "home.dashboard_tabs" })).value).toEqual([]);
    expect((await a2("home.tabs.list")).items).toEqual([]);
    expect((await fails(a2("home.prefs.set", { key: "home.dashboard_tabs", value: [dashId] }))).details.reason).toBe("pin_not_own");
    // a dashboard shared with me is seen on the shared tab, not pinned
    await a1("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id });
    expect((await fails(a2("home.prefs.set", { key: "home.dashboard_tabs", value: [dashId] }))).details.reason).toBe("pin_not_own");
    expect((await a1("home.prefs.get", { key: "home.dashboard_tabs" })).value).toEqual([dash2Id, dashId]);
  });

  it("refuses unknown keys, bad values and more than 20 tabs; the server-only key `recent` is not writable", async () => {
    expect((await fails(a1("home.prefs.set", { key: "recent", value: [] }))).code).toBe("validation_error");
    expect((await fails(a1("home.prefs.set", { key: "home.dashboard_tabs", value: ["x"] }))).code).toBe("validation_error");
    expect((await fails(a1("home.prefs.set", { key: "home.dashboard_tabs", value: Array.from({ length: 21 }, () => dashId) }))).code).toBe("validation_error");
    expect((await fails(a1("home.prefs.get", { key: "recent" }))).code).toBe("validation_error");
  });

  it("a deleted dashboard drops out of the tabs", async () => {
    await a1("metrics.dashboard.delete", { dashboard_id: dash2Id });
    expect(ids(await a1("home.tabs.list"))).toEqual([dashId]);
  });
});

describe("recent (home.recent.touch, home.recent.list)", () => {
  it("records what I open, newest first, one entry per item, at most 20", async () => {
    expect((await a1("home.recent.touch", { type: "datahub", id: dhId })).recorded).toBe(true);
    expect((await a1("home.recent.touch", { type: "form", id: formId })).recorded).toBe(true);
    expect((await a1("home.recent.touch", { type: "dashboard", id: dashId })).recorded).toBe(true);
    const list = (await a1("home.recent.list")).items as { type: string; id: string; name: string }[];
    expect(list.map((e) => [e.type, e.id, e.name])).toEqual([["dashboard", dashId, "Dash một"], ["form", formId, "Form trang chủ"], ["datahub", dhId, "Bảng trang chủ"]]);
    // opening the first one again straight away writes nothing; opening an older one moves it to the top
    expect((await a1("home.recent.touch", { type: "dashboard", id: dashId })).recorded).toBe(false);
    await a1("home.recent.touch", { type: "datahub", id: dhId });
    expect(((await a1("home.recent.list")).items as { id: string }[]).map((e) => e.id)).toEqual([dhId, dashId, formId]);
    // the stored list is capped at 20 (older entries fall off)
    const old = Array.from({ length: 30 }, (_v, n) => ({ type: "datahub", id: `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`, at: "2026-01-01T00:00:00.000Z" }));
    await t.c.db.db.execute(sql`UPDATE user_prefs SET value = ${JSON.stringify(old)}::jsonb WHERE /*scope:system*/ user_id = ${org.userA1.id}::uuid AND key = 'recent'`);
    await a1("home.recent.touch", { type: "form", id: formId });
    const stored = (await t.c.db.db.execute(sql`SELECT value FROM user_prefs WHERE /*scope:system*/ user_id = ${org.userA1.id}::uuid AND key = 'recent'`)).rows[0] as { value: { id: string }[] };
    expect(stored.value).toHaveLength(20);
    expect(stored.value[0]!.id).toBe(formId);
  });

  it("cannot record something I cannot open", async () => {
    expect((await fails(a2("home.recent.touch", { type: "datahub", id: dhId }))).code).toBe("not_found");
    expect((await fails(a2("home.recent.touch", { type: "form", id: formId }))).code).toBe("not_found");
    expect((await a2("home.recent.list")).items).toEqual([]);
  });

  it("the list is private: the other person's list is their own", async () => {
    await a2("home.recent.touch", { type: "dashboard", id: dashId }); // shared with a2 above
    expect((await a2("home.recent.list")).items.map((e: { id: string }) => e.id)).toEqual([dashId]);
    expect((await a1("home.recent.list")).items.every((e: { at: string }) => typeof e.at === "string")).toBe(true);
  });

  it("an item whose right was withdrawn (share removed, dashboard or datahub gone) is filtered out when read, not shown by name", async () => {
    const shares = (await a1("metrics.dashboard.share.list", { dashboard_id: dashId })).items as { id: string }[];
    for (const s of shares) await a1("metrics.dashboard.share.remove", { dashboard_id: dashId, share_id: s.id });
    expect((await a2("home.recent.list")).items).toEqual([]);
    // the owner's dashboard deleted: gone from the owner's list too
    const d3 = (await a1("metrics.dashboard.create", { datahub_id: dhId, name: "Dash ba" })).id;
    await a1("home.recent.touch", { type: "dashboard", id: d3 });
    expect(ids(await a1("home.recent.list"))).toContain(d3);
    await a1("metrics.dashboard.delete", { dashboard_id: d3 });
    expect(ids(await a1("home.recent.list"))).not.toContain(d3);
  });

  it("an article: the reader needs the right to read it; the author sees their own draft", async () => {
    const draft = await a1("knowledge.article.save", {
      title: "Bài trang chủ thử",
      summary: "Tóm tắt thử cho bài.",
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Quy trình tạo deal mới gồm nhiều bước: kiểm tra khách hàng, nhập thông tin cơ bản, chọn người tham gia và xác nhận tỉ lệ com với quản lý. ".repeat(3) }] }] },
      category: "business",
      type: "guide",
      tags: ["deal"],
    });
    const post = draft.post_id as string;
    expect((await a1("home.recent.touch", { type: "article", id: post })).recorded).toBe(true);
    expect((await a1("home.recent.list")).items.find((e: { id: string }) => e.id === post)?.name).toBe("Bài trang chủ thử");
    // another person cannot open an unpublished draft, so it is neither recorded nor listed
    expect((await fails(a2("home.recent.touch", { type: "article", id: post }))).code).toBe("not_found");
  });
});
