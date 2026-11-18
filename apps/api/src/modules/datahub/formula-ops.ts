import { sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, evaluate, FUNCTION_CATALOG, FError, toDisplayFormula } from "@soe/formula";
import { AppError, isAppError } from "@soe/shared";
import { newId } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { loadTableAccess } from "./access";
import { RESULT_TYPES, resultTypeFor, valueToStored, type ResultType } from "./cell-values";
import { assertScanLimits, compileFormula, OwnerIndex, prepareComputed } from "./computed";
import { buildFormulaEnv } from "./recalc";
import { Id } from "./shared";
import { rowFromDb, TableSchema } from "./table-schema";

const FunctionOut = z.object({
  name: z.string(),
  group: z.string().describe("Logic, Toán, Thống kê, Chuỗi, Ngày, Tra cứu hoặc Thông tin dòng."),
  syntax: z.string().describe("Cú pháp, ví dụ `IF(điều_kiện, nếu_đúng, [nếu_sai])`; tham số trong [ ] là tuỳ chọn."),
  description: z.string().describe("Mô tả tiếng Việt ngắn."),
  example: z.string(),
  example_result: z.string(),
  min_args: z.number().int(),
  max_args: z.number().int(),
  volatile: z.enum(["today", "now"]).nullable().describe("`today`: cột dùng hàm này tính lại 00:05 mỗi ngày; `now`: mỗi giờ."),
});

const PreviewIssue = z.object({ message: z.string(), start: z.number().int().describe("Vị trí ký tự bắt đầu (từ 0) trong công thức đã gửi."), end: z.number().int() });

const POSITION = z.object({ start: z.number().int(), end: z.number().int() });

