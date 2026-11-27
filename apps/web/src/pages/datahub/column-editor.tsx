import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { changeColumnType, columnTypes, createColumn, dhKeys, optionImpact, previewTypeChange, updateColumn, type ColumnBody, type OptionImpact } from "@/lib/datahub/api";
import { COMPUTED, ROLLUP_FUNCTIONS, TEXT_LIKE, buildBody, buildConfig, columnError, emptyAttr, type AttrDraft, convertibleTypes, describeConversion, draftFromColumn, emptyDraft, firstError, groupedTypes, hasNumberFormat, hasProperty, moveOption, nextColor, sampleLine, validateDraft, type ColumnDraft, type ConversionReport, type DraftErrors, type TypeInfo } from "@/lib/datahub/column-config";
import { parseCellText, SYSTEM_TYPES } from "@/lib/datahub/cells";
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
/** Where a column editor saves. The default is the ordinary column commands of the table; the Template page gives the template commands. */
export interface ColumnAdapter {
  create: (body: ColumnBody) => Promise<unknown>;
  update: (key: string, body: ColumnBody) => Promise<unknown>;
  changeType: (key: string, type: string, config: Record<string, unknown> | undefined, acceptDataLoss: boolean) => Promise<unknown>;
  preview: (key: string, type: string, config?: Record<string, unknown>) => ReturnType<typeof previewTypeChange>;
  optionImpact: (key: string, options: { id?: string; name: string; color?: string }[]) => Promise<OptionImpact>;
  /** Refresh what shows the columns after a save. */
  refresh: () => Promise<unknown>;
}

const tableAdapter = (tableId: string, qc: ReturnType<typeof useQueryClient>): ColumnAdapter => ({
  create: (b) => createColumn(tableId, b),
  update: (k, b) => updateColumn(tableId, k, b),
  changeType: (k, t, c, a) => changeColumnType(tableId, k, t, c, a),
  preview: (k, t, c) => previewTypeChange(tableId, k, t, c),
  optionImpact: (k, o) => optionImpact(tableId, k, o),
  refresh: () => qc.invalidateQueries({ queryKey: dhKeys.table(tableId) }),
});

