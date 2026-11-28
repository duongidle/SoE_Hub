import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { files, newId } from "@soe/db";
import { as, fails } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 11A: feedback (design module11 1-4, 7). Invented data only. */
let t: TestApp;
let org: Org;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;
let admin2: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  admin = as(t, org.admin.id);
  admin2 = as(t, org.admin2.id);
  guest = as(t, org.guestSale.id);
});
afterAll(async () => {
  await t.close();
});

const send = (who: typeof userA1, o: Record<string, unknown> = {}) => who("feedback.create", { kind: "bug", body: "Nút lưu không phản hồi.", ...o }) as Promise<{ id: string; version: number; status: string }>;
const notes = async (who: typeof userA1, type: string, feedbackId: string) =>
  ((await who("notification.list", { limit: 100 })).items as { type: string; data: { feedback_id?: string } | null }[]).filter((n) => n.type === type && n.data?.feedback_id === feedbackId).length;
async function addFile(ownerId: string, o: { contentType?: string; size?: number; status?: "ready" | "pending" } = {}) {
  const id = newId();
  await t.c.db.db.insert(files).values({ id, ownerId, createdBy: ownerId, updatedBy: ownerId, storageKey: `files/${id}`, filename: "anh.png", contentType: o.contentType ?? "image/png", sizeBytes: o.size ?? 1000, status: o.status ?? "ready" });
  return id;
}
const ids = (r: unknown) => ((r as { items: { id: string }[] }).items).map((x) => x.id);

describe("feedback: sending and seeing", () => {
  it("a person sees only their own feedback; another person cannot read it", async () => {
    const f = await send(userA1);
    expect(f.status).toBe("new");
    expect(ids(await userA1("feedback.mine", {}))).toContain(f.id);
    expect(ids(await userA2("feedback.mine", {}))).not.toContain(f.id);
    expect((await fails(userA2("feedback.get", { id: f.id }))).code).toBe("not_found");
    expect((await fails(userA2("feedback.message.create", { feedback_id: f.id, body: "chen vào" }))).code).toBe("not_found");
    expect(((await userA1("feedback.get", { id: f.id })) as { can_manage: boolean }).can_manage).toBe(false);
  });

  it("without feedback:inbox:manage, list, status.set and get of someone else are refused; an Admin handles them", async () => {
    const f = await send(userA1);
    for (const who of [userA1, mgrA, guest]) expect((await fails(who("feedback.list", {}))).code).toBe("forbidden");
    expect((await fails(userA1("feedback.status.set", { id: f.id, status: "viewing", version: f.version }))).code).toBe("forbidden");
    expect(ids(await admin("feedback.list", {}))).toContain(f.id);
    const g = (await admin("feedback.get", { id: f.id })) as { can_manage: boolean; author: { id: string } };
    expect(g.can_manage).toBe(true);
    expect(g.author.id).toBe(org.userA1.id);
    const upd = (await admin("feedback.status.set", { id: f.id, status: "viewing", version: f.version })) as { status: string; version: number };
    expect(upd.status).toBe("viewing");
    expect((await fails(admin("feedback.status.set", { id: f.id, status: "done", version: f.version }))).code).toBe("conflict");
  });

  it("the inbox defaults to New + Viewing and filters by kind and status, newest first, with keyset pages", async () => {
    const a = await send(userA2, { kind: "feature", body: "Thêm bộ lọc theo tuần." });
    const b = await send(userA2, { kind: "suggestion", body: "Màu chữ nhạt quá." });
    await admin("feedback.status.set", { id: b.id, status: "done", version: b.version });
    const open = ids(await admin("feedback.list", { limit: 100 }));
    expect(open).toContain(a.id);
    expect(open).not.toContain(b.id);
    expect(ids(await admin("feedback.list", { status: "done", limit: 100 }))).toContain(b.id);
    const feats = ids(await admin("feedback.list", { kind: "feature", status: "all", limit: 100 }));
    expect(feats).toContain(a.id);
    expect(feats).not.toContain(b.id);
    const p1 = (await admin("feedback.list", { status: "all", limit: 2 })) as { items: { id: string }[]; nextCursor: string | null };
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await admin("feedback.list", { status: "all", limit: 2, cursor: p1.nextCursor })) as { items: { id: string }[] };
    expect(p2.items.map((x) => x.id).filter((x) => p1.items.some((y) => y.id === x))).toEqual([]);
  });

  it("a Guest can send; the body is required and limited to 5000 characters", async () => {
    const f = await send(guest, { kind: "feature" });
    expect(ids(await guest("feedback.mine", {}))).toContain(f.id);
    expect((await fails(send(userA1, { body: "   " }))).code).toBe("validation_error");
    expect((await fails(send(userA1, { body: "x".repeat(5001) }))).code).toBe("validation_error");
    await send(userA1, { body: "x".repeat(5000) });
  });

  it("withdrawing works only for the sender and only while the status is New", async () => {
    const f = await send(userA1);
    expect((await fails(userA2("feedback.withdraw", { id: f.id, version: f.version }))).code).toBe("not_found");
    expect((await fails(admin("feedback.withdraw", { id: f.id, version: f.version }))).code).toBe("not_found");
    const g = await send(userA1);
    const s = (await admin("feedback.status.set", { id: g.id, status: "viewing", version: g.version })) as { version: number };
    const e = await fails(userA1("feedback.withdraw", { id: g.id, version: s.version }));
    expect(e.code).toBe("conflict");
    expect(e.details.reason).toBe("not_new");
    await userA1("feedback.withdraw", { id: f.id, version: f.version });
    expect(ids(await userA1("feedback.mine", {}))).not.toContain(f.id);
    expect((await fails(admin("feedback.get", { id: f.id }))).code).toBe("not_found");
  });
});

