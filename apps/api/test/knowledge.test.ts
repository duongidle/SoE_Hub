import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 8A: the post engine and Knowledge (design module8 2, 3, 5, 6). Invented data only.
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1. GuestSale, GuestData, Admin outside.
 */
let t: TestApp;
let org: Org;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;
let guestSale: ReturnType<typeof as>;
let guestData: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.mgrA, org.mgrB, org.admin, org.guestSale, org.guestData]) await unlimit(t, p.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  admin = as(t, org.admin.id);
  guestSale = as(t, org.guestSale.id);
  guestData = as(t, org.guestData.id);
});
afterAll(async () => {
  await t.close();
});

const PARA = "Quy trình tạo deal mới gồm nhiều bước: kiểm tra khách hàng, nhập thông tin cơ bản, chọn người tham gia và xác nhận tỉ lệ com với quản lý. ";
const longText = (extra = "") => PARA.repeat(3) + extra;
const doc = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Các bước" }] }, { type: "paragraph", content: [{ type: "text", text }] }] });
const uniq = () => randomUUID().slice(0, 8);
/** A valid article input; `tag` makes the title and the words unique to the test. */
const art = (o: Record<string, unknown> = {}) => ({ title: `Hướng dẫn tạo deal ${uniq()}`, summary: "Cách tạo một deal mới từ đầu đến cuối.", body: doc(longText()), category: "business", type: "guide", tags: ["deal"], ...o });
const countType = async (who: typeof userA1, type: string) => (((await who("notification.list", { limit: 100 })).items as { type: string }[]).filter((n) => n.type === type)).length;

/** Creates an article as `who` and sends it; returns its id. */
async function draft(who: typeof userA1, o: Record<string, unknown> = {}) {
  const r = await who("knowledge.article.save", art(o));
  return r.post_id as string;
}
async function publish(author: typeof userA1, o: Record<string, unknown> = {}) {
  const id = await draft(author, o);
  await author("knowledge.article.submit", { id });
  await mgrA("review.decide", { post_id: id, decision: "approve" });
  return id;
}

