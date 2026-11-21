import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui/form";
import { attrsOf, entriesOf, type PersonAttr, type PersonEntry } from "@/lib/datahub/cells";
import type { Column } from "@/lib/datahub/types";
import { PersonPicker } from "./pickers";

/** "50", "50%", "12,5%" -> 0.5, 0.5, 0.125; null when it is not a number. */
export function parsePercentText(t: string): number | null {
  const s = t.trim().replace(/%$/, "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 10000 : null;
}
const percentText = (v: unknown) => (typeof v === "number" ? `${String(Number((v * 100).toPrecision(10))).replace(".", ",")}%` : "");

/** The people of a Người dùng cell with attributes and the attributes of each (role, %, yes/no). Saves the whole list; the server says why a list is refused (total over 100%, over the cap). */
export function PeopleAttrsEditor({ col, tableId, value, names, onSave, onCancel, readonly, error, busy }: { col: Column; tableId: string; value: unknown; names: ReadonlyMap<string, string>; onSave: (v: PersonEntry[] | null) => void; onCancel: () => void; readonly?: boolean; error?: string | null; busy?: boolean }) {
  const attrs = attrsOf(col);
  const [list, setList] = useState<PersonEntry[]>(() => entriesOf(value));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [known, setKnown] = useState<Record<string, string>>({});
  const nameOf = (id: string) => known[id] ?? names.get(id) ?? "…";
  const setAttr = (i: number, a: PersonAttr, v: string | number | boolean | null) => setList((l) => l.map((e, k) => (k === i ? { ...e, attrs: { ...e.attrs, [a.key]: v } } : e)));
  const total = (a: PersonAttr) => list.reduce((s, e) => s + (typeof e.attrs[a.key] === "number" ? (e.attrs[a.key] as number) : 0), 0);
  return (
    <div className="flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-md" data-testid="people-attrs" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      {list.length === 0 && <p className="text-muted-foreground">Chưa có người nào.</p>}
      <ul className="flex flex-col gap-2">
        {list.map((e, i) => (
          <li key={e.id} className="flex flex-col gap-1 rounded-md border border-border p-2" data-testid="people-entry">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">{nameOf(e.id)}</span>
              {!readonly && <Button variant="ghost" aria-label={`Bỏ ${nameOf(e.id)}`} className="!px-2 !text-bad" onClick={() => setList((l) => l.filter((_, k) => k !== i))}><Trash2 size={16} aria-hidden /></Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {attrs.map((a) => {
                const v = e.attrs[a.key];
                const k = `${e.id}:${a.key}`;
                return (
                  <label key={a.key} className="flex min-w-24 flex-1 flex-col gap-0.5 text-xs text-muted-foreground">
                    {a.label}
                    {a.kind === "select" ? (
                      <Select aria-label={`${a.label} của ${nameOf(e.id)}`} disabled={readonly} value={typeof v === "string" ? v : ""} onChange={(ev) => setAttr(i, a, ev.target.value || null)}>
                        <option value="">—</option>
                        {(a.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                    ) : a.kind === "percent" ? (
                      <Input aria-label={`${a.label} của ${nameOf(e.id)}`} disabled={readonly} inputMode="decimal" className="text-right" placeholder="0%" value={texts[k] ?? percentText(v)} onChange={(ev) => { setTexts((t) => ({ ...t, [k]: ev.target.value })); setAttr(i, a, parsePercentText(ev.target.value)); }} />
                    ) : (
                      <input type="checkbox" aria-label={`${a.label} của ${nameOf(e.id)}`} disabled={readonly} className="h-5 w-5" checked={v === true} onChange={(ev) => setAttr(i, a, ev.target.checked)} />
                    )}
                  </label>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {attrs.filter((a) => a.kind === "percent" && (a.sum_max !== undefined || list.length > 0)).map((a) => (
        <p key={a.key} className="text-xs text-muted-foreground">Tổng {a.label}: {percentText(total(a)) || "0%"}{a.sum_max !== undefined ? ` (tối đa ${percentText(a.sum_max)})` : ""}</p>
      ))}
      {!readonly && adding && (
        <PersonPicker tableId={tableId} value={null} onCancel={() => setAdding(false)} onDone={(p) => {
          setAdding(false);
          if (!p || list.some((x) => x.id === p.id)) return;
          setKnown((k) => ({ ...k, [p.id]: p.full_name }));
          setList((l) => [...l, { id: p.id, attrs: Object.fromEntries(attrs.filter((a) => a.default !== undefined && a.default !== null).map((a) => [a.key, a.default as string | number | boolean])) }]);
        }} />
      )}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!readonly ? <Button variant="secondary" onClick={() => setAdding((v) => !v)}><Plus size={16} aria-hidden /> Thêm người</Button> : <span />}
        <span className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>{readonly ? "Đóng" : "Huỷ"}</Button>
          {!readonly && <Button loading={busy} onClick={() => onSave(list.length ? list : null)}>Lưu</Button>}
        </span>
      </div>
    </div>
  );
}
