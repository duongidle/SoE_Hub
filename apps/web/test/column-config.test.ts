import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api";
import { buildBody, buildConfig, buildDisplay, columnError, convertibleTypes, describeConversion, draftFromColumn, emptyDraft, groupedTypes, moveOption, nextColor, sampleLine, validateDraft, validateName, type TypeInfo } from "../src/lib/datahub/column-config";
import type { Column } from "../src/lib/datahub/types";

const col = (id: string, name: string, type: string, extra: Partial<Column> = {}): Column =>
  ({ id, key: id, name, type, config: {}, position: 0, required: false, unique: false, default_value: null, description: null, display: {}, version: 1, calc: null, ...extra }) as Column;

const types: TypeInfo[] = [
  { type: "text", label: "Chữ", group: "basic", available: true, writable: true, can_be_unique: true },
  { type: "number", label: "Số", group: "basic", available: true, writable: true, can_be_unique: true },
  { type: "attachment", label: "Đính kèm", group: "file", available: true, writable: true, can_be_unique: false },
  { type: "formula", label: "Công thức", group: "compute", available: true, writable: false, can_be_unique: false },
  { type: "ghost", label: "Chưa có", group: "basic", available: false, writable: true, can_be_unique: false },
];

describe("types", () => {
  it("lists the types by group, leaving out the ones that cannot be made yet", () => {
    const g = groupedTypes(types);
    expect(g.map((x) => x.id)).toEqual(["basic", "file", "compute"]);
    expect(g[0]!.types.map((t) => t.type)).toEqual(["text", "number"]);
  });
  it("lets a plain column turn into another plain one, never a computed or attachment column", () => {
    expect(convertibleTypes(types, "text").map((t) => t.type)).toEqual(["text", "number"]);
    expect(convertibleTypes(types, "formula")).toEqual([]);
    expect(convertibleTypes(types, "attachment")).toEqual([]);
  });
});

describe("column name", () => {
  const cols = [col("a", "Doanh thu", "currency"), col("b", "Khách hàng", "text")];
  it("refuses an empty name, brackets and a name that is too long", () => {
    expect(validateName("  ", cols)).toBe("Tên không được để trống.");
    expect(validateName("Giá [VND]", cols)).toBe("Tên không được chứa dấu [ hoặc ].");
    expect(validateName("x".repeat(101), cols)).toBe("Tên tối đa 100 ký tự.");
  });
  it("refuses a name another column has, ignoring case and extra spaces, but not the column's own", () => {
    expect(validateName("doanh THU", cols)).toBe("Bảng này đã có một cột tên này. Hãy đặt tên khác.");
    expect(validateName("doanh thu", cols, "a")).toBeNull();
    expect(validateName("Ngày chốt", cols)).toBeNull();
  });
});

