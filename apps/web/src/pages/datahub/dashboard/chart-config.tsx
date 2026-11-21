import type { FilterNode } from "@soe/shared";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { createChart, dashKeys, listMetrics, listSources, saveMetric, saveSource, updateChart } from "@/lib/dashboard/api";
import { AGG_LABELS, BUCKET_LABELS, FORMAT_LABELS, MAX_SERIES_PER_CHART, RANGES, TYPE_HINTS, TYPE_LABELS, allowsManySeries, chartReady, emptySeries, isDateCol, isGroupCol, isNumberCol, mirrorGroups, needsTwoSeries, newChart, rangeToken, retype, usesGroups, usesRawValues, usesTime } from "@/lib/dashboard/config";
import { bottom, defaultSizeOf } from "@/lib/dashboard/layout";
import { CHART_TYPES, type Agg, type Bucket, type ChartDef, type ChartRecord, type ChartType, type SavedMetric, type SavedSource, type SeriesDef } from "@/lib/dashboard/types";
import { dhKeys, getTable } from "@/lib/datahub/api";
import { dealKeys, getDealHome } from "@/lib/datahub/deal-api";
import type { Column, DatahubBrief } from "@/lib/datahub/types";
import { FilterEditor } from "../filter-editor";
import { ChartBody } from "./chart-body";

const AGGS = Object.keys(AGG_LABELS) as Agg[];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Columns a series can use: of its base table and, with a saved source, of the joined tables (`Alias.Column`). */
interface Cols {
  base: Column[];
  /** Columns by name, then (for a table whose columns have roles) the roles as `role:<key>` (module4 13). */
  all: { name: string; col: Column; role?: string }[];
  loading: boolean;
}

function useSourceColumns(dh: DatahubBrief, sources: SavedSource[], sel: string | undefined): Cols {
  const src = sources.find((s) => s.id === sel);
  const baseRef = src ? src.definition.table : sel;
  const byRef = (ref?: string) => dh.tables.find((t) => t.id === ref || t.name.toLowerCase() === ref?.toLowerCase());
  const base = byRef(baseRef);
  const joins = ((src?.definition.joins ?? []) as { table: string; as?: string }[]).map((j) => ({ alias: j.as ?? byRef(j.table)?.name ?? j.table, table: byRef(j.table) }));
  const ids = [base?.id, ...joins.map((j) => j.table?.id)].filter((x): x is string => !!x);
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: dhKeys.table(id), queryFn: () => getTable(id), staleTime: 60_000 })) });
  const detail = (id?: string) => qs.find((q) => q.data?.id === id)?.data;
  const baseCols = detail(base?.id)?.columns ?? [];
  const all: Cols["all"] = [
    ...baseCols.map((c) => ({ name: c.name, col: c })),
    ...baseCols.filter((c) => !!c.role).map((c) => ({ name: `role:${c.role}`, col: c, role: c.name })),
    ...joins.flatMap((j) => (detail(j.table?.id)?.columns ?? []).map((c) => ({ name: `${j.alias}.${c.name}`, col: c }))),
  ];
  return { base: baseCols, all, loading: qs.some((q) => q.isPending) };
}

