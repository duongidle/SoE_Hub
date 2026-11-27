import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Braces, BookOpen, Sigma } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formulaFunctions, previewFormula } from "@/lib/datahub/api";
import { RESULT_TYPES } from "@/lib/datahub/column-config";
import { activeCall, applySuggestion, FORMULA_SAMPLES, fillSample, previewText, sampleReady, segments, suggest, syntaxParts, type FnInfo, type Sample, type SampleSlot } from "@/lib/datahub/formula-assist";
import { nameKey } from "@/lib/datahub/cells";
import type { Column, TableDetail } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";
import { useFormulaScope } from "./formula-scope";

const useDebounced = <T,>(value: T, ms: number): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

const BOX = "w-full rounded-md border px-3 py-2 text-base leading-6 sm:text-sm [overflow-wrap:anywhere] whitespace-pre-wrap";

/**
 * The formula box (design module2 section 6.3). Suggestions for functions and `[names]` while typing, the syntax of the function the caret is
 * in, the errors the server finds (underlined where they are), the first five rows as a preview, a picker for references and the library of
 * sample formulas. The server checks and computes; this only shows what it answers.
 */
export function FormulaEditor({ table, column, value, onChange, resultType, onResultType, error, id }: { table: TableDetail; column?: Column; value: string; onChange: (v: string) => void; resultType: string; onResultType: (v: string) => void; error?: string | null; id: string }) {
  const { scope, ensure, columnsOf } = useFormulaScope(table, column?.key);
  const fq = useQuery({ queryKey: ["dh-formula-functions"], queryFn: formulaFunctions, staleTime: Infinity });
  const fns: FnInfo[] = useMemo(() => fq.data?.functions ?? [], [fq.data]);
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mark, setMark] = useState({ i: 0, key: "" });

  const sug = useMemo(() => (focused && !dismissed ? suggest(value, caret, scope, fns) : null), [focused, dismissed, value, caret, scope, fns]);
  useEffect(() => {
    if (sug?.needs) ensure(sug.needs);
  }, [sug?.needs, ensure]);
  const sugKey = `${sug?.from}:${sug?.items.length}`;
  const active = mark.key === sugKey ? mark.i : 0;
  const setActive = (f: number | ((a: number) => number)) => setMark({ i: typeof f === "function" ? f(active) : f, key: sugKey });
  const call = useMemo(() => activeCall(value, caret), [value, caret]);
  const callFn = call ? fns.find((f) => f.name === call.name) : undefined;

  // The box grows with its text, so the underlay (same text, same size) lines up with it.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  const sent = value.startsWith("=") ? value : `=${value}`;
  const offset = value.startsWith("=") ? 0 : 1;
  const debounced = useDebounced(sent, 500);
  const pq = useQuery({
    queryKey: ["dh-formula-preview", table.id, debounced, resultType, column?.key ?? null],
    queryFn: () => previewFormula(table.id, { formula: debounced, ...(resultType ? { result_type: resultType } : {}), ...(column ? { column: column.key } : {}) }),
    enabled: debounced.trim().length > 1,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
  const fresh = pq.data && debounced === sent;
  const issues = useMemo(() => (fresh && pq.data && !pq.data.ok ? pq.data.errors : []), [fresh, pq.data]);
  const parts = useMemo(() => segments(value, issues, offset), [value, issues, offset]);

  const focusLater = (pos: number) =>
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });

  const pick = (i: number) => {
    if (!sug || !sug.items[i]) return;
    const r = applySuggestion(value, sug, sug.items[i]!);
    onChange(r.text);
    setDismissed(false);
    focusLater(r.caret);
  };

  /** Puts text at the caret (or over the selection) and leaves the caret after it. */
  const insert = (text: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    const base = value.trim() === "" ? "=" : value;
    const from = value.trim() === "" ? 1 : a;
    const to = value.trim() === "" ? 1 : b;
    onChange(base.slice(0, from) + text + base.slice(to));
    focusLater(from + text.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug && sug.items.length) {
      if (e.key === "ArrowDown") setActive((a) => Math.min(sug.items.length - 1, a + 1));
      else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
      else if (e.key === "Enter" || e.key === "Tab") pick(active);
      else if (e.key === "Escape") setDismissed(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A formula is one line of thought but may be laid out on several lines; Enter breaks the line like in the spreadsheet.
  };

  const resultLabel = RESULT_TYPES.find((r) => r.value === (pq.data?.result_type ?? ""))?.label;
  const listId = `${id}-sug`;

  return (
    <div className="flex flex-col gap-2" data-field="formula">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Công cụ công thức">
        <FunctionPicker fns={fns} loading={fq.isLoading} onPick={(f) => insert(f.max_args === 0 ? `${f.name}()` : `${f.name}(`)} />
        <RefPicker table={table} scope={scope} ensure={ensure} columnsOf={columnsOf} onInsert={insert} />
        <SamplePicker table={table} scope={scope} ensure={ensure} columnsOf={columnsOf} hasFormula={value.trim().replace(/^=/, "") !== ""} onUse={(f) => { onChange(f); focusLater(f.length); }} />
      </div>

      <div className="relative">
        <div aria-hidden className={cn(BOX, "pointer-events-none absolute inset-0 overflow-hidden border-transparent text-transparent")}>
          {parts.map((s, i) =>
            s.issue ? <mark key={i} className="bg-bad/15 text-transparent underline decoration-bad decoration-wavy underline-offset-4">{s.text}</mark> : <span key={i}>{s.text}</span>,
          )}
          {"​"}
        </div>
        <textarea
          ref={area}
          id={id}
          rows={2}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Công thức"
          aria-invalid={!!error || issues.length > 0}
          aria-autocomplete="list"
          aria-controls={sug ? listId : undefined}
          aria-describedby={`${id}-help`}
          placeholder={'=IF([Doanh thu] > 1000000000, "Trên 1 tỷ", "Dưới 1 tỷ")'}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={onKeyDown}
          className={cn(BOX, "relative block min-h-20 resize-none overflow-hidden bg-transparent outline-none focus:ring-2 focus:ring-primary/10", error || issues.length ? "border-bad" : "border-border")}
        />
      </div>

      {sug && (
        <div className="rounded-md border border-border bg-card text-sm shadow-sm">
          {sug.items.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground">Đang tải danh sách cột…</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Gợi ý" className="contain-scroll-y max-h-48 overflow-y-auto p-1">
              {sug.items.map((s, i) => (
                <li key={`${s.kind}-${s.label}`} role="option" aria-selected={i === active}>
                  <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseMove={() => setActive(i)} className={cn("flex min-h-9 w-full items-baseline gap-2 rounded px-2 py-1 text-left", i === active && "bg-muted")}>
                    <span className="shrink-0 font-medium [overflow-wrap:anywhere]">{s.label}</span>
                    {s.detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{s.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div id={`${id}-help`} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {callFn && call ? (
          <p>
            <span className="font-medium text-foreground">
              {syntaxParts(callFn.syntax, call.arg).map((p, i) => (p.active ? <b key={i} className="rounded bg-selected px-0.5">{p.text}</b> : <span key={i}>{p.text}</span>))}
            </span>{" "}
            {callFn.description} Ví dụ: <code>{callFn.example}</code>
          </p>
        ) : (
          <p>Bắt đầu bằng dấu =. Gõ [ để chọn cột, bảng hoặc datahub; gõ tên hàm để xem gợi ý.</p>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      {issues.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-bad">
          {issues.map((i, k) => (
            <li key={k} className="[overflow-wrap:anywhere]">{i.message}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Xem trước 5 dòng đầu</span>
          <label className="flex items-center gap-2 text-xs">
            <span>Kiểu kết quả</span>
            <Select aria-label="Kiểu kết quả" value={resultType} onChange={(e) => onResultType(e.target.value)} className="!w-auto">
              <option value="">Tự nhận biết{resultLabel && !resultType ? ` (${resultLabel})` : ""}</option>
              {RESULT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </label>
        </div>
        {debounced.trim().length <= 1 ? (
          <p className="text-muted-foreground">Nhập công thức để xem kết quả.</p>
        ) : pq.isLoading || (pq.isFetching && !fresh) ? (
          <div className="flex flex-col gap-1">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : pq.error ? (
          <p role="alert" className="text-bad">Chưa xem trước được lúc này. Công thức vẫn được kiểm tra khi lưu.</p>
        ) : pq.data && !pq.data.ok ? (
          <p className="text-muted-foreground">Công thức chưa đúng nên chưa có kết quả. Sửa theo lỗi ở trên.</p>
        ) : pq.data && pq.data.rows.length === 0 ? (
          <p className="text-muted-foreground">Bảng chưa có dòng nào nên chưa xem trước được.</p>
        ) : pq.data ? (
          <table className="w-full text-left">
            <caption className="sr-only">Kết quả trên 5 dòng đầu</caption>
            <thead className="text-xs text-muted-foreground">
              <tr><th scope="col" className="w-20 py-1 font-medium">Dòng</th><th scope="col" className="py-1 font-medium">Kết quả</th></tr>
            </thead>
            <tbody>
              {pq.data.rows.map((r) => (
                <tr key={r.row_id} className="border-t border-border">
                  <td className="py-1 pr-2">#{r.row_no}</td>
                  <td className={cn("py-1 [overflow-wrap:anywhere]", r.error ? "text-bad" : ["number", "percent"].includes(pq.data!.result_type ?? "") && "text-right")}>
                    {r.error ? `${r.error}. ${r.error_message ?? ""}` : previewText(pq.data!.result_type, r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {pq.data?.ok && pq.data.reads.tables.length > 0 && <p className="text-xs text-muted-foreground">Đọc dữ liệu từ bảng: {pq.data.reads.tables.join(", ")}. Cột này do máy chủ tính lại khi dữ liệu nguồn đổi.</p>}
      </div>
    </div>
  );
}

// ---- insert a function --------------------------------------------------------------------------------------------------------------

function FunctionPicker({ fns, loading, onPick }: { fns: FnInfo[]; loading: boolean; onPick: (f: FnInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = nameKey(q);
    return n ? fns.filter((f) => nameKey(f.name).includes(n) || nameKey(f.description).includes(n)) : fns;
  }, [fns, q]);
  const groups = [...new Set(shown.map((f) => f.group))];
  return (
    <Popover label="Chèn hàm" fixedSide open={open} onOpenChange={setOpen} width="w-[30rem]" trigger={<Button variant="secondary"><Sigma size={16} aria-hidden /> Chèn hàm</Button>}>
      <Input aria-label="Tìm hàm" placeholder="Tìm hàm theo tên hoặc việc cần làm" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <div className="contain-scroll-y mt-2 max-h-72 overflow-y-auto">
        {loading && <Skeleton className="h-24" />}
        {!loading && shown.length === 0 && <p className="px-2 py-3 text-muted-foreground">Không có hàm nào khớp.</p>}
        {groups.map((g) => (
          <div key={g} className="mb-2">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{g}</p>
            {shown.filter((f) => f.group === g).map((f) => (
              <button key={f.name} type="button" onClick={() => { onPick(f); setOpen(false); setQ(""); }} className="flex min-h-11 w-full flex-col items-start justify-center rounded px-2 py-1 text-left hover:bg-muted sm:min-h-9">
                <span className="font-medium [overflow-wrap:anywhere]">{f.syntax}</span>
                <span className="text-xs text-muted-foreground">{f.description}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  );
}

// ---- insert a reference -------------------------------------------------------------------------------------------------------------

type Scope = ReturnType<typeof useFormulaScope>["scope"];
interface PickerProps {
  table: TableDetail;
  scope: Scope;
  ensure: (tableId: string) => void;
  columnsOf: (tableId: string) => Column[] | null;
}

function RefPicker({ table, scope, ensure, columnsOf, onInsert }: PickerProps & { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const all = [scope.datahub, ...scope.others];
  const [dhId, setDhId] = useState(scope.datahub.id);
  const dh = all.find((d) => d.id === dhId) ?? scope.datahub;
  const [tableId, setTableId] = useState(table.id);
  const t = dh.tables.find((x) => x.id === tableId) ?? dh.tables[0];
  const [colName, setColName] = useState("");
  useEffect(() => {
    if (open && t) ensure(t.id);
  }, [open, t, ensure]);
  const cols = t ? (t.id === table.id ? columnsOf(table.id) : columnsOf(t.id)) : null;
  const names = (cols ?? []).map((c) => c.name);
  const col = names.includes(colName) ? colName : (names[0] ?? "");
  const sameDh = dh.id === scope.datahub.id;
  const ref = !t || !col ? "" : sameDh && t.id === table.id ? `[${col}]` : sameDh ? `[${t.name}].[${col}]` : `[${dh.name}].[${t.name}].[${col}]`;
  const meaning = !ref ? "" : sameDh && t?.id === table.id ? "Giá trị của cột này ở dòng đang tính." : "Cả cột của bảng đó, dùng trong hàm tra cứu và tổng hợp như SUMIFS, XLOOKUP.";
  return (
    <Popover label="Chèn cột hoặc bảng" fixedSide open={open} onOpenChange={setOpen} width="w-[24rem]" trigger={<Button variant="secondary"><Braces size={16} aria-hidden /> Chèn cột hoặc bảng</Button>}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Datahub</span>
          <Select value={dh.id} onChange={(e) => { setDhId(e.target.value); setTableId(""); setColName(""); }}>
            {all.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === scope.datahub.id ? " (hiện tại)" : ""}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Bảng</span>
          <Select value={t?.id ?? ""} onChange={(e) => { setTableId(e.target.value); setColName(""); }}>
            {dh.tables.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === table.id ? " (bảng này)" : ""}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Cột</span>
          <Select value={col} onChange={(e) => setColName(e.target.value)} disabled={cols === null || names.length === 0}>
            {cols === null && <option value="">Đang tải…</option>}
            {cols !== null && names.length === 0 && <option value="">Bảng chưa có cột</option>}
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>
        {ref && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs [overflow-wrap:anywhere]">
            <code className="font-medium">{ref}</code>
            <br />
            {meaning}
          </p>
        )}
        <Button disabled={!ref} onClick={() => { onInsert(ref); setOpen(false); }}>Chèn vào công thức</Button>
      </div>
    </Popover>
  );
}

// ---- sample library -----------------------------------------------------------------------------------------------------------------

function SamplePicker({ table, scope, ensure, columnsOf, hasFormula, onUse }: PickerProps & { hasFormula: boolean; onUse: (formula: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<Sample | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const others = scope.datahub.tables.filter((t) => t.id !== table.id);

  // Every blank starts with the first column that fits, so a click on "Dùng mẫu này" already gives a working formula when the table has them.
  const resolved = useMemo(() => {
    if (!sample) return {};
    const out: Record<string, string> = {};
    const used = new Set<string>();
    const colsFor = (slot: SampleSlot): Column[] => {
      const types = "types" in slot ? slot.types : undefined;
      const list = slot.kind === "col" ? table.columns : slot.kind === "tcol" ? (columnsOf(others.find((t) => t.name === out[slot.of])?.id ?? "") ?? []) : [];
      return list.filter((c) => !types || types.includes(c.type));
    };
    for (const slot of sample.slots) {
      if (picks[slot.id] !== undefined) {
        out[slot.id] = picks[slot.id]!;
        continue;
      }
      if (slot.kind === "table") out[slot.id] = others[0]?.name ?? "";
      else {
        const scopeKey = slot.kind === "col" ? "this" : out[slot.of];
        const first = colsFor(slot).find((c) => !used.has(`${scopeKey}:${c.name}`));
        out[slot.id] = first?.name ?? "";
        if (first) used.add(`${scopeKey}:${first.name}`);
      }
    }
    return out;
  }, [sample, picks, table.columns, others, columnsOf]);

  const tableName = sample?.slots.find((s) => s.kind === "table") ? resolved[sample.slots.find((s) => s.kind === "table")!.id] : undefined;
  useEffect(() => {
    const id = others.find((t) => t.name === tableName)?.id;
    if (id) ensure(id);
  }, [tableName, others, ensure]);

  const optionsFor = (slot: SampleSlot): string[] => {
    if (slot.kind === "table") return others.map((t) => t.name);
    const types = slot.types;
    const list = slot.kind === "col" ? table.columns : (columnsOf(others.find((t) => t.name === resolved[slot.of])?.id ?? "") ?? []);
    return list.filter((c) => !types || types.includes(c.type)).map((c) => c.name);
  };

  return (
    <Popover label="Công thức mẫu" fixedSide open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSample(null); }} width="w-[32rem]" trigger={<Button variant="secondary"><BookOpen size={16} aria-hidden /> Công thức mẫu</Button>}>
      {!sample ? (
        <ul className="flex flex-col gap-1">
          {FORMULA_SAMPLES.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => { setSample(s); setPicks({}); }} className="flex min-h-11 w-full flex-col items-start justify-center rounded px-2 py-1 text-left hover:bg-muted sm:min-h-9">
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium">{sample.title}</p>
            <p className="text-xs text-muted-foreground">{sample.description}</p>
          </div>
          {sample.slots.map((slot) => {
            const opts = optionsFor(slot);
            return (
              <label key={slot.id} className="flex flex-col gap-1">
                <span className="font-medium">{slot.label}</span>
                <Select value={opts.includes(resolved[slot.id] ?? "") ? resolved[slot.id] : ""} onChange={(e) => setPicks((p) => ({ ...p, [slot.id]: e.target.value }))} disabled={opts.length === 0}>
                  {opts.length === 0 && <option value="">{slot.kind === "table" ? "Datahub chưa có bảng nào khác" : "Chưa có cột phù hợp"}</option>}
                  {opts.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </label>
            );
          })}
          <code className="rounded-md bg-muted px-3 py-2 text-xs [overflow-wrap:anywhere]">{fillSample(sample, resolved)}</code>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setSample(null)}>Chọn mẫu khác</Button>
            <Button disabled={!sampleReady(sample, resolved)} onClick={() => { onUse(fillSample(sample, resolved)); setOpen(false); setSample(null); }}>{hasFormula ? "Thay công thức bằng mẫu này" : "Dùng mẫu này"}</Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