describe("draft to API body", () => {
  it("builds the config of each type from what was typed", () => {
    expect(buildConfig({ ...emptyDraft("number"), precision: "2" })).toEqual({ precision: 2 });
    expect(buildConfig({ ...emptyDraft("number"), precision: "" })).toEqual({});
    expect(buildConfig({ ...emptyDraft("text"), maxLength: "50" })).toEqual({ max_length: 50 });
    expect(buildConfig({ ...emptyDraft("rating"), ratingMax: "10" })).toEqual({ max: 10 });
    expect(buildConfig({ ...emptyDraft("relation"), targetTableId: "t1", multiple: false })).toEqual({ target_table_id: "t1", multiple: false });
    expect(buildConfig({ ...emptyDraft("rollup"), relation: "Khách", targetColumn: "Tiền", fn: "avg" })).toEqual({ relation: "Khách", target_column: "Tiền", fn: "avg" });
    expect(buildConfig({ ...emptyDraft("formula"), formula: "[A]*2", resultType: "number" })).toEqual({ formula: "=[A]*2", result_type: "number" });
    expect(buildConfig({ ...emptyDraft("formula"), formula: "=[A]*2" })).toEqual({ formula: "=[A]*2" });
    expect(buildConfig({ ...emptyDraft("checkbox") })).toEqual({});
  });
  it("keeps the ids of options already saved and drops spaces around names", () => {
    const d = { ...emptyDraft("single_select"), options: [{ id: "o_1", name: " Mới ", color: "blue" }, { name: "Chốt", color: "green" }] };
    expect(buildConfig(d)).toEqual({ options: [{ id: "o_1", name: "Mới", color: "blue" }, { name: "Chốt", color: "green" }] });
  });
  it("formats only number-like columns", () => {
    expect(buildDisplay({ ...emptyDraft("number"), decimals: "2", thousands: false, unit: " kg " })).toEqual({ decimals: 2, thousands: false, unit: "kg" });
    expect(buildDisplay({ ...emptyDraft("percent"), decimals: "1", unit: "x" })).toEqual({ decimals: 1 });
    expect(buildDisplay({ ...emptyDraft("text"), decimals: "2" })).toEqual({});
    expect(buildDisplay({ ...emptyDraft("formula"), resultType: "text", decimals: "2" })).toEqual({});
    expect(buildDisplay({ ...emptyDraft("formula"), resultType: "number", decimals: "0" })).toEqual({ decimals: 0, thousands: true });
  });
  it("sends the description as null when it is blank and trims the name", () => {
    const b = buildBody({ ...emptyDraft("text"), name: "  Tên  ", description: "  " }, null);
    expect(b).toMatchObject({ name: "Tên", type: "text", description: null, default_value: null, required: false });
  });
  it("reads a saved column back into a draft", () => {
    const c = col("x", "Giai đoạn", "single_select", { config: { options: [{ id: "o1", name: "Mới", color: "blue" }] }, description: "Bước của deal", required: true });
    expect(draftFromColumn(c)).toMatchObject({ name: "Giai đoạn", description: "Bước của deal", required: true, options: [{ id: "o1", name: "Mới", color: "blue" }] });
    const f = col("f", "Gấp đôi", "formula", { config: { formula: "=[A]*2", result_type: "number" }, display: { decimals: 1 } });
    expect(draftFromColumn(f)).toMatchObject({ formula: "=[A]*2", resultType: "number", decimals: "1" });
    const r = col("r", "Tổng", "rollup", { config: { relation: "Khách", target_column: "Tiền", fn: "sum" } });
    expect(draftFromColumn(r)).toMatchObject({ relation: "Khách", targetColumn: "Tiền", fn: "sum" });
  });
});

describe("validateDraft", () => {
  it("names the field that is wrong", () => {
    const base = { ...emptyDraft("text"), name: "Ghi chú" };
    expect(validateDraft(base, [])).toEqual({});
    expect(validateDraft({ ...base, maxLength: "0" }, [])).toHaveProperty("maxLength");
    expect(validateDraft({ ...emptyDraft("number"), name: "N", precision: "11" }, [])).toHaveProperty("precision");
    expect(validateDraft({ ...emptyDraft("number"), name: "N", decimals: "x" }, [])).toHaveProperty("decimals");
    expect(validateDraft({ ...emptyDraft("relation"), name: "R" }, [])).toHaveProperty("targetTableId");
    expect(validateDraft({ ...emptyDraft("lookup"), name: "L" }, [])).toHaveProperty("relation");
    expect(validateDraft({ ...emptyDraft("lookup"), name: "L", relation: "R" }, [])).toHaveProperty("targetColumn");
    expect(validateDraft({ ...emptyDraft("formula"), name: "F", formula: "=" }, [])).toHaveProperty("formula");
  });
  it("checks the options: a name each, no repeats", () => {
    const d = (options: { name: string; color: string }[]) => ({ ...emptyDraft("single_select"), name: "S", options });
    expect(validateDraft(d([{ name: "A", color: "gray" }, { name: "", color: "gray" }]), []).options).toContain("thứ 2");
    expect(validateDraft(d([{ name: "Mới", color: "gray" }, { name: " mới ", color: "blue" }]), []).options).toContain("trùng");
    expect(validateDraft(d([{ name: "Mới", color: "gray" }, { name: "Chốt", color: "blue" }]), [])).toEqual({});
  });
});