/** `Vai trò` first (the metric follows the column when the Manager moves the role), then the columns. */
function colOptions(list: Cols["all"]) {
  const roles = list.filter((c) => c.role !== undefined);
  const cols = list.filter((c) => c.role === undefined);
  return (
    <>
      {roles.length > 0 && (
        <optgroup label="Vai trò">
          {roles.map((c) => <option key={c.name} value={c.name}>{`${c.name.slice(5).replace(/_/g, " ")} → cột "${c.role}"`}</option>)}
        </optgroup>
      )}
      {roles.length > 0 ? <optgroup label="Cột">{cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup> : cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </>
  );
}

function SaveAsDialog({ title, hint, initial, busy, error, onSave, onClose }: { title: string; hint: string; initial: string; busy: boolean; error: unknown; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} open onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <Field label="Tên *" hint={hint}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" maxLength={100} />
        </Field>
        <ErrorText error={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={busy} disabled={!name.trim() || /[[\]]/.test(name)}>Lưu</Button>
        </div>
      </form>
    </Modal>
  );
}

interface CohortDef {
  start: string;
  event: string;
  bucket?: Bucket;
  mature_after?: number;
  max_offset?: number;
}

/** Cohort of a metric: the date a row starts (the cohort), the date of the event, the period, and which cohorts count. */
function CohortEditor({ cols, value, onChange }: { cols: Cols; value: CohortDef | undefined; onChange: (c: CohortDef | undefined) => void }) {
  const dates = cols.all.filter((c) => isDateCol(c.col));
  const c = value ?? { start: "", event: "" };
  const set = (p: Partial<CohortDef>) => {
    const next = { ...c, ...p };
    for (const k of Object.keys(next) as (keyof CohortDef)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange(next.start || next.event ? (next as CohortDef) : undefined);
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="cohort-editor">
      <legend className="px-1 text-sm font-semibold">Cohort</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Cột ngày bắt đầu" required hint="Dòng thuộc cohort của kỳ chứa ngày này.">
          <Select value={c.start} onChange={(e) => set({ start: e.target.value })}>
            <option value="">Chọn cột…</option>
            {dates.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Cột ngày sự kiện" required hint="Ngày xảy ra sự kiện (ví dụ ngày chốt).">
          <Select value={c.event} onChange={(e) => set({ event: e.target.value })}>
            <option value="">Chọn cột…</option>
            {dates.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Kỳ">
          <Select value={c.bucket ?? "month"} onChange={(e) => set({ bucket: e.target.value as Bucket })}>
            {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
          </Select>
        </Field>
        <Field label="Chỉ tính cohort đã qua (kỳ)" hint="Để trống: tính mọi cohort.">
          <Input type="number" min={0} value={c.mature_after ?? ""} onChange={(e) => set({ mature_after: e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} />
        </Field>
      </div>
    </fieldset>
  );
}

/** Reference bands of a bullet chart (for example KPI, Goal, Out performance). */
function BandsEditor({ value, onChange }: { value: { label: string; value: number }[]; onChange: (b: { label: string; value: number }[]) => void }) {
  return (
    <div className="flex flex-col gap-2" data-testid="bands-editor">
      <span className="text-sm font-medium">Các mốc (tối đa 4)</span>
      {value.map((b, i) => (
        <div key={i} className="flex items-end gap-2">
          <Field label={`Tên mốc ${i + 1}`}><Input value={b.label} maxLength={40} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></Field>
          <Field label="Giá trị"><Input type="number" value={b.value} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) } : x)))} /></Field>
          <Button variant="ghost" className="!px-2" aria-label={`Gỡ mốc ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><X size={16} aria-hidden /></Button>
        </div>
      ))}
      {value.length < 4 && <Button variant="secondary" className="self-start" onClick={() => onChange([...value, { label: `Mốc ${value.length + 1}`, value: 0 }])}><Plus size={16} aria-hidden /> Thêm mốc</Button>}
    </div>
  );
}

interface SeriesEditorProps {
  dh: DatahubBrief;
  chart: ChartDef;
  index: number;
  series: SeriesDef;
  metrics: SavedMetric[];
  sources: SavedSource[];
  onChange: (s: SeriesDef) => void;
  onRemove?: () => void;
}

function SeriesEditor({ dh, chart, index, series: s, metrics, sources, onChange, onRemove }: SeriesEditorProps) {
  const qc = useQueryClient();
  const saved = !!s.metric_id;
  const m = s.metric;
  const sel = typeof m?.source === "string" ? m.source : undefined;
  const cols = useSourceColumns(dh, sources, sel);
  const [dialog, setDialog] = useState<"metric" | "source" | null>(null);
  const tables = dh.tables;
  // The template tables of Quản lý Deal are their own group in the list of sources (module4 13).
  const dealHome = useQuery({ queryKey: dealKeys.home, queryFn: getDealHome, staleTime: 60_000 });
  const dealTableIds = new Set((dealHome.data?.tables ?? []).filter((x) => x.template_id !== null).map((x) => x.id));

  const patchMetric = (p: Partial<NonNullable<SeriesDef["metric"]>>) => {
    const next = { ...(s.metric ?? { name: "Biểu đồ" }), ...p };
    const agg = next.measure?.agg;
    next.name = agg ? `${AGG_LABELS[agg]}${next.measure?.field ? ` ${next.measure.field}` : ""}`.slice(0, 100) : "Biểu đồ";
    onChange({ ...s, metric: next });
  };
  const patchTime = (p: Record<string, unknown>) => {
    const t = { ...(saved ? s.time : m?.time), ...p } as Record<string, unknown>;
    for (const k of Object.keys(t)) if (t[k] === undefined || t[k] === "") delete t[k];
    const v = Object.keys(t).length ? (t as SeriesDef["time"]) : undefined;
    if (saved) onChange({ ...s, time: v });
    else patchMetric({ time: v });
  };
  const time = (saved ? s.time : m?.time) ?? {};
  const groups = ((saved ? s.group_by : m?.group_by) ?? []).map((g) => (typeof g === "string" ? { field: g } : g)) as { field: string; bucket?: Bucket }[];
  const setGroups = (g: typeof groups) => {
    const v = g.length ? g : undefined;
    if (saved) onChange({ ...s, group_by: v });
    else patchMetric({ group_by: v });
  };
  const filter = (saved ? s.filter : m?.filter) as FilterNode | undefined;
  const colByName = (n: string) => cols.all.find((c) => c.name === n)?.col;
  const measure = m?.measure;

  const create = useMutation({
    mutationFn: async (name: string) => {
      if (dialog === "metric") {
        const def = { ...m!, name };
        const r = await saveMetric(dh.id, def);
        return { kind: "metric" as const, r };
      }
      const r = await saveSource(dh.id, { name, table: sel! });
      return { kind: "source" as const, r };
    },
    onSuccess: (x) => {
      void qc.invalidateQueries({ queryKey: x.kind === "metric" ? dashKeys.metrics(dh.id) : dashKeys.sources(dh.id) });
      if (x.kind === "metric") onChange({ metric_id: x.r.id, label: s.label, axis: s.axis, kind: s.kind, compare: s.compare, target: s.target, order: s.order, limit: s.limit });
      else patchMetric({ source: x.r.id });
      setDialog(null);
    },
  });

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid={`series-${index}`}>
      <legend className="px-1 text-sm font-semibold">{chart.type === "combo" || allowsManySeries(chart.type) ? `Số liệu ${index + 1}` : "Số liệu"}</legend>
      {onRemove && (
        <Button variant="ghost" className="self-end !px-2" onClick={onRemove} aria-label={`Bỏ số liệu ${index + 1}`}><Trash2 size={16} aria-hidden /> Bỏ</Button>
      )}

      <div className="flex gap-3 text-sm" role="radiogroup" aria-label="Cách lấy số liệu">
        <label className="inline-flex items-center gap-1.5"><input type="radio" name={`mode-${index}`} checked={!saved} onChange={() => onChange({ ...emptySeries(), label: s.label, axis: s.axis, kind: s.kind })} /> Tính từ bảng</label>
        <label className="inline-flex items-center gap-1.5"><input type="radio" name={`mode-${index}`} checked={saved} disabled={!metrics.length} onChange={() => onChange({ metric_id: metrics[0]?.id, label: s.label, axis: s.axis, kind: s.kind })} /> Chỉ số đã lưu{!metrics.length ? " (chưa có)" : ""}</label>
      </div>

      {saved ? (
        <Field label="Chỉ số">
          <Select value={s.metric_id} onChange={(e) => onChange({ ...s, metric_id: e.target.value })}>
            {metrics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Nguồn dữ liệu" required>
            <Select value={sel ?? ""} onChange={(e) => patchMetric({ source: e.target.value || undefined, measure: undefined, filter: undefined, group_by: undefined, time: undefined })}>
              <option value="">Chọn bảng…</option>
              {tables.some((t) => dealTableIds.has(t.id)) && (
                <optgroup label="Quản lý Deal">
                  {tables.filter((t) => dealTableIds.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Bảng">
                {tables.filter((t) => !dealTableIds.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
              {sources.length > 0 && (
                <optgroup label="Nguồn đã lưu">
                  {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>
              )}
            </Select>
          </Field>
          {sel && cols.loading && <Skeleton className="h-9 w-full" aria-label="Đang tải cột" />}
          {sel && !cols.loading && (
            <>
              {usesRawValues(chart.type) ? (
                <Field label="Cột số cần xem phân bố" required hint="Mỗi dòng là một giá trị; số liệu do server tính.">
                  <Select value={measure?.field ?? ""} onChange={(e) => patchMetric({ measure: e.target.value ? { agg: "sum", field: e.target.value } : undefined })}>
                    <option value="">Chọn cột…</option>
                    {colOptions(cols.all.filter((c) => isNumberCol(c.col)))}
                  </Select>
                </Field>
              ) : (
                <Field label="Cách tính" required>
                  <Select value={measure?.agg ?? ""} onChange={(e) => patchMetric({ measure: e.target.value ? { agg: e.target.value as Agg, ...(e.target.value === "percentile" ? { p: 90 } : {}) } : undefined })}>
                    <option value="">Chọn cách tính…</option>
                    {(chart.type === "cohort" ? (["count", "count_distinct"] as Agg[]) : AGGS).map((a) => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
                  </Select>
                </Field>
              )}
              {chart.type === "cohort" && (
                <CohortEditor cols={cols} value={(m?.cohort ?? undefined) as CohortDef | undefined} onChange={(c) => patchMetric({ cohort: c })} />
              )}
              {!usesRawValues(chart.type) && measure && measure.agg !== "count" && (
                <Field label="Cột giá trị" required>
                  <Select value={measure.field ?? ""} onChange={(e) => patchMetric({ measure: { ...measure, ...(e.target.value ? { field: e.target.value } : { field: undefined }) } })}>
                    <option value="">Chọn cột…</option>
                    {colOptions(cols.all.filter((c) => (measure.agg === "count_distinct" ? true : isNumberCol(c.col) || ((measure.agg === "min" || measure.agg === "max") && isDateCol(c.col)))))}
                  </Select>
                </Field>
              )}
              {measure?.agg === "percentile" && (
                <Field label="P (0 đến 100)">
                  <Input type="number" min={0} max={100} value={measure.p ?? 90} onChange={(e) => patchMetric({ measure: { ...measure, p: Number(e.target.value) } })} />
                </Field>
              )}
            </>
          )}
        </>
      )}

      {(saved || (sel && !cols.loading)) && (
        <>
          {usesTime(chart.type) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!saved && (
                <Field label="Cột ngày" hint="Cột để chọn khoảng và gộp theo kỳ.">
                  <Select value={time.field ?? ""} onChange={(e) => patchTime({ field: e.target.value || undefined, ...(e.target.value ? {} : { bucket: undefined, range: undefined }) })}>
                    <option value="">Không dùng</option>
                    {colOptions(cols.all.filter((c) => isDateCol(c.col)))}
                  </Select>
                </Field>
              )}
              {(saved || time.field) && (
                <Field label="Khoảng thời gian">
                  <Select value={rangeToken(time.range)} onChange={(e) => patchTime({ range: RANGES.find((r) => r.token === e.target.value)?.value })}>
                    {RANGES.map((r) => <option key={r.token} value={r.token}>{r.label}</option>)}
                    {rangeToken(time.range) === "custom" && <option value="custom">Tuỳ chỉnh (giữ nguyên)</option>}
                  </Select>
                </Field>
              )}
              {(saved || time.field) && chart.type !== "kpi" && (
                <Field label="Nhóm theo thời gian">
                  <Select value={time.bucket ?? ""} onChange={(e) => patchTime({ bucket: e.target.value || undefined })}>
                    <option value="">Không nhóm</option>
                    {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}

          {usesGroups(chart.type) && needsTwoSeries(chart.type) && index === 1 && <p className="text-xs text-muted-foreground">Mỗi điểm là một nhóm: dùng đúng cột nhóm của số liệu 1.</p>}
          {usesGroups(chart.type) && !(needsTwoSeries(chart.type) && index === 1) && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{needsTwoSeries(chart.type) ? "Mỗi điểm là một nhóm theo cột (cột thứ hai: màu)" : chart.type === "heatmap" ? "Hai cột nhóm: dòng, rồi cột" : chart.type === "waterfall" || chart.type === "funnel" ? "Nhóm theo cột (mỗi nhóm một bước, hoặc để trống và dùng nhiều số liệu)" : "Nhóm theo cột"}</span>
              {groups.map((g, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label={`Cột nhóm ${i + 1}`}>
                    <Select value={g.field} onChange={(e) => setGroups(groups.map((x, k) => (k === i ? { field: e.target.value } : x)))}>
                      {cols.all.some((c) => c.name === g.field) ? null : <option value={g.field}>{g.field}</option>}
                      {colOptions(cols.all.filter((c) => isGroupCol(c.col) || isDateCol(c.col)))}
                    </Select>
                  </Field>
                  {colByName(g.field) && isDateCol(colByName(g.field)!) && (
                    <Field label="Theo">
                      <Select value={g.bucket ?? "day"} onChange={(e) => setGroups(groups.map((x, k) => (k === i ? { ...x, bucket: e.target.value as Bucket } : x)))}>
                        {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Button variant="ghost" className="!px-2" aria-label={`Gỡ nhóm số ${i + 1}`} onClick={() => setGroups(groups.filter((_, k) => k !== i))}><X size={16} aria-hidden /></Button>
                </div>
              ))}
              {groups.length < 2 && !saved && cols.all.length > 0 && (
                <Button variant="secondary" className="self-start" onClick={() => setGroups([...groups, { field: cols.all.find((c) => isGroupCol(c.col))?.name ?? cols.all[0]!.name }])}><Plus size={16} aria-hidden /> Thêm cột nhóm</Button>
              )}
              {saved && groups.length === 0 && <p className="text-xs text-muted-foreground">Đang theo cách nhóm của chỉ số. Sửa chỉ số ở thư viện nếu cần đổi.</p>}
            </div>
          )}

          {!saved && cols.base.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Lọc dòng</span>
              <FilterEditor columns={cols.base} value={filter} onChange={(f) => patchMetric({ filter: f })} idPrefix={`chart-filter-${index}`} />
            </div>
          )}

          {chart.type !== "note" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(time.range !== undefined || saved) && (
                <Field label="So sánh">
                  <Select value={s.compare ?? ""} onChange={(e) => onChange({ ...s, compare: (e.target.value || undefined) as SeriesDef["compare"] })}>
                    <option value="">Không so sánh</option>
                    <option value="previous_period">Với kỳ trước</option>
                    <option value="year_ago">Với cùng kỳ năm trước</option>
                  </Select>
                </Field>
              )}
              <Field label="Mục tiêu (số)" hint="Vẽ đường mục tiêu hoặc thanh % đạt.">
                <Input type="number" value={s.target?.value ?? ""} onChange={(e) => onChange({ ...s, target: e.target.value === "" ? undefined : { value: Number(e.target.value) } })} />
              </Field>
              {chart.type !== "kpi" && (
                <Field label="Sắp xếp nhóm">
                  <Select value={s.order ?? ""} onChange={(e) => onChange({ ...s, order: (e.target.value || undefined) as SeriesDef["order"] })}>
                    <option value="">Theo nhóm (mặc định)</option>
                    <option value="value_desc">Giá trị giảm dần</option>
                    <option value="value_asc">Giá trị tăng dần</option>
                  </Select>
                </Field>
              )}
              {chart.type !== "kpi" && (
                <Field label="Số nhóm tối đa">
                  <Input type="number" min={1} max={5000} value={s.limit ?? ""} placeholder="1000" onChange={(e) => onChange({ ...s, limit: e.target.value === "" ? undefined : Math.max(1, Math.round(Number(e.target.value))) })} />
                </Field>
              )}
            </div>
          )}

          {(allowsManySeries(chart.type) || chart.type === "combo" || needsTwoSeries(chart.type)) && (
            <Field label={needsTwoSeries(chart.type) ? (index === 0 ? "Tên trục ngang" : "Tên trục dọc") : chart.type === "funnel" || chart.type === "waterfall" ? "Tên bước" : "Tên trong chú giải"}>
              <Input value={s.label ?? ""} onChange={(e) => onChange({ ...s, label: e.target.value || undefined })} maxLength={100} />
            </Field>
          )}
          {chart.type === "waterfall" && (
            <Field label="Bước này" hint="Giá trị đầu đặt mức xuất phát; cộng thêm hoặc trừ đi thay đổi mức luỹ kế (server tính).">
              <Select value={s.step ?? (index === 0 ? "start" : "add")} onChange={(e) => onChange({ ...s, step: e.target.value as SeriesDef["step"] })}>
                <option value="start">Giá trị đầu</option>
                <option value="add">Cộng thêm</option>
                <option value="subtract">Trừ đi</option>
              </Select>
            </Field>
          )}
          {chart.type === "combo" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vẽ bằng">
                <Select value={s.kind ?? (index === 0 ? "bar" : "line")} onChange={(e) => onChange({ ...s, kind: e.target.value as "bar" | "line" })}>
                  <option value="bar">Cột</option>
                  <option value="line">Đường</option>
                </Select>
              </Field>
              <Field label="Trục">
                <Select value={s.axis ?? "left"} onChange={(e) => onChange({ ...s, axis: e.target.value as "left" | "right" })}>
                  <option value="left">Trái</option>
                  <option value="right">Phải</option>
                </Select>
              </Field>
            </div>
          )}

          {!saved && sel && measure && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { create.reset(); setDialog("metric"); }}>Lưu thành chỉ số…</Button>
              {tables.some((t) => t.id === sel) && <Button variant="secondary" onClick={() => { create.reset(); setDialog("source"); }}>Lưu thành nguồn dữ liệu…</Button>}
            </div>
          )}
        </>
      )}
      {dialog && (
        <SaveAsDialog
          title={dialog === "metric" ? "Lưu thành chỉ số" : "Lưu thành nguồn dữ liệu"}
          hint={dialog === "metric" ? "Dùng lại ở mọi dashboard của datahub này và qua API. Tên không trùng chỉ số khác, không chứa [ hoặc ]." : "Nguồn lưu bảng này để dùng lại; thêm phép ghép bảng bằng API (metrics.source.update)."}
          initial={dialog === "metric" ? (m?.name ?? "") : (tables.find((t) => t.id === sel)?.name ?? "")}
          busy={create.isPending}
          error={create.error}
          onSave={(n) => create.mutate(n)}
          onClose={() => setDialog(null)}
        />
      )}
    </fieldset>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; error: unknown };

/**
 * Right-hand panel that configures one chart. There is no Save button: once the chart is complete enough to draw it is saved by itself
 * (created the first time, then updated). A chart that is not complete is not saved and the panel says what is missing.
 */
export function ChartConfigPanel({ dh, dashboardId, record, startType, siblings, onClose }: { dh: DatahubBrief; dashboardId: string; record: ChartRecord | null; startType: ChartType; siblings: ChartRecord[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ChartDef>(() => record?.chart ?? newChart(startType));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [savedStr, setSavedStr] = useState(() => (record ? JSON.stringify(record.chart) : ""));
  const savedStrRef = useRef(savedStr);
  const saved = useRef<{ id: string; version: number } | null>(record ? { id: record.id, version: record.version } : null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const metrics = useQuery({ queryKey: dashKeys.metrics(dh.id), queryFn: () => listMetrics(dh.id) });
  const sources = useQuery({ queryKey: dashKeys.sources(dh.id), queryFn: () => listSources(dh.id) });
  const ready = chartReady(draft);
  const draftStr = JSON.stringify(draft);
  const dirty = ready && draftStr !== savedStr;
  const settled = useDebounced(draft, 700);
  const preview = useDebounced(draft, 500);

  // One save at a time, in order; each sends what the screen had when it was asked for.
  const enqueue = (def: ChartDef): Promise<unknown> => {
    chain.current = chain.current.then(async () => {
      const str = JSON.stringify(def);
      if (str === savedStrRef.current) return;
      setState({ kind: "saving" });
      try {
        if (!saved.current) {
          const items = siblings.map((c) => ({ id: c.id, ...(c.chart.layout ?? { x: 0, y: 0, w: 6, h: 5 }) }));
          const r = await createChart(dashboardId, { ...def, layout: { x: 0, y: bottom(items), ...defaultSizeOf(def.type) } });
          saved.current = { id: r.id, version: r.version };
        } else {
          const r = await updateChart(saved.current.id, saved.current.version, def);
          saved.current = { id: r.id, version: r.version };
        }
        savedStrRef.current = str;
        setSavedStr(str);
        setState({ kind: "saved" });
        await qc.invalidateQueries({ queryKey: dashKeys.one(dashboardId) });
        await qc.invalidateQueries({ queryKey: dashKeys.list(dh.id) });
      } catch (e) {
        setState({ kind: "error", error: e });
      }
    });
    return chain.current;
  };
  useEffect(() => {
    if (chartReady(settled)) void enqueue(settled);
  }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing saves what is still waiting for the pause, so a last edit is never lost.
  const close = async () => {
    if (chartReady(draft)) await enqueue(draft);
    onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="dialog"][data-state="open"]') && void closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const set = (p: Partial<ChartDef>) => setDraft((d) => ({ ...d, ...p }));
  const setOpt = (p: Partial<NonNullable<ChartDef["options"]>>) => setDraft((d) => {
    const options = { ...d.options, ...p };
    for (const k of Object.keys(options) as (keyof typeof options)[]) if (options[k] === undefined) delete options[k];
    return { ...d, options };
  });
  const setSeries = (i: number, s: SeriesDef) => setDraft((d) => mirrorGroups({ ...d, series: d.series.map((x, k) => (k === i ? s : x)) }));
  const o = draft.options ?? {};
  const t = draft.type;

  return (
    <aside role="complementary" aria-label="Cấu hình biểu đồ" className="contain-scroll fixed inset-y-0 right-0 z-40 flex w-full max-w-[30rem] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 shadow-xl" data-testid="chart-config">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{record ? "Sửa biểu đồ" : "Thêm biểu đồ"}</h2>
        <Button variant="ghost" onClick={() => void close()} aria-label="Đóng cấu hình" className="!px-2"><X size={20} aria-hidden /></Button>
      </div>
      <p className="text-xs text-muted-foreground" role="status" data-testid="chart-save-state">
        {state.kind === "error" ? "" : dirty || state.kind === "saving" ? "Đang lưu…" : !ready ? "Chưa đủ thông tin nên chưa lưu: chọn bảng, cách tính và cột." : savedStr ? "Đã lưu tự động." : "Mọi thay đổi tự lưu khi biểu đồ đủ thông tin."}
      </p>
      {state.kind === "error" && <ErrorText error={state.error} />}

      <div className="shrink-0 rounded-md border border-border p-2" style={{ height: 240 }} aria-label="Xem trước">
        {ready ? <ChartBody chart={preview} datahubId={dh.id} /> : <p className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">Chọn nguồn dữ liệu để xem trước.</p>}
      </div>

      <Field label="Loại biểu đồ" hint={TYPE_HINTS[t]}>
        <Select value={t} onChange={(e) => setDraft(retype(draft, e.target.value as ChartType))}>
          {CHART_TYPES.map((x) => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
        </Select>
      </Field>
      <Field label="Tiêu đề">
        <Input value={draft.title ?? ""} onChange={(e) => set({ title: e.target.value })} maxLength={100} />
      </Field>

      {t === "note" ? (
        <Field label="Nội dung ghi chú" hint="Văn bản thường, không dùng định dạng.">
          <Textarea rows={6} value={draft.text ?? ""} onChange={(e) => set({ text: e.target.value })} maxLength={5000} />
        </Field>
      ) : metrics.isPending || sources.isPending ? (
        <Skeleton className="h-40 w-full" aria-busy="true" />
      ) : (
        <>
          {draft.series.map((s, i) => (
            <SeriesEditor key={i} dh={dh} chart={draft} index={i} series={s} metrics={metrics.data ?? []} sources={sources.data ?? []} onChange={(x) => setSeries(i, x)} onRemove={draft.series.length > 1 ? () => setDraft((d) => ({ ...d, series: d.series.filter((_, k) => k !== i) })) : undefined} />
          ))}
          {allowsManySeries(t) && draft.series.length < MAX_SERIES_PER_CHART && (
            <Button variant="secondary" className="self-start" onClick={() => setDraft((d) => ({ ...d, series: [...d.series, { ...emptySeries(), ...(t === "waterfall" ? { step: "add" as const } : {}), ...(t === "combo" ? { kind: "line" as const, axis: "right" as const } : {}) }] }))}>
              <Plus size={16} aria-hidden /> Thêm số liệu
            </Button>
          )}

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Hiển thị</legend>
            <Field label="Định dạng số">
              <Select value={o.format ?? ""} onChange={(e) => setOpt({ format: (e.target.value || undefined) as never })}>
                {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {["column", "bar", "area"].includes(t) && (
              <Field label="Xếp chồng">
                <Select value={o.stack ?? "none"} onChange={(e) => setOpt({ stack: e.target.value === "none" ? undefined : (e.target.value as never) })}>
                  <option value="none">Không chồng (nhóm cạnh nhau)</option>
                  <option value="stack">Chồng</option>
                  <option value="percent">Chồng 100%</option>
                </Select>
              </Field>
            )}
            {t === "kpi" && (
              <Field label="Đường xu hướng nhỏ" hint="Cần chọn cột ngày.">
                <Select value={o.sparkline ?? ""} onChange={(e) => setOpt({ sparkline: (e.target.value || undefined) as never })}>
                  <option value="">Không</option>
                  {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => <option key={b} value={b}>Theo {BUCKET_LABELS[b].toLowerCase()}</option>)}
                </Select>
              </Field>
            )}
            {(t === "pie" || t === "donut") && (
              <Field label="Số phần tối đa" hint="Phần còn lại gộp thành &quot;Khác&quot; khi phép tính cộng được (tổng, đếm).">
                <Input type="number" min={2} max={8} value={o.max_slices ?? 8} onChange={(e) => setOpt({ max_slices: Math.min(8, Math.max(2, Math.round(Number(e.target.value) || 8))) })} />
              </Field>
            )}
            {!["kpi", "table", "pivot", "note"].includes(t) && (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.labels} onChange={(e) => setOpt({ labels: e.target.checked || undefined })} /> Hiện nhãn số</label>
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={o.legend ?? draft.series.length > 1} onChange={(e) => setOpt({ legend: e.target.checked })} /> Chú giải</label>
                {["line", "area", "combo"].includes(t) && <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.smooth} onChange={(e) => setOpt({ smooth: e.target.checked || undefined })} /> Đường mềm</label>}
                {["column", "bar", "line", "area", "combo"].includes(t) && <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.log} onChange={(e) => setOpt({ log: e.target.checked || undefined })} /> Trục log</label>}
              </div>
            )}
            {t === "histogram" && (
              <Field label="Số khoảng" hint="2 đến 50 khoảng đều nhau giữa giá trị nhỏ nhất và lớn nhất.">
                <Input type="number" min={2} max={50} value={o.bins ?? 10} onChange={(e) => setOpt({ bins: Math.min(50, Math.max(2, Math.round(Number(e.target.value) || 10))) })} />
              </Field>
            )}
            {t === "ranking" && (
              <Field label="Số vị trí" hint="Hiện bao nhiêu nhóm đứng đầu (tối đa 50).">
                <Input type="number" min={1} max={50} value={o.top_n ?? 10} onChange={(e) => setOpt({ top_n: Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 10))) })} />
              </Field>
            )}
            {t === "waterfall" && (
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={o.total !== false} onChange={(e) => setOpt({ total: e.target.checked ? undefined : false })} /> Thêm cột tổng cuối cùng</label>
            )}
            {t === "gauge" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mốc nhỏ nhất" hint="Chỉ dùng khi không có mục tiêu."><Input type="number" value={o.gauge_min ?? ""} onChange={(e) => setOpt({ gauge_min: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
                <Field label="Mốc lớn nhất"><Input type="number" value={o.gauge_max ?? ""} onChange={(e) => setOpt({ gauge_max: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
              </div>
            )}
            {t === "matrix" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mốc chia trục ngang" hint="Để trống: trung vị."><Input type="number" value={o.x_split ?? ""} onChange={(e) => setOpt({ x_split: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
                <Field label="Mốc chia trục dọc" hint="Để trống: trung vị."><Input type="number" value={o.y_split ?? ""} onChange={(e) => setOpt({ y_split: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
              </div>
            )}
            {t === "bullet" && <BandsEditor value={o.bands ?? []} onChange={(b) => setOpt({ bands: b.length ? b : undefined })} />}
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.ignore_filters} onChange={(e) => setOpt({ ignore_filters: e.target.checked || undefined })} /> Bỏ qua bộ lọc chung</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.ignore_cross} onChange={(e) => setOpt({ ignore_cross: e.target.checked || undefined })} /> Không nhận lọc chéo</label>
            </div>
            {t === "pivot" && (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!o.heat} onChange={(e) => setOpt({ heat: e.target.checked || undefined })} /> Tô màu theo giá trị</label>
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={o.totals !== false} onChange={(e) => setOpt({ totals: e.target.checked ? undefined : false })} /> Tổng dòng và cột</label>
              </div>
            )}
          </fieldset>
        </>
      )}
    </aside>
  );
}

