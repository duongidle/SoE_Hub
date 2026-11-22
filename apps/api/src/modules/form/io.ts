import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DH_NAME_MAX } from "@soe/shared";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { STRUCTURE_EVENT } from "../datahub/shared";
import { compatibleTypes, flatten, FormConfigSchema, FORM_SCHEMA, isSelect, publicConfig, questionsOf, remapOptionRefs, type Block, type FormConfig, type Question } from "./config";
import { canFill } from "./fill";
import { createColumnsFor, createFormIn, disabledIds, ownTable, saveDraft } from "./ops";
import { Id, fillable, latestConfig, liveColumns, loadFormRow, loadOwnForm, VERSION_COLUMN_NAME } from "./shared";

type Ctx = HandlerCtx;

export interface Unmatched {
  question_id: string;
  label: string;
  reason: "no_column" | "type_mismatch" | "column_taken" | "option_missing";
  column_name?: string;
}

/** The JSON of a form (design module7 8). The owner gets the answers; the column keys never leave (a question carries the NAME of its column instead). */
async function exportConfig(ctx: { db: Ctx["db"] }, cfg: FormConfig, tableId: string | null, withAnswers: boolean): Promise<Record<string, unknown>> {
  const cols = await liveColumns(ctx.db, tableId);
  const base = (withAnswers ? cfg : (publicConfig(cfg, disabledIds(cfg, cols, !!tableId)) as FormConfig)) as FormConfig;
  const walk = (list: Block[]): Block[] =>
    list.map((b) => {
      if (b.type === "group") return { ...b, blocks: walk((b as { blocks: Block[] }).blocks) } as Block;
      if (b.type !== "question") return b;
      const { column_id, ...rest } = b as Question & { column_name?: string };
      const name = column_id ? cols.get(column_id)?.name : undefined;
      return { ...rest, ...(name ? { column_name: name } : {}) } as Block;
    });
  return { ...base, schema: FORM_SCHEMA, blocks: walk(base.blocks) };
}

/** Reads a JSON document as a form: a bad one gets a list of `{ path, message }` so a person (or an AI) can fix it. */
export function parseFormJson(json: unknown): FormConfig {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new AppError("validation_error", "JSON form phải là một đối tượng.", { issues: [{ path: "$", message: "Cần một đối tượng JSON." }] });
  const schema = (json as { schema?: unknown }).schema;
  if (schema !== undefined && schema !== FORM_SCHEMA) throw new AppError("validation_error", `Phiên bản JSON không hỗ trợ: ${String(schema)}.`, { issues: [{ path: "schema", message: `Chỉ hỗ trợ "${FORM_SCHEMA}".` }] });
  const r = FormConfigSchema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.map((p, n) => (typeof p === "number" ? `[${p}]` : n === 0 ? String(p) : `.${String(p)}`)).join("") || "$", message: i.message }));
    throw new AppError("validation_error", `JSON form chưa hợp lệ: ${issues[0]!.path}: ${issues[0]!.message}`, { issues: issues.slice(0, 50) });
  }
  const ids = new Map<string, number>();
  const issues: { path: string; message: string }[] = [];
  flatten(r.data.blocks).forEach((f, n) => {
    if (ids.has(f.block.id)) issues.push({ path: `blocks[${n}].id`, message: `Mã khối "${f.block.id}" bị trùng.` });
    ids.set(f.block.id, n);
  });
  if (issues.length) throw new AppError("validation_error", `JSON form chưa hợp lệ: ${issues[0]!.message}`, { issues });
  return r.data;
}

/**
 * Puts the questions of a JSON onto an existing table: a question joins the column of the same NAME (and a kind that fits, not already taken);
 * the others stay unlinked and are listed with the reason (design module7 8). Select options must all exist in the column.
 */
async function matchColumns(ctx: Ctx, tableId: string, cfg: FormConfig): Promise<{ cfg: FormConfig; unmatched: Unmatched[] }> {
  const cols = await liveColumns(ctx.db, tableId);
  const byName = new Map([...cols.values()].map((c) => [c.name.trim().toLowerCase(), c]));
  const taken = new Set<string>();
  const unmatched: Unmatched[] = [];
  const patch = new Map<string, Partial<Question>>();
  const remaps: { id: string; from: { id?: string; label: string }[]; to: { id?: string; label: string }[] }[] = [];
  for (const q of questionsOf(cfg)) {
    const want = (q as Question & { column_name?: string }).column_name;
    if (!want) {
      unmatched.push({ question_id: q.id, label: q.label, reason: "no_column" });
      continue;
    }
    const col = byName.get(want.trim().toLowerCase());
    const bad = (reason: Unmatched["reason"]) => unmatched.push({ question_id: q.id, label: q.label, reason, column_name: want });
    if (!col || col.name.toLowerCase() === VERSION_COLUMN_NAME.toLowerCase()) bad("no_column");
    else if (!fillable(col) || !compatibleTypes(q.input).includes(col.type)) bad("type_mismatch");
    else if (taken.has(col.key)) bad("column_taken");
    else if (isSelect(q.input) && (q.options ?? []).some((o) => !col.options.some((c) => c.name.toLowerCase() === o.label.toLowerCase()))) bad("option_missing");
    else {
      taken.add(col.key);
      const p: Partial<Question> = { column_id: col.key };
      if (isSelect(q.input)) {
        const options = (q.options ?? []).map((o) => ({ id: col.options.find((c) => c.name.toLowerCase() === o.label.toLowerCase())!.id, label: o.label }));
        p.options = options;
        remaps.push({ id: q.id, from: q.options ?? [], to: options });
      }
      patch.set(q.id, p);
    }
  }
  const walk = (list: Block[]): Block[] =>
    list.map((b) => {
      if (b.type === "group") return { ...b, blocks: walk((b as { blocks: Block[] }).blocks) } as Block;
      if (b.type !== "question") return b;
      const { column_name: _n, ...rest } = b as Question & { column_name?: string };
      return { ...rest, column_id: null, ...(patch.get(b.id) ?? {}) } as Block;
    });
  let out: FormConfig = { ...cfg, blocks: walk(cfg.blocks) };
  for (const r of remaps) out = remapOptionRefs(out, r.id, r.from, r.to);
  return { cfg: out, unmatched };
}

