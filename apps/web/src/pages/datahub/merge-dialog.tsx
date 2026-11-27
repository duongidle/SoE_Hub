import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { createMerged, dhKeys, getTable, listDatahubs, MERGE_STRATEGY_LABELS, previewMerge, updateMerged, type MergeInfo, type MergeInput, type MergeStrategy } from "@/lib/datahub/api";
import type { TableDetail } from "@/lib/datahub/types";
import { dealKeys, getDealHome } from "@/lib/datahub/deal-api";
import { MergeDiagnosticsView } from "./merge-status";
import { nameError } from "./list";

/** Types a merged column cannot be fed from (no copyable value). Everything else is offered; the server checks that the types fit together. */
const NOT_MERGEABLE = new Set(["attachment", "relation", "auto_number", "row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified"]);

interface ManualColumn {
  name: string;
  from: Record<string, string>;
}

/** Keys are remembered by folded name: in automatic mode the name of a merged column comes from the first source, so it changes with the order. */
const fold = (s: string) => s.trim().toLowerCase();

const useDebounced = <T,>(value: T, ms: number): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

/**
 * Builder of a merged table (design module3 section 4.1, 4.2): up to 10 source tables of the owner in priority order, the columns
 * (same names are merged on their own, or mapped by hand), the key and the way duplicates are removed. The diagnosis under the form
 * is the server's own preview, so what is shown is what the worker will write.
 * With `existing` the same form reconfigures a merged table.
 */