export function ColumnEditor({ table, column, onClose, adapter, confirmText, notice }: { table: TableDetail; column?: Column; onClose: () => void; adapter?: ColumnAdapter; confirmText?: string; notice?: React.ReactNode }) {
  const qc = useQueryClient();
  const ad = adapter ?? tableAdapter(table.id, qc);
  // The Template page asks "Áp dụng cho N người" before the first write of a save.
  const [asking, setAsking] = useState(false);
  const confirmed = useRef(false);
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
  // Renamed options that formulas compare with as text: the person sees them before saving (design module4 19d).
  const [impact, setImpact] = useState<{ data: OptionImpact; patch: Record<string, unknown> } | null>(null);
  const [updateFormulas, setUpdateFormulas] = useState(true);
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
    await ad.refresh();
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
        if (confirmText && !confirmed.current) return void setAsking(true);
        await ad.create(buildBody(draft, def.value));
        return await done("Đã thêm cột");
      }
      if (draft.type !== column.type) {
        const report = await ad.preview(column.key, draft.type, buildConfig(draft));
        setConfirm({ report });
        return;
      }
      const body = buildBody(draft, def.value);
      const sameConfig = JSON.stringify(buildConfig(original)) === JSON.stringify(body.config);
      const patch: Record<string, unknown> = { name: body.name, description: body.description, required: body.required, allow_edit: body.allow_edit, unique: body.unique, default_value: body.default_value, display: body.display, version: column.version };
      if (!sameConfig) patch.config = body.config;
      if (!dirty) return onClose();
      const isSelect = column.type === "single_select" || column.type === "multi_select";
      const renamed = isSelect && !sameConfig && draft.options.some((o) => o.id && original.options.some((x) => x.id === o.id && x.name.trim() !== o.name.trim()));
      if (renamed) {
        const data = await ad.optionImpact(column.key, draft.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), color: o.color })));
        if (data.formulas.length > 0) {
          setImpact({ data, patch });
          return;
        }
      }
      if (confirmText && !confirmed.current) return void setAsking(true);
      await ad.update(column.key, patch);
      await done("Đã lưu cột");
    } catch (e) {
      failWith(e);
    } finally {
      setBusy(false);
      confirmed.current = false;
    }
  };

  /** After the person has read which formulas compare the renamed option with its old name. */
  const applyWithFormulas = async () => {
    if (!column || !impact) return;
    setBusy(true);
    try {
      await ad.update(column.key, { ...impact.patch, ...(updateFormulas ? { update_formulas: true } : {}) });
      setImpact(null);
      await done(updateFormulas ? "Đã lưu cột và cập nhật công thức" : "Đã lưu cột");
    } catch (e) {
      setImpact(null);
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
      await ad.changeType(column.key, draft.type, buildConfig(draft), confirm.report.cannot_convert > 0);
      // A type change resets the format and the default; the rest of the form is written on top of it.
      const body = buildBody(draft, def.ok ? def.value : null);
      await ad.update(column.key, { name: body.name, description: body.description, required: body.required, allow_edit: body.allow_edit, unique: body.unique, default_value: body.default_value, display: body.display });
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
      <Drawer
        title={editing ? `Sửa cột "${column!.name}"` : "Thêm cột"}
        open
        onClose={onClose}
        dirty={dirty && !busy}
        width="sm:w-[480px]"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={onClose}>Huỷ</Button>
            <Button type="submit" form="column-form" loading={busy}>{editing ? "Lưu cột" : "Thêm cột"}</Button>
          </div>
        }
      >
        <form id="column-form" ref={form} className="flex flex-col gap-6" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {notice}
          <Section title="Cơ bản">
            <div data-field="name">
              <Field label="Tên cột" required error={shown("name")} hint="Không trùng tên cột khác trong bảng, không chứa [ hoặc ]. Công thức gọi cột bằng tên này.">
                <Input value={draft.name} onChange={(e) => { set({ name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} maxLength={100} autoComplete="off" autoFocus {...fieldProps("name")} />
              </Field>
            </div>

            <Field label="Kiểu cột" hint={typeLocked ? "Không đổi được kiểu của cột này." : editing ? "Đổi kiểu sẽ chuyển giá trị đang có. Bạn xem kết quả trước khi áp dụng." : undefined}>
              {typesQ.isLoading ? (
                <Skeleton className="h-9" />
              ) : (
                <Select value={draft.type} disabled={typeLocked} onChange={(e) => setDraft((d) => ({ ...emptyDraft(e.target.value), name: d.name, description: d.description, required: d.required, allowEdit: d.allowEdit }))}>
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

            <Field label="Mô tả" hint="Hiện cho người nhập dữ liệu khi sửa dòng.">
              <Textarea rows={2} value={draft.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </Section>

          {numberFormat && (
            <Section title="Định dạng">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div data-field="decimals"><Field label="Số chữ số thập phân" error={shown("decimals")} hint="Để trống thì hiện đúng số đã lưu."><Input inputMode="numeric" value={draft.decimals} onChange={(e) => set({ decimals: e.target.value })} {...fieldProps("decimals")} /></Field></div>
                {draft.type !== "percent" && draft.type !== "currency" && (
                  <div data-field="unit"><Field label="Đơn vị" error={shown("unit")} hint="Ví dụ kg, ngày. Hiện sau số."><Input value={draft.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={20} {...fieldProps("unit")} /></Field></div>
                )}
              </div>
              {draft.type !== "percent" && draft.type !== "currency" && (
                <Switch checked={draft.thousands} onChange={(v) => set({ thousands: v })} label="Dùng dấu chấm ngăn cách hàng nghìn" />
              )}
            </Section>
          )}

          {(hasProperty(draft.type, "allow_edit") || hasProperty(draft.type, "required")) && (
            <Section title="Thuộc tính">
              {hasProperty(draft.type, "required") && <Switch checked={draft.required} onChange={(v) => set({ required: v })} label="Bắt buộc có giá trị" />}
              {hasProperty(draft.type, "allow_edit") && (
                <Switch checked={draft.allowEdit} onChange={(v) => set({ allowEdit: v })} label="Cho phép sửa" hint="Người được chia sẻ có quyền Sửa được gõ vào cột này; chủ bảng luôn sửa được." />
              )}
            </Section>
          )}

          {(hasProperty(draft.type, "unique", info) || hasProperty(draft.type, "default")) && (
            <Section title="Nâng cao">
              {hasProperty(draft.type, "unique", info) && <Switch checked={draft.unique} onChange={(v) => set({ unique: v })} label="Không cho trùng giá trị" />}
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
            </Section>
          )}

          {formError ? <ErrorText error={formError} /> : null}
        </form>
      </Drawer>
      {asking && confirmText && (
        <ConfirmDialog title="Áp dụng thay đổi template?" message={<span data-testid="template-confirm">{confirmText}</span>} confirmLabel="Xác nhận" onClose={() => setAsking(false)} onConfirm={() => { confirmed.current = true; setAsking(false); void save(); }} />
      )}

      {impact && (
        <Modal title="Công thức đang so chữ với tên cũ" open onClose={() => setImpact(null)}>
          <div className="flex flex-col gap-3 text-sm" data-testid="option-impact">
            <p>
              Bạn đổi tên {impact.data.renames.map((r) => `"${r.from}" thành "${r.to}"`).join(", ")}. {impact.data.formulas.length === 1 ? "Công thức sau" : `${impact.data.formulas.length} công thức sau`} so sánh cột này với tên cũ.
              Nếu không cập nhật, công thức không báo lỗi mà cho kết quả sai.
            </p>
            <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
              {impact.data.formulas.map((f) => (
                <li key={f.column_id} className="rounded-md border border-border p-2">
                  <div className="font-medium [overflow-wrap:anywhere]">{f.table_name} › {f.column_name}</div>
                  <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Hiện tại: <code>{f.before}</code></div>
                  <div className="text-xs [overflow-wrap:anywhere]">Sau khi cập nhật: <code>{f.after}</code></div>
                </li>
              ))}
            </ul>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-9">
              <input type="checkbox" className="h-5 w-5" checked={updateFormulas} onChange={(e) => setUpdateFormulas(e.target.checked)} data-testid="option-impact-update" />
              Cập nhật cả các công thức này
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-4">
              <Button variant="secondary" onClick={() => setImpact(null)}>Quay lại</Button>
              <Button loading={busy} onClick={() => void applyWithFormulas()} data-testid="option-impact-save">Lưu cột</Button>
            </div>
          </div>
        </Modal>
      )}
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
  if (t === "user") return <AttrsEditor draft={draft} set={set} error={shown("attrs")} />;
  if (t === "field_modified") {
    // Columns people type into; computed and system-made values change without anyone editing, so they cannot be watched.
    const watchable = others.filter((c) => !COMPUTED.has(c.type) && !SYSTEM_TYPES.has(c.type) && c.type !== "auto_number");
    const toggle = (key: string) => set({ watch: draft.watch.includes(key) ? draft.watch.filter((k) => k !== key) : draft.watch.length >= 5 ? draft.watch : [...draft.watch, key] });
    return (
      <fieldset className="flex flex-col gap-1" data-field="watch">
        <legend className="mb-1 text-sm font-medium">Cột theo dõi <span className="text-bad" aria-hidden>*</span></legend>
        <p className="text-xs text-muted-foreground">Cột này ghi lại lần gần nhất người, API hoặc form đổi giá trị một trong các cột được chọn (1–5 cột). Công thức tính lại không tính là đổi.</p>
        {watchable.map((c) => (
          <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" className="h-5 w-5" checked={draft.watch.includes(c.key)} onChange={() => toggle(c.key)} />
            <span className="[overflow-wrap:anywhere]">{c.name}</span>
          </label>
        ))}
        {shown("watch") && <p role="alert" className="text-sm text-bad">{shown("watch")}</p>}
      </fieldset>
    );
  }
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

/** Attributes of each person in a Người dùng cell (module4 4.5): a label (role), a share in %, or yes/no; a percent can be capped in total. */
function AttrsEditor({ draft, set, error }: { draft: ColumnDraft; set: (p: Partial<ColumnDraft>) => void; error?: string }) {
  const list = draft.attrs;
  const update = (i: number, patch: Partial<AttrDraft>) => set({ attrs: list.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  return (
    <fieldset className="flex flex-col gap-2" data-field="attrs" data-testid="attrs-editor">
      <legend className="mb-1 text-sm font-medium">Thuộc tính của mỗi người</legend>
      <p className="text-xs text-muted-foreground">Ví dụ vai trò (nhãn), tỉ lệ doanh thu (%). Để trống thì ô chỉ chứa người, không có thuộc tính. Tối đa 8.</p>
      <ul className="flex flex-col gap-3">
        {list.map((a, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="attr-row">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Tên"><Input aria-label={`Tên thuộc tính ${i + 1}`} value={a.label} onChange={(e) => update(i, { label: e.target.value, ...(a.fresh && (a.key === "" || a.key === slugKey(a.label)) ? { key: slugKey(e.target.value) } : {}) })} /></Field>
              <Field label="Mã"><Input aria-label={`Mã thuộc tính ${i + 1}`} value={a.key} onChange={(e) => update(i, { key: e.target.value })} /></Field>
              <Field label="Kiểu">
                <Select aria-label={`Kiểu thuộc tính ${i + 1}`} value={a.kind} onChange={(e) => update(i, { kind: e.target.value as AttrDraft["kind"] })}>
                  <option value="select">Nhãn (chọn một)</option>
                  <option value="percent">Phần trăm</option>
                  <option value="boolean">Có / không</option>
                </Select>
              </Field>
              <Button variant="secondary" aria-label={`Xoá thuộc tính ${i + 1}`} onClick={() => set({ attrs: list.filter((_, k) => k !== i) })}><Trash2 size={16} aria-hidden /></Button>
            </div>
            {a.kind === "select" && <Field label="Các nhãn" hint="Cách nhau bằng dấu phẩy."><Input aria-label={`Các nhãn thuộc tính ${i + 1}`} value={a.options} onChange={(e) => update(i, { options: e.target.value })} /></Field>}
            {a.kind === "percent" && (
              <div className="flex flex-wrap gap-2">
                <Field label="Tổng tối đa (%)" hint="Tổng của mọi người trong một ô không vượt quá."><Input aria-label={`Tổng tối đa thuộc tính ${i + 1}`} inputMode="decimal" value={a.sumMax} onChange={(e) => update(i, { sumMax: e.target.value })} /></Field>
                <Field label="Hoặc theo tham số" hint="Tên tham số trong bảng Tham số com."><Input aria-label={`Tham số giới hạn thuộc tính ${i + 1}`} value={a.capParam} onChange={(e) => update(i, { capParam: e.target.value })} /></Field>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {list.length < 8 && <div><Button variant="secondary" onClick={() => set({ attrs: [...list, emptyAttr()] })}><Plus size={16} aria-hidden /> Thêm thuộc tính</Button></div>}
    </fieldset>
  );
}

/** "Vai trò bán hàng" -> "vai_tro_ban_hang": the code of an attribute, made from its name until the person types their own. */
function slugKey(label: string): string {
  const k = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return /^[a-z]/.test(k) ? k : k ? `a_${k}`.slice(0, 30) : "";
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


/** A titled group of fields of the column drawer. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="border-b border-border-soft pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