/** Builds a form from a JSON: on a new table every question gets a column; on an existing table the questions join the columns of the same name. */
async function importInto(ctx: Ctx, cfg: FormConfig, target: { name: string; datahub_id?: string; table_id?: string }): Promise<{ id: string; created_columns: number; unmatched: Unmatched[] }> {
  const id = await createFormIn(ctx, target, { ...cfg, blocks: stripColumns(cfg.blocks) });
  const f = await loadOwnForm(ctx.db, ctx.actor.userId, id);
  if (!f.tableId) return { id, created_columns: 0, unmatched: [] };
  if (target.table_id) {
    const m = await matchColumns(ctx, f.tableId, cfg);
    await saveDraft(ctx, f, m.cfg);
    return { id, created_columns: 0, unmatched: m.unmatched };
  }
  const made = await createColumnsFor(ctx, f.tableId, f.draft);
  await saveDraft(ctx, f, made.cfg);
  return { id, created_columns: made.created.length, unmatched: [] };
}

const stripColumns = (list: Block[]): Block[] =>
  list.map((b) => {
    if (b.type === "group") return { ...b, blocks: stripColumns((b as { blocks: Block[] }).blocks) } as Block;
    if (b.type !== "question") return b;
    const { column_name: _n, column_id: _c, ...rest } = b as Question & { column_name?: string };
    return { ...rest, column_id: null } as Block;
  });

const Target = {
  name: z.string().trim().min(1).max(200).optional(),
  datahub_id: Id.optional().describe("Tạo bảng mới trong datahub này."),
  table_id: Id.optional().describe("Hoặc ghi vào bảng sẵn có của bạn (câu hỏi ghép vào cột cùng tên)."),
};
const ImportOut = z.object({ form_id: Id, created_columns: z.number().int(), unmatched: z.array(z.object({ question_id: z.string(), label: z.string(), reason: z.string(), column_name: z.string().optional() })) });
const MANAGE = { permission: "form:form:create" as const, aiAllowed: true, menu: "form" as const };

