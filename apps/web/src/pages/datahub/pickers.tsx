import { Check, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { lookupPeople } from "@/lib/datahub/api";
import type { Person, SelectOption } from "@/lib/datahub/types";
import { optionVar } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Pickers shared by the grid (inside its overlay editor) and the row detail panel. Each is a plain controlled component:
 * it reports the new value and the caller decides when to save.
 */

export function OptionChip({ option }: { option: SelectOption }) {
  return (
    <span className="inline-flex max-w-full items-center rounded px-2 py-0.5 text-sm [overflow-wrap:anywhere]" style={{ background: optionVar(option.color) }}>
      {option.name}
    </span>
  );
}

/** List of options. Single: a click picks and finishes. Multiple: clicks toggle, "Xong" finishes. Arrow keys move, Enter picks, Esc cancels. */
export function SelectPicker({ options, value, multi, onChange, onDone, onCancel, autoFocus = true }: { options: SelectOption[]; value: string[]; multi: boolean; onChange: (ids: string[]) => void; onDone: (ids: string[]) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter((o) => o.name.toLowerCase().includes(n)) : options;
  }, [options, q]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const pick = (id: string) => {
    if (multi) onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    else onDone([id]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter") {
      if (shown[active]) pick(shown[active]!.id);
      else if (multi) onDone(value);
    } else if (e.key === "Escape") onCancel?.();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} tabIndex={-1} onKeyDown={onKey} className="w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-2 text-sm shadow-md outline-none">
      {options.length > 8 && <Input aria-label="Tìm lựa chọn" placeholder="Tìm lựa chọn" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} className="mb-2" autoFocus />}
      <div role="listbox" aria-multiselectable={multi} aria-label="Lựa chọn" className="contain-scroll-y flex max-h-60 flex-col gap-0.5 overflow-y-auto">
        {shown.length === 0 && <p className="px-2 py-3 text-muted-foreground">Không có lựa chọn nào khớp.</p>}
        {shown.map((o, i) => {
          const on = value.includes(o.id);
          return (
            <button key={o.id} type="button" role="option" aria-selected={on} onClick={() => pick(o.id)} onMouseMove={() => setActive(i)} className={cn("flex min-h-11 items-center gap-2 rounded px-2 py-1 text-left sm:min-h-9", i === active && "bg-muted")}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on && <Check size={16} aria-hidden />}</span>
              <OptionChip option={o} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <button type="button" className="min-h-11 rounded px-2 text-muted-foreground hover:bg-muted sm:min-h-9" onClick={() => onDone([])}>Xoá lựa chọn</button>
        {multi && <button type="button" className="min-h-11 rounded bg-primary px-3 text-primary-foreground sm:min-h-9" onClick={() => onDone(value)}>Xong</button>}
      </div>
    </div>
  );
}

/** Search people by name or email and pick one. */
/** With `tableId` only the owner and members of that table are suggested (a Người dùng cell takes members only). */
export function PersonPicker({ value, valueName, onDone, onCancel, autoFocus = true, tableId }: { value: string | null; valueName?: string; onDone: (p: Person | null) => void; onCancel?: () => void; autoFocus?: boolean; tableId?: string }) {
  const [q, setQ] = useState("");
  const [found, setList] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const list = q.trim() ? found : [];
  useEffect(() => {
    if (q.trim().length < 1) return;
    const t = setTimeout(() => {
      setBusy(true);
      lookupPeople({ q: q.trim(), tableId })
        .then((r) => {
          setList(r);
          setActive(0);
        })
        .catch(() => setList([]))
        .finally(() => setBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, tableId]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(list.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter" && list[active]) onDone(list[active]!);
    else if (e.key === "Escape") onCancel?.();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div onKeyDown={onKey} className="w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-2 text-sm shadow-md">
      {value && <p className="mb-2 px-1 text-muted-foreground [overflow-wrap:anywhere]">Đang chọn: <span className="text-foreground">{valueName ?? "…"}</span></p>}
      <Input aria-label="Tìm người" placeholder="Gõ tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} />
      <div role="listbox" aria-label="Người" className="contain-scroll-y mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {q.trim() && !busy && list.length === 0 && <p className="px-2 py-3 text-muted-foreground">{tableId ? "Không có thành viên nào khớp. Chủ bảng cần chia sẻ bảng cho người này trước." : "Không tìm thấy ai."}</p>}
        {list.map((p, i) => (
          <button key={p.id} type="button" role="option" aria-selected={p.id === value} onClick={() => onDone(p)} onMouseMove={() => setActive(i)} className={cn("flex min-h-11 flex-col items-start justify-center rounded px-2 py-1 text-left sm:min-h-9", i === active && "bg-muted")}>
            <span className="[overflow-wrap:anywhere]">{p.full_name}</span>
            {p.email && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</span>}
          </button>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <button type="button" className="min-h-11 rounded px-2 text-muted-foreground hover:bg-muted sm:min-h-9" onClick={() => onDone(null)}>Bỏ chọn</button>
      </div>
    </div>
  );
}

/** Rating: buttons for 1..max and a clear button. */
export function RatingPicker({ value, max, onPick }: { value: number | null; max: number; onPick: (n: number | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Đánh giá" className="flex items-center gap-1 rounded-md border border-border bg-card p-1 shadow-md">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} sao`} onClick={() => onPick(n)} className="flex h-11 w-11 items-center justify-center rounded hover:bg-muted sm:h-9 sm:w-9">
          <Star size={20} aria-hidden className={n <= (value ?? 0) ? "fill-warn text-warn" : "text-muted-foreground"} />
        </button>
      ))}
      <button type="button" className="min-h-11 rounded px-2 text-sm text-muted-foreground hover:bg-muted sm:min-h-9" onClick={() => onPick(null)}>Xoá</button>
    </div>
  );
}
