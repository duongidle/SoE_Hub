import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { fillToken, resetSpamState, SPAM } from "../src/modules/form";

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => resetSpamState());

const q = (id: string, input: string, extra: Record<string, unknown> = {}) => ({ id, type: "question", input, label: `Câu ${id}`, ...extra });
const cfgOf = (blocks: unknown[], title = "Form") => ({ schema: "soe-form/1", title, description: "", appearance: {}, blocks });

/** A form with a new table in a fresh datahub. */
async function newForm(name = `Form ${randomUUID().slice(0, 6)}`) {
  const dh = await a("datahub.datahub.create", { name: `DH ${randomUUID().slice(0, 8)}` });
  const f = await a("form.form.create", { name, datahub_id: dh.id });
  return { f, dh, tableId: f.table_id as string, id: f.id as string, code: f.code as string };
}
async function setup(blocks: unknown[], opts: { access?: string; audience?: unknown } = {}) {
  const x = await newForm();
  await a("form.form.save_draft", { form_id: x.id, config: cfgOf(blocks) });
  await a("form.question.create_columns", { form_id: x.id });
  await a("form.form.publish", { form_id: x.id });
  if (opts.access) await a("form.form.update", { form_id: x.id, access: opts.access, ...(opts.audience ? { audience: opts.audience } : {}) });
  return x;
}
const attempt = () => randomUUID();
const publicCall = (name: string, input: Record<string, unknown>, ip = "10.0.0.1") => t.c.executor.execute(name, input, { actor: null, requestId: randomUUID(), client: { via: "web", ip, userAgent: "vitest" } }).then((r) => r.result as any); // eslint-disable-line @typescript-eslint/no-explicit-any
const submitPublic = (code: string, answers: Record<string, unknown>, o: { ip?: string; ageMs?: number; website?: string; attempt?: string } = {}) =>
  publicCall("form.public.submit", { code, answers, attempt_id: o.attempt ?? attempt(), fill_token: fillToken(t.c.config.AUTH_SECRET, code, Date.now() - (o.ageMs ?? 10_000)), ...(o.website !== undefined ? { website: o.website } : {}) }, o.ip);
async function rows(tableId: string) {
  await drainOutbox(t);
  return (await a("datahub.row.list", { table_id: tableId })).items as { id: string; data: Record<string, unknown> }[];
}
const colKey = async (tableId: string, name: string) => ((await a("datahub.table.get", { table_id: tableId })).columns as { key: string; name: string }[]).find((c) => c.name === name)!.key;

describe("form: target table", () => {
  it("cannot target the Deals datahub, a shared table, a merged table or a template table", async () => {
    const dh = await a("datahub.datahub.create", { name: `Deal-like ${randomUUID().slice(0, 6)}` });
    const tb = await a("datahub.table.create", { datahub_id: dh.id, name: "T" });
    await t.c.db.db.execute(sql`UPDATE dh_datahubs SET /*scope:system*/ system_key = 'deal' WHERE id = ${dh.id}::uuid`);
    expect((await fails(a("form.form.create", { name: "F", table_id: tb.id }))).details.reason).toBe("form_target_deal");
    expect((await fails(a("form.form.create", { name: "F", datahub_id: dh.id }))).details.reason).toBe("form_target_deal");
    await t.c.db.db.execute(sql`UPDATE dh_datahubs SET /*scope:system*/ system_key = NULL WHERE id = ${dh.id}::uuid`);

    const other = as(t, org.userA2.id);
    await unlimit(t, org.userA2.id);
    const odh = await other("datahub.datahub.create", { name: `Của A2 ${randomUUID().slice(0, 6)}` });
    const otb = await other("datahub.table.create", { datahub_id: odh.id, name: "T" });
    await other("datahub.share.set", { datahub_id: odh.id, grantee_id: org.userA1.id, permission: "edit_data" });
    expect((await fails(a("form.form.create", { name: "F", table_id: otb.id }))).details.reason).toBe("form_target_shared");

    await t.c.db.db.execute(sql`UPDATE dh_tables SET /*scope:system*/ kind = 'merged' WHERE id = ${tb.id}::uuid`);
    expect((await fails(a("form.form.create", { name: "F", table_id: tb.id }))).details.reason).toBe("form_target_merged");
    await t.c.db.db.execute(sql`UPDATE dh_tables SET /*scope:system*/ kind = 'normal' WHERE id = ${tb.id}::uuid`);
    const ok = await a("form.form.create", { name: "F ok", table_id: tb.id });
    expect(ok.table_id).toBe(tb.id);
  });

  it("creating a form makes the table with the system column and a 10-character link", async () => {
    const x = await newForm("Khảo sát A");
    expect(x.code).toMatch(/^[a-z2-9]{10}$/);
    expect(x.f).toMatchObject({ status: "draft", state: "draft", table_name: expect.any(String), notify_new_response: false, response_count: 0 });
    const tb = await a("datahub.table.get", { table_id: x.tableId });
    expect(tb.name).toBe("Khảo sát A");
    expect(tb.columns.map((c: { name: string }) => c.name)).toContain("Phiên bản form");
    const other = await a("form.form.rotate_link", { form_id: x.id });
    expect(other.code).not.toBe(x.code);
    expect((await fails(publicCall("form.public.get", { code: x.code }))).code).toBe("not_found");
  });
});