describe("feedback: images", () => {
  it("accepts up to 3 of the sender's own ready images; refuses others, non-images and big files", async () => {
    const own = await addFile(org.userA1.id);
    const other = await addFile(org.userA2.id);
    const pdf = await addFile(org.userA1.id, { contentType: "application/pdf" });
    const big = await addFile(org.userA1.id, { size: 6 * 1024 * 1024 });
    const pending = await addFile(org.userA1.id, { status: "pending" });
    const f = await send(userA1, { file_ids: [own] });
    expect(((await userA1("feedback.get", { id: f.id })) as { files: { id: string }[] }).files.map((x) => x.id)).toEqual([own]);
    for (const bad of [other, pdf, big, pending]) expect((await fails(send(userA1, { file_ids: [bad] }))).code).toBe("validation_error");
    const four = await Promise.all([1, 2, 3, 4].map(() => addFile(org.userA1.id)));
    expect((await fails(send(userA1, { file_ids: four }))).code).toBe("validation_error");
    await send(userA1, { file_ids: four.slice(0, 3) });
  });

  it("the handler downloads the attachment through feedback.file.url; a stranger cannot", async () => {
    const own = await addFile(org.userA1.id);
    const f = await send(userA1, { file_ids: [own] });
    // The file itself stays private to its owner.
    expect((await fails(admin("file.download.url", { id: own }))).code).toBe("not_found");
    const u = (await admin("feedback.file.url", { feedback_id: f.id, file_id: own })) as { url: string };
    expect(u.url).toBeTruthy();
    expect(((await userA1("feedback.file.url", { feedback_id: f.id, file_id: own })) as { url: string }).url).toBeTruthy();
    expect((await fails(userA2("feedback.file.url", { feedback_id: f.id, file_id: own }))).code).toBe("not_found");
    expect((await fails(admin("feedback.file.url", { feedback_id: f.id, file_id: newId() }))).code).toBe("not_found");
  });
});

describe("feedback: thread and notifications", () => {
  it("new feedback notifies every handler (not the sender); a reply and a status change notify the sender", async () => {
    const f = await send(userA1);
    expect(await notes(admin, "feedback.new", f.id)).toBe(1);
    expect(await notes(admin2, "feedback.new", f.id)).toBe(1);
    expect(await notes(userA1, "feedback.new", f.id)).toBe(0);
    await admin("feedback.message.create", { feedback_id: f.id, body: "Cậu gửi ảnh chụp màn hình giúp tớ." });
    expect(await notes(userA1, "feedback.update", f.id)).toBe(1);
    await admin("feedback.status.set", { id: f.id, status: "planned", version: f.version });
    expect(await notes(userA1, "feedback.update", f.id)).toBe(2);
    expect(await notes(admin, "feedback.update", f.id)).toBe(0);
  });

  it("the sender writing back reaches the handlers who already replied; with no reply yet, every handler", async () => {
    const f = await send(userA2);
    const before2 = await notes(admin2, "feedback.new", f.id);
    await userA2("feedback.message.create", { feedback_id: f.id, body: "Bổ sung: lỗi chỉ xảy ra trên điện thoại." });
    expect(await notes(admin, "feedback.new", f.id)).toBe(2);
    expect(await notes(admin2, "feedback.new", f.id)).toBe(before2 + 1);
    await admin("feedback.message.create", { feedback_id: f.id, body: "Đã nhận." });
    await userA2("feedback.message.create", { feedback_id: f.id, body: "Cảm ơn." });
    expect(await notes(admin, "feedback.new", f.id)).toBe(3);
    expect(await notes(admin2, "feedback.new", f.id)).toBe(before2 + 1);
    const g = (await userA2("feedback.get", { id: f.id })) as { messages: { from_author: boolean; body: string }[] };
    expect(g.messages.map((m) => m.from_author)).toEqual([true, false, true]);
    expect((await fails(userA2("feedback.message.create", { feedback_id: f.id, body: "y".repeat(5001) }))).code).toBe("validation_error");
  });
});

