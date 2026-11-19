import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatCount } from "@soe/shared";
import { ArrowLeft, ArrowRight, FileSpreadsheet, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Field, Input, Modal, Notice, Select, Tabs, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { analyzeImport, cancelJob, dhKeys, getTable, importSheet, previewImport, startImport, uploadFile, type ImportColumnReport, type ImportIssue, type ImportMappingBody, type ImportSheetInfo, type ImportSheetReport } from "@/lib/datahub/api";
import type { Level } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";
import { JobBar, useJob } from "./job-progress";
import { nameError } from "./list";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TYPE_LABELS: Record<string, string> = {
  text: "Văn bản",
  long_text: "Văn bản dài",
  number: "Số",
  currency: "Tiền (VND)",
  percent: "Phần trăm",
  date: "Ngày",
  datetime: "Ngày giờ",
  checkbox: "Checkbox",
  rating: "Đánh giá (sao)",
  single_select: "Một lựa chọn",
  multi_select: "Nhiều lựa chọn",
  email: "Email",
  phone: "Điện thoại",
  url: "URL",
};
const IMPORTABLE = Object.keys(TYPE_LABELS);
const WRITE_LABELS = { add: "Thêm dòng mới", upsert: "Cập nhật theo cột khoá (chưa có thì thêm)", replace: "Thay toàn bộ (dòng cũ vào thùng rác 7 ngày)" } as const;
const REASON_HELP: Record<string, string> = {
  differs: "Công thức khác nhau giữa các dòng",
  mixed: "Cột có cả ô công thức và ô giá trị",
  missing_table: "Tham chiếu bảng không tồn tại",
  missing_data: "Tham chiếu dữ liệu không tồn tại",
  fixed_cell: "Tham chiếu ô cố định",
  row_offset: "Tham chiếu dòng khác",
  other_sheet_cell: "Tham chiếu ô của sheet khác",
  range_2d: "Vùng nhiều cột",
  range_partial: "Vùng chỉ lấy một phần của cột",
  unsupported_function: "Hàm không hỗ trợ",
  source_error: "Công thức lỗi trong file gốc",
  syntax: "Công thức không đọc được",
  named_range: "Tên đã đặt không hỗ trợ",
};

interface ColPlan {
  index: number;
  letter: string;
  header: string;
  sample: string[];
  include: boolean;
  name: string;
  type: string;
  /** Existing column (key) the values go to; "" = a new column. */
  target: string;
  formulaCount: number;
}

interface SheetPlan {
  name: string;
  hidden: boolean;
  info: ImportSheetInfo;
  include: boolean;
  headerRow: number;
  tableMode: "new" | "existing";
  tableName: string;
  tableId: string;
  write: "add" | "upsert" | "replace";
  key: string;
  onError: "skip_row" | "blank_cell";
  cols: ColPlan[];
}

const colsOf = (info: ImportSheetInfo): ColPlan[] => info.columns.map((c) => ({ index: c.index, letter: c.letter, header: c.header, sample: c.sample, include: true, name: c.name, type: c.type, target: "", formulaCount: c.formula_count }));

export interface ImportTarget {
  datahub?: { id: string; name: string; access: Level; tables: { id: string; name: string }[] };
  /** Open table: the first sheet goes into it by default. */
  table?: { id: string; name: string };
}

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = ["Nguồn", "Chọn sheet", "Ghép cột", "Kiểm tra", "Nhập"];

/**
 * Import wizard (design module2 section 8.1): source, sheets and header row, column mapping, report, background run with progress.
 * Every number and every reason shown comes from the server's answers (`datahub.import.*`).
 */
export function ImportDialog({ target, onClose }: { target: ImportTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [tab, setTab] = useState<"file" | "link" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [current, setCurrent] = useState(0);
  const [dhName, setDhName] = useState("");
  const [importFormulas, setImportFormulas] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const isOwner = !target.datahub || target.datahub.access === "owner";
  const patch = (i: number, p: Partial<SheetPlan>) => setPlans((all) => all.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const analyze = useMutation({
    mutationFn: async () => {
      if (tab === "file") {
        if (!file) throw new Error("Chọn một file .xlsx hoặc .csv.");
        const lower = file.name.toLowerCase();
        const type = lower.endsWith(".xlsx") ? XLSX_TYPE : lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt") ? "text/csv" : null;
        if (!type) throw new Error("Chỉ nhận file .xlsx, .csv, .tsv. File Excel cũ (.xls) hãy lưu lại thành .xlsx.");
        const f = await uploadFile(file, type);
        return analyzeImport({ file_id: f.id });
      }
      if (tab === "link") return analyzeImport({ url: link.trim() });
      return analyzeImport({ text, filename: "Dữ liệu dán.csv" });
    },
    onSuccess: (r) => {
      setJobId(r.job.id);
      const firstTable = target.table;
      let usedFirst = false;
      setPlans(
        r.sheets.map((s) => {
          const include = !s.hidden && s.columns.length > 0 && s.row_count > 0;
          const useOpen = include && !usedFirst && !!firstTable;
          if (useOpen) usedFirst = true;
          return { name: s.name, hidden: s.hidden, info: s, include, headerRow: 1, tableMode: useOpen ? "existing" : "new", tableName: s.name.slice(0, 100).replace(/[[\]]/g, ""), tableId: useOpen ? firstTable!.id : "", write: "add", key: "", onError: "skip_row", cols: colsOf(s) } as SheetPlan;
        }),
      );
      setImportFormulas(false);
      setDhName((n) => n || (file ? file.name.replace(/\.[^.]+$/, "").slice(0, 100).replace(/[[\]]/g, "") : "Dữ liệu nhập"));
      setCurrent(Math.max(0, r.sheets.findIndex((s) => !s.hidden && s.columns.length > 0)));
      setStep(2);
    },
  });

  const mapping = useMemo((): ImportMappingBody => {
    const picked = plans.filter((p) => p.include);
    return {
      datahub: target.datahub ? { id: target.datahub.id } : { name: dhName.trim() },
      import_formulas: importFormulas,
      sheets: picked.map((p) => ({
        sheet: p.name,
        header_row: p.headerRow,
        table: p.tableMode === "new" ? { mode: "new" as const, name: p.tableName.trim() } : { mode: "existing" as const, table_id: p.tableId },
        columns: p.cols.filter((c) => c.include).map((c) => (c.target ? { index: c.index, target: c.target } : { index: c.index, name: c.name.trim(), type: c.type })),
        write: p.write,
        ...(p.write === "upsert" && p.key ? { key: p.key } : {}),
        on_error: p.onError,
      })),
    };
  }, [plans, target.datahub, dhName, importFormulas]);

  const preview = useMutation({ mutationFn: () => previewImport(jobId!, mapping), onSuccess: () => setStep(4) });
  const start = useMutation({
    mutationFn: () => startImport(jobId!, mapping),
    onSuccess: (j) => {
      setRunId(j.id);
      setStep(5);
    },
  });
  const run = useJob(runId);
  const finishedRef = useRef(false);
  useEffect(() => {
    if (run.data?.status === "done" && !finishedRef.current) {
      finishedRef.current = true;
      void qc.invalidateQueries({ queryKey: dhKeys.list });
      if (target.datahub) void qc.invalidateQueries({ queryKey: dhKeys.datahub(target.datahub.id) });
      void qc.invalidateQueries({ queryKey: ["dh-table"] });
    }
  }, [run.data?.status, qc, target.datahub]);

  const picked = plans.filter((p) => p.include);
  const mappingProblem = (): string | null => {
    if (!target.datahub) {
      const e = nameError(dhName);
      if (e) return `Tên datahub: ${e}`;
    }
    if (picked.length === 0) return "Chọn ít nhất một sheet để nhập.";
    for (const p of picked) {
      if (p.tableMode === "new") {
        const e = nameError(p.tableName);
        if (e) return `Sheet "${p.name}": tên bảng. ${e}`;
      } else if (!p.tableId) return `Sheet "${p.name}": chọn bảng có sẵn.`;
      const cols = p.cols.filter((c) => c.include);
      if (cols.length === 0) return `Sheet "${p.name}": chưa chọn cột nào.`;
      for (const c of cols) if (!c.target) {
        const e = nameError(c.name);
        if (e) return `Sheet "${p.name}", cột ${c.letter}: tên cột. ${e}`;
      }
      if (p.write === "upsert" && !p.key) return `Sheet "${p.name}": chọn cột khoá để cập nhật.`;
    }
    return null;
  };
  const problem = mappingProblem();
  const running = !!runId && (!run.data || run.data.status === "pending" || run.data.status === "running");
  const dirty = step > 1 && step < 5;

  return (
    <Modal title="Nhập dữ liệu" open onClose={onClose} wide dirty={dirty}>
      <div className="flex flex-col gap-4" data-testid="import-dialog">
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Các bước">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={cn(step === i + 1 && "font-semibold text-foreground")}>{i + 1}. {s}</li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "file", label: "Tải file" },
                { value: "link", label: "Link Google Sheets" },
                { value: "text", label: "Dán dữ liệu" },
              ]}
            />
            {tab === "file" && (
              <Field label="File Excel (.xlsx) hoặc CSV" hint="Tối đa 25 MB. Mỗi sheet của file Excel có thể thành một bảng.">
                <input type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Chọn file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-h-11 text-sm sm:min-h-9" />
              </Field>
            )}
            {tab === "link" && (
              <Field label="Link Google Sheets" hint={'Sheet phải để chia sẻ "Bất kỳ ai có đường liên kết đều có thể xem". Hệ thống không đăng nhập Google của bạn.'}>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="off" inputMode="url" />
              </Field>
            )}
            {tab === "text" && (
              <Field label="Dán dữ liệu" hint="Chọn vùng ô trong Google Sheets hoặc Excel, sao chép rồi dán vào đây. Dòng đầu là tiêu đề cột.">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} aria-label="Dữ liệu dán" className="font-mono text-xs" />
              </Field>
            )}
            <ErrorText error={analyze.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={onClose}>Huỷ</Button>
              <Button onClick={() => analyze.mutate()} loading={analyze.isPending} disabled={(tab === "file" && !file) || (tab === "link" && !link.trim()) || (tab === "text" && !text.trim())}>
                <Upload size={16} aria-hidden /> Đọc dữ liệu
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <SheetsStep plans={plans} current={current} setCurrent={setCurrent} patch={patch} jobId={jobId!} onNext={() => setStep(3)} onBack={() => setStep(1)} />
        )}

        {step === 3 && (
          <>
            {!target.datahub && (
              <Field label="Tên datahub mới *" hint="Datahub này sẽ chứa các bảng được nhập.">
                <Input value={dhName} onChange={(e) => setDhName(e.target.value)} aria-label="Tên datahub mới" autoComplete="off" />
              </Field>
            )}
            {plans.some((p) => p.include && p.info.has_formulas) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={importFormulas} onChange={(e) => setImportFormulas(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>
                  <span className="font-medium">Lấy cả công thức</span>
                  <span className="block text-xs text-muted-foreground">Cột nào dịch được thì thành cột công thức; cột không dịch được vẫn nhập giá trị và bước sau báo rõ lý do.</span>
                </span>
              </label>
            )}
            <MappingStep plans={picked} all={plans} patch={(i, p) => patch(plans.indexOf(picked[i]!), p)} target={target} isOwner={isOwner} />
            {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
            <ErrorText error={preview.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}><ArrowLeft size={16} aria-hidden /> Quay lại</Button>
              <Button onClick={() => preview.mutate()} loading={preview.isPending} disabled={!!problem}>Kiểm tra <ArrowRight size={16} aria-hidden /></Button>
            </div>
          </>
        )}

        {step === 4 && preview.data && (
          <>
            {preview.data.blocking.length > 0 && (
              <div role="alert" className="rounded-md bg-bad/10 p-3 text-sm" data-testid="import-blocking">
                <p className="font-medium">Chưa nhập được:</p>
                <ul className="list-disc pl-5">{preview.data.blocking.map((b) => <li key={b} className="[overflow-wrap:anywhere]">{b}</li>)}</ul>
              </div>
            )}
            {preview.data.sheets.map((s) => (
              <section key={s.sheet} className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="import-report-sheet">
                <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">Sheet "{s.sheet}" → bảng {s.new_table ? "mới " : ""}"{s.table}"</h3>
                <p className="text-sm">
                  <b className="tabular-nums">{s.rows_total.toLocaleString("vi-VN")}</b> dòng: <b className="tabular-nums text-ok">{s.valid.toLocaleString("vi-VN")}</b> hợp lệ
                  {s.invalid > 0 && <>, <b className="tabular-nums text-bad">{s.invalid.toLocaleString("vi-VN")}</b> dòng lỗi sẽ bị bỏ</>}.
                  {s.sampled && <span className="text-muted-foreground"> (Kiểm tra {s.rows_checked.toLocaleString("vi-VN")} dòng đầu; lỗi ở dòng sau chỉ biết khi chạy.)</span>}
                </p>
                <IssueList issues={s.errors} />
                <FormulaReport columns={s.columns} />
              </section>
            ))}
            <ErrorText error={start.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep(3)}><ArrowLeft size={16} aria-hidden /> Sửa cách ghép</Button>
              <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!preview.data.ok}>Bắt đầu nhập</Button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            {run.data ? <JobBar job={run.data} /> : <Skeleton className="h-10 w-full" />}
            {run.data?.status === "failed" && <p role="alert" className="text-sm text-bad">Việc nhập bị dừng. {run.data.error}</p>}
            {run.data?.status === "cancelled" && <p role="status" className="text-sm">Đã huỷ. Các dòng đã nhập vẫn ở trong bảng.</p>}
            {run.data && run.data.status !== "pending" && <RunReport reports={((run.data.report as { sheets?: ImportSheetReport[] } | null)?.sheets ?? []) as ImportSheetReport[]} done={run.data.status === "done"} datahubId={run.data.datahub_id ?? target.datahub?.id ?? null} />}
            <div className="flex flex-wrap justify-between gap-2">
              {running ? <Button variant="secondary" onClick={() => void cancelJob(runId!)}>Huỷ nhập</Button> : <Button onClick={onClose}>Đóng</Button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function SheetsStep({ plans, current, setCurrent, patch, jobId, onNext, onBack }: { plans: SheetPlan[]; current: number; setCurrent: (i: number) => void; patch: (i: number, p: Partial<SheetPlan>) => void; jobId: string; onNext: () => void; onBack: () => void }) {
  const p = plans[current];
  // What was typed in the header-row box, per sheet (a sheet never typed in shows its saved header row).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const header = p ? (edits[p.name] ?? String(p.headerRow)) : "1";
  const setHeader = (v: string) => p && setEdits((e) => ({ ...e, [p.name]: v }));
  const reread = useMutation({
    mutationFn: () => importSheet(jobId, p!.name, Number(header)),
    onSuccess: (info) => patch(current, { info, headerRow: Number(header), cols: colsOf(info) }),
  });
  const headerNum = Number(header);
  const valid = Number.isInteger(headerNum) && headerNum >= 1 && headerNum <= 1000;
  return (
    <>
      <p className="text-sm text-muted-foreground">Chọn sheet muốn nhập (mỗi sheet thành một bảng), rồi kiểm tra dòng tiêu đề.</p>
      <ul className="flex flex-col gap-1" data-testid="import-sheets">
        {plans.map((s, i) => (
          <li key={s.name} className={cn("flex items-center gap-2 rounded-md border p-2", i === current ? "border-primary" : "border-border")}>
            <input type="checkbox" checked={s.include} onChange={(e) => patch(i, { include: e.target.checked })} aria-label={`Nhập sheet ${s.name}`} className="h-4 w-4 shrink-0" />
            <button type="button" onClick={() => setCurrent(i)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm sm:min-h-8" aria-label={`Xem sheet ${s.name}`}>
              <FileSpreadsheet size={16} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatCount(s.info.row_count, "dòng")} · {formatCount(s.info.columns.length, "cột")}</span>
              {s.hidden && <Badge tone="muted">Ẩn</Badge>}
              {s.info.has_formulas && <Badge tone="muted">Có công thức</Badge>}
            </button>
          </li>
        ))}
      </ul>
      {p && (
        <section aria-label={`Xem trước sheet ${p.name}`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Dòng tiêu đề (số dòng trong sheet)">
              <Input value={header} onChange={(e) => setHeader(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-24" aria-label="Dòng tiêu đề" />
            </Field>
            <Button variant="secondary" onClick={() => reread.mutate()} loading={reread.isPending} disabled={!valid || headerNum === p.headerRow}>Đọc lại</Button>
          </div>
          <ErrorText error={reread.error} />
          <div className="overflow-x-auto rounded-md border border-border" data-testid="import-preview">
            <table className="w-full text-xs">
              <tbody>
                {p.info.preview.map((r) => (
                  <tr key={r.row} className={cn("border-b border-border last:border-0", r.row === p.headerRow && "bg-muted font-semibold")}>
                    <th scope="row" className="sticky left-0 bg-card px-2 py-1 text-right font-normal tabular-nums text-muted-foreground">{r.row}</th>
                    {r.cells.map((c, k) => (
                      <td key={k} className="max-w-48 truncate px-2 py-1" title={c}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Hiện 20 dòng đầu. Dòng được tô đậm là dòng tiêu đề.</p>
        </section>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Quay lại</Button>
        <Button onClick={onNext} disabled={!plans.some((s) => s.include)}>Ghép cột <ArrowRight size={16} aria-hidden /></Button>
      </div>
    </>
  );
}

function MappingStep({ plans, all, patch, target, isOwner }: { plans: SheetPlan[]; all: SheetPlan[]; patch: (i: number, p: Partial<SheetPlan>) => void; target: ImportTarget; isOwner: boolean }) {
  const [cur, setCur] = useState(0);
  const i = Math.min(cur, plans.length - 1);
  const p = plans[i];
  if (!p) return null;
  void all;
  return (
    <div className="flex flex-col gap-3">
      {plans.length > 1 && (
        <Tabs value={String(i)} onChange={(v) => setCur(Number(v))} items={plans.map((s, k) => ({ value: String(k), label: s.name.slice(0, 24) }))} />
      )}
      <SheetMapping key={p.name} p={p} patch={(x) => patch(i, x)} target={target} isOwner={isOwner} />
    </div>
  );
}

function SheetMapping({ p, patch, target, isOwner }: { p: SheetPlan; patch: (x: Partial<SheetPlan>) => void; target: ImportTarget; isOwner: boolean }) {
  const existing = useQuery({ queryKey: dhKeys.table(p.tableId), queryFn: () => getTable(p.tableId), enabled: p.tableMode === "existing" && !!p.tableId });
  const existingCols = useMemo(() => (existing.data?.columns ?? []).filter((c) => IMPORTABLE.includes(c.type)), [existing.data]);
  const dhTables = target.datahub?.tables ?? [];
  const setCol = (k: number, x: Partial<ColPlan>) => patch({ cols: p.cols.map((c, j) => (j === k ? { ...c, ...x } : c)) });

  // When an existing table is chosen, columns whose header matches a column of the table are mapped to it.
  const chooseTable = (id: string) => {
    patch({ tableId: id });
  };
  useEffect(() => {
    if (p.tableMode !== "existing" || !existing.data) return;
    const names = new Map(existingCols.map((c) => [c.name.trim().toLowerCase(), c.key]));
    patch({ cols: p.cols.map((c) => (c.target ? c : { ...c, target: names.get(c.header.trim().toLowerCase()) ?? "" })) });
    // Only when the table's columns arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data?.id, p.tableMode]);

  const keyOptions = p.cols.filter((c) => c.include).map((c) => ({ value: c.target || c.name, label: c.target ? (existingCols.find((x) => x.key === c.target)?.name ?? c.target) : c.name }));

  return (
    <div className="flex flex-col gap-3" data-testid="import-mapping">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nhập vào">
          <Select value={p.tableMode} onChange={(e) => patch({ tableMode: e.target.value as "new" | "existing", ...(e.target.value === "new" ? { tableId: "", cols: colsOf(p.info).map((c, k) => ({ ...c, include: p.cols[k]?.include ?? true })) } : {}) })} aria-label="Nhập vào bảng mới hay bảng có sẵn">
            {isOwner && <option value="new">Bảng mới</option>}
            {(dhTables.length > 0 || p.tableMode === "existing") && <option value="existing">Bảng có sẵn</option>}
          </Select>
        </Field>
        {p.tableMode === "new" ? (
          <Field label="Tên bảng mới *">
            <Input value={p.tableName} onChange={(e) => patch({ tableName: e.target.value })} aria-label="Tên bảng mới" autoComplete="off" />
          </Field>
        ) : (
          <Field label="Bảng *">
            <Select value={p.tableId} onChange={(e) => chooseTable(e.target.value)} aria-label="Bảng có sẵn">
              <option value="">Chọn bảng…</option>
              {dhTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {target.table && !dhTables.some((t) => t.id === target.table!.id) && <option value={target.table.id}>{target.table.name}</option>}
            </Select>
          </Field>
        )}
      </div>

      {p.tableMode === "existing" && existing.isLoading && <Skeleton className="h-10 w-full" />}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="w-10 px-2 py-2"><span className="sr-only">Nhập</span></th>
              <th className="px-2 py-2">Cột trong file</th>
              <th className="px-2 py-2">{p.tableMode === "existing" ? "Cột của bảng" : "Tên cột"}</th>
              <th className="px-2 py-2">Kiểu</th>
            </tr>
          </thead>
          <tbody>
            {p.cols.map((c, k) => (
              <tr key={c.index} className="border-b border-border last:border-0 align-top">
                <td className="px-2 py-2"><input type="checkbox" checked={c.include} onChange={(e) => setCol(k, { include: e.target.checked })} aria-label={`Nhập cột ${c.letter}`} className="h-4 w-4" /></td>
                <td className="px-2 py-2">
                  <div className="font-medium [overflow-wrap:anywhere]">{c.letter}{c.header ? ` · ${c.header}` : ""}</div>
                  <div className="max-w-48 truncate text-xs text-muted-foreground" title={c.sample.join(" | ")}>{c.sample.join(" · ")}</div>
                  {c.formulaCount > 0 && <Badge tone="muted">Có công thức</Badge>}
                </td>
                <td className="px-2 py-2">
                  {p.tableMode === "existing" ? (
                    <Select value={c.target} onChange={(e) => setCol(k, { target: e.target.value })} disabled={!c.include} aria-label={`Cột của bảng cho cột ${c.letter}`}>
                      {isOwner && <option value="">(Tạo cột mới: {c.name})</option>}
                      {!isOwner && <option value="">Chọn cột…</option>}
                      {existingCols.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                    </Select>
                  ) : (
                    <Input value={c.name} onChange={(e) => setCol(k, { name: e.target.value })} disabled={!c.include} aria-label={`Tên cột cho cột ${c.letter}`} autoComplete="off" />
                  )}
                </td>
                <td className="px-2 py-2">
                  {c.target ? <span className="text-xs text-muted-foreground">{TYPE_LABELS[existingCols.find((x) => x.key === c.target)?.type ?? ""] ?? "—"}</span> : (
                    <Select value={c.type} onChange={(e) => setCol(k, { type: e.target.value })} disabled={!c.include} aria-label={`Kiểu cột cho cột ${c.letter}`}>
                      {IMPORTABLE.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                    </Select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cách nhập">
          <Select value={p.write} onChange={(e) => patch({ write: e.target.value as SheetPlan["write"] })} aria-label="Cách nhập">
            {(Object.keys(WRITE_LABELS) as (keyof typeof WRITE_LABELS)[]).filter((w) => p.tableMode === "existing" || w === "add").map((w) => <option key={w} value={w}>{WRITE_LABELS[w]}</option>)}
          </Select>
        </Field>
        {p.write === "upsert" && (
          <Field label="Cột khoá *" hint="Dòng có cùng giá trị ở cột này sẽ được cập nhật.">
            <Select value={p.key} onChange={(e) => patch({ key: e.target.value })} aria-label="Cột khoá">
              <option value="">Chọn cột…</option>
              {keyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Ô sai kiểu">
          <Select value={p.onError} onChange={(e) => patch({ onError: e.target.value as SheetPlan["onError"] })} aria-label="Xử lý ô sai kiểu">
            <option value="skip_row">Bỏ cả dòng và báo lỗi</option>
            <option value="blank_cell">Để trống ô, vẫn nhập dòng</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function IssueList({ issues, limit = 8 }: { issues: ImportIssue[]; limit?: number }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid="import-issues">
      {issues.slice(0, limit).map((e, i) => (
        <li key={i} className="[overflow-wrap:anywhere]">
          <span className="tabular-nums font-medium">Dòng {e.row}</span>
          {e.column ? ` · ${e.column}` : ""}: {e.message}
        </li>
      ))}
      {issues.length > limit && <li className="text-muted-foreground">… và {issues.length - limit} lỗi khác.</li>}
    </ul>
  );
}

function FormulaReport({ columns }: { columns: ImportColumnReport[] }) {
  const withFormula = columns.filter((c) => c.formula);
  if (withFormula.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm" data-testid="import-formulas">
      <h4 className="font-medium">Cột có công thức</h4>
      <ul className="flex flex-col gap-1">
        {withFormula.map((c) => (
          <li key={c.name} className="[overflow-wrap:anywhere]">
            <span className="font-medium">{c.name}</span>{" "}
            {c.formula!.status === "formula" ? <Badge tone="ok">Thành cột công thức</Badge> : <Badge tone="warn">Nhập giá trị</Badge>}
            {c.formula!.reason && <div className="text-xs text-muted-foreground">{REASON_HELP[c.formula!.code ?? ""] ? `${REASON_HELP[c.formula!.code ?? ""]}. ` : ""}{c.formula!.reason}</div>}
            {c.formula!.warnings.map((w) => <div key={w} className="text-xs text-warn" data-testid="import-warning">Lưu ý: {w}</div>)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunReport({ reports, done, datahubId }: { reports: ImportSheetReport[]; done: boolean; datahubId: string | null }) {
  if (reports.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="import-result">
      {done && <Notice>Đã nhập xong.</Notice>}
      {reports.map((r) => (
        <section key={r.sheet} className="flex flex-col gap-1 rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">Sheet "{r.sheet}" → bảng "{r.table_name}"</h3>
          <p className="text-sm tabular-nums">
            Thêm {r.created.toLocaleString("vi-VN")}
            {r.updated > 0 && `, cập nhật ${r.updated.toLocaleString("vi-VN")}`}
            {r.deleted > 0 && `, đưa vào thùng rác ${r.deleted.toLocaleString("vi-VN")} dòng cũ`}
            {r.skipped > 0 && `, bỏ ${r.skipped.toLocaleString("vi-VN")}`}
            {r.error_count > 0 && ` · ${r.error_count.toLocaleString("vi-VN")} lỗi`}.
          </p>
          <IssueList issues={r.errors} limit={20} />
          {done && r.table_id && datahubId && (
            <Link to="/datahub/$datahubId/$tableId" params={{ datahubId, tableId: r.table_id }} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline sm:min-h-8">Mở bảng "{r.table_name}"</Link>
          )}
        </section>
      ))}
    </div>
  );
}