describe("form: publish", () => {
  it("blocks an unlinked question, offers creating the columns, and names columns by the question", async () => {
    const x = await newForm();
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("q1", "text", { label: "Nhu cầu của bạn" }), q("q2", "text", { label: "Nhu cầu của bạn" }), q("q3", "single_select", { label: "Ngành [chính]", options: [{ label: "Vận tải" }, { label: "Bán lẻ" }] })]) });
    const err = await fails(a("form.form.publish", { form_id: x.id }));
    expect(err.code).toBe("validation_error");
    expect(err.details.issues.filter((i: { code: string }) => i.code === "unlinked_question")[0].message).toBe("Còn 3 câu chưa nối cột.");
    const made = await a("form.question.create_columns", { form_id: x.id });
    expect(made.created.map((c: { column_name: string }) => c.column_name)).toEqual(["Nhu cầu của bạn", "Nhu cầu của bạn (2)", "Ngành chính"]);
    const col = (await a("datahub.table.get", { table_id: x.tableId })).columns.find((c: { name: string }) => c.name === "Ngành chính");
    expect(col.type).toBe("single_select");
    expect(col.config.options.map((o: { name: string }) => o.name)).toEqual(["Vận tải", "Bán lẻ"]);
    const pub = await a("form.form.publish", { form_id: x.id });
    expect(pub).toMatchObject({ published_version: 1, status: "open" });
    const again = await a("form.form.publish", { form_id: x.id });
    expect(again.published_version).toBe(2);
    expect((await a("datahub.table.get", { table_id: x.tableId })).columns).toHaveLength(4); // 3 questions + Phiên bản form: publishing again makes no column
  });

  it("blocks a missing required column and a required column behind a condition; link options list only fitting free columns", async () => {
    const x = await newForm();
    const email = await a("datahub.column.create", { table_id: x.tableId, name: "Email", type: "email", required: true });
    await a("datahub.column.create", { table_id: x.tableId, name: "Ghi chú", type: "long_text" });
    await a("datahub.column.create", { table_id: x.tableId, name: "Số", type: "number" });
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("a", "single_select", { options: [{ label: "Có" }, { label: "Không" }] }), q("b", "text")]) });
    await a("form.question.create_columns", { form_id: x.id });
    const miss = await fails(a("form.form.publish", { form_id: x.id }));
    expect(miss.details.issues.map((i: { code: string }) => i.code)).toContain("required_column_missing");
    expect(miss.details.issues.find((i: { code: string }) => i.code === "required_column_missing").message).toBe("Cột Email là bắt buộc trong bảng nhưng form chưa có câu này.");
    // link-options: a text question sees only text columns that no other question uses
    const opts = await a("form.question.link_options", { form_id: x.id, question_id: "b" });
    expect(opts.map((o: { name: string }) => o.name)).toEqual(["Câu b"]); // its own column; no other text column is free
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("a", "single_select", { options: [{ label: "Có" }, { label: "Không" }] }), q("e", "email", { show_if: { field: "a", op: "eq", value: "Có" } })]) });
    await a("form.question.link", { form_id: x.id, question_id: "e", column_id: email.key });
    await a("form.question.create_columns", { form_id: x.id });
    const cond = await fails(a("form.form.publish", { form_id: x.id }));
    expect(cond.details.issues.map((i: { code: string }) => i.code)).toContain("required_column_conditional");
  });

  it("blocks conditions that point forward, to nothing, or use an operator a form lacks", async () => {
    const x = await newForm();
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("a", "text", { show_if: { field: "b", op: "eq", value: "x" } }), q("b", "text", { show_if: { field: "zz", op: "eq", value: 1 } }), q("c", "text", { show_if: { field: "a", op: "today" } })]) });
    await a("form.question.create_columns", { form_id: x.id });
    const err = await fails(a("form.form.publish", { form_id: x.id }));
    const codes = err.details.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["condition_forward", "condition_unknown", "condition_op"]));
  });

  it("a question linked to a deleted column is switched off and does not block; the version column carries the version", async () => {
    const x = await setup([q("a", "text"), q("b", "text")]);
    const colA = (await a("form.form.get", { form_id: x.id })).draft.blocks[0].column_id as string;
    await a("datahub.column.delete", { table_id: x.tableId, column: colA });
    const g = await a("form.form.get", { form_id: x.id });
    expect(g.disabled_question_ids).toEqual(["a"]);
    const view = await publicCall("form.public.get", { code: x.code }).catch((e) => e);
    expect(view.code).toBe("not_found"); // not a public form
    await a("form.form.update", { form_id: x.id, access: "public" });
    const pv = await publicCall("form.public.get", { code: x.code });
    expect(pv.config.blocks.map((b: { id: string }) => b.id)).toEqual(["b"]);
    await a("form.form.publish", { form_id: x.id });
    const r = await submitPublic(x.code, { a: "bỏ", b: "giữ" });
    expect(r.form_version).toBe(2);
    const row = (await rows(x.tableId))[0]!;
    expect(row.data[await colKey(x.tableId, "Phiên bản form")]).toBe(2);
  });

  it("discard_draft goes back to the published version; status, delete and restore", async () => {
    const x = await setup([q("a", "text")]);
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("a", "text"), q("b", "text")]) });
    expect((await a("form.form.get", { form_id: x.id })).has_unpublished).toBe(true);
    await a("form.form.discard_draft", { form_id: x.id });
    const g = await a("form.form.get", { form_id: x.id });
    expect(g.has_unpublished).toBe(false);
    expect(g.draft.blocks).toHaveLength(1);
    expect((await a("form.form.set_status", { form_id: x.id, status: "paused" })).state).toBe("paused");
    expect((await a("form.form.list")).items.find((f: { id: string }) => f.id === x.id)).toMatchObject({ response_count: 0, status: "paused" });
    await a("form.form.delete", { form_id: x.id });
    expect((await a("form.form.list")).items.find((f: { id: string }) => f.id === x.id)).toBeUndefined();
    expect((await a("form.form.list", { trashed: "true" })).items.map((f: { id: string }) => f.id)).toContain(x.id);
    expect((await a("datahub.table.get", { table_id: x.tableId })).name).toBeTruthy(); // the table stays
    await a("form.form.restore", { form_id: x.id });
    expect((await a("form.form.get", { form_id: x.id })).id).toBe(x.id);
  });
});