describe("feedback: handler permission is a supplementary grant", () => {
  it("only an Admin grants it, only to Manager/Leader/User; the grantee then handles the inbox and is notified", async () => {
    expect((await fails(mgrA("org.permission.grant", { id: org.userA1.id, permission: "feedback:inbox:manage" }))).code).toBe("forbidden");
    expect((await fails(admin("org.permission.grant", { id: org.guestSale.id, permission: "feedback:inbox:manage" }))).code).toBe("validation_error");
    await admin("org.permission.grant", { id: org.userB1.id, permission: "feedback:inbox:manage" });
    const userB1 = as(t, org.userB1.id);
    const f = await send(userA1);
    expect(ids(await userB1("feedback.list", {}))).toContain(f.id);
    expect(await notes(userB1, "feedback.new", f.id)).toBe(1);
    await userB1("feedback.message.create", { feedback_id: f.id, body: "Tớ xem rồi." });
    expect(await notes(userA1, "feedback.update", f.id)).toBe(1);
    await admin("org.permission.revoke", { id: org.userB1.id, permission: "feedback:inbox:manage" });
    expect((await fails(userB1("feedback.list", {}))).code).toBe("forbidden");
  });
});

describe("org.permission.holders", () => {
  type Group = { permission: string; can_manage: boolean; by_roles: string[]; holders: { user_id: string; writable: boolean }[] };
  const group = (r: unknown, p: string) => (r as Group[]).find((g) => g.permission === p)!;

  it("lists holders inside the viewer's tree and flags what the viewer may change", async () => {
    await mgrA("org.permission.grant", { id: org.userA1.id, permission: "onboarding:path:create" });
    await admin("org.permission.grant", { id: org.leaderA.id, permission: "feedback:inbox:manage" });
    const m = await mgrA("org.permission.holders", {});
    expect(group(m, "onboarding:path:create").holders.map((h) => h.user_id)).toContain(org.userA1.id);
    expect(group(m, "onboarding:path:create").holders.find((h) => h.user_id === org.userA1.id)!.writable).toBe(true);
    const fb = group(m, "feedback:inbox:manage");
    expect(fb.can_manage).toBe(false);
    expect(fb.holders.map((h) => h.user_id)).toContain(org.leaderA.id);
    expect(fb.holders.every((h) => !h.writable)).toBe(true);
    expect(group(m, "knowledge:article:review").by_roles).toContain("manager");
    // Another tree does not see tree A.
    const b = await mgrB("org.permission.holders", {});
    expect(group(b, "onboarding:path:create").holders.map((h) => h.user_id)).not.toContain(org.userA1.id);
    expect(group(b, "feedback:inbox:manage").holders.map((h) => h.user_id)).not.toContain(org.leaderA.id);
    // The Admin sees all and changes the Admin-only grants.
    const a = await admin("org.permission.holders", {});
    expect(group(a, "feedback:inbox:manage").can_manage).toBe(true);
    expect(group(a, "feedback:inbox:manage").holders.find((h) => h.user_id === org.leaderA.id)!.writable).toBe(true);
    // A User cannot ask.
    expect((await fails(userA1("org.permission.holders", {}))).code).toBe("forbidden");
    await admin("org.permission.revoke", { id: org.leaderA.id, permission: "feedback:inbox:manage" });
    await mgrA("org.permission.revoke", { id: org.userA1.id, permission: "onboarding:path:create" });
  });
});
