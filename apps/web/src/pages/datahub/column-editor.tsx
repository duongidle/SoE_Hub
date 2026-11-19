import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { changeColumnType, columnTypes, createColumn, dhKeys, previewTypeChange, updateColumn } from "@/lib/datahub/api";
import { COMPUTED, ROLLUP_FUNCTIONS, TEXT_LIKE, buildBody, buildConfig, columnError, convertibleTypes, describeConversion, draftFromColumn, emptyDraft, firstError, groupedTypes, hasNumberFormat, hasProperty, moveOption, nextColor, sampleLine, validateDraft, type ColumnDraft, type ConversionReport, type DraftErrors, type TypeInfo } from "@/lib/datahub/column-config";
import { parseCellText } from "@/lib/datahub/cells";
import type { Column, TableDetail } from "@/lib/datahub/types";
import { OPTION_COLORS, optionVar } from "@/lib/theme";
import { FormulaEditor } from "./formula-editor";
import { useFormulaScope } from "./formula-scope";

const COLOR_LABEL: Record<string, string> = { gray: "Xám", blue: "Xanh dương", green: "Xanh lá", orange: "Cam", red: "Đỏ", purple: "Tím", yellow: "Vàng", teal: "Xanh ngọc", pink: "Hồng" };

/** The default value as the server takes it (stored form), or the sentence that says why it cannot be read. */
function parseDefault(d: ColumnDraft): { ok: true; value: unknown } | { ok: false; message: string } {
  const t = d.defaultText.trim();
  if (!hasProperty(d.type, "default") || (t === "" && d.type !== "checkbox")) return { ok: true, value: null };
  if (d.type === "single_select") {
    const o = d.options.find((x) => x.name.trim().toLowerCase() === t.toLowerCase());
    return o ? { ok: true, value: o.name.trim() } : { ok: false, message: "Giá trị mặc định phải là một trong các lựa chọn của cột." };
  }
  if (d.type === "checkbox") return t === "" ? { ok: true, value: null } : { ok: true, value: t === "true" };
  const pseudo = { id: "", key: "", name: d.name, type: d.type, config: {}, position: 0, required: false, unique: false, default_value: null, description: null, display: {}, version: 1, calc: null } as Column;
  return parseCellText(pseudo, t);
}

/**
 * Add a column or change one (design module2 sections 4 and 6). Everything the type needs is on one form; each field says what is wrong under
 * itself. Changing the type first asks the server what would happen to the values and shows it before anything is written.
 */