describe("form: submit (internal)", () => {
  it("writes one row with history via=form, formulas calculate after, a repeated attempt makes one row, the filler cannot read the table", async () => {
    const x = await newForm();
    const num = await a("datahub.column.create", { table_id: x.tableId, name: "Gấp đôi", type: "formula", config: { formula: "[Số] * 2" } }).catch(() => null);
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("n", "number", { label: "Số" }), q("t", "text", { label: "Tên" })]) });
    await a("form.question.create_columns", { form_id: x.id });
    const dbl = await a("datahub.column.create", { table_id: x.tableId, name: "Gấp đôi 2", type: "formula", config: { formula: "[Số] * 2" } });
    await a("form.form.publish", { form_id: x.id });
    void num;
    const u = as(t, org.userA2.id, "web");
    const att = attempt();
    const r1 = await u("form.response.submit", { code: x.code, answers: { n: 21, t: "An" }, attempt_id: att });
    const r2 = await u("form.response.submit", { code: x.code, answers: { n: 21, t: "An" }, attempt_id: att });
    expect(r2).toMatchObject({ replayed: true, id: r1.id, row_id: r1.row_id });
    const list = await rows(x.tableId);
    expect(list).toHaveLength(1);
    expect(list[0]!.data[dbl.key]).toBe(42);
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: r1.row_id });
    expect(hist.items[0].actor).toMatchObject({ via: "form", userId: org.userA2.id });
    const row = await a("datahub.row.get", { table_id: x.tableId, row_id: r1.row_id });
    expect(row.created_by).toBe(org.userA2.id);
    expect((await fails(u("datahub.row.list", { table_id: x.tableId }))).code).toBe("not_found"); // filling gives no right on the table
    expect((await a("form.form.list")).items.find((f: { id: string }) => f.id === x.id).response_count).toBe(1);
  });

  it("hidden questions lose their value and are not required; hidden fields are always written", async () => {
    const x = await setup([
      q("k", "single_select", { options: [{ label: "Vận tải" }, { label: "Bán lẻ" }], required: true }),
      { id: "g1", type: "group", title: "Vận tải", show_if: { field: "k", op: "eq", value: "Vận tải" }, blocks: [q("vt", "text", { required: true })] },
      q("bl", "text", { reveal: undefined, show_if: { field: "k", op: "eq", value: "Bán lẻ" } }),
      q("src", "text", { hidden: true, param: "nguon" }),
    ]);
    const u = as(t, org.userA2.id, "web");
    const opt = (await a("form.form.get", { form_id: x.id })).draft.blocks[0].options as { id: string; label: string }[];
    expect(opt.every((o) => !!o.id)).toBe(true);
    // the option id (what the form sends) and the label both work in a condition on the label
    const r2 = await u("form.response.submit", { code: x.code, answers: { k: "Bán lẻ", vt: "Xe tải", bl: "Cửa hàng", src: "facebook" }, attempt_id: attempt() });
    const list = await rows(x.tableId);
    const row = list.find((z) => z.id === r2.row_id)!;
    expect(row.data[await colKey(x.tableId, "Câu vt")]).toBeUndefined();
    expect(row.data[await colKey(x.tableId, "Câu bl")]).toBe("Cửa hàng");
    expect(row.data[await colKey(x.tableId, "Câu src")]).toBe("facebook");
    // Vận tải: the group shows, its required question counts
    const bad = await fails(u("form.response.submit", { code: x.code, answers: { k: "Vận tải" }, attempt_id: attempt() }));
    expect(bad.details.issues).toEqual([{ question_id: "vt", message: "Câu này bắt buộc." }]);
  });

  it("'when chosen, show' reveals blocks by option id or label; a block nobody reveals stays hidden and its value is dropped", async () => {
    const x = await newForm();
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("k", "multi_select", { options: [{ id: "o1", label: "Vận tải" }, { id: "o2", label: "Bán lẻ" }], reveal: { o1: ["vt"], o2: ["bl"] } }), q("vt", "text"), q("bl", "text")]) });
    await a("form.question.create_columns", { form_id: x.id });
    await a("form.form.publish", { form_id: x.id });
    await a("form.form.update", { form_id: x.id, access: "all_accounts" });
    const u = as(t, org.userA2.id, "web");
    const opts = (await a("form.form.get", { form_id: x.id })).draft.blocks[0].options as { id: string; label: string }[];
    const r = await u("form.response.submit", { code: x.code, answers: { k: [opts[0]!.label], vt: "xe", bl: "cửa hàng" }, attempt_id: attempt() });
    const row = (await rows(x.tableId)).find((z) => z.id === r.row_id)!;
    expect(row.data[await colKey(x.tableId, "Câu vt")]).toBe("xe");
    expect(row.data[await colKey(x.tableId, "Câu bl")]).toBeUndefined();
    const r2 = await u("form.response.submit", { code: x.code, answers: { k: [opts[1]!.id], vt: "xe", bl: "cửa hàng" }, attempt_id: attempt() });
    const row2 = (await rows(x.tableId)).find((z) => z.id === r2.row_id)!;
    expect(row2.data[await colKey(x.tableId, "Câu vt")]).toBeUndefined();
    expect(row2.data[await colKey(x.tableId, "Câu bl")]).toBe("cửa hàng");
  });

  it("conditions, reveal and submitted values use option ids: a renamed option still works, a removed one blocks publishing", async () => {
    const x = await newForm();
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("k", "single_select", { options: [{ id: "o_a", label: "Vận tải" }, { id: "o_b", label: "Bán lẻ" }] }), q("vt", "text", { show_if: { field: "k", op: "eq", value: "o_a" } })]) });
    await a("form.question.create_columns", { form_id: x.id });
    const d = (await a("form.form.get", { form_id: x.id })).draft;
    const opts = d.blocks[0].options as { id: string; label: string }[];
    expect(d.blocks[1].show_if.value).toBe(opts[0]!.id); // the condition follows the column's option id
    await a("form.form.publish", { form_id: x.id });
    await a("form.form.update", { form_id: x.id, access: "all_accounts" });
    // rename the option in the form: the condition, which holds the id, still works
    const renamed = { ...d, blocks: [{ ...d.blocks[0], options: opts.map((o, i) => (i === 0 ? { ...o, label: "Logistics" } : o)) }, d.blocks[1]] };
    await a("form.form.save_draft", { form_id: x.id, config: renamed });
    await a("form.form.publish", { form_id: x.id });
    const u = as(t, org.userA2.id, "web");
    const r = await u("form.response.submit", { code: x.code, answers: { k: opts[0]!.id, vt: "xe" }, attempt_id: attempt() });
    const row = (await rows(x.tableId)).find((z) => z.id === r.row_id)!;
    expect(row.data[await colKey(x.tableId, "Câu vt")]).toBe("xe");
    expect(row.data[await colKey(x.tableId, "Câu k")]).toBe(opts[0]!.id); // the column stores the option id
    const r2 = await u("form.response.submit", { code: x.code, answers: { k: "Bán lẻ", vt: "xe" }, attempt_id: attempt() }); // a name from a link works too
    const row2 = (await rows(x.tableId)).find((z) => z.id === r2.row_id)!;
    expect(row2.data[await colKey(x.tableId, "Câu vt")]).toBeUndefined();
    // a condition on an option that is gone is refused when publishing
    const bad = { ...renamed, blocks: [renamed.blocks[0], { ...d.blocks[1], show_if: { field: "k", op: "eq", value: "o_gone" } }] };
    await a("form.form.save_draft", { form_id: x.id, config: bad });
    const e = await fails(a("form.form.publish", { form_id: x.id }));
    expect(JSON.stringify(e.details.issues)).toContain("condition_option");
  });

  it("a unique column reports on the right question; one response per person; closing dates and the maximum", async () => {
    const x = await newForm();
    const mail = await a("datahub.column.create", { table_id: x.tableId, name: "Email", type: "email", unique: true, required: true });
    await a("form.form.save_draft", { form_id: x.id, config: cfgOf([q("m", "email", { column_id: mail.key, unique_message: "Email này đã được dùng để gửi form", required: true }), q("n", "text")]) });
    await a("form.question.create_columns", { form_id: x.id });
    await a("form.form.publish", { form_id: x.id });
    const u = as(t, org.userA2.id, "web");
    await u("form.response.submit", { code: x.code, answers: { m: "a@b.vn", n: "1" }, attempt_id: attempt() });
    const dup = await fails(as(t, org.userB1.id, "web")("form.response.submit", { code: x.code, answers: { m: "a@b.vn", n: "2" }, attempt_id: attempt() }));
    expect(dup).toMatchObject({ code: "conflict", message: "Email này đã được dùng để gửi form", details: { question_id: "m" } });
    expect((await rows(x.tableId))).toHaveLength(1);
    // one per user + max responses
    await a("form.form.update", { form_id: x.id, options: { one_per_user: true, max_responses: 2 } });
    const again = await fails(u("form.response.submit", { code: x.code, answers: { m: "c@d.vn" }, attempt_id: attempt() }));
    expect(again.details.reason).toBe("one_per_user");
    await as(t, org.userB1.id, "web")("form.response.submit", { code: x.code, answers: { m: "e@f.vn" }, attempt_id: attempt() });
    expect((await a("form.form.get", { form_id: x.id })).state).toBe("closed"); // the maximum closed it
    const late = await fails(as(t, org.userA1.id, "web")("form.response.submit", { code: x.code, answers: { m: "g@h.vn" }, attempt_id: attempt() }));
    expect(late.details.reason).toBe("form_closed");
    await a("form.form.set_status", { form_id: x.id, status: "open" });
    await a("form.form.update", { form_id: x.id, options: { close_at: "2020-01-01T00:00:00+07:00" } });
    expect((await a("form.form.get", { form_id: x.id })).state).toBe("closed");
  });

  it("audience: mọi tài khoản excludes Guests; selected opens to the chosen guest; a Guest cannot be in a role", async () => {
    const x = await setup([q("n", "text")], { access: "all_accounts" });
    const guest = as(t, org.guestSale.id, "web");
    expect((await fails(guest("form.fill.get", { code: x.code }))).details.reason).toBe("not_in_audience");
    expect((await fails(guest("form.response.submit", { code: x.code, answers: { n: "x" }, attempt_id: attempt() }))).code).toBe("forbidden");
    await as(t, org.userB1.id, "web")("form.fill.get", { code: x.code });
    await a("form.form.update", { form_id: x.id, access: "selected", audience: { guest_ids: [org.guestSale.id], team_ids: [org.leaderA.id] } });
    expect((await guest("form.fill.get", { code: x.code })).config.blocks).toHaveLength(1);
    expect((await fails(as(t, org.userB1.id, "web")("form.fill.get", { code: x.code }))).code).toBe("forbidden"); // not in the audience
    await as(t, org.userA1.id, "web")("form.fill.get", { code: x.code }); // owner
    await a("form.form.update", { form_id: x.id, audience: { team_ids: [org.leaderA.id], guest_presets: ["data"] } });
    await as(t, org.userA1.id, "web")("form.fill.get", { code: x.code });
    expect((await fails(guest("form.fill.get", { code: x.code }))).code).toBe("forbidden");
    await as(t, org.guestData.id, "web")("form.fill.get", { code: x.code });
  });

  it("draft of the filler: saved per person, dropped on submit, kept (minus gone questions) when the form is published again", async () => {
    const x = await setup([q("a", "text"), q("b", "text")], { access: "all_accounts" });
    const u = as(t, org.userA2.id, "web");
    await u("form.draft.save", { code: x.code, answers: { a: "một", b: "hai", ghost: "x" } });
    let g = await u("form.fill.get", { code: x.code });
    expect(g.draft).toEqual({ a: "một", b: "hai" });
    expect(g.form_updated).toBe(false);
    expect((await as(t, org.userB1.id, "web")("form.fill.get", { code: x.code })).draft).toBeNull();
    expect((await rows(x.tableId))).toHaveLength(0); // a draft is not a row
    await a("form.form.save_draft", { form_id: x.id, config: (await a("form.form.get", { form_id: x.id })).draft && cfgOf([(await a("form.form.get", { form_id: x.id })).draft.blocks[0]]) });
    await a("form.form.publish", { form_id: x.id });
    g = await u("form.fill.get", { code: x.code });
    expect(g.draft).toEqual({ a: "một" });
    expect(g.form_updated).toBe(true);
    await u("form.response.submit", { code: x.code, answers: { a: "x" }, attempt_id: attempt() });
    expect((await u("form.fill.get", { code: x.code })).draft).toBeNull();
  });

  it("a token with the Form menu at write level submits; read level does not", async () => {
    const { activeToken } = await import("./fixtures");
    const x = await setup([q("a", "text")], { access: "all_accounts" });
    const w = await activeToken(t, org.userA2.id, [], { kind: "personal", menus: { form: "write" } });
    const r = await t.app.inject({ method: "POST", url: `/api/v1/fill/${x.code}/submit`, headers: w.headers, payload: { answers: { a: "qua token" }, attempt_id: attempt() } });
    expect(r.statusCode).toBe(201);
    const rd = await activeToken(t, org.userA2.id, [], { kind: "personal", menus: { form: "read" } });
    const r2 = await t.app.inject({ method: "POST", url: `/api/v1/fill/${x.code}/submit`, headers: rd.headers, payload: { answers: { a: "x" }, attempt_id: attempt() } });
    expect(r2.statusCode).toBe(403);
    const list = await rows(x.tableId);
    expect(list).toHaveLength(1);
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: list[0]!.id });
    expect(hist.items[0].actor.via).toBe("api");
  });
});