describe("server errors under the right field", () => {
  const err = (status: number, code: string, message: string, details?: object) => new ApiError(status, { error: { code, message, details } } as never);
  it("puts a repeated name under the name", () => {
    expect(columnError(err(409, "conflict", "Bảng này đã có một cột tên này. Hãy đặt tên khác.", { reason: "duplicate_name" }))).toEqual({ field: "name", message: "Bảng này đã có một cột tên này. Hãy đặt tên khác." });
  });
  it("puts formula problems under the formula and link problems under the target table", () => {
    expect(columnError(err(400, "validation_error", "Không có cột \"X\" trong bảng này (công thức).", { position: { start: 1, end: 2 } })).field).toBe("formula");
    expect(columnError(err(400, "validation_error", "Bảng liên kết phải là bảng trong datahub do bạn sở hữu.", { code: "#PERM!" })).field).toBe("targetTableId");
    expect(columnError(err(400, "validation_error", "Tên lựa chọn bị trùng: \"A\".")).field).toBe("options");
  });
  it("turns an unknown English message into a Vietnamese sentence", () => {
    const r = columnError(err(400, "validation_error", "Invalid input"));
    expect(r.field).toBe("form");
    expect(r.message).toMatch(/[ăâêôơưđ]/i);
    expect(columnError(new TypeError("fetch failed")).message).toContain("kết nối");
  });
  it("explains the column limit and a missing right", () => {
    expect(columnError(err(409, "quota_exceeded", "Bạn đã dùng hết 70 cột trong một bảng.")).message).toContain("70");
    expect(columnError(err(403, "forbidden", "x")).message).toContain("chủ datahub");
  });
});

describe("type change summary", () => {
  const rep = (o: Partial<Parameters<typeof describeConversion>[0]>) => ({ total_rows: 100, with_value: 80, unchanged: 50, converted: 25, cannot_convert: 5, samples: [], ...o });
  it("says how many cells stay, change and are lost, from the server's numbers", () => {
    const s = describeConversion(rep({}), "text", "number");
    expect(s.lines).toEqual(['50 ô giữ nguyên giá trị.', '25 ô đổi sang dạng của kiểu "number".', "5 ô không chuyển được nên sẽ bị xoá trắng. Giá trị cũ vẫn nằm trong lịch sử của dòng."]);
    expect(s.lost).toBe(5);
    expect(s.harmless).toBe(false);
  });
  it("is harmless when nothing changes or is lost", () => {
    expect(describeConversion(rep({ converted: 0, cannot_convert: 0 }), "a", "b").harmless).toBe(true);
    expect(describeConversion(rep({ with_value: 0, unchanged: 0, converted: 0, cannot_convert: 0 }), "a", "b").lines[0]).toContain("Chưa ô nào");
  });
  it("shows a lost value shortly", () => {
    expect(sampleLine({ row_id: "r", row_no: 7, value: "x".repeat(60), reason: "" })).toBe(`Dòng #7: "${"x".repeat(40)}…"`);
  });
});

describe("options list", () => {
  it("moves an option up or down and stops at the ends", () => {
    const l = [{ name: "A", color: "gray" }, { name: "B", color: "gray" }, { name: "C", color: "gray" }];
    expect(moveOption(l, 1, -1).map((o) => o.name)).toEqual(["B", "A", "C"]);
    expect(moveOption(l, 2, 1)).toBe(l);
    expect(moveOption(l, 0, -1)).toBe(l);
  });
  it("starts a new option with a colour not yet used", () => {
    expect(nextColor(["gray", "blue"], ["gray", "blue", "green"])).toBe("green");
    expect(nextColor(["gray", "blue", "green"], ["gray", "blue", "green"])).toBe("gray");
  });
});