describe("knowledge and the post engine", () => {
  it("an error blocks the send (structured, nothing saved); a warning does not and reaches the reviewer in review.get", async () => {
    const e = await fails(userA1("knowledge.article.submit", { title: "", summary: "x", body: "ngắn", category: null }));
    expect(e.code).toBe("validation_error");
    const errs = e.details.errors as { code: string; path: string; message: string; hint: string }[];
    expect(errs.map((x) => x.code)).toEqual(expect.arrayContaining(["title_required", "category_required", "body_too_short"]));
    for (const x of errs) expect(Object.keys(x)).toEqual(expect.arrayContaining(["code", "message", "path", "hint"]));
    expect(((await userA1("knowledge.article.mine", {})).items as unknown[]).length).toBe(0);
    const secret = "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1";
    const sec = await fails(userA1("knowledge.article.submit", art({ body: doc(longText(`Khoá: ${secret}`)) })));
    expect(sec.details.errors.map((x: { code: string }) => x.code)).toContain("secret_found");
    expect(JSON.stringify(sec.details)).not.toContain(secret);

    const id = await draft(userA1, { for_sale: true, body: doc(longText("Liên hệ chị Lan qua lan@vidu.vn.")) });
    const sent = await userA1("knowledge.article.submit", { id });
    expect(sent.status).toBe("pending");
    expect(sent.check.warnings.map((w: { code: string }) => w.code)).toEqual(["for_sale_contact_info"]);
    const rv = await mgrA("review.get", { post_id: id });
    expect(rv.warnings.map((w: { code: string }) => w.code)).toEqual(["for_sale_contact_info"]);
    expect(rv.notice).toMatch(/không phải chỉ dẫn/);
  });

  it("send -> return (reason required) -> resubmit -> approve -> published; notifications reach reviewers and the author", async () => {
    const pending = await countType(mgrA, "post.pending");
    const returned = await countType(userA1, "post.returned");
    const id = await draft(userA1);
    await userA1("knowledge.article.submit", { id });
    expect(await countType(mgrA, "post.pending")).toBe(pending + 1);
    expect((await fails(mgrA("review.decide", { post_id: id, decision: "return" }))).details.reason).toBe("reason_required");
    await mgrA("review.decide", { post_id: id, decision: "return", reason: "Thiếu ví dụ." });
    expect(await countType(userA1, "post.returned")).toBe(returned + 1);
    expect(((await userA1("knowledge.article.mine", {})).items as { id: string; state: string }[]).find((x) => x.id === id)!.state).toBe("returned");
    await userA1("knowledge.article.submit", { id });
    await mgrA("review.decide", { post_id: id, decision: "approve" });
    expect(await userA2("knowledge.article.get", { id })).toMatchObject({ state: "published", version: 1 });
  });

  it("a revision does not replace the live version until approved; the old version stays readable", async () => {
    const id = await publish(userA1);
    const old = (await userA2("knowledge.article.get", { id })).content.title as string;
    await userA1("knowledge.article.save", { id, title: old + " (sửa)" });
    await userA1("knowledge.article.submit", { id });
    expect(await userA2("knowledge.article.get", { id })).toMatchObject({ version: 1, content: { title: old } });
    expect(await mgrA("review.get", { post_id: id })).toMatchObject({ version: 2, is_revision: true, live: { version: 1 } });
    await mgrA("review.decide", { post_id: id, decision: "approve" });
    expect((await userA2("knowledge.article.get", { id })).content.title).toBe(old + " (sửa)");
    expect((await userA2("post.version.get", { post_id: id, version: 1 })).content.title).toBe(old);
  });

  it("a reviewer's own article is published at once, checks still run", async () => {
    expect((await fails(mgrA("knowledge.article.submit", art({ title: "" })))).details.errors.map((x: { code: string }) => x.code)).toContain("title_required");
    expect(await mgrA("knowledge.article.submit", art())).toMatchObject({ status: "published", published: true });
  });

  it("a Manager of another tree reviews; a User without the right cannot", async () => {
    const b = as(t, org.userB1.id);
    const id = await draft(b);
    await b("knowledge.article.submit", { id });
    expect((await fails(userA2("review.decide", { post_id: id, decision: "approve" }))).code).toBe("forbidden");
    expect((await mgrA("review.decide", { post_id: id, decision: "approve" })).status).toBe("published");
  });

  it("search finds without accents and shows a snippet; archive hides, unpublish returns a draft, with an audit trail", async () => {
    const word = `kiemthu${uniq()}`;
    const id = await publish(userA1, { title: `Hướng dẫn nhập liệu ${word}` });
    const hit = (await userA2("knowledge.article.search", { q: "huong dan nhap lieu " + word })).items as { id: string; snippet?: string }[];
    expect(hit.map((x) => x.id)).toEqual([id]);
    await userA1("post.archive", { post_id: id });
    expect((await userA2("knowledge.article.search", { q: word })).items).toHaveLength(0);
    await userA1("post.restore", { post_id: id });
    expect((await mgrA("post.unpublish", { post_id: id })).status).toBe("draft");
    expect((await userA2("knowledge.article.search", { q: word })).items).toHaveLength(0);
    const log = await t.c.db.db.execute(sql`SELECT details FROM audit_log WHERE command IN ('post.unpublish','post.archive','post.restore') AND target_id = ${id}`);
    expect((log.rows as { details: { action: string } }[]).map((r) => r.details.action).sort()).toEqual(["archive", "restore", "unpublish"]);
  });

  it("Guest Sale sees only for-sale articles; Guest Data reads nothing; Admin reads but cannot post", async () => {
    const word = `sale${uniq()}`;
    const open = await publish(userA1, { title: `Mở cho sale ${word}`, for_sale: true });
    const closed = await publish(userA1, { title: `Nội bộ ${word}` });
    expect(((await guestSale("knowledge.article.search", { q: word })).items as { id: string }[]).map((x) => x.id)).toEqual([open]);
    expect((await fails(guestSale("knowledge.article.get", { id: closed }))).code).toBe("not_found");
    expect((await fails(guestData("knowledge.article.search", { q: word }))).code).toBe("forbidden");
    expect(((await admin("knowledge.article.search", { q: word })).items as unknown[]).length).toBe(2);
    expect((await fails(admin("knowledge.article.save", art()))).code).toBe("forbidden");
  });

  it("check_only runs the rules and creates nothing", async () => {
    const before = (await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM posts`)).rows[0] as { n: number };
    const bad = await userA1("knowledge.article.submit", { ...art({ title: "" }), check_only: true });
    expect(bad).toMatchObject({ check_only: true, ok: false });
    expect(await userA1("knowledge.article.submit", { ...art(), check_only: true })).toMatchObject({ ok: true });
    expect((await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM posts`)).rows[0]).toEqual(before);
  });
});
void activeToken;
void drainOutbox;
