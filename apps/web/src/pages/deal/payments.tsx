import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonChip } from "@/components/ui/person";
import { Link } from "@tanstack/react-router";
import { formatCurrency, formatDate } from "@soe/shared";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, errorMessage, Field, Input, Modal, Notice, Select, Table, Tabs, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { fetchRows, fetchRowsByIds, getTable, lookupPeople, relationLabels } from "@/lib/datahub/api";
import { dealKeys, getDealHome, type DealTable } from "@/lib/datahub/deal-api";
import { adjustCommission, confirmPayments, matchCandidates, schedulePayments, unconfirmPayments, type Allocation, type MatchCandidate, type ScheduleItem } from "@/lib/datahub/payment-api";
import type { Column, Row, TableDetail } from "@/lib/datahub/types";
import { can, useMe } from "@/lib/session";

/**
 * `/quan-ly-deal/thanh-toan`: payments by instalment (Module 4 mục 7, 16). Instalments with their views, the tool Ghép tiền về, unmatched transfers, the commission
 * ledger. The server decides every number and every rule; this page sends what the Manager typed and shows the answer. Only the Manager sees the write buttons.
 */

// ---- tables and columns by role (never by name) -----------------------------------------------------------------------------

export function usePaymentTables() {
  const q = useQuery({ queryKey: dealKeys.home, queryFn: getDealHome });
  const by = (rs: string): DealTable | undefined => q.data?.tables.find((t) => t.role_set === rs && t.kind === "normal");
  return { q, deals: by("deals"), dots: by("payments"), receipts: by("receipts"), ledger: by("ledger") };
}

export function useSchema(tableId?: string) {
  const q = useQuery({ queryKey: ["pay-table", tableId], queryFn: () => getTable(tableId!), enabled: !!tableId });
  const table: TableDetail | undefined = q.data;
  const col = (role: string): Column | undefined => table?.columns.find((c) => c.role === role);
  const key = (role: string): string => col(role)?.key ?? "";
  return { q, table, col, key };
}

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" ? [x] : x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? [(x as { id: string }).id] : [])) : typeof v === "string" ? [v] : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const money = (v: unknown) => formatCurrency(num(v));
/** A select cell stores the option id; show the option name. */
const optionName = (col: Column | undefined, v: unknown): string => {
  const id = Array.isArray(v) ? v[0] : v;
  const o = col?.config.options?.find((x) => x.id === id || x.name === id);
  return o?.name ?? (typeof id === "string" ? id : "");
};
const today = () => new Date().toISOString().slice(0, 10);

function useRelationLabels(tableId: string | undefined, column: string, ids: string[]) {
  const uniq = [...new Set(ids)].slice(0, 200);
  return useQuery({
    queryKey: ["pay-rel", tableId, column, uniq.join(",")],
    enabled: !!tableId && !!column && uniq.length > 0,
    queryFn: async () => new Map((await relationLabels(tableId!, column, uniq)).map((r) => [r.id, r.label])),
  });
}

function usePeopleNames(ids: string[]) {
  const uniq = [...new Set(ids)].slice(0, 200);
  return useQuery({ queryKey: ["pay-people", uniq.join(",")], enabled: uniq.length > 0, queryFn: async () => new Map((await lookupPeople({ ids: uniq })).map((p) => [p.id, p.full_name])) });
}

const refreshAll = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ["pay-rows"] });
  void qc.invalidateQueries({ queryKey: ["deal-payments"] });
};

// ---- the page ---------------------------------------------------------------------------------------------------------------

type Tab = "dot" | "match" | "ledger";

export function PaymentsPage() {
  const me = useMe().data;
  const { q, dots, receipts, ledger } = usePaymentTables();
  const manager = can(me, "deal:payment:write");
  const [tab, setTab] = useState<Tab>("dot");
  const [prefill, setPrefill] = useState<{ receiptId: string } | null>(null);
  if (q.isLoading) return <div className="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được thanh toán" />;
  if (!dots) return <EmptyState title="Chưa có bảng Đợt thanh toán" hint="Bộ bảng thanh toán do hệ thống dựng cho cây của Manager. Nếu vừa cập nhật, chờ ít phút rồi tải lại." />;
  const items: { value: Tab; label: string }[] = [{ value: "dot", label: "Đợt thanh toán" }, ...(manager ? [{ value: "match" as const, label: "Ghép tiền về" }] : []), { value: "ledger", label: "Sổ com" }];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="payments-page">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 text-xl font-semibold sm:text-2xl">Thanh toán và com</h1>
        <Link to="/quan-ly-deal" className="ml-auto inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">Về Quản lý Deal</Link>
      </div>
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === "dot" && <InstalmentsTab manager={manager} />}
      {tab === "match" && manager && <MatchTab receiptsTable={receipts} prefill={prefill} onDone={() => setPrefill(null)} onPick={(id) => setPrefill({ receiptId: id })} />}
      {tab === "ledger" && ledger && <LedgerTab manager={manager} myId={me?.user.id ?? ""} />}
      {tab === "ledger" && !ledger && <EmptyState title="Chưa có Sổ com" hint="Bảng Sổ com chưa được dựng cho cây của bạn." />}
    </div>
  );
}