export const formulaOperations = [
  defineQuery({
    name: "datahub.formula.functions",
    summary: "Danh mục hàm công thức: nhóm, cú pháp, mô tả tiếng Việt và một ví dụ cho từng hàm; kèm danh sách mã lỗi.",
    description: "Dùng cho gợi ý khi gõ công thức và cho AI. Tham chiếu: `[Cột]`, `[Bảng].[Cột]`, `[Datahub].[Bảng].[Cột]`. Toán tử: `+ - * / ^ &`, so sánh `= <> < <= > >=`, `%` sau số.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({
      functions: z.array(FunctionOut),
      errors: z.array(z.object({ code: z.string(), message: z.string() })),
    }),
    http: { method: "GET", path: "/datahub/formula-functions" },
    handler: async () => ({
      functions: FUNCTION_CATALOG,
      errors: ERROR_CODES.map((code) => ({ code, message: ERROR_MESSAGES[code] })),
    }),
  }),

  defineCommand({
    name: "datahub.formula.preview",
    summary: "Kiểm tra công thức và xem trước kết quả trên 5 dòng đầu của bảng. Không ghi gì. Chỉ chủ datahub.",
    description:
      "Công thức sai thì `ok: false` kèm `errors` có vị trí ký tự (`start`, `end`) và câu giải thích tiếng Việt; không trả lỗi HTTP vì sai công thức là việc bình thường khi đang gõ. " +
      "Kiểm tra giống lúc lưu cột: cú pháp, tên cột/bảng, tên và số đối số của hàm, vòng lặp (#CYCLE!), bảng không cùng chủ (#PERM!), ngưỡng 20.000 dòng cho điều kiện không gom nhóm được. " +
      "Gửi `column` (mã hoặc tên) khi đang sửa một cột công thức có sẵn.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "none",
    input: z.object({
      table_id: Id,
      formula: z.string().max(10_000),
      result_type: z.enum(RESULT_TYPES).optional(),
      column: z.string().min(1).max(100).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      /** Formula as stored form shown with current names, `=` first. */
      formula: z.string().nullable(),
      errors: z.array(PreviewIssue),
      result_type: z.enum(RESULT_TYPES).nullable(),
      volatile: z.enum(["today", "now"]).nullable(),
      reads: z.object({
        columns: z.array(z.string()).describe("Cột của chính bảng này mà công thức đọc."),
        tables: z.array(z.string()).describe("Bảng khác mà công thức đọc cả cột."),
        grouped_calls: z.number().int().describe("Số lời gọi (SUMIFS, COUNTIFS, XLOOKUP...) được tính bằng MỘT câu SQL gom nhóm cho cả cột."),
        scanned_tables: z.array(z.object({ name: z.string(), rows: z.number().int() })).describe("Bảng phải duyệt từng dòng (tối đa 20.000 dòng)."),
      }),
      rows: z.array(z.object({ row_id: Id, row_no: z.number().int(), value: z.unknown(), error: z.string().nullable(), error_message: z.string().nullable() })),
      position: POSITION.nullable(),
    }),
    http: { method: "POST", path: "/tables/:table_id/formula/preview" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      const ix = await OwnerIndex.load(ctx.db, acc.datahub.ownerId);
      const schema = await TableSchema.load(ctx.db, acc);
      const existing = i.column ? schema.tryResolve(i.column) : null;
      if (i.column && (!existing || existing.deletedAt || existing.type !== "formula")) throw new AppError("not_found", `Không tìm thấy cột công thức "${i.column}".`);
      const at = { tableId: acc.tableId, datahubId: acc.datahub.id };
      const empty = { reads: { columns: [], tables: [], grouped_calls: 0, scanned_tables: [] }, rows: [], position: null };
      const fail = (e: unknown) => {
        if (isAppError(e) && e.code === "validation_error") {
          const pos = (e.details as { position?: { start: number; end: number } } | undefined)?.position ?? { start: 0, end: i.formula.length };
          return { ok: false, formula: null, errors: [{ message: e.message, start: pos.start, end: pos.end }], result_type: null, volatile: null, ...empty, position: pos };
        }
        throw e;
      };
      try {
        const own = existing ? { key: existing.key } : null;
        const compiled = compileFormula(i.formula, ix, at, own);
        assertScanLimits(ix, compiled.scan);
        // The cycle check and result type use the same code as saving.
        const prepared = await prepareComputed(ctx.db, ix, schema, { id: existing?.id ?? newId(), key: existing?.key ?? "c_preview0", tableId: acc.tableId, datahubId: acc.datahub.id, type: "formula", current: existing ?? undefined }, { formula: i.formula, ...(i.result_type ? { result_type: i.result_type } : {}) });
        const resultType = (prepared.resultType ?? resultTypeFor(compiled.type)) as ResultType;

        const res = await ctx.db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows
          WHERE ${acc.scope()} AND deleted_at IS NULL ORDER BY row_no LIMIT 5`);
        const env = await buildFormulaEnv(ctx.db, ix, acc.tableId, compiled.ast, new Date(), (res.rows as Record<string, unknown>[]).map(rowFromDb));
        const rows = (res.rows as Record<string, unknown>[]).map((r) => {
          const row = rowFromDb(r);
          env.setRow(row);
          const out = valueToStored(resultType, evaluate(compiled.ast, env.ctx));
          const raw = evaluate(compiled.ast, env.ctx);
          const code = out.kind === "error" ? out.code : null;
          const detail = raw instanceof FError ? raw.detail : undefined;
          return { row_id: row.id, row_no: row.rowNo, value: out.kind === "value" ? out.value : null, error: code, error_message: code ? (detail ?? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? null) : null };
        });
        const names = new Set<string>();
        const tables = new Set<string>();
        for (const d of prepared.deps) {
          const c = ix.column(d.srcTableId, d.srcKey);
          if (d.kind === "cell" && c) names.add(c.name);
          else if (d.srcTableId !== acc.tableId && c) tables.add(ix.tableById.get(d.srcTableId)!.name);
        }
        const scanned = [...new Set(compiled.scan.map((n) => n.table!))].map((t) => ({ name: ix.tableById.get(t)!.name, rows: ix.tableById.get(t)!.rowCount }));
        return {
          ok: true,
          formula: toDisplay(compiled.stored, ix, acc.tableId),
          errors: [],
          result_type: resultType,
          volatile: compiled.volatile,
          reads: { columns: [...names], tables: [...tables], grouped_calls: compiled.grouped.length, scanned_tables: scanned },
          rows,
          position: null,
        };
      } catch (e) {
        return fail(e);
      }
    },
  }),
];


function toDisplay(stored: string, ix: OwnerIndex, tableId: string): string {
  return toDisplayFormula(stored, (t, k) => ix.namesOf(tableId, t, k));
}