export function ColumnEditor({ table, column, onClose }: { table: TableDetail; column?: Column; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!column;
  const typesQ = useQuery({ queryKey: ["dh-column-types"], queryFn: columnTypes, staleTime: Infinity });
  const types: TypeInfo[] = typesQ.data ?? [];
  const original = useMemo(() => (column ? draftFromColumn(column) : emptyDraft("text")), [column]);
  const [draft, setDraft] = useState<ColumnDraft>(original);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ColumnDraft, boolean>>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ report: ConversionReport } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const info = types.find((t) => t.type === draft.type);
  const set = (patch: Partial<ColumnDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const others = table.columns.filter((c) => c.id !== column?.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  // Errors shown under a field once the person has left it or tried to save; they follow the draft after that.
  const live = useMemo(() => validateDraft(draft, table.columns, column?.id), [draft, table.columns, column?.id]);
  const shown = (k: keyof DraftErrors): string | undefined => errors[k] ?? (touched[k as keyof ColumnDraft] ? live[k] : undefined);
  const touch = (k: keyof ColumnDraft) => () => setTouched((t) => ({ ...t, [k]: true }));
  const fieldProps = (k: keyof DraftErrors) => ({ "aria-invalid": !!shown(k) || undefined, onBlur: touch(k as keyof ColumnDraft) });

  const focusField = (name: string) => form.current?.querySelector<HTMLElement>(`[data-field="${name}"] input, [data-field="${name}"] textarea, [data-field="${name}"] select, [data-field="${name}"] button`)?.focus();

  const failWith = (e: unknown) => {
    const r = columnError(e);
    if (r.field === "form") setFormError(e);
    else {
      setErrors((x) => ({ ...x, [r.field]: r.message }));
      setTimeout(() => focusField(r.field), 0);
    }
  };

  const done = async (text: string) => {
    await qc.invalidateQueries({ queryKey: dhKeys.table(table.id) });
    notify.ok(text);
    onClose();
  };

  const save = async () => {
    setFormError(null);
    const errs = validateDraft(draft, table.columns, column?.id);
    const def = parseDefault(draft);
    setErrors(errs);
    setTouched(Object.fromEntries(Object.keys(draft).map((k) => [k, true])));
    const first = firstError(errs);
    if (first) return void setTimeout(() => focusField(first), 0);
    if (!def.ok) {
      setFormError(new Error(def.message));
      return void setTimeout(() => focusField("default"), 0);
    }
    setBusy(true);
    try {
      if (!column) {
        await createColumn(table.id, buildBody(draft, def.value));
        return await done("Đã thêm cột");
      }
      if (draft.type !== column.type) {
        const report = await previewTypeChange(table.id, column.key, draft.type, buildConfig(draft));
        setConfirm({ report });
        return;
      }
      const body = buildBody(draft, def.value);
      const sameConfig = JSON.stringify(buildConfig(original)) === JSON.stringify(body.config);
      const patch: Record<string, unknown> = { name: body.name, description: body.description, required: body.required, unique: body.unique, default_value: body.default_value, display: body.display, version: column.version };
      if (!sameConfig) patch.config = body.config;
      if (!dirty) return onClose();
      await updateColumn(table.id, column.key, patch);
      await done("Đã lưu cột");
    } catch (e) {
      failWith(e);
    } finally {
      setBusy(false);
    }
  };

  /** After the person has read what the type change does. */
  const applyTypeChange = async () => {
    if (!column || !confirm) return;
    setBusy(true);
    try {
      const def = parseDefault(draft);
      await changeColumnType(table.id, column.key, draft.type, buildConfig(draft), confirm.report.cannot_convert > 0);
      // A type change resets the format and the default; the rest of the form is written on top of it.
      const body = buildBody(draft, def.ok ? def.value : null);
      await updateColumn(table.id, column.key, { name: body.name, description: body.description, required: body.required, unique: body.unique, default_value: body.default_value, display: body.display });
      setConfirm(null);
      await done("Đã đổi kiểu cột");
    } catch (e) {
      setConfirm(null);
      failWith(e);
    } finally {
      setBusy(false);
    }
  };


  const convertible = column ? convertibleTypes(types, column.type) : [];
  const typeLocked = editing && convertible.length === 0;
  const typeList = editing ? convertible : types;
  const typeLabel = (t: string) => types.find((x) => x.type === t)?.label ?? t;
  const numberFormat = hasNumberFormat(draft.type, COMPUTED.has(draft.type) ? draft.resultType || "number" : draft.type);

  return (
    <>
      <Modal title={editing ? `Sửa cột "${column!.name}"` : "Thêm cột"} open onClose={onClose} dirty={dirty && !busy} wide>
        <form ref={form} className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div data-field="name">
            <Field label="Tên cột" required error={shown("name")} hint="Không trùng tên cột khác trong bảng, không chứa [ hoặc ]. Công thức gọi cột bằng tên này.">
              <Input value={draft.name} onChange={(e) => { set({ name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} maxLength={100} autoComplete="off" autoFocus {...fieldProps("name")} />
            </Field>
          </div>

          <Field label="Kiểu cột" hint={typeLocked ? "Không đổi được kiểu của cột này." : editing ? "Đổi kiểu sẽ chuyển giá trị đang có. Bạn xem kết quả trước khi áp dụng." : undefined}>
            {typesQ.isLoading ? (
              <Skeleton className="h-9" />
            ) : (
              <Select value={draft.type} disabled={typeLocked} onChange={(e) => setDraft((d) => ({ ...emptyDraft(e.target.value), name: d.name, description: d.description, required: d.required }))}>
                {typeLocked
                  ? <option value={draft.type}>{typeLabel(draft.type)}</option>
                  : editing
                    ? typeList.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)
                    : groupedTypes(types).map((g) => (
                        <optgroup key={g.id} label={g.label}>
                          {g.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                        </optgroup>
                      ))}
              </Select>
            )}
          </Field>

          <TypeFields draft={draft} set={set} shown={shown} fieldProps={fieldProps} table={table} column={column} others={others} />

          {numberFormat && (
            <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium">Định dạng hiển thị</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div data-field="decimals"><Field label="Số chữ số thập phân" error={shown("decimals")} hint="Để trống thì hiện đúng số đã lưu."><Input inputMode="numeric" value={draft.decimals} onChange={(e) => set({ decimals: e.target.value })} {...fieldProps("decimals")} /></Field></div>
                {draft.type !== "percent" && draft.type !== "currency" && (
                  <div data-field="unit"><Field label="Đơn vị" error={shown("unit")} hint="Ví dụ kg, ngày. Hiện sau số."><Input value={draft.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={20} {...fieldProps("unit")} /></Field></div>
                )}
              </div>
              {draft.type !== "percent" && draft.type !== "currency" && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input type="checkbox" className="h-5 w-5" checked={draft.thousands} onChange={(e) => set({ thousands: e.target.checked })} />
                  Dùng dấu chấm ngăn cách hàng nghìn
                </label>
              )}
            </fieldset>
          )}

          <Field label="Mô tả" hint="Hiện cho người nhập dữ liệu khi sửa dòng.">
            <Textarea rows={2} value={draft.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
          </Field>

          {(hasProperty(draft.type, "required") || hasProperty(draft.type, "unique", info) || hasProperty(draft.type, "default")) && (
            <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium">Thuộc tính</legend>
              {hasProperty(draft.type, "required") && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input type="checkbox" className="h-5 w-5" checked={draft.required} onChange={(e) => set({ required: e.target.checked })} />
                  Bắt buộc có giá trị
                </label>
              )}
              {hasProperty(draft.type, "unique", info) && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input type="checkbox" className="h-5 w-5" checked={draft.unique} onChange={(e) => set({ unique: e.target.checked })} />
                  Không cho trùng giá trị
                </label>
              )}
              {hasProperty(draft.type, "default") && (
                <div data-field="default">
                  {draft.type === "checkbox" ? (
                    <Field label="Giá trị mặc định" hint="Dòng mới có giá trị này.">
                      <Select value={draft.defaultText} onChange={(e) => set({ defaultText: e.target.value })}>
                        <option value="">Không đặt</option>
                        <option value="true">Có</option>
                        <option value="false">Không</option>
                      </Select>
                    </Field>
                  ) : draft.type === "single_select" ? (
                    <Field label="Giá trị mặc định" hint="Dòng mới có lựa chọn này.">
                      <Select value={draft.defaultText} onChange={(e) => set({ defaultText: e.target.value })}>
                        <option value="">Không đặt</option>
                        {draft.options.filter((o) => o.name.trim()).map((o, i) => <option key={`${o.id ?? "n"}${i}`} value={o.name.trim()}>{o.name.trim()}</option>)}
                      </Select>
                    </Field>
                  ) : (
                    <Field label="Giá trị mặc định" hint="Dòng mới có giá trị này. Để trống nếu không cần.">
                      <Input value={draft.defaultText} onChange={(e) => set({ defaultText: e.target.value })} autoComplete="off" />
                    </Field>
                  )}
                  {editing && <p className="mt-1 text-xs text-muted-foreground">Giá trị mặc định cũ được giữ khi bạn không đổi ô này.</p>}
                </div>
              )}
            </fieldset>
          )}

          {formError ? <ErrorText error={formError} /> : null}
          {/* The buttons stay in view at the bottom of a long form, so an error line above never moves them from under the pointer. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap justify-between gap-2 border-t border-border bg-card px-5 py-3">
            <Button variant="secondary" onClick={onClose}>Huỷ</Button>
            <Button type="submit" loading={busy}>{editing ? "Lưu cột" : "Thêm cột"}</Button>
          </div>
        </form>
      </Modal>

      {confirm && column && (
        <TypeChangeDialog column={column} to={typeLabel(draft.type)} from={typeLabel(column.type)} report={confirm.report} busy={busy} onConfirm={() => void applyTypeChange()} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

// ---- type change --------------------------------------------------------------------------------------------------------------------

function TypeChangeDialog({ column, from, to, report, busy, onConfirm, onClose }: { column: Column; from: string; to: string; report: ConversionReport; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const s = describeConversion(report, from, to);
  return (
    <ConfirmDialog
      title={`Đổi cột "${column.name}" từ ${from} sang ${to}?`}
      message={
        <span className="flex flex-col gap-2">
          {s.lines.map((l) => <span key={l}>{l}</span>)}
          {report.samples.length > 0 && (
            <span className="flex flex-col gap-1 rounded-md bg-muted p-2 text-xs">
              <span className="font-medium">Ví dụ các ô sẽ bị xoá trắng:</span>
              {report.samples.slice(0, 5).map((x) => <span key={x.row_id} className="[overflow-wrap:anywhere]">{sampleLine(x)}</span>)}
              {report.samples.length > 5 && <span>và {report.samples.length - 5} ví dụ khác</span>}
            </span>
          )}
        </span>
      }
      confirmLabel={s.lost > 0 ? `Đổi kiểu và xoá ${s.lost.toLocaleString("vi-VN")} ô` : "Đổi kiểu cột"}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

// ---- fields of each type ------------------------------------------------------------------------------------------------------------

type Shown = (k: keyof DraftErrors) => string | undefined;
type FieldProps = (k: keyof DraftErrors) => { "aria-invalid"?: true; onBlur: () => void };

function TypeFields({ draft, set, shown, fieldProps, table, column, others }: { draft: ColumnDraft; set: (p: Partial<ColumnDraft>) => void; shown: Shown; fieldProps: FieldProps; table: TableDetail; column?: Column; others: Column[] }) {
  const t = draft.type;
  const num = (k: keyof DraftErrors, label: string, key: keyof ColumnDraft, hint?: string, required = false) => (
    <div data-field={k}>
      <Field label={label} required={required} error={shown(k)} hint={hint}>
        <Input inputMode="numeric" value={String(draft[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<ColumnDraft>)} {...fieldProps(k)} />
      </Field>
    </div>
  );
  if (TEXT_LIKE.has(t)) return num("maxLength", "Độ dài tối đa", "maxLength", "Để trống thì không giới hạn.");
  if (t === "number") return num("precision", "Làm tròn tới số chữ số thập phân", "precision", "Để trống thì giữ nguyên số đã nhập. Giá trị được làm tròn khi lưu.");
  if (t === "rating") return num("ratingMax", "Số sao", "ratingMax", "Từ 1 đến 10.", true);
  if (t === "attachment") return num("maxFiles", "Số file tối đa mỗi ô", "maxFiles", "Từ 1 đến 50. Để trống thì tối đa 20.");
  if (t === "auto_number") return num("start", "Số bắt đầu", "start", "Dòng đầu tiên nhận số này; các dòng sau tăng dần.", true);
  if (t === "single_select" || t === "multi_select") return <OptionsEditor draft={draft} set={set} error={shown("options")} />;
  if (t === "relation") return <RelationFields draft={draft} set={set} shown={shown} fieldProps={fieldProps} table={table} locked={!!column} />;
  if (t === "lookup" || t === "rollup") return <LookupFields draft={draft} set={set} shown={shown} table={table} others={others} />;
  if (t === "formula") {
    return (
      <div data-field="formula" className="flex flex-col gap-1">
        <label htmlFor="col-formula" className="text-sm font-medium">Công thức <span className="text-bad" aria-hidden>*</span></label>
        <FormulaEditor id="col-formula" table={table} column={column} value={draft.formula} onChange={(v) => set({ formula: v })} resultType={draft.resultType} onResultType={(v) => set({ resultType: v })} error={shown("formula")} />
      </div>
    );
  }
  return null;
}

function OptionsEditor({ draft, set, error }: { draft: ColumnDraft; set: (p: Partial<ColumnDraft>) => void; error?: string }) {
  const list = draft.options;
  const update = (i: number, patch: Partial<(typeof list)[number]>) => set({ options: list.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const add = () => set({ options: [...list, { name: "", color: nextColor(list.map((o) => o.color), OPTION_COLORS) }] });
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <fieldset className="flex flex-col gap-2" data-field="options">
      <legend className="mb-1 text-sm font-medium">Lựa chọn</legend>
      <p className="text-xs text-muted-foreground">Thứ tự ở đây là thứ tự khi sắp xếp. Đổi tên một lựa chọn không làm mất giá trị đã nhập.</p>
      {list.length === 0 && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Chưa có lựa chọn nào.</p>}
      <ul className="flex flex-col gap-2">
        {list.map((o, i) => (
          <li key={o.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <span aria-hidden className="h-5 w-5 shrink-0 rounded" style={{ background: optionVar(o.color) }} />
            <Input ref={(el) => { refs.current[i] = el; }} aria-label={`Tên lựa chọn ${i + 1}`} value={o.name} maxLength={100} onChange={(e) => update(i, { name: e.target.value })} className="min-w-0 flex-1 basis-40" />
            <Select aria-label={`Màu của lựa chọn ${i + 1}`} value={o.color} onChange={(e) => update(i, { color: e.target.value })} className="!w-32 shrink-0">
              {OPTION_COLORS.map((c) => <option key={c} value={c}>{COLOR_LABEL[c]}</option>)}
            </Select>
            <span className="flex shrink-0 gap-1">
              <Tip label="Chuyển lên"><Button variant="ghost" aria-label={`Chuyển lựa chọn ${i + 1} lên`} disabled={i === 0} onClick={() => set({ options: moveOption(list, i, -1) })} className="!px-2"><ArrowUp size={16} aria-hidden /></Button></Tip>
              <Tip label="Chuyển xuống"><Button variant="ghost" aria-label={`Chuyển lựa chọn ${i + 1} xuống`} disabled={i === list.length - 1} onClick={() => set({ options: moveOption(list, i, 1) })} className="!px-2"><ArrowDown size={16} aria-hidden /></Button></Tip>
              <Tip label="Xoá lựa chọn"><Button variant="ghost" aria-label={`Xoá lựa chọn ${i + 1}`} onClick={() => set({ options: list.filter((_, k) => k !== i) })} className="!px-2 !text-bad"><Trash2 size={16} aria-hidden /></Button></Tip>
            </span>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" onClick={() => { add(); setTimeout(() => refs.current[list.length]?.focus(), 0); }}><Plus size={16} aria-hidden /> Thêm lựa chọn</Button>
      </div>
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
    </fieldset>
  );
}

function RelationFields({ draft, set, shown, fieldProps, table, locked }: { draft: ColumnDraft; set: (p: Partial<ColumnDraft>) => void; shown: Shown; fieldProps: FieldProps; table: TableDetail; locked: boolean }) {
  const { scope } = useFormulaScope(table);
  // Every table of every datahub of the same owner (the server refuses anyone else's).
  const all = [scope.datahub, ...scope.others];
  const holder = all.find((d) => d.tables.some((t) => t.id === draft.targetTableId));
  const [picked, setPicked] = useState<string | null>(null);
  const dh = all.find((d) => d.id === (picked ?? holder?.id ?? scope.datahub.id)) ?? scope.datahub;
  const target = dh.tables.find((t) => t.id === draft.targetTableId);
  return (
    <div className="flex flex-col gap-3">
      <Field label="Datahub của bảng cần liên kết" hint={locked ? undefined : "Mặc định là datahub này. Chỉ có datahub của bạn."}>
        <Select value={dh.id} disabled={locked} onChange={(e) => { setPicked(e.target.value); set({ targetTableId: "" }); }}>
          {all.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === scope.datahub.id ? " (hiện tại)" : ""}</option>)}
        </Select>
      </Field>
      <div data-field="targetTableId">
        <Field label="Liên kết tới bảng" required error={shown("targetTableId")} hint={locked ? "Không đổi được bảng đích của cột đã tạo. Muốn đổi thì tạo cột mới." : "Mỗi ô chọn các dòng của bảng đó."}>
          <Select value={draft.targetTableId} disabled={locked} onChange={(e) => set({ targetTableId: e.target.value })} {...fieldProps("targetTableId")}>
            <option value="">Chọn bảng</option>
            {dh.tables.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === table.id ? " (bảng này)" : ""}</option>)}
          </Select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
        <input type="checkbox" className="h-5 w-5" checked={draft.multiple} onChange={(e) => set({ multiple: e.target.checked })} />
        Cho liên kết nhiều dòng trong một ô
      </label>
      {target && !draft.multiple && <p className="text-xs text-muted-foreground">Mỗi ô chỉ liên kết một dòng của bảng "{target.name}".</p>}
      <p className="text-xs text-muted-foreground">Chỉ chủ datahub chọn được dòng liên kết. Người được chia sẻ chỉ thấy tên các dòng đã liên kết.</p>
    </div>
  );
}

function LookupFields({ draft, set, shown, table, others }: { draft: ColumnDraft; set: (p: Partial<ColumnDraft>) => void; shown: Shown; table: TableDetail; others: Column[] }) {
  const { columnsOf, ensure, scope } = useFormulaScope(table);
  const relations = others.filter((c) => c.type === "relation");
  const rel = relations.find((c) => c.name === draft.relation);
  const targetId = (rel?.config.target_table_id as string | undefined) ?? "";
  useEffect(() => {
    if (targetId) ensure(targetId);
  }, [targetId, ensure]);
  const targetCols = targetId ? columnsOf(targetId) : null;
  const targetName = [scope.datahub, ...scope.others].flatMap((d) => d.tables).find((t) => t.id === targetId)?.name;
  const NUMERIC = new Set(["number", "currency", "percent", "auto_number"]);
  const col = targetCols?.find((c) => c.name === draft.targetColumn);
  const numeric = !!col && (NUMERIC.has(col.type) || (["formula", "rollup", "lookup"].includes(col.type) && ["number", "percent"].includes(String(col.config.result_type))));
  const fns = ROLLUP_FUNCTIONS.filter((f) => !f.numeric || numeric || !col);
  return (
    <div className="flex flex-col gap-3">
      <div data-field="relation">
        <Field label="Cột Liên kết của bảng này" required error={shown("relation")} hint={relations.length === 0 ? "Bảng này chưa có cột Liên kết. Thêm cột Liên kết trước." : "Lấy dữ liệu của các dòng đã được liên kết ở cột này."}>
          <Select value={draft.relation} disabled={relations.length === 0} onChange={(e) => set({ relation: e.target.value, targetColumn: "" })}>
            <option value="">Chọn cột Liên kết</option>
            {relations.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      <div data-field="targetColumn">
        <Field label={`Cột của bảng${targetName ? ` "${targetName}"` : " được liên kết"}`} required error={shown("targetColumn")}>
          <Select value={draft.targetColumn} disabled={!rel || targetCols === null} onChange={(e) => set({ targetColumn: e.target.value })}>
            <option value="">{rel && targetCols === null ? "Đang tải…" : "Chọn cột"}</option>
            {(targetCols ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      {draft.type === "rollup" && (
        <Field label="Cách tổng hợp" hint="Tổng và trung bình chỉ dùng cho cột số.">
          <Select value={draft.fn} onChange={(e) => set({ fn: e.target.value })}>
            {fns.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </Field>
      )}
      <p className="text-xs text-muted-foreground">Giá trị do máy chủ tính, không sửa trực tiếp được.</p>
    </div>
  );
}

