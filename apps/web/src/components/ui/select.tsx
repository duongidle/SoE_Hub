import { Check, ChevronDown, Search } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";

/** Shape of what `onChange` receives: enough of a select's change event for `e.target.value` / `e.currentTarget.value`. */
export type SelectChange = { target: { value: string; name: string }; currentTarget: { value: string; name: string } };
type Opt = { value: string; label: string; disabled: boolean; group?: string };

/** More options than this get a search box. */
const SEARCH_FROM = 8;

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

/** Reads `<option>` / `<optgroup>` children (also inside fragments and arrays) into a flat list. */
function readOptions(children: React.ReactNode, group?: string, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return;
    const p = c.props as { value?: string | number; disabled?: boolean; label?: string; children?: React.ReactNode };
    if (c.type === "option") {
      const label = textOf(p.children);
      out.push({ value: p.value === undefined ? label : String(p.value), label, disabled: !!p.disabled, group });
    } else if (c.type === "optgroup") readOptions(p.children, p.label, out);
    else if (c.type === React.Fragment) readOptions(p.children, group, out);
  });
  return out;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");

/**
 * The system dropdown (replaces the browser's `<select>`). Same props as a select: `<option>`/`<optgroup>` children, value or
 * defaultValue, onChange(e) with `e.target.value`, disabled, name, required, id, aria-*. A panel in a portal; a search box above
 * 8 options; arrows, Home/End, Enter, Esc and type-ahead; rows are 44px high on a phone.
 */
export function Select({ className, children, value, defaultValue, onChange, disabled, name, required, id, onBlur, onFocus, ...rest }: Omit<React.ComponentProps<"select">, "onChange" | "multiple" | "size"> & { onChange?: (e: SelectChange) => void }) {
  const options = React.useMemo(() => readOptions(children), [children]);
  const first = options.find((o) => !o.disabled)?.value ?? "";
  const [inner, setInner] = React.useState(defaultValue === undefined ? first : String(defaultValue));
  const controlled = value !== undefined;
  const current = controlled ? String(value) : inner;
  const selected = options.find((o) => o.value === current);
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<string | null>(null);
  const searchable = options.length > SEARCH_FROM;
  const shown = React.useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter((o) => fold(o.label).includes(q)) : options;
  }, [options, query]);
  const enabled = shown.filter((o) => !o.disabled);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ text: "", at: 0 });

  const choose = (o: Opt) => {
    if (o.disabled) return;
    if (!controlled) setInner(o.value);
    onChange?.({ target: { value: o.value, name: name ?? "" }, currentTarget: { value: o.value, name: name ?? "" } });
    setOpen(false);
  };
  const optId = (v: string) => `${listId}-${options.findIndex((o) => o.value === v)}`;

  const onOpenChange = (o: boolean) => {
    if (o && disabled) return;
    setOpen(o);
    if (o) {
      setQuery("");
      setActive(selected && !selected.disabled ? selected.value : (options.find((x) => !x.disabled)?.value ?? null));
    }
  };

  // keep the highlighted row in view
  React.useEffect(() => {
    if (open && active != null) document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const move = (delta: number | "first" | "last") => {
    if (enabled.length === 0) return;
    const i = enabled.findIndex((o) => o.value === active);
    const next = delta === "first" ? 0 : delta === "last" ? enabled.length - 1 : Math.min(enabled.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : enabled.length) : i) + delta));
    setActive(enabled[next]!.value);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); move("first"); }
    else if (e.key === "End") { e.preventDefault(); move("last"); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = enabled.find((x) => x.value === active);
      if (o) choose(o);
    } else if (e.key === "Tab") setOpen(false);
    else if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: letters typed in quick succession build a prefix
      const now = e.timeStamp;
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + e.key, at: now };
      const hit = enabled.find((o) => fold(o.label).startsWith(fold(typed.current.text)));
      if (hit) { e.preventDefault(); setActive(hit.value); }
    }
  };

  const trigger = (
    <button
      type="button"
      id={id}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-required={required || undefined}
      data-value={current}
      disabled={disabled}
      onBlur={onBlur as React.FocusEventHandler<HTMLButtonElement> | undefined}
      onFocus={onFocus as React.FocusEventHandler<HTMLButtonElement> | undefined}
      onKeyDown={(e) => {
        if (open || disabled) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); onOpenChange(true); }
      }}
      className={cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-[9px] border border-border bg-card px-3 py-1.5 text-left text-[16px] outline-none transition-colors hover:border-primary-border focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-bad sm:min-h-9 sm:text-sm", className)}
      {...(rest as Record<string, unknown>)}
    >
      <span className={cn("min-w-0 flex-1 truncate", !selected && "text-faint")}>{selected?.label ?? ""}</span>
      <ChevronDown size={16} aria-hidden className="shrink-0 text-muted-foreground" />
    </button>
  );

  const items: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  for (const o of shown) {
    if (o.group !== lastGroup && o.group) items.push(<div key={`g-${o.group}`} role="presentation" className="px-2 pb-0.5 pt-2 text-xs font-semibold text-muted-foreground">{o.group}</div>);
    lastGroup = o.group;
    items.push(
      <div
        key={o.value + "|" + options.indexOf(o)}
        id={optId(o.value)}
        role="option"
        aria-selected={o.value === current}
        aria-disabled={o.disabled || undefined}
        data-value={o.value}
        data-active={o.value === active || undefined}
        onClick={() => choose(o)}
        onMouseMove={() => !o.disabled && active !== o.value && setActive(o.value)}
        className={cn("flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] sm:min-h-8", o.disabled ? "cursor-not-allowed opacity-50" : "data-[active]:bg-primary-soft", o.value === current && "font-medium text-primary")}
      >
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.label}</span>
        {o.value === current && <Check size={16} aria-hidden className="shrink-0" />}
      </div>,
    );
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <Popover
        trigger={trigger}
        label="Danh sách lựa chọn"
        open={open}
        onOpenChange={onOpenChange}
        modal
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (searchRef.current ?? listRef.current)?.focus();
        }}
        width="w-[max(var(--radix-popover-trigger-width),12rem)]"
        className="p-1"
      >
        {searchable && (
          <div className="relative p-1">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              role="combobox"
              aria-label="Tìm trong danh sách"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={active != null && enabled.some((o) => o.value === active) ? optId(active) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                const q = fold(e.target.value.trim());
                const f = options.find((o) => !o.disabled && fold(o.label).includes(q));
                setActive(f?.value ?? null);
              }}
              onKeyDown={onListKey}
              placeholder="Tìm…"
              className="min-h-11 w-full rounded-[9px] border border-border bg-card py-1.5 pl-8 pr-2 text-[16px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 sm:min-h-8 sm:text-[13px]"
            />
          </div>
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={searchable ? -1 : 0}
          aria-activedescendant={!searchable && active != null ? optId(active) : undefined}
          onKeyDown={searchable ? undefined : onListKey}
          className="max-h-72 overflow-y-auto outline-none"
        >
          {items.length === 0 ? <div className="px-2 py-3 text-sm text-muted-foreground">Không có kết quả</div> : items}
        </div>
      </Popover>
    </>
  );
}