export const formIoOperations = [
  defineQuery({
    name: "form.form.export",
    summary: "Xuất form thành JSON `soe-form/1`. Chủ form (`form_id`) nhận cả đáp án và điểm; người điền (`code`) chỉ nhận bản đã lọc, không có đáp án.",
    description: "Mỗi câu hỏi mang tên cột (`column_name`) thay cho mã cột. `source`: `draft` (mặc định) hoặc `published`.",
    permission: "form:response:submit",
    aiAllowed: true,
    menu: "form",
    input: z.object({ form_id: Id.optional(), code: z.string().min(4).max(40).optional(), source: z.enum(["draft", "published"]).default("draft") }),
    output: z.object({ name: z.string(), json: z.unknown(), has_answers: z.boolean() }),
    http: { method: "GET", path: "/forms/export" },
    handler: async (ctx, i) => {
      if (!!i.form_id === !!i.code) throw new AppError("validation_error", "Gửi một trong hai: `form_id` (chủ form) hoặc `code` (người điền).");
      if (i.form_id) {
        const f = await loadFormRow(ctx.db, sql`id = ${i.form_id}::uuid`);
        if (f && f.ownerId === ctx.actor.userId) {
          const cfg = i.source === "published" ? await latestConfig(ctx.db, f) : f.draft;
          if (!cfg) throw new AppError("not_found", "Form chưa xuất bản.");
          return { name: f.name, json: await exportConfig(ctx, cfg, f.tableId, true), has_answers: true };
        }
        throw new AppError("not_found", "Không tìm thấy form.");
      }
      const f = await loadFormRow(ctx.db, sql`code = ${i.code!}`);
      if (!f || !(await canFill(ctx.db, f, ctx.actor.userId))) throw new AppError("not_found", "Không tìm thấy form.");
      const cfg = await latestConfig(ctx.db, f);
      if (!cfg) throw new AppError("not_found", "Form chưa xuất bản.");
      return { name: f.name, json: await exportConfig(ctx, cfg, f.tableId, false), has_answers: false };
    },
  }),

  defineCommand({
    name: "form.form.import",
    summary: "Nhập JSON `soe-form/1` thành form mới (nháp). Có `datahub_id`: tạo bảng mới, mỗi câu một cột. Có `table_id`: ghép câu vào cột cùng tên của bảng sẵn có; câu không ghép được nằm trong `unmatched` kèm lý do.",
    description: "JSON sai thì lỗi `validation_error` kèm `details.issues[{path, message}]` (đường dẫn trong JSON) để tự sửa. Cần `datahub_id` hoặc `table_id`.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ ...Target, json: z.unknown() }),
    output: ImportOut,
    http: { method: "POST", path: "/forms/import", status: 201 },
    handler: async (ctx, i) => {
      if (!!i.datahub_id === !!i.table_id) throw new AppError("validation_error", "Chọn một: `datahub_id` (tạo bảng mới) hoặc `table_id` (bảng sẵn có).");
      const cfg = parseFormJson(i.json);
      const r = await importInto(ctx, cfg, { name: (i.name ?? cfg.title ?? "").trim() || "Form nhập từ JSON", datahub_id: i.datahub_id, table_id: i.table_id });
      return { form_id: r.id, created_columns: r.created_columns, unmatched: r.unmatched };
    },
  }),

  defineCommand({
    name: "form.form.save_json",
    summary: "Ghi JSON `soe-form/1` thành bản nháp của một form đã có (thay nội dung nháp). Câu hỏi ghép với cột của bảng đích theo tên cột (`column_name`); câu chưa có cột thì tạo cột mới (`create_columns`, mặc định true).",
    description: "Dùng cho AI viết hoặc sửa form: gửi JSON đầy đủ của form. Chưa xuất bản: người điền chưa thấy. JSON sai thì lỗi `validation_error` kèm `details.issues[{path, message}]`.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ form_id: Id, json: z.unknown(), create_columns: z.boolean().default(true) }),
    output: z.object({ form_id: Id, created_columns: z.number().int(), unmatched: z.array(z.object({ question_id: z.string(), label: z.string(), reason: z.string(), column_name: z.string().optional() })), has_unpublished: z.literal(true) }),
    http: { method: "PUT", path: "/forms/:form_id/json" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      const cfg = parseFormJson(i.json);
      let next = { ...cfg, blocks: stripColumns(cfg.blocks) } as FormConfig;
      let unmatched: Unmatched[] = [];
      let created = 0;
      if (f.tableId) {
        await ownTable(ctx, f.tableId);
        const m = await matchColumns(ctx, f.tableId, cfg);
        next = m.cfg;
        unmatched = m.unmatched;
        if (i.create_columns) {
          const made = await createColumnsFor(ctx, f.tableId, next);
          next = made.cfg;
          created = made.created.length;
          unmatched = unmatched.filter((u) => !made.created.some((c) => c.question_id === u.question_id));
        }
      }
      await saveDraft(ctx, f, next);
      ctx.audit({ type: "form", id: f.id, details: { name: f.name, json: true } });
      return { form_id: f.id, created_columns: created, unmatched, has_unpublished: true as const };
    },
  }),

  defineCommand({
    name: "form.form.clone",
    summary: "Nhân bản form của tôi (bản nháp, chưa xuất bản). Mặc định tạo bảng mới cùng cấu trúc trong datahub của bảng cũ; hoặc ghi vào bảng sẵn có (`table_id`, ghép theo tên cột).",
    description: "Nhân bản chép cả đáp án và phiếu chấm. Link và phản hồi không chép.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ form_id: Id, ...Target }),
    output: ImportOut,
    http: { method: "POST", path: "/forms/:form_id/clone", status: 201 },
    handler: async (ctx, i) => {
      if (i.datahub_id && i.table_id) throw new AppError("validation_error", "Chọn một: `datahub_id` hoặc `table_id`.");
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      let datahubId = i.datahub_id;
      if (!i.table_id && !datahubId) {
        if (!f.tableId) throw new AppError("validation_error", "Form chưa có bảng đích: chọn `datahub_id` hoặc `table_id`.");
        const r = await ctx.db.execute(sql`SELECT datahub_id FROM dh_tables WHERE /*scope:system*/ id = ${f.tableId}::uuid`);
        datahubId = (r.rows[0] as { datahub_id: string } | undefined)?.datahub_id;
        if (!datahubId) throw new AppError("not_found", "Không tìm thấy bảng đích của form.");
      }
      if (i.table_id) await ownTable(ctx, i.table_id);
      const cfg = parseFormJson(await exportConfig(ctx, f.draft, f.tableId, true));
      const name = (i.name ?? `${f.name} (bản sao)`).slice(0, DH_NAME_MAX);
      const r = await importInto(ctx, { ...cfg, title: cfg.title }, { name, datahub_id: datahubId, table_id: i.table_id });
      return { form_id: r.id, created_columns: r.created_columns, unmatched: r.unmatched };
    },
  }),
];