// ---- instalments ------------------------------------------------------------------------------------------------------------

type DotView = "pending" | "month" | "ai";
const DOT_VIEWS: { value: DotView; label: string }[] = [
  { value: "pending", label: "Chờ tiền về" },
  { value: "month", label: "Đã về trong kỳ" },
  { value: "ai", label: "Do AI nhập chưa kiểm" },
];

/** The period of "Đã về trong kỳ": the Manager may open last month to cancel a confirmation of a month that is not closed yet (module4 12). */
const DOT_PERIODS = [
  { value: "this_month", label: "Tháng này" },
  { value: "last_month", label: "Tháng trước" },
  { value: "this_quarter", label: "Quý này" },
  { value: "last_quarter", label: "Quý trước" },
] as const;
type DotPeriod = (typeof DOT_PERIODS)[number]["value"];

function InstalmentsTab({ manager }: { manager: boolean }) {
  const qc = useQueryClient();
  const { dots, deals } = usePaymentTables();
  const s = useSchema(dots?.id);
  const [view, setView] = useState<DotView>("pending");
  const [period, setPeriod] = useState<DotPeriod>("this_month");
  const [scheduling, setScheduling] = useState(false);
  const [undo, setUndo] = useState<Row | null>(null);
  const ngay = s.key("ngay_tien_ve");
  const rowsQ = useQuery({
    queryKey: ["pay-rows", dots?.id, view, period],
    enabled: !!dots && !!s.table,
    queryFn: async () => {
      const filter = view === "pending" ? { field: ngay, op: "is_empty" } : view === "month" ? { field: ngay, op: period } : undefined;
      return (await fetchRows(dots!.id, { filter, limit: 500 })).data;
    },
  });
  const rows = useMemo(() => {
    const all = rowsQ.data ?? [];
    if (view !== "ai") return all;
    return all.filter((r) => optionName(s.col("nguon_nhap"), r.data[s.key("nguon_nhap")]) === "AI" && r.data[s.key("da_kiem")] !== true);
  }, [rowsQ.data, view, s]);
  const dealKey = s.key("deal");
  const labels = useRelationLabels(dots?.id, dealKey, rows.flatMap((r) => idsOf(r.data[dealKey])));
  const statusCol = s.table?.columns.find((c) => c.name === "Trạng thái" && c.type === "formula");
  const un = useMutation({
    mutationFn: (id: string) => unconfirmPayments([id]),
    onSuccess: () => {
      setUndo(null);
      refreshAll(qc);
      notify.ok("Đã huỷ xác nhận. Com tạm tính của đợt này đã bị gỡ.");
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Chế độ xem" className="flex flex-wrap gap-1">
          {DOT_VIEWS.map((v) => (
            <button key={v.value} type="button" aria-pressed={view === v.value} data-testid={`dot-view-${v.value}`} onClick={() => setView(v.value)} className={`min-h-9 rounded-md border px-3 text-sm ${view === v.value ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-muted"}`}>
              {v.label}
            </button>
          ))}
        </div>
        {view === "month" && (
          <Select aria-label="Kỳ của các đợt đã về" data-testid="dot-period" className="!w-auto" value={period} onChange={(e) => setPeriod(e.target.value as DotPeriod)}>
            {DOT_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        )}
        {manager && deals && (
          <Button className="ml-auto" data-testid="open-schedule" onClick={() => setScheduling(true)}>
            <Plus size={16} aria-hidden /> Lập lịch cho deal
          </Button>
        )}
      </div>
      {rowsQ.isLoading || s.q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rowsQ.error ? (
        <ErrorState error={rowsQ.error} onRetry={() => void rowsQ.refetch()} title="Không tải được các đợt" />
      ) : rows.length === 0 ? (
        <EmptyState title="Không có đợt nào" hint={view === "pending" ? "Chưa có đợt nào đang chờ tiền về." : view === "month" ? "Kỳ này chưa có đợt nào về." : "Không có đợt nào do AI nhập mà chưa kiểm."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Deal</th><th>Đợt</th><th>Pháp nhân</th><th>Hạn</th><th className="text-right">Dự kiến (chưa VAT)</th><th>Ngày tiền về</th><th className="text-right">Đã về (chưa VAT)</th><th>Trạng thái</th>{manager && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dealId = idsOf(r.data[dealKey])[0];
              const paid = str(r.data[ngay]) !== "";
              return (
                <tr key={r.id} data-testid="dot-row">
                  <td>{(dealId && labels.data?.get(dealId)) || "—"}</td>
                  <td>{num(r.data[s.key("dot_so")]) ?? "—"}</td>
                  <td>{str(r.data[s.key("phap_nhan")]) || "—"}</td>
                  <td>{formatDate(str(r.data[s.key("han")]))}</td>
                  <td className="text-right">{money(r.data[s.key("so_tien_du_kien")])}</td>
                  <td>{paid ? formatDate(str(r.data[ngay])) : "—"}</td>
                  <td className="text-right">{paid ? money(r.data[s.key("so_tien_ve")]) : "—"}</td>
                  <td data-testid="dot-status">{statusCol ? <Badge>{str(r.data[statusCol.key]) || "—"}</Badge> : "—"}</td>
                  {manager && (
                    <td className="text-right">
                      {paid && <Button variant="secondary" data-testid="unconfirm" onClick={() => setUndo(r)}>Huỷ xác nhận</Button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {undo && (
        <>
          <ConfirmDialog
            title="Huỷ xác nhận tiền về?"
            message="Đợt trở lại trạng thái chờ tiền về; com tạm tính của đợt bị gỡ và deal Won có thể trở lại trạng thái mở. Kỳ đã chốt thì không huỷ được."
            confirmLabel="Huỷ xác nhận"
            busy={un.isPending}
            onConfirm={() => un.mutate(undo.id)}
            onClose={() => { setUndo(null); un.reset(); }}
          />
          {un.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2" role="alert"><ErrorText error={un.error} /></div>}
        </>
      )}
      {scheduling && deals && <DealPickerAndSchedule dealsTable={deals} onClose={() => setScheduling(false)} />}
    </div>
  );
}

// ---- schedule ---------------------------------------------------------------------------------------------------------------

export interface DealRef { id: string; label: string }

/** Search a deal by name or code, then open the schedule dialog for it. */
function DealPickerAndSchedule({ dealsTable, onClose }: { dealsTable: DealTable; onClose: () => void }) {
  const s = useSchema(dealsTable.id);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<DealRef | null>(null);
  const res = useQuery({ queryKey: ["pay-deal-search", dealsTable.id, text], enabled: text.trim().length >= 2, queryFn: async () => (await fetchRows(dealsTable.id, { search: text.trim(), limit: 8 })).data });
  const nameKey = s.key("ten_cong_ty");
  const codeKey = s.key("ma_deal");
  if (picked) return <ScheduleDialog deal={picked} onClose={onClose} />;
  return (
    <Modal title="Chọn deal để lập lịch" open onClose={onClose}>
      <Field label="Tìm deal theo tên công ty hoặc mã deal">
        <Input autoFocus data-testid="deal-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ít nhất 2 ký tự" />
      </Field>
      <ul className="mt-3 flex flex-col gap-1">
        {(res.data ?? []).map((r) => {
          const label = [str(r.data[codeKey]), str(r.data[nameKey])].filter(Boolean).join(" · ") || `Deal #${r.row_no ?? ""}`;
          return (
            <li key={r.id}>
              <button type="button" data-testid="deal-option" className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPicked({ id: r.id, label })}>{label}</button>
            </li>
          );
        })}
        {res.data && res.data.length === 0 && <li className="text-sm text-muted-foreground">Không tìm thấy deal nào.</li>}
      </ul>
    </Modal>
  );
}

interface Draft { id?: string; seq: string; amount: string; due: string; locked: boolean }
const toNumber = (t: string): number | null => {
  const n = Number(t.replace(/[.\s]/g, "").replace(",", "."));
  return t.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Schedule of one deal: unconfirmed instalments can change or go; confirmed ones are shown and stay (module4 7.4). A confirmed instalment is undone from the instalment list. */
export function ScheduleDialog({ deal, onClose }: { deal: DealRef; onClose: () => void }) {
  const qc = useQueryClient();
  const { dots, deals } = usePaymentTables();
  const ds = useSchema(deals?.id);
  const ps = useSchema(dots?.id);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [legal, setLegal] = useState("");
  const [tax, setTax] = useState("");
  const [contract, setContract] = useState("");
  const existing = useQuery({
    queryKey: ["deal-payments", "sched", deal.id],
    enabled: !!deals && !!dots && !!ds.table && !!ps.table,
    queryFn: async () => {
      const dealRow = (await fetchRowsByIds(deals!.id, [deal.id]))[0];
      const ids = idsOf(dealRow?.data[ds.key("dot_thanh_toan")]);
      const rows = ids.length ? await fetchRowsByIds(dots!.id, ids) : [];
      return rows;
    },
  });
  const rows = existing.data;
  const list: Draft[] = drafts ?? (rows ? rows.map((r) => ({ id: r.id, seq: String(num(r.data[ps.key("dot_so")]) ?? ""), amount: String(num(r.data[ps.key("so_tien_du_kien")]) ?? ""), due: str(r.data[ps.key("han")]).slice(0, 10), locked: str(r.data[ps.key("ngay_tien_ve")]) !== "" })).sort((a, b) => Number(a.seq) - Number(b.seq)) : []);
  const set = (i: number, p: Partial<Draft>) => setDrafts(list.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const add = () => setDrafts([...list, { seq: String(Math.max(0, ...list.map((d) => Number(d.seq) || 0)) + 1), amount: "", due: "", locked: false }]);
  const drop = (i: number) => {
    const d = list[i]!;
    if (d.id) setRemoved([...removed, d.id]);
    setDrafts(list.filter((_, k) => k !== i));
  };
  const parsed = list.filter((d) => !d.locked).map((d) => ({ d, amount: toNumber(d.amount) }));
  const invalid = parsed.some((p) => p.amount === null || p.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(p.d.due));
  const save = useMutation({
    mutationFn: () => {
      const payments: ScheduleItem[] = parsed.map(({ d, amount }) => ({ ...(d.id ? { id: d.id } : {}), ...(Number(d.seq) ? { seq: Number(d.seq) } : {}), amount: amount!, due: d.due, ...(legal ? { legal_entity: legal } : {}), ...(tax ? { tax_code: tax } : {}), ...(contract ? { contract_no: contract } : {}) }));
      return schedulePayments({ deal_id: deal.id, payments, remove_ids: removed });
    },
    onSuccess: (r) => {
      refreshAll(qc);
      void qc.invalidateQueries({ queryKey: ["deal-payments"] });
      notify.ok(`Đã lưu lịch: ${r.payments.length} đợt`);
      onClose();
    },
  });
  return (
    <Modal title={`Lập lịch thanh toán: ${deal.label}`} open onClose={onClose} dirty={drafts !== null} wide>
      {existing.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : existing.error ? (
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} title="Không tải được lịch hiện có" />
      ) : (
        <div className="flex flex-col gap-3">
          <Notice>Số tiền là số chưa VAT. Đợt đã xác nhận tiền về không sửa ở đây; huỷ xác nhận ở danh sách đợt.</Notice>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Pháp nhân (áp cho đợt mới)"><Input value={legal} onChange={(e) => setLegal(e.target.value)} /></Field>
            <Field label="Mã số thuế"><Input value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
            <Field label="Số hợp đồng"><Input value={contract} onChange={(e) => setContract(e.target.value)} /></Field>
          </div>
          <div className="flex flex-col gap-2">
            {list.map((d, i) => (
              <div key={d.id ?? `new${i}`} data-testid="sched-row" className="grid grid-cols-[4rem_1fr_9rem_auto] items-end gap-2">
                <Field label={i === 0 ? "Đợt" : ""}><Input aria-label="Đợt số" value={d.seq} disabled={d.locked} onChange={(e) => set(i, { seq: e.target.value })} /></Field>
                <Field label={i === 0 ? "Số tiền (chưa VAT)" : ""}><Input aria-label="Số tiền" inputMode="numeric" value={d.amount} disabled={d.locked} onChange={(e) => set(i, { amount: e.target.value })} /></Field>
                <Field label={i === 0 ? "Hạn" : ""}><Input aria-label="Hạn" type="date" value={d.due} disabled={d.locked} onChange={(e) => set(i, { due: e.target.value })} /></Field>
                {d.locked ? <Badge>Đã về</Badge> : <Button variant="ghost" aria-label="Bỏ đợt này" onClick={() => drop(i)} className="!px-2"><Trash2 size={16} aria-hidden /></Button>}
              </div>
            ))}
            {list.length === 0 && <p className="text-sm text-muted-foreground">Deal chưa có đợt nào.</p>}
          </div>
          <div><Button variant="secondary" data-testid="sched-add" onClick={add}><Plus size={16} aria-hidden /> Thêm đợt</Button></div>
          {save.error && <div role="alert"><ErrorText error={save.error} /></div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Đóng</Button>
            <Button data-testid="sched-save" loading={save.isPending} disabled={invalid || (parsed.length === 0 && removed.length === 0)} onClick={() => save.mutate()}>Lưu lịch</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- matching tool ----------------------------------------------------------------------------------------------------------

interface Pick { c: MatchCandidate; amount: string; received: string; shortfall: "split" | "keep" }

function MatchTab({ receiptsTable, prefill, onPick, onDone }: { receiptsTable?: DealTable; prefill: { receiptId: string } | null; onPick: (id: string) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const rs = useSchema(receiptsTable?.id);
  const [f, setF] = useState({ amount: "", received_on: today(), payer_name: "", account_no: "", bank: "", tax_code: "", content: "" });
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [cands, setCands] = useState<MatchCandidate[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const upd = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const amountNum = toNumber(f.amount);
  const find = useMutation({
    mutationFn: () => matchCandidates({ amount: amountNum ?? undefined, payer_name: f.payer_name, account_no: f.account_no, tax_code: f.tax_code, content: f.content, received_on: f.received_on, limit: 10 }),
    onSuccess: setCands,
  });
  const toggle = (c: MatchCandidate) => {
    const on = picks.find((p) => p.c.payment_id === c.payment_id);
    if (on) return setPicks(picks.filter((p) => p !== on));
    const solo = picks.length === 0;
    setPicks([...picks, { c, amount: String(c.planned), received: solo && amountNum !== null ? String(amountNum) : "", shortfall: "split" }]);
  };
  const setPick = (i: number, p: Partial<Pick>) => setPicks(picks.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const receivedSum = picks.reduce((a, p) => a + (toNumber(p.received) ?? 0), 0);
  const ready = amountNum !== null && picks.length > 0 && picks.every((p) => toNumber(p.amount) !== null && toNumber(p.received) !== null) && Math.round(receivedSum) === Math.round(amountNum);
  const confirm = useMutation({
    mutationFn: () => {
      const allocations: Allocation[] = picks.map((p) => ({ payment_id: p.c.payment_id, amount: toNumber(p.amount)!, amount_received: toNumber(p.received)!, shortfall: p.shortfall }));
      return confirmPayments({ received_on: f.received_on, receipt: receiptId ? { id: receiptId } : { amount: amountNum!, payer_name: f.payer_name || undefined, account_no: f.account_no || undefined, bank: f.bank || undefined, content: f.content || undefined }, allocations });
    },
    onSuccess: (r) => {
      refreshAll(qc);
      void qc.invalidateQueries({ queryKey: ["pay-receipts"] });
      notify.ok(r.won_deal_ids.length ? `Đã xác nhận. ${r.won_deal_ids.length} deal chuyển sang Won.` : "Đã xác nhận tiền về");
      setF({ amount: "", received_on: today(), payer_name: "", account_no: "", bank: "", tax_code: "", content: "" });
      setReceiptId(null);
      setCands(null);
      setPicks([]);
      onDone();
    },
  });
  // An unmatched transfer chosen in the list below fills the form; the confirm then reuses that row instead of making a new one.
  const [loaded, setLoaded] = useState<string | null>(null);
  if (prefill && loaded !== prefill.receiptId && rs.table) {
    setLoaded(prefill.receiptId);
    void fetchRowsByIds(receiptsTable!.id, [prefill.receiptId]).then((r) => {
      const row = r[0];
      if (!row) return;
      setReceiptId(row.id);
      setF({ amount: String(num(row.data[rs.key("so_tien")]) ?? ""), received_on: str(row.data[rs.key("ngay_nhan")]).slice(0, 10) || today(), payer_name: str(row.data[rs.key("nguoi_tra")]), account_no: str(row.data[rs.key("so_tai_khoan")]), bank: str(row.data[rs.key("ngan_hang")]), tax_code: "", content: str(row.data[rs.key("noi_dung")]) });
      setCands(null);
      setPicks([]);
    });
  }
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-label="Ghép tiền về">
        <Notice>Nhập thông tin ủy nhiệm chi (UNC), hoặc dán nguyên thông báo vào ô nội dung. Hệ thống xếp hạng các đợt chưa về bằng luật cố định, không dùng AI.</Notice>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Số tiền (gồm VAT)" required><Input data-testid="m-amount" inputMode="numeric" value={f.amount} onChange={(e) => upd({ amount: e.target.value })} disabled={!!receiptId} /></Field>
          <Field label="Ngày nhận" required><Input data-testid="m-date" type="date" value={f.received_on} onChange={(e) => upd({ received_on: e.target.value })} /></Field>
          <Field label="Tên đơn vị trả"><Input data-testid="m-payer" value={f.payer_name} onChange={(e) => upd({ payer_name: e.target.value })} /></Field>
          <Field label="Số tài khoản"><Input data-testid="m-account" value={f.account_no} onChange={(e) => upd({ account_no: e.target.value })} /></Field>
          <Field label="Ngân hàng"><Input value={f.bank} onChange={(e) => upd({ bank: e.target.value })} /></Field>
          <Field label="Mã số thuế (nếu có)"><Input value={f.tax_code} onChange={(e) => upd({ tax_code: e.target.value })} /></Field>
        </div>
        <Field label="Nội dung chuyển khoản / dán thông báo"><Textarea data-testid="m-content" rows={3} value={f.content} onChange={(e) => upd({ content: e.target.value })} /></Field>
        <div><Button data-testid="m-find" loading={find.isPending} disabled={amountNum === null} onClick={() => find.mutate()}>Tìm đợt khớp</Button></div>
        {find.error && <div role="alert"><ErrorText error={find.error} /></div>}
        {cands && (
          <div className="flex flex-col gap-2" data-testid="m-candidates">
            {cands.length === 0 && <EmptyState title="Không có đợt nào khớp" hint="Không tìm thấy đợt chưa về nào gần với thông tin này. Có thể lưu khoản này vào hàng Tiền về chưa ghép bằng cách nhập tay ở bảng Tiền về." />}
            {cands.map((c) => {
              const on = picks.some((p) => p.c.payment_id === c.payment_id);
              return (
                <label key={c.payment_id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" data-testid="m-cand" checked={on} onChange={() => toggle(c)} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{c.deal_name}{c.seq !== null ? ` · đợt ${c.seq}` : ""} {c.strong && <Badge>Khớp mạnh</Badge>}</span>
                    <span className="text-muted-foreground">Dự kiến {formatCurrency(c.planned)}{c.due ? `, hạn ${formatDate(c.due)}` : ""}</span>
                    <span className="text-muted-foreground">{c.reasons.join("; ")}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {picks.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="m-alloc">
            <h2 className="text-base font-semibold">Chia khoản này vào các đợt</h2>
            {picks.map((p, i) => (
              <div key={p.c.payment_id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-4" data-testid="m-alloc-row">
                <div className="sm:col-span-4 text-sm font-medium">{p.c.deal_name}{p.c.seq !== null ? ` · đợt ${p.c.seq}` : ""}</div>
                <Field label="Số tiền chưa VAT"><Input aria-label="Số tiền chưa VAT" inputMode="numeric" value={p.amount} onChange={(e) => setPick(i, { amount: e.target.value })} /></Field>
                <Field label="Số tiền nhận (gồm VAT)"><Input aria-label="Số tiền nhận" inputMode="numeric" value={p.received} onChange={(e) => setPick(i, { received: e.target.value })} /></Field>
                <Field label="Nếu về thiếu"><Select aria-label="Về thiếu" value={p.shortfall} onChange={(e) => setPick(i, { shortfall: e.target.value as "split" | "keep" })}><option value="split">Tách phần còn thiếu thành đợt mới</option><option value="keep">Giữ đợt, chờ phần còn lại</option></Select></Field>
              </div>
            ))}
            <p className={`text-sm ${ready ? "text-muted-foreground" : "text-bad"}`} data-testid="m-sum">
              Tổng nhận các đợt: {formatCurrency(receivedSum)} / số tiền về {amountNum === null ? "—" : formatCurrency(amountNum)}{ready ? "" : ". Hai số phải bằng nhau."}
            </p>
            {confirm.error && <div role="alert"><ErrorText error={confirm.error} /></div>}
            <div><Button data-testid="m-confirm" loading={confirm.isPending} disabled={!ready} onClick={() => confirm.mutate()}>Xác nhận tiền về</Button></div>
          </div>
        )}
      </section>
      <UnmatchedReceipts receiptsTable={receiptsTable} onPick={onPick} />
    </div>
  );
}

function UnmatchedReceipts({ receiptsTable, onPick }: { receiptsTable?: DealTable; onPick: (id: string) => void }) {
  const rs = useSchema(receiptsTable?.id);
  const q = useQuery({ queryKey: ["pay-receipts", receiptsTable?.id], enabled: !!receiptsTable && !!rs.table, queryFn: async () => (await fetchRows(receiptsTable!.id, { limit: 500 })).data });
  const dotKey = rs.key("dot");
  const rows = (q.data ?? []).filter((r) => idsOf(r.data[dotKey]).length === 0);
  return (
    <section className="flex flex-col gap-2" aria-label="Tiền về chưa ghép" data-testid="unmatched">
      <h2 className="text-base font-semibold">Tiền về chưa ghép</h2>
      {!receiptsTable ? <p className="text-sm text-muted-foreground">Chưa có bảng Tiền về.</p> : q.isLoading ? <Skeleton className="h-16 w-full" /> : q.error ? <ErrorState error={q.error} title="Không tải được" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Không có khoản nào chờ ghép.</p> : (
        <Table>
          <thead><tr><th>Ngày nhận</th><th>Đơn vị trả</th><th className="text-right">Số tiền</th><th>Nội dung</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="unmatched-row">
                <td>{formatDate(str(r.data[rs.key("ngay_nhan")]))}</td>
                <td>{str(r.data[rs.key("nguoi_tra")]) || "—"}</td>
                <td className="text-right">{money(r.data[rs.key("so_tien")])}</td>
                <td className="max-w-64 truncate" title={str(r.data[rs.key("noi_dung")])}>{str(r.data[rs.key("noi_dung")]) || "—"}</td>
                <td className="text-right"><Button variant="secondary" onClick={() => onPick(r.id)}>Ghép khoản này</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

// ---- commission ledger ------------------------------------------------------------------------------------------------------

function LedgerTab({ manager, myId }: { manager: boolean; myId: string }) {
  const qc = useQueryClient();
  const { ledger } = usePaymentTables();
  const s = useSchema(ledger?.id);
  const [mine, setMine] = useState(true);
  const [period, setPeriod] = useState("");
  const [adj, setAdj] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ["pay-rows", ledger?.id, "ledger"], enabled: !!ledger && !!s.table, queryFn: async () => (await fetchRows(ledger!.id, { limit: 500 })).data });
  const personKey = s.key("nguoi");
  const kyKey = s.key("ky");
  const personOf = (r: Row) => idsOf(r.data[personKey])[0] ?? "";
  const all = q.data ?? [];
  const periods = [...new Set(all.map((r) => str(r.data[kyKey]).slice(0, 7)).filter(Boolean))].sort().reverse();
  const rows = all.filter((r) => (!mine || personOf(r) === myId) && (!period || str(r.data[kyKey]).slice(0, 7) === period));
  const names = usePeopleNames(rows.map(personOf).filter(Boolean));
  const dotKey = s.key("dot");
  const dealKey = s.key("deal");
  const dealLabels = useRelationLabels(ledger?.id, dealKey, rows.flatMap((r) => idsOf(r.data[dealKey])));
  const del = useMutation({ mutationFn: (v: { payment_id: string; person_id: string; amount: number; reason: string }) => adjustCommission(v), onSuccess: () => { setAdj(null); refreshAll(qc); notify.ok("Đã ghi điều chỉnh com"); } });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Phạm vi" className="flex gap-1">
          {[{ v: true, l: "Com của tôi" }, { v: false, l: "Tất cả trong phạm vi" }].map((o) => (
            <button key={String(o.v)} type="button" aria-pressed={mine === o.v} data-testid={o.v ? "ledger-mine" : "ledger-all"} onClick={() => setMine(o.v)} className={`min-h-9 rounded-md border px-3 text-sm ${mine === o.v ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-muted"}`}>{o.l}</button>
          ))}
        </div>
        <Select aria-label="Kỳ" value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-auto">
          <option value="">Mọi kỳ</option>
          {periods.map((p) => <option key={p} value={p}>Tháng {p.slice(5)}/{p.slice(0, 4)}</option>)}
        </Select>
      </div>
      {q.isLoading || s.q.isLoading ? <Skeleton className="h-40 w-full" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được Sổ com" /> : rows.length === 0 ? <EmptyState title="Chưa có dòng com" hint="Com tạm tính xuất hiện khi Manager xác nhận tiền về của một đợt." /> : (
        <Table>
          <thead><tr><th>Kỳ</th><th>Người</th><th>Deal</th><th className="text-right">% com</th><th className="text-right">Com</th><th>Trạng thái</th><th>Lý do</th>{manager && <th />}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const pid = personOf(r);
              return (
                <tr key={r.id} data-testid="ledger-row">
                  <td>{str(r.data[kyKey]).slice(0, 7) || "—"}</td>
                  <td>{names.data?.get(pid) ? <PersonChip person={{ id: pid, full_name: names.data.get(pid)! }} /> : "—"}</td>
                  <td>{(idsOf(r.data[dealKey])[0] && dealLabels.data?.get(idsOf(r.data[dealKey])[0]!)) || "—"}</td>
                  <td className="text-right">{typeof r.data[s.key("ty_le_com")] === "number" ? `${Math.round((r.data[s.key("ty_le_com")] as number) * 10000) / 100}%` : "—"}</td>
                  <td className="text-right" data-testid="ledger-com">{money(r.data[s.key("com")])}</td>
                  <td data-testid="ledger-status">{optionName(s.col("trang_thai_com"), r.data[s.key("trang_thai_com")]) || "—"}</td>
                  <td>{str(r.data[s.key("ly_do")]) || "—"}</td>
                  {manager && <td className="text-right"><Button variant="secondary" data-testid="adjust" onClick={() => setAdj(r)}>Điều chỉnh</Button></td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {adj && <AdjustDialog paymentId={idsOf(adj.data[dotKey])[0] ?? ""} personId={personOf(adj)} personName={names.data?.get(personOf(adj)) ?? ""} busy={del.isPending} error={del.error} onSave={(v) => del.mutate(v)} onClose={() => { setAdj(null); del.reset(); }} />}
    </div>
  );
}

function AdjustDialog({ paymentId, personId, personName, busy, error, onSave, onClose }: { paymentId: string; personId: string; personName: string; busy: boolean; error: unknown; onSave: (v: { payment_id: string; person_id: string; amount: number; reason: string }) => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const n = toNumber(amount);
  return (
    <Modal title={`Điều chỉnh com${personName ? `: ${personName}` : ""}`} open onClose={onClose} dirty={amount !== "" || reason !== ""}>
      <div className="flex flex-col gap-3">
        <Notice>Ghi thêm một dòng điều chỉnh vào Sổ com (số âm để giảm). Dòng cũ không bị sửa.</Notice>
        <Field label="Số tiền điều chỉnh (có thể âm)" required><Input data-testid="adj-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Lý do" required><Textarea data-testid="adj-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {!!error && <div role="alert"><ErrorText error={error} /></div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          <Button data-testid="adj-save" loading={busy} disabled={n === null || n === 0 || reason.trim() === "" || !paymentId || !personId} onClick={() => onSave({ payment_id: paymentId, person_id: personId, amount: n!, reason: reason.trim() })}>Ghi điều chỉnh</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- the instalments of one deal, for the deal detail panel -----------------------------------------------------------------

/** "Các đợt thanh toán" of a deal in the row panel (module4 16): status and "com của tôi" of each instalment, from the same columns the page reads. */
export function DealPaymentsPanel({ dealRow, dealsTableId }: { dealRow: Row; dealsTableId: string }) {
  const me = useMe().data;
  const manager = can(me, "deal:payment:write");
  const { dots, ledger } = usePaymentTables();
  const ds = useSchema(dealsTableId);
  const ps = useSchema(dots?.id);
  const ls = useSchema(ledger?.id);
  const [scheduling, setScheduling] = useState(false);
  const ids = idsOf(dealRow.data[ds.key("dot_thanh_toan")]);
  const q = useQuery({ queryKey: ["deal-payments", dealRow.id, ids.join(",")], enabled: !!dots && !!ps.table && ids.length > 0, queryFn: () => fetchRowsByIds(dots!.id, ids) });
  const mine = useQuery({
    queryKey: ["deal-payments", "ledger", dealRow.id, ids.join(",")],
    enabled: !!ledger && !!ls.table && ids.length > 0,
    queryFn: async () => (await fetchRows(ledger!.id, { limit: 500 })).data.filter((r) => idsOf(r.data[ls.key("nguoi")])[0] === me?.user.id && ids.includes(idsOf(r.data[ls.key("dot")])[0] ?? "")),
  });
  const statusCol = ps.table?.columns.find((c) => c.name === "Trạng thái" && c.type === "formula");
  const comOf = (payId: string) => (mine.data ?? []).filter((r) => idsOf(r.data[ls.key("dot")])[0] === payId).map((r) => num(r.data[ls.key("com")])).filter((v): v is number => v !== null);
  if (!dots) return null;
  const label = str(dealRow.data[ds.key("ma_deal")]) || str(dealRow.data[ds.key("ten_cong_ty")]) || `Deal #${dealRow.row_no ?? ""}`;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3" aria-label="Các đợt thanh toán" data-testid="deal-payments">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Các đợt thanh toán</h3>
        {manager && <Button variant="secondary" data-testid="panel-schedule" onClick={() => setScheduling(true)}>Lập lịch</Button>}
      </div>
      {ids.length === 0 ? <p className="text-sm text-muted-foreground">Deal chưa có lịch thanh toán.</p> : q.isLoading ? <Skeleton className="h-12 w-full" /> : q.error ? <p className="text-sm text-bad">{errorMessage(q.error)}</p> : (
        <ul className="flex flex-col gap-1 text-sm">
          {(q.data ?? []).sort((a, b) => (num(a.data[ps.key("dot_so")]) ?? 0) - (num(b.data[ps.key("dot_so")]) ?? 0)).map((r) => {
            const com = comOf(r.id);
            return (
              <li key={r.id} data-testid="panel-dot" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-border pt-1 first:border-t-0 first:pt-0">
                <span>Đợt {num(r.data[ps.key("dot_so")]) ?? "?"}: {money(r.data[ps.key("so_tien_du_kien")])}, hạn {formatDate(str(r.data[ps.key("han")]))}</span>
                <span className="flex items-center gap-2">{statusCol && <Badge>{str(r.data[statusCol.key]) || "—"}</Badge>}<span className="text-muted-foreground" data-testid="panel-com">{com.length ? `Com của tôi ${formatCurrency(com.reduce((a, b) => a + b, 0))}` : "Com của tôi: —"}</span></span>
              </li>
            );
          })}
        </ul>
      )}
      {scheduling && <ScheduleDialog deal={{ id: dealRow.id, label }} onClose={() => setScheduling(false)} />}
    </section>
  );
}