export function MergeDialog({ datahubId, existing, onClose }: { datahubId: string; existing?: { table: TableDetail; info: MergeInfo }; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const cfg = existing?.info.config ?? null;
  const [name, setName] = useState(existing?.table.name ?? "");
  const [touched, setTouched] = useState(false);
  const [sources, setSources] = useState<string[]>(cfg?.sources.map((s) => s.table_id) ?? []);
  const [mode, setMode] = useState<"auto" | "manual">(cfg ? "manual" : "auto");
  const [manual, setManual] = useState<ManualColumn[]>(cfg ? cfg.columns.map((c) => ({ name: c.name, from: Object.fromEntries(Object.entries(c.from).map(([t, f]) => [t, f.column_name ?? ""]).filter(([, n]) => n)) })) : []);
  const [dedupOn, setDedupOn] = useState(!!cfg?.dedup);
  const [dedupCols, setDedupCols] = useState<string[]>((cfg?.dedup?.columns ?? []).map(fold));
  const [strategy, setStrategy] = useState<MergeStrategy>(cfg?.dedup?.strategy ?? "priority");
  const [picked, setPicked] = useState("");

  const mine = useQuery({ queryKey: dhKeys.list, queryFn: () => listDatahubs("mine") });
  // The tables of Quản lý Deal are their own group (the datahub is not in the list above).
  const deal = useQuery({ queryKey: dealKeys.home, queryFn: getDealHome });
  const options = useMemo(
    () => [
      ...(mine.data ?? []).flatMap((d) => d.tables.filter((t) => t.kind !== "merged" && t.access === "owner").map((t) => ({ id: t.id, label: `${d.name} – ${t.name}` }))),
      ...(deal.data?.tables ?? []).filter((t) => t.kind !== "merged" && t.access === "owner").map((t) => ({ id: t.id, label: `Quản lý Deal – ${t.name}` })),
    ],
    [mine.data, deal.data],
  );
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? cfg?.sources.find((s) => s.table_id === id)?.name ?? "Bảng nguồn";

  // Source columns for the hand mapping.
  const tables = useQueries({ queries: sources.map((id) => ({ queryKey: dhKeys.table(id), queryFn: () => getTable(id), enabled: mode === "manual" })) });
  const colsOf = (id: string) => (tables[sources.indexOf(id)]?.data?.columns ?? []).filter((c) => !NOT_MERGEABLE.has(c.type));

  // Keys are sent as folded names: the server matches column names without case and spaces, so the key survives a reorder that renames an automatic column.
  const body: MergeInput = useMemo(() => {
    const columns = mode === "manual" ? manual.filter((c) => c.name.trim() && Object.values(c.from).some(Boolean)).map((c) => ({ name: c.name.trim(), from: Object.fromEntries(Object.entries(c.from).filter(([, v]) => v)) })) : undefined;
    return { sources, ...(columns ? { columns } : {}), dedup: dedupOn && dedupCols.length ? { columns: dedupCols, strategy } : null };
  }, [sources, mode, manual, dedupOn, dedupCols, strategy]);
  const debounced = useDebounced(JSON.stringify(body), 450);
  // `ready` is judged on what is really sent (the debounced body), never on the newer state: a request must not carry an older, empty form.
  const sent = useMemo(() => JSON.parse(debounced) as MergeInput, [debounced]);
  const ready = sent.sources.length > 0 && (mode === "auto" || (sent.columns?.length ?? 0) > 0);
  const preview = useQuery({
    queryKey: ["dh-merge-preview", datahubId, debounced],
    queryFn: () => previewMerge(datahubId, JSON.parse(debounced) as MergeInput),
    enabled: ready,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const columnNames = mode === "manual" ? manual.map((c) => c.name.trim()).filter(Boolean) : (preview.data?.columns.map((c) => c.name) ?? []);

  const save = useMutation({
    mutationFn: async () => {
      if (existing) {
        await updateMerged(existing.table.id, { ...body, ...(existing.info.version ? { version: existing.info.version } : {}) });
        return existing.table.id;
      }
      return (await createMerged(datahubId, { ...body, name: name.trim() })).table.id;
    },
    onSuccess: (tableId) => {
      void qc.invalidateQueries({ queryKey: dhKeys.datahub(datahubId) });
      void qc.invalidateQueries({ queryKey: dhKeys.list });
      void qc.invalidateQueries({ queryKey: ["dh-merge"] });
      void qc.invalidateQueries({ queryKey: dhKeys.table(tableId) });
      notify.ok(existing ? "Đã lưu cấu hình. Dòng đang được chép lại." : `Đã tạo bảng gộp "${name.trim()}". Dòng được chép trong vài giây.`);
      if (!existing) void nav({ to: "/datahub/$datahubId/$tableId", params: { datahubId, tableId } });
      onClose();
    },
  });

  const move = (i: number, to: number) => setSources((s) => {
    const n = [...s];
    const [x] = n.splice(i, 1);
    n.splice(to, 0, x!);
    return n;
  });
  const toggleKey = (c: string) => setDedupCols((d) => (d.includes(fold(c)) ? d.filter((x) => x !== fold(c)) : d.length >= 5 ? d : [...d, fold(c)]));
  const useManual = () => {
    if (mode === "manual") return;
    setManual((preview.data?.columns ?? []).map((c) => ({ name: c.name, from: { ...c.from } })));
    setMode("manual");
  };

  const nameErr = existing ? null : touched ? nameError(name) : null;
  const canSave = sources.length > 0 && (existing || !nameError(name)) && (mode === "auto" || (body.columns?.length ?? 0) > 0) && !preview.error;

  return (
    <Modal title={existing ? `Cấu hình bảng gộp "${existing.table.name}"` : "Thêm bảng gộp"} open onClose={onClose} wide dirty={!save.isPending && (existing ? false : name !== "" || sources.length > 0)}>
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (canSave) save.mutate(); }} data-testid="merge-form">
        <p className="text-sm text-muted-foreground">Bảng gộp chỉ đọc. Dòng được hệ thống chép từ các bảng nguồn và tự cập nhật khi nguồn đổi. Muốn sửa dữ liệu thì sửa ở bảng nguồn.</p>
        {!existing && (
          <Field label="Tên bảng gộp" required hint="Tối đa 100 ký tự, không chứa dấu [ hoặc ]." error={nameErr}>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} autoComplete="off" aria-invalid={!!nameErr} data-testid="merge-name" />
          </Field>
        )}

        <section aria-label="Bảng nguồn" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Bảng nguồn <span className="font-normal text-muted-foreground">(tối đa 10, thứ tự từ trên xuống là mức ưu tiên)</span></h3>
          {mine.isLoading && <Skeleton className="h-9 w-full" />}
          {sources.length === 0 && <p className="text-sm text-muted-foreground" data-testid="merge-no-source">Chưa chọn bảng nguồn nào. Chỉ chọn được bảng của chính bạn (không phải bảng gộp).</p>}
          <ol className="flex flex-col gap-2" data-testid="merge-sources">
            {sources.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-md border border-border p-2" data-testid="merge-source">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground" aria-hidden>{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{labelOf(id)}</span>
                <Button variant="ghost" aria-label={`Ưu tiên cao hơn: ${labelOf(id)}`} disabled={i === 0} onClick={() => move(i, i - 1)} className="!px-2"><ArrowUp size={16} aria-hidden /></Button>
                <Button variant="ghost" aria-label={`Ưu tiên thấp hơn: ${labelOf(id)}`} disabled={i === sources.length - 1} onClick={() => move(i, i + 1)} className="!px-2"><ArrowDown size={16} aria-hidden /></Button>
                <Button variant="ghost" aria-label={`Bỏ nguồn ${labelOf(id)}`} onClick={() => setSources((s) => s.filter((x) => x !== id))} className="!px-2"><X size={16} aria-hidden /></Button>
              </li>
            ))}
          </ol>
          {sources.length < 10 && (
            <div className="flex gap-2">
              <Select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Chọn bảng nguồn để thêm" data-testid="merge-source-select">
                <option value="">Chọn một bảng của bạn…</option>
                {options.filter((o) => !sources.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
              <Button variant="secondary" disabled={!picked} onClick={() => { setSources((s) => [...s, picked]); setPicked(""); }} data-testid="merge-add-source"><Plus size={16} aria-hidden /> Thêm</Button>
            </div>
          )}
        </section>

        <section aria-label="Ghép cột" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Ghép cột</h3>
            {mode === "auto" ? (
              <Button variant="secondary" disabled={!preview.data} onClick={useManual} data-testid="merge-manual">Ghép cột tay</Button>
            ) : !existing ? (
              <Button variant="secondary" onClick={() => setMode("auto")}>Về tự ghép theo tên</Button>
            ) : null}
          </div>
          {mode === "auto" ? (
            <p className="text-sm text-muted-foreground">Cột cùng tên (không phân biệt hoa thường, bỏ khoảng trắng thừa) của các nguồn được ghép thành một cột. Cột không ghép được (đính kèm, liên kết) bị bỏ qua.</p>
          ) : (
            <div className="overflow-x-auto" data-testid="merge-mapping">
              <table className="w-full min-w-max text-left text-sm [&_td]:p-1 [&_th]:p-1 [&_th]:font-medium">
                <thead>
                  <tr>
                    <th scope="col">Cột của bảng gộp</th>
                    {sources.map((id) => <th key={id} scope="col" className="max-w-48 truncate" title={labelOf(id)}>{labelOf(id)}</th>)}
                    <th scope="col"><span className="sr-only">Xoá cột</span></th>
                  </tr>
                </thead>
                <tbody>
                  {manual.map((c, i) => (
                    <tr key={i} data-testid="merge-mapping-row">
                      <td><Input value={c.name} aria-label={`Tên cột gộp ${i + 1}`} onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                      {sources.map((id) => (
                        <td key={id}>
                          <Select aria-label={`Cột nguồn của "${c.name || i + 1}" ở ${labelOf(id)}`} value={c.from[id] ?? ""} onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, from: { ...x.from, [id]: e.target.value } } : x)))}>
                            <option value="">— để trống —</option>
                            {colsOf(id).map((col) => <option key={col.id} value={col.name}>{col.name}</option>)}
                          </Select>
                        </td>
                      ))}
                      <td><Button variant="ghost" aria-label={`Bỏ cột ${c.name || i + 1}`} onClick={() => setManual((m) => m.filter((_, j) => j !== i))} className="!px-2"><X size={16} aria-hidden /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button variant="secondary" className="mt-2" onClick={() => setManual((m) => [...m, { name: "", from: {} }])}><Plus size={16} aria-hidden /> Thêm cột</Button>
            </div>
          )}
          {mode === "auto" && preview.data && (
            <p className="text-sm" data-testid="merge-columns">Các cột sẽ có: {preview.data.columns.map((c) => c.name).join(", ")}, Nguồn, Mã dòng gốc.</p>
          )}
        </section>

        <section aria-label="Chống trùng" className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-0">
            <input type="checkbox" checked={dedupOn} onChange={(e) => setDedupOn(e.target.checked)} data-testid="merge-dedup-on" />
            Chống trùng theo khoá
          </label>
          {!dedupOn ? (
            <Badge tone="warn" className="self-start">Chưa có khoá chống trùng, số liệu có thể bị đếm hai lần.</Badge>
          ) : (
            <>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm text-muted-foreground">Cột khoá (chọn 1 đến 5). So khớp bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa.</legend>
                <div className="flex flex-wrap gap-2">
                  {columnNames.length === 0 && <span className="text-sm text-muted-foreground">Chưa có cột nào để chọn.</span>}
                  {columnNames.map((c) => (
                    <label key={c} className="flex min-h-11 items-center gap-1.5 rounded-md border border-border px-2 text-sm sm:min-h-9">
                      <input type="checkbox" checked={dedupCols.includes(fold(c))} onChange={() => toggleKey(c)} data-testid={`merge-key-${c}`} />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm text-muted-foreground">Khi một khoá có ở nhiều dòng</legend>
                {(Object.keys(MERGE_STRATEGY_LABELS) as MergeStrategy[]).map((s) => (
                  <label key={s} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                    <input type="radio" name="merge-strategy" checked={strategy === s} onChange={() => setStrategy(s)} data-testid={`merge-strategy-${s}`} />
                    {MERGE_STRATEGY_LABELS[s]}
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </section>

        <section aria-label="Chẩn đoán" aria-live="polite" className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
          <h3 className="text-sm font-medium">Chẩn đoán</h3>
          {!ready ? <p className="text-sm text-muted-foreground">Chọn bảng nguồn để xem trước số dòng.</p> : preview.error ? <ErrorText error={preview.error} /> : preview.data ? <MergeDiagnosticsView d={preview.data.diagnostics} /> : <Skeleton className="h-10 w-full" />}
        </section>

        <ErrorText error={save.error} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-4">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={save.isPending} disabled={!canSave} data-testid="merge-submit">{existing ? "Lưu cấu hình" : "Tạo bảng gộp"}</Button>
        </div>
      </form>
    </Modal>
  );
}
