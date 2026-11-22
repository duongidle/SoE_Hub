import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, fails, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 8B: AI Hub skills on the post engine (design module8 4, 5). Invented data only. */
let t: TestApp;
let org: Org;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let guestSale: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.mgrA, org.guestSale]) await unlimit(t, p.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  guestSale = as(t, org.guestSale.id);
});
afterAll(async () => {
  await t.close();
});

const uniq = () => randomUUID().slice(0, 8).replace(/[0-9]/g, "x");
const DESC = "Soạn email chào hàng cho khách mới. Dùng khi sale cần viết email đầu tiên cho một khách.";
const skillMd = (name: string, desc = DESC, body = "# Email chào hàng\n\nXem mẫu ở [mẫu](references/mau.md).\n") => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
const pkg = (name: string, extra: Record<string, { content: string }> = {}) => [
  { path: "SKILL.md", content: skillMd(name) },
  { path: "references/mau.md", content: "Kính gửi anh/chị, cảm ơn đã quan tâm." },
  ...Object.entries(extra).map(([path, v]) => ({ path, content: v.content })),
];
const base = (name: string, o: Record<string, unknown> = {}) => ({ files: pkg(name), group: "sales", version: "1.0.0", tags: ["email"], clients: ["claude_code"], ...o });
const zipOf = async (files: Record<string, string>) => {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(p, c);
  return (await z.generateAsync({ type: "nodebuffer" })).toString("base64");
};

describe("AI Hub skills", () => {
  it("a valid zip is posted, a reviewer approves, it is found, and the download/skill_get give back the right files", async () => {
    const name = `email-${uniq()}`;
    const zip_base64 = await zipOf({ [`${name}/SKILL.md`]: skillMd(name), [`${name}/references/mau.md`]: "Kính gửi anh/chị." });
    const sent = await userA1("skill.package.submit", { zip_base64, group: "sales", clients: ["claude_code"], tags: ["Email"] });
    expect(sent.status).toBe("pending");
    expect(((await mgrA("review.queue", { kind: "skill" })).items as { post_id: string }[]).map((x) => x.post_id)).toContain(sent.post_id);
    await mgrA("review.decide", { post_id: sent.post_id, decision: "approve" });
    const found = (await userA2("skill.package.search", { q: "chao hang email", group: "sales" })).items as { id: string; name: string }[];
    expect(found.map((x) => x.name)).toContain(name);
    const got = await userA2("skill.package.get", { id: sent.post_id, include_files: true });
    expect(got.skill_md).toContain(`name: ${name}`);
    expect(got.tree.map((x: { path: string }) => x.path)).toEqual(["SKILL.md", "references/mau.md"]);
    expect(got.install.claude_code).toContain(`~/.claude/skills/${name}`);
    expect(got.files.find((f: { path: string }) => f.path === "references/mau.md").content).toBe("Kính gửi anh/chị.");
    const dl = await userA2("skill.package.download", { id: sent.post_id });
    const back = await JSZip.loadAsync(Buffer.from(dl.content_base64, "base64"));
    expect(Object.values(back.files).filter((f) => !f.dir).map((f) => f.name).sort()).toEqual(["SKILL.md", "references/mau.md"]);
    expect((await userA2("skill.package.search", { q: name })).items[0].download_count).toBe(1);
    const tk = await activeToken(t, org.userA2.id, [], { menus: { aihub: "read" }, name: "claude-cai" });
    const r = await t.app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tk.token}` }, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "skill_get", arguments: { id: sent.post_id } } } });
    const files = r.json().result.structuredContent.files as { path: string; content: string }[];
    expect(files.map((f) => f.path)).toEqual(["SKILL.md", "references/mau.md"]);
  });

  it("a .env file or a key blocks the send (error has the file path, the key is never echoed); a hostile zip path is refused", async () => {
    const key = "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1";
    const e = await fails(userA1("skill.package.submit", base(`khoa-${uniq()}`, { files: [...pkg(`khoa-${uniq()}`), { path: ".env", content: "A=1" }, { path: "scripts/run.sh", content: `export T=${key}` }] })));
    expect(e.code).toBe("validation_error");
    const errs = e.details.errors as { code: string; path: string }[];
    expect(errs).toEqual(expect.arrayContaining([expect.objectContaining({ code: "forbidden_file", path: ".env" }), expect.objectContaining({ code: "secret_found", path: "scripts/run.sh" })]));
    expect(JSON.stringify(e.details)).not.toContain(key);
    const evil = await fails(userA1("skill.package.save", { zip_base64: await zipOf({ "SKILL.md": skillMd("x-skill"), "../evil.md": "x" }) }));
    expect(evil.code).toBe("validation_error");
  });

  it("a personal path and a look-alike skill only warn; the warnings reach the reviewer in review.get; same name cannot go live twice", async () => {
    const name = `bao-gia-${uniq()}`;
    const first = await userA1("skill.package.submit", base(name));
    await mgrA("review.decide", { post_id: first.post_id, decision: "approve" });
    const files = [{ path: "SKILL.md", content: skillMd(name, DESC, "# Ghi chú\n\nLưu tại /Users/vidu/Desktop/mau.\n") }];
    const sent = await userA2("skill.package.submit", { files, group: "sales", version: "1.0.0" });
    expect(sent.status).toBe("pending");
    const codes = (sent.check.warnings as { code: string }[]).map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["personal_path", "similar_skill"]));
    const rv = await mgrA("review.get", { post_id: sent.post_id });
    expect((rv.warnings as { code: string }[]).map((w) => w.code)).toEqual(expect.arrayContaining(["personal_path", "similar_skill"]));
    const clash = await fails(mgrA("review.decide", { post_id: sent.post_id, decision: "approve" }));
    expect(clash.details.reason).toBe("skill_name_taken");
  });

  it("check_only creates nothing", async () => {
    const before = (await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM posts`)).rows[0];
    const bad = await userA1("skill.package.submit", { files: [{ path: "README.md", content: "x" }], check_only: true });
    expect(bad).toMatchObject({ check_only: true, ok: false });
    expect(bad.errors.map((x: { code: string }) => x.code)).toContain("skill_md_missing");
    expect(await userA1("skill.package.submit", { ...base(`ok-${uniq()}`), check_only: true })).toMatchObject({ ok: true });
    expect((await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM posts`)).rows[0]).toEqual(before);
  });

  it("a Guest cannot read AI Hub", async () => {
    expect((await fails(guestSale("skill.package.search", {}))).code).toBe("forbidden");
  });
});