describe("form: public endpoint", () => {
  it("the public config holds no table id, column key, datahub name or answer", async () => {
    const x = await setup([q("a", "single_select", { options: [{ label: "Có" }, { label: "Không" }], answer: "Có", points: 5 }), q("b", "text")], { access: "public" });
    const dh = await a("datahub.table.get", { table_id: x.tableId });
    const v = await publicCall("form.public.get", { code: x.code });
    const json = JSON.stringify(v);
    expect(json).not.toContain(x.tableId);
    expect(json).not.toContain(dh.datahub_name);
    for (const c of dh.columns as { key: string; id: string }[]) {
      expect(json).not.toContain(c.key);
      expect(json).not.toContain(c.id);
    }
    expect(json).not.toContain("column_id");
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"points"');
    expect(v).toMatchObject({ state: "open", version: 1 });
    expect(v.fill_token).toBeTruthy();
    // closed form: the owner's message and no configuration
    await a("form.form.update", { form_id: x.id, options: { closed_message: "Form đã đóng ngày 30/11" } });
    await a("form.form.set_status", { form_id: x.id, status: "closed" });
    expect(await publicCall("form.public.get", { code: x.code })).toMatchObject({ state: "closed", message: "Form đã đóng ngày 30/11", config: null });
  });

  it("anonymous submit: row created by the public account, via form, audit has the IP; the filler needs no rights", async () => {
    const x = await setup([q("a", "text")], { access: "public" });
    const ip = "203.0.113.7";
    const r = await submitPublic(x.code, { a: "xin chào" }, { ip });
    const list = await rows(x.tableId);
    expect(list).toHaveLength(1);
    const row = await a("datahub.row.get", { table_id: x.tableId, row_id: r.row_id });
    expect(row.created_by).toBe("00000000-0000-7000-8000-000000000f01");
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: r.row_id });
    expect(hist.items[0].actor.via).toBe("form");
    const audit = await t.c.db.db.execute(sql`SELECT ip, details FROM audit_log WHERE command = 'form.public.submit' ORDER BY at DESC LIMIT 1`);
    expect((audit.rows[0] as { ip: string; details: { code: string } }).ip).toBe(ip);
    expect((audit.rows[0] as { details: { code: string } }).details.code).toBe(x.code);
    // a replayed attempt is one row
    const att = attempt();
    await submitPublic(x.code, { a: "1" }, { attempt: att });
    await submitPublic(x.code, { a: "1" }, { attempt: att });
    expect(await rows(x.tableId)).toHaveLength(2);
  });

  it("spam: honeypot, under 3 seconds, a forged token, 10 per minute per IP, the daily limit; each is refused and audited", async () => {
    const x = await setup([q("a", "text")], { access: "public" });
    const msg = "Bạn gửi quá nhanh, thử lại sau ít phút.";
    const trap = await fails(submitPublic(x.code, { a: "x" }, { website: "http://spam" }));
    expect(trap).toMatchObject({ code: "rate_limited", message: msg });
    const fast = await fails(submitPublic(x.code, { a: "x" }, { ageMs: 500 }));
    expect(fast).toMatchObject({ code: "rate_limited", details: { reason: "too_fast" } });
    const forged = await fails(publicCall("form.public.submit", { code: x.code, answers: { a: "x" }, attempt_id: attempt(), fill_token: "1.deadbeef" }));
    expect(forged.details.reason).toBe("bad_token");
    expect(SPAM.minFillMs).toBe(3000);
    expect(await rows(x.tableId)).toHaveLength(0);
    resetSpamState();
    for (let n = 0; n < 7; n++) await submitPublic(x.code, { a: `${n}` }, { ip: "198.51.100.9" }); // 3 refused attempts above used another... counted per IP
    const over = [];
    for (let n = 0; n < 5; n++) over.push(await fails(submitPublic(x.code, { a: "z" }, { ip: "198.51.100.9" })).catch(() => null));
    const refused = over.filter((e) => e && e.code === "rate_limited");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]!.details.reason).toBe("ip_rate");
    await submitPublic(x.code, { a: "khác IP" }, { ip: "198.51.100.10" }); // another IP is fine
    const logged = await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM audit_log WHERE command = 'form.public.submit' AND result = 'error' AND error_code = 'rate_limited'`);
    expect((logged.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(5);
    // daily limit set by the owner
    resetSpamState();
    await a("form.form.update", { form_id: x.id, options: { daily_limit: 8 } });
    const count = await rows(x.tableId);
    const left = 8 - count.length;
    for (let n = 0; n < left; n++) await submitPublic(x.code, { a: "d" }, { ip: `192.0.2.${n + 1}` });
    expect((await fails(submitPublic(x.code, { a: "d" }, { ip: "192.0.2.99" }))).details.reason).toBe("daily_limit");
  });

  it("a public form cannot be opened with the internal command, and an internal form is not on the public endpoint", async () => {
    const pub = await setup([q("a", "text")], { access: "public" });
    const inner = await setup([q("a", "text")], { access: "all_accounts" });
    expect((await fails(publicCall("form.public.get", { code: inner.code }))).code).toBe("not_found");
    expect((await fails(submitPublic(inner.code, { a: "x" }))).code).toBe("not_found");
    await as(t, org.userA2.id, "web")("form.response.submit", { code: pub.code, answers: { a: "ok" }, attempt_id: attempt() }); // a logged-in person may use a public form too
  });

  it("files: the upload link is for one fill and one question, at most 5 files, 10 MB", async () => {
    const x = await setup([q("f", "attachment")], { access: "public" });
    const v = await publicCall("form.public.get", { code: x.code });
    const att = v.attempt_id as string;
    const tok = fillToken(t.c.config.AUTH_SECRET, x.code, Date.now() - 10_000);
    const base = { code: x.code, fill_token: tok, attempt_id: att, question_id: "f", content_type: "application/pdf" };
    const ids: string[] = [];
    for (let n = 0; n < 5; n++) ids.push((await publicCall("form.public.upload_init", { ...base, filename: `f${n}.pdf`, size_bytes: 100 })).file_id);
    expect((await fails(publicCall("form.public.upload_init", { ...base, filename: "f6.pdf", size_bytes: 100 }))).details.reason).toBe("too_many_files");
    expect((await fails(publicCall("form.public.upload_init", { ...base, attempt_id: attempt(), filename: "big.pdf", size_bytes: 11 * 1024 * 1024 }))).code).toBe("payload_too_large");
    expect((await fails(publicCall("form.public.upload_init", { ...base, question_id: "zz", filename: "x.pdf", size_bytes: 10 }))).code).toBe("not_found");
    // a file of another fill is refused at submit
    const other = (await publicCall("form.public.upload_init", { ...base, attempt_id: attempt(), filename: "o.pdf", size_bytes: 10 })).file_id;
    const bad = await fails(submitPublic(x.code, { f: [other] }, { attempt: att }));
    expect(bad.details.issues[0]).toMatchObject({ question_id: "f", message: "File không hợp lệ cho lượt điền này." });
    const owner = await t.c.db.db.execute(sql`SELECT owner_id FROM files WHERE /*scope:system*/ id = ${ids[0]}::uuid`);
    expect((owner.rows[0] as { owner_id: string }).owner_id).toBe(org.userA1.id); // counts against the owner's storage
  });
});

describe("form: columns and tables", () => {
  it("a table with a form may have 150 columns; without a form the person's limit applies; deleting the table pauses the form", async () => {
    const dh = await a("datahub.datahub.create", { name: `Lim ${randomUUID().slice(0, 6)}` });
    await t.c.db.db.execute(sql`DELETE FROM dh_user_limits WHERE /*scope:system*/ user_id = ${org.userA1.id}::uuid`);
    const tb = await a("datahub.table.create", { datahub_id: dh.id, name: "Nhiều cột" });
    const first = await a("datahub.column.create", { table_id: tb.id, name: "C0", type: "text" });
    expect(first.name).toBe("C0");
    // 70 columns is the default limit: fill up to it directly, then a 71st fails without a form
    await t.c.db.db.execute(sql`INSERT INTO dh_columns (id, table_id, key, name, type, config, position, created_by, updated_by)
      SELECT gen_random_uuid(), ${tb.id}::uuid, 'k' || n, 'Cột ' || n, 'text', '{}'::jsonb, n, ${org.userA1.id}::uuid, ${org.userA1.id}::uuid FROM generate_series(1, 69) n`);
    expect((await fails(a("datahub.column.create", { table_id: tb.id, name: "Thừa", type: "text" }))).code).toBe("quota_exceeded");
    const f = await a("form.form.create", { name: "Có form", table_id: tb.id }); // adds the version column: 71st column is allowed by the form limit
    await a("datahub.column.create", { table_id: tb.id, name: "Thêm 1", type: "text" });
    expect((await a("datahub.table.get", { table_id: tb.id })).max_columns).toBe(150);
    await a("form.form.save_draft", { form_id: f.id, config: cfgOf([q("a", "text")]) });
    await a("form.question.create_columns", { form_id: f.id });
    await a("form.form.publish", { form_id: f.id });
    await a("form.form.update", { form_id: f.id, access: "all_accounts" });
    await a("datahub.table.delete", { table_id: tb.id });
    const g = await a("form.form.get", { form_id: f.id });
    expect(g).toMatchObject({ state: "paused", state_reason: "table_deleted" });
    const view = await as(t, org.userA2.id, "web")("form.fill.get", { code: f.code });
    expect(view).toMatchObject({ state: "paused", config: null });
    expect((await fails(as(t, org.userA2.id, "web")("form.response.submit", { code: f.code, answers: { a: "x" }, attempt_id: attempt() }))).details.reason).toBe("form_paused");
    await a("datahub.table.restore", { table_id: tb.id });
    expect((await a("form.form.get", { form_id: f.id })).state).toBe("open");
    await t.c.db.db.execute(sql`DELETE FROM dh_user_limits WHERE /*scope:system*/ user_id = ${org.userA1.id}::uuid`);
    await unlimit(t, org.userA1.id);
  });
});
