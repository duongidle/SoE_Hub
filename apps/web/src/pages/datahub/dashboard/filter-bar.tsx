import { Plus, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui/form";
import { RANGES, rangeToken } from "@/lib/dashboard/config";
import type { DashCondition, DashFilters, FilterField, PickInfo } from "@/lib/dashboard/types";

const OP_WORD: Record<DashCondition["op"], string> = { eq: "=", neq: "≠", contains: "chứa", in: "thuộc" };
const show = (v: DashCondition["value"]) => (Array.isArray(v) ? v.join(", ") : v === true ? "Có" : v === false ? "Không" : String(v));

/**
 * The common filters of a dashboard (design module3 section 8): a date range and conditions on columns, and the filters made by clicking
 * charts. A change is saved as the viewer's own copy by the caller; "Về mặc định" drops that copy. The owner may also make the current
 * filters the default for everyone.
 */
export function FilterBar({ fields, value, onChange, custom, onReset, onSaveDefault, exactText, picks, onClearPick, onClearPicks }: {
  fields: FilterField[];
  value: DashFilters;
  onChange: (v: DashFilters) => void;
  /** The viewer has changed the filters (their own copy exists). */
  custom: boolean;
  onReset: () => void;
  /** Owner only. */
  onSaveDefault?: () => void;
  /** Viewer who is not the owner: a text column is filtered by exact value (the server refuses "chứa"). */
  exactText?: boolean;
  picks: { chartId: string; title: string; pick: PickInfo }[];
  onClearPick: (chartId: string) => void;
  onClearPicks: () => void;
}) {
  const conds = value.conditions ?? [];
  const [field, setField] = useState("");
  const [text, setText] = useState("");
  const f = fields.find((x) => x.name === field);
  const setRange = (token: string) => {
    const r = RANGES.find((x) => x.token === token)?.value;
    const { range: _old, ...rest } = value;
    void _old;
    onChange(r ? { ...rest, range: r } : rest);
  };
  const add = (c: DashCondition) => {
    onChange({ ...value, conditions: [...conds, c] });
    setField("");
    setText("");
  };
  const remove = (i: number) => {
    const next = conds.filter((_, k) => k !== i);
    const { conditions: _c, ...rest } = value;
    void _c;
    onChange(next.length ? { ...rest, conditions: next } : rest);
  };
  const tok = rangeToken(value.range);
  const active = !!value.range || conds.length > 0;

  return (
    <section aria-label="Bộ lọc chung" className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-card p-3" data-testid="filter-bar">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Khoảng thời gian</span>
          <Select value={tok} onChange={(e) => setRange(e.target.value)} aria-label="Khoảng thời gian chung" className="w-auto min-w-44" data-testid="filter-range">
            {RANGES.map((r) => <option key={r.token} value={r.token}>{r.label}</option>)}
            {tok === "custom" && <option value="custom">Tuỳ chỉnh (giữ nguyên)</option>}
          </Select>
        </label>
        {fields.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Lọc theo cột</span>
              <Select value={field} onChange={(e) => { setField(e.target.value); setText(""); }} aria-label="Cột để lọc" className="w-auto min-w-40" data-testid="filter-field">
                <option value="">Chọn cột…</option>
                {fields.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
              </Select>
            </label>
            {f?.kind === "enum" && (
              <Select value="" onChange={(e) => e.target.value && add({ field: f.name, op: "eq", value: e.target.value })} aria-label={`Giá trị của ${f.name}`} className="w-auto min-w-40" data-testid="filter-value">
                <option value="">Chọn giá trị…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            )}
            {f?.kind === "boolean" && (
              <Select value="" onChange={(e) => e.target.value && add({ field: f.name, op: "eq", value: e.target.value === "yes" })} aria-label={`Giá trị của ${f.name}`} className="w-auto min-w-32" data-testid="filter-value">
                <option value="">Chọn…</option>
                <option value="yes">Có</option>
                <option value="no">Không</option>
              </Select>
            )}
            {f?.kind === "text" && (
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add({ field: f.name, op: exactText ? "eq" : "contains", value: text.trim() }); }}>
                <Input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Từ cần tìm trong ${f.name}`} placeholder={exactText ? "Đúng giá trị…" : "Chứa chữ…"} className="min-w-40" data-testid="filter-value" />
                <Button type="submit" variant="secondary" disabled={!text.trim()}><Plus size={16} aria-hidden /> Thêm</Button>
              </form>
            )}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {onSaveDefault && <Button variant="secondary" onClick={onSaveDefault} disabled={!custom} data-testid="filter-save-default"><Save size={16} aria-hidden /> Lưu làm mặc định</Button>}
          <Button variant="secondary" onClick={onReset} disabled={!custom} data-testid="filter-reset"><RotateCcw size={16} aria-hidden /> Về mặc định</Button>
        </div>
      </div>
      {(conds.length > 0 || picks.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Bộ lọc đang áp dụng" data-testid="filter-chips">
          {conds.map((c, i) => (
            <li key={`${c.field}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm" data-testid="filter-chip">
              <span className="[overflow-wrap:anywhere]">{c.field} {OP_WORD[c.op]} {show(c.value)}</span>
              <Button variant="ghost" className="!min-h-7 !min-w-7 !px-1" onClick={() => remove(i)} aria-label={`Bỏ bộ lọc ${c.field} ${OP_WORD[c.op]} ${show(c.value)}`}><X size={14} aria-hidden /></Button>
            </li>
          ))}
          {picks.map((p) => (
            <li key={p.chartId} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-card py-1 pl-3 pr-1 text-sm" data-testid="cross-chip">
              <span className="[overflow-wrap:anywhere]">Từ “{p.title}”: {p.pick.groups.map((g, i) => `${p.pick.columns[i]?.column ?? ""} = ${g.label}`).join(", ")}</span>
              <Button variant="ghost" className="!min-h-7 !min-w-7 !px-1" onClick={() => onClearPick(p.chartId)} aria-label={`Bỏ lọc chéo từ ${p.title}`}><X size={14} aria-hidden /></Button>
            </li>
          ))}
          {picks.length > 1 && <li><Button variant="ghost" onClick={onClearPicks}>Bỏ mọi lọc chéo</Button></li>}
        </ul>
      )}
      {!active && picks.length === 0 && <p className="text-xs text-muted-foreground">Chọn khoảng thời gian hoặc cột để lọc mọi biểu đồ. Bấm vào một cột, điểm hay phần của biểu đồ để lọc các biểu đồ còn lại.</p>}
    </section>
  );
}
