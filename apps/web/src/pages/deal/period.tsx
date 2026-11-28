import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonChip } from "@/components/ui/person";
import { Link } from "@tanstack/react-router";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "@soe/shared";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, Notice, PageTitle, Table, Tabs, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoAccessState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createExport, fetchRowsByIds, jobDownload, lookupPeople, saveFromUrl } from "@/lib/datahub/api";
import { ApiError } from "@/lib/api";
import { closePeriod, confirmReceived, periodCom, periodKeys, periodList, periodReview, reopenPeriod, snapshotCompare, snapshotCreate, snapshotList, type CloseResult, type CompareGroup, type ConfirmReceivedResult, type ReviewItem, type ReviewKind } from "@/lib/datahub/period-api";
import { can, useMe } from "@/lib/session";
import { useJob, JobBar } from "../datahub/job-progress";
import { usePaymentTables, useSchema } from "./payments";

/**
 * `/quan-ly-deal/chot-ky`: closing a month and the forecast snapshots (Module 4 mục 11, 12). Only the Manager of the tree sees it. The server decides what still
 * needs handling, every commission total and every refusal; this page lists them, asks for the confirmations and shows the answer.
 */

type Tab = "close" | "snapshot";

const monthNow = () => new Date().toISOString().slice(0, 7);
const monthLabel = (m: string) => `tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function PeriodPage() {
  const me = useMe().data;
  const [tab, setTab] = useState<Tab>("close");
  if (!me) return <Skeleton className="h-40 w-full" />;
  const manager = can(me, "deal:payment:write");
  if (!manager) return <NoAccessState title="Chỉ Manager chốt kỳ" hint="Chốt kỳ, mở lại kỳ và snapshot dự báo là việc của Manager trên cây của mình." />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="period-page">
      <PageTitle actions={<Link to="/quan-ly-deal" className="inline-flex min-h-8 items-center rounded-control border border-border bg-card px-3 text-sm font-medium hover:bg-muted">Về Quản lý Deal</Link>}>Chốt kỳ và dự báo</PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "close", label: "Chốt kỳ tháng" }, { value: "snapshot", label: "Snapshot dự báo" }]} />
      {tab === "close" ? <ClosePanel /> : <SnapshotPanel />}
    </div>
  );
}

// ---- close a month ----------------------------------------------------------------------------------------------------------

const KIND_LABEL: Record<ReviewKind, string> = {
  overdue_payment: "Đợt quá hạn chưa xác nhận",
  received_unconfirmed: "Đợt đã có ngày hoặc số tiền về nhưng chưa xác nhận (thường do import)",
  unmatched_receipt: "Tiền về chưa ghép vào đợt nào",
  com_cap_mismatch: "Tổng % com khác mức trần Tỉ lệ SoE",
  com_blank: "Com trống (thiếu Level BC hoặc Performance BC)",
  unchecked_source: "Dòng do AI/API nhập chưa kiểm",
  stale_processing: "Deal Processing quá hạn đợt đầu lâu",
};

function detailText(it: ReviewItem): string {
  const d = it.detail;
  const parts: string[] = [];
  if (it.kind === "received_unconfirmed") { if (str(d.received_on)) parts.push(`về ${formatDate(str(d.received_on))}`); if (num(d.amount) !== null) parts.push(formatCurrency(num(d.amount))); }
  else if (it.kind === "overdue_payment") { if (str(d.due)) parts.push(`hạn ${formatDate(str(d.due))}`); if (num(d.planned) !== null) parts.push(formatCurrency(num(d.planned))); }
  else if (it.kind === "unmatched_receipt") { if (str(d.received_on)) parts.push(`nhận ${formatDate(str(d.received_on))}`); if (num(d.amount) !== null) parts.push(formatCurrency(num(d.amount))); if (str(d.payer)) parts.push(str(d.payer)); }
  else if (it.kind === "com_cap_mismatch") { if (num(d.total) !== null) parts.push(`đã chia ${formatPercent(num(d.total))}`); if (num(d.cap) !== null) parts.push(`mức trần ${formatPercent(num(d.cap))}`); }
  else if (it.kind === "unchecked_source") { if (str(d.source)) parts.push(`nguồn ${str(d.source)}`); }
  else if (it.kind === "stale_processing") { if (num(d.days) !== null) parts.push(`quá ${num(d.days)} ngày`); if (str(d.due)) parts.push(`hạn ${formatDate(str(d.due))}`); }
  return parts.join(" · ");
}

function ClosePanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthNow());
  const [confirm, setConfirm] = useState<"close" | "confirm_close" | null>(null);
  const [done, setDone] = useState<{ confirmed: ConfirmReceivedResult; closed: CloseResult } | null>(null);
  const [reopen, setReopen] = useState(false);
  const [exportMonth, setExportMonth] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const list = useQuery({ queryKey: periodKeys.list, queryFn: periodList });
  const review = useQuery({ queryKey: periodKeys.review(month), queryFn: () => periodReview(month), enabled: valid });
  const com = useQuery({ queryKey: periodKeys.com(month), queryFn: () => periodCom(month), enabled: valid });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: periodKeys.list });
    void qc.invalidateQueries({ queryKey: ["period-review"] });
    void qc.invalidateQueries({ queryKey: ["period-com"] });
    void qc.invalidateQueries({ queryKey: ["pay-rows"] });
  };
  const close = useMutation({
    mutationFn: (anyway: boolean) => closePeriod({ month, close_anyway: anyway }),
    onSuccess: (r) => {
      setConfirm(null);
      refresh();
      notify.ok(`Đã chốt kỳ ${monthLabel(r.month)}${r.blank_com_ids.length ? `. ${r.blank_com_ids.length} dòng com trống, sửa bằng điều chỉnh com.` : ""}`);
      setExportMonth(r.month);
    },
  });
  // Confirm the imported instalments, wait for the formulas (Kỳ, Com) the server computes after the write, then close; the server decides every number.
  const confirmClose = useMutation({
    mutationFn: async () => {
      const confirmed = await confirmReceived({ month });
      let fresh = await periodReview(month);
      for (let i = 0; i < 40 && fresh.stale; i++) { await sleep(1500); fresh = await periodReview(month); }
      for (let i = 0; ; i++) {
        try { return { confirmed, closed: await closePeriod({ month, close_anyway: fresh.total > 0 }) }; }
        catch (e) { if (!(e instanceof ApiError && e.details?.reason === "recalc_pending") || i >= 20) throw e; await sleep(1500); }
      }
    },
    onSuccess: (r) => { setConfirm(null); setDone(r); refresh(); notify.ok(`Đã xác nhận ${r.confirmed.payments} đợt và chốt kỳ ${monthLabel(r.closed.month)}`); },
    onError: () => { setConfirm(null); refresh(); },
  });
  const closed = review.data?.closed === true;
  const total = review.data?.total ?? 0;
  const unconfirmed = review.data?.items.filter((i) => i.kind === "received_unconfirmed").length ?? 0;
  const errorOf = (e: unknown): unknown => (e instanceof ApiError && e.details?.reason === "period_already_closed" ? new Error(`Kỳ ${monthLabel(month)} đã được chốt rồi. Tải lại trang để xem kết quả, hoặc mở lại kỳ nếu cần sửa.`) : e);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card px-4 py-3 shadow-card" data-testid="period-toolbar">
        <Field label="Tháng">
          <Input type="month" aria-label="Tháng chốt kỳ" data-testid="period-month" value={month} onChange={(e) => { setMonth(e.target.value); setPerson(null); close.reset(); confirmClose.reset(); setDone(null); }} className="!w-44" />
        </Field>
        {valid && review.data && <Badge tone={closed ? "ok" : "warn"} data-testid="period-state">{closed ? "Đã chốt" : "Đang mở"}</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {valid && <Button variant="secondary" data-testid="export-com" onClick={() => setExportMonth(month)}>Xuất XLSX bảng com</Button>}
          {closed ? (
            <Button variant="secondary" data-testid="reopen-period" onClick={() => setReopen(true)}>Mở lại kỳ</Button>
          ) : (
            <>
              {unconfirmed > 0 && <Button variant="secondary" data-testid="confirm-and-close" loading={confirmClose.isPending} onClick={() => setConfirm("confirm_close")}>Xác nhận rồi chốt</Button>}
            <Button data-testid="close-period" disabled={!valid || review.isLoading} loading={close.isPending} onClick={() => setConfirm("close")}>Chốt kỳ {valid ? monthLabel(month) : ""}</Button>
            </>
          )}
        </div>
      </div>
      <ErrorText error={errorOf(close.error)} />
      <ErrorText error={errorOf(confirmClose.error)} />
      {done && (
        <Notice>
          <span data-testid="confirm-result">
            Đã xác nhận <strong>{done.confirmed.payments}</strong> đợt, <strong>{done.confirmed.won_deal_ids.length}</strong> deal chuyển Won, <strong>{done.confirmed.ledger_ids.length}</strong> dòng Sổ com mới
            {done.confirmed.skipped_ledger > 0 ? `, ${done.confirmed.skipped_ledger} đợt đã có dòng Sổ com nên không sinh thêm` : ""}. Kỳ {monthLabel(done.closed.month)} đã chốt{done.closed.blank_com_ids.length ? `, ${done.closed.blank_com_ids.length} dòng com trống` : ""}.
          </span>
        </Notice>
      )}

      {valid && (
        <section aria-label="Cần xử lý trước khi chốt" className="flex flex-col gap-2" data-testid="period-review">
          <h2 className="text-base font-semibold">Cần xử lý trước khi chốt{review.data ? ` (${total})` : ""}</h2>
          {review.isLoading ? <Skeleton className="h-24 w-full" /> : review.error ? <ErrorState error={review.error} onRetry={() => void review.refetch()} title="Không tải được danh sách cần xử lý" /> : total === 0 ? (
            <p className="text-sm text-muted-foreground">Không còn mục nào.</p>
          ) : (
            <ReviewList items={review.data!.items} />
          )}
        </section>
      )}

      {valid && (
        <section aria-label="Com theo người" className="flex flex-col gap-2" data-testid="period-com">
          <h2 className="text-base font-semibold">Com theo người, {monthLabel(month)}</h2>
          {com.isLoading ? <Skeleton className="h-24 w-full" /> : com.error ? <ErrorState error={com.error} onRetry={() => void com.refetch()} title="Không tải được com của kỳ" /> : (com.data?.people.length ?? 0) === 0 ? (
            <EmptyState title="Chưa có dòng com trong kỳ" hint="Com tạm tính xuất hiện khi xác nhận tiền về của một đợt." />
          ) : <ComByPerson month={month} data={com.data!} person={person} onPerson={setPerson} />}
        </section>
      )}

      <section aria-label="Các kỳ đã chốt" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Các kỳ đã chốt</h2>
        {list.isLoading ? <Skeleton className="h-16 w-full" /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Không tải được danh sách kỳ" /> : (list.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Chưa chốt kỳ nào.</p> : (
          <PeriodList rows={list.data!} onPick={(m) => { setMonth(m); setPerson(null); }} />
        )}
      </section>

      {confirm === "close" && (
        <ConfirmDialog
          title={total > 0 ? `Chốt dù còn ${total} mục?` : `Chốt kỳ ${monthLabel(month)}?`}
          message={total > 0 ? <>Còn {total} mục chưa xử lý. Chốt xong, ngày tiền về, số tiền và chia com của các đợt trong tháng, Status và Loại deal của deal đóng trong tháng bị khoá, dòng Sổ com thành giá trị cứng. Dòng do AI/API nhập chưa kiểm sẽ được đánh dấu đã kiểm.</> : <>Chốt xong, các đợt trong tháng và deal đóng trong tháng bị khoá, dòng Sổ com thành giá trị cứng. Mở lại kỳ được, nhưng dòng com đã chốt không tính lại.</>}
          confirmLabel={total > 0 ? `Chốt dù còn ${total} mục` : "Chốt kỳ"}
          busy={close.isPending}
          onConfirm={() => close.mutate(total > 0)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "confirm_close" && (
        <ConfirmDialog
          title={`Xác nhận ${unconfirmed} đợt rồi chốt kỳ ${monthLabel(month)}?`}
          message={<>Các đợt đã có ngày hoặc số tiền về sẽ được xác nhận như đã nhận tiền: tạo dòng Tiền về, chuyển deal đang mở thành Won, sinh dòng Sổ com và Doanh thu theo người. Sau đó kỳ được chốt. Mở lại kỳ được, nhưng dòng com đã chốt không tính lại.</>}
          confirmLabel="Xác nhận rồi chốt"
          busy={confirmClose.isPending}
          onConfirm={() => confirmClose.mutate()}
          onClose={() => setConfirm(null)}
        />
      )}
      {reopen && <ReopenDialog month={month} onClose={() => setReopen(false)} onDone={() => { setReopen(false); refresh(); }} />}
      {exportMonth && <ComExportDialog month={exportMonth} onClose={() => setExportMonth(null)} />}
    </div>
  );
}

function RowLink({ item }: { item: ReviewItem }) {
  const t = usePaymentTables();
  const id = item.table === "deals" ? t.deals?.id : item.table === "payments" ? t.dots?.id : item.table === "receipts" ? t.receipts?.id : t.ledger?.id;
  if (!id) return null;
  return <Link to="/quan-ly-deal/$tableId" params={{ tableId: id }} search={{ row: item.row_id } as never} className="text-primary underline" data-testid="review-link">Mở dòng</Link>;
}

function ReviewList({ items }: { items: ReviewItem[] }) {
  const kinds = (Object.keys(KIND_LABEL) as ReviewKind[]).filter((k) => items.some((i) => i.kind === k));
  return (
    <div className="flex flex-col gap-3">
      {kinds.map((k) => {
        const rows = items.filter((i) => i.kind === k);
        return (
          <div key={k}>
            <h3 className="mb-1 text-sm font-medium">{KIND_LABEL[k]} <span className="text-muted-foreground">({rows.length})</span></h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card text-sm">
              {rows.map((it) => (
                <li key={`${it.table}-${it.row_id}-${k}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="review-item">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{it.deal_name ?? "Không gắn deal"}</span>
                  <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{detailText(it)}</span>
                  <span className="ml-auto"><RowLink item={it} /></span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function usePeople(ids: string[]) {
  const uniq = [...new Set(ids)].slice(0, 200);
  return useQuery({ queryKey: ["pay-people", uniq.join(",")], enabled: uniq.length > 0, queryFn: async () => new Map((await lookupPeople({ ids: uniq })).map((p) => [p.id, p.full_name])) });
}

function ComByPerson({ month, data, person, onPerson }: { month: string; data: PeriodComResult; person: string | null; onPerson: (id: string | null) => void }) {
  const names = usePeople(data.people.map((p) => p.person_id));
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <thead><tr><th>Người</th><th className="text-right">Số dòng</th><th className="text-right">Tổng com</th><th /></tr></thead>
        <tbody>
          {data.people.map((p) => (
            <tr key={p.person_id} data-testid="com-person">
              <td>{names.data?.get(p.person_id) ? <PersonChip person={{ id: p.person_id, full_name: names.data.get(p.person_id)! }} /> : "—"}{p.blank_lines > 0 && <Badge tone="warn" className="ml-2">{p.blank_lines} dòng trống</Badge>}</td>
              <td className="text-right tabular-nums">{p.lines}</td>
              <td className="text-right font-medium tabular-nums" data-testid="com-total">{formatCurrency(p.total)}</td>
              <td className="text-right"><Button variant="ghost" className="!min-h-8" aria-pressed={person === p.person_id} onClick={() => onPerson(person === p.person_id ? null : p.person_id)}>{person === p.person_id ? "Ẩn dòng" : "Xem dòng"}</Button></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {person && <PersonLines month={month} personId={person} name={names.data?.get(person) ?? ""} />}
    </div>
  );
}
type PeriodComResult = Awaited<ReturnType<typeof periodCom>>;

function PersonLines({ month, personId, name }: { month: string; personId: string; name: string }) {
  const q = useQuery({ queryKey: periodKeys.com(month, personId), queryFn: () => periodCom(month, personId) });
  const t = usePaymentTables();
  const s = useSchema(t.deals?.id);
  const ids = [...new Set((q.data?.lines ?? []).map((l) => l.deal_id).filter((x): x is string => !!x))];
  const deals = useQuery({ queryKey: ["period-deals", t.deals?.id, ids.join(",")], enabled: !!t.deals && ids.length > 0, queryFn: async () => new Map((await fetchRowsByIds(t.deals!.id, ids.slice(0, 200))).map((r) => [r.id, str(r.data[s.key("ten_cong_ty")])])) });
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được dòng com" />;
  return (
    <div data-testid="com-lines" aria-label={`Dòng Sổ com của ${name}`}>
      <Table>
        <thead><tr><th>Deal</th><th>Trạng thái</th><th className="text-right">% com</th><th className="text-right">Com</th><th>Lý do</th></tr></thead>
        <tbody>
          {q.data!.lines.map((l) => (
            <tr key={l.id} data-testid="com-line">
              <td>{(l.deal_id && deals.data?.get(l.deal_id)) || "—"}</td>
              <td>{l.status ? <Badge tone={l.status === "Đã chốt" ? "ok" : l.status === "Điều chỉnh" ? "ai" : l.status === "Tạm tính" ? "warn" : "muted"}>{l.status}</Badge> : "—"}</td>
              <td className="text-right tabular-nums">{l.pct === null ? "—" : formatPercent(l.pct)}</td>
              <td className="text-right tabular-nums">{l.com === null ? <Badge tone="warn">Trống</Badge> : formatCurrency(l.com)}</td>
              <td>{l.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function PeriodList({ rows, onPick }: { rows: { month: string; locked_at: string; locked_by: string | null }[]; onPick: (m: string) => void }) {
  const names = usePeople(rows.map((r) => r.locked_by).filter((x): x is string => !!x));
  return (
    <Table>
      <thead><tr><th>Kỳ</th><th>Chốt lúc</th><th>Người chốt</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.month} data-testid="period-row">
            <td>{monthLabel(r.month)}</td>
            <td className="tabular-nums">{formatDateTime(r.locked_at)}</td>
            <td>{r.locked_by && names.data?.get(r.locked_by) ? <PersonChip person={{ id: r.locked_by, full_name: names.data.get(r.locked_by)! }} /> : "—"}</td>
            <td className="text-right"><Button variant="ghost" className="!min-h-8" onClick={() => onPick(r.month)}>Xem kỳ</Button></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ReopenDialog({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => reopenPeriod({ month, reason: reason.trim() }), onSuccess: () => { notify.ok(`Đã mở lại kỳ ${monthLabel(month)}`); onDone(); } });
  return (
    <Modal title={`Mở lại kỳ ${monthLabel(month)}`} open onClose={onClose} dirty={reason !== ""}>
      <div className="flex flex-col gap-3" data-testid="reopen-dialog">
        <p className="text-sm">Mở lại để sửa Status, Closing date hoặc chuyển vai trò cột. Dòng Sổ com đã chốt vẫn đứng yên: chênh lệch đi qua dòng điều chỉnh. Việc này được ghi nhật ký.</p>
        <Field label="Lý do mở lại"><Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lý do mở lại" data-testid="reopen-reason" /></Field>
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Không mở</Button>
          <Button variant="danger" data-testid="reopen-confirm" disabled={reason.trim() === ""} loading={m.isPending} onClick={() => m.mutate()}>Mở lại kỳ</Button>
        </div>
      </div>
    </Modal>
  );
}

/** XLSX of the commission ledger of one month (the sheet Data used to send): the ordinary table export, filtered on `Kỳ`. */
function ComExportDialog({ month, onClose }: { month: string; onClose: () => void }) {
  const com = useQuery({ queryKey: periodKeys.com(month), queryFn: () => periodCom(month) });
  const s = useSchema(com.data?.ledger_table_id);
  const [jobId, setJobId] = useState<string | null>(null);
  const started = useRef(false);
  const job = useJob(jobId);
  const downloaded = useRef<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => createExport({ table_id: com.data!.ledger_table_id, format: "xlsx", time_filter: { columns: [s.key("ky")], range: { kind: "period", unit: "month", year: Number(month.slice(0, 4)), index: Number(month.slice(5, 7)) } } }),
    onSuccess: (j) => setJobId(j.id),
  });
  useEffect(() => {
    if (com.data && s.table && !started.current) { started.current = true; start.mutate(); }
  }, [com.data, s.table, start]);
  const d = job.data;
  useEffect(() => {
    if (d?.status === "done" && downloaded.current !== d.id) {
      downloaded.current = d.id;
      void jobDownload(d.id).then((r) => saveFromUrl(r.url, r.filename)).catch(() => setDlError("Không tải được file. Bấm Xuất lại."));
    }
  }, [d]);
  return (
    <Modal title={`Xuất bảng com ${monthLabel(month)}`} open onClose={onClose}>
      <div className="flex flex-col gap-3" data-testid="com-export">
        {(com.error || s.q.error) && <ErrorText error={com.error ?? s.q.error} />}
        <ErrorText error={start.error} />
        {dlError && <p role="alert" className="text-sm text-bad">{dlError}</p>}
        {d ? <JobBar job={d} /> : !com.error && <Skeleton className="h-6 w-full" />}
        {d?.status === "done" && <Notice>File XLSX đã sẵn sàng, trình duyệt đang tải về.</Notice>}
        {d && (d.status === "failed" || d.status === "cancelled") && <p role="alert" className="text-sm text-bad">Không xuất được file. Thử lại.</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Đóng</Button></div>
      </div>
    </Modal>
  );
}

// ---- snapshots --------------------------------------------------------------------------------------------------------------

const GROUP_LABEL: Record<CompareGroup, string> = { won: "Won trong quý", slipped: "Trượt sang quý sau", lost: "Lost / Disqualified", open: "Vẫn mở" };

function SnapshotPanel() {
  const qc = useQueryClient();
  const me = useMe().data;
  const allowed = can(me, "deal:snapshot:create");
  const list = useQuery({ queryKey: periodKeys.snaps, queryFn: snapshotList, enabled: allowed });
  const [note, setNote] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => snapshotCreate(note.trim()),
    onSuccess: (r) => { setNote(""); void qc.invalidateQueries({ queryKey: periodKeys.snaps }); setSel(r.id); notify.ok(`Đã chụp ${r.name}: ${r.row_count} deal, dự báo ${formatCurrency(r.forecast)}`); },
  });
  if (!allowed) return <NoAccessState title="Chỉ Manager chụp snapshot" />;
  return (
    <div className="flex flex-col gap-4" data-testid="snapshot-panel">
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card px-4 py-3 shadow-card">
        <Field label="Ghi chú (không bắt buộc)"><Input aria-label="Ghi chú snapshot" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="!w-72" /></Field>
        <Button data-testid="snapshot-create" loading={create.isPending} onClick={() => create.mutate()}>Chụp snapshot dự báo</Button>
      </div>
      <p className="text-sm text-muted-foreground">Snapshot ghi dự báo của quý cho các deal đang mở. Hệ thống tự chụp lúc 00:05 ngày đầu mỗi quý; chụp thêm bất cứ lúc nào.</p>
      <ErrorText error={create.error} />
      {list.isLoading ? <Skeleton className="h-24 w-full" /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Không tải được snapshot" /> : (list.data?.length ?? 0) === 0 ? <EmptyState title="Chưa có snapshot" hint="Bấm Chụp snapshot dự báo để lưu dự báo của quý này." /> : (
        <Table>
          <thead><tr><th>Snapshot</th><th>Quý</th><th>Chụp lúc</th><th className="text-right">Số deal</th><th>Ghi chú</th><th /></tr></thead>
          <tbody>
            {list.data!.map((s) => (
              <tr key={s.id} data-testid="snapshot-row">
                <td>{s.name} {s.auto && <Badge>Tự động</Badge>}</td>
                <td>{s.quarter ?? "—"}</td>
                <td className="tabular-nums">{formatDateTime(s.taken_at)}</td>
                <td className="text-right tabular-nums">{s.row_count}</td>
                <td>{s.note ?? "—"}</td>
                <td className="text-right"><Button variant="ghost" className="!min-h-8" aria-pressed={sel === s.id} data-testid="snapshot-compare" onClick={() => setSel(sel === s.id ? null : s.id)}>{sel === s.id ? "Ẩn so sánh" : "So sánh cuối quý"}</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {sel && <ComparePanel id={sel} />}
    </div>
  );
}

function ComparePanel({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["deal-snapshot-compare", id], queryFn: () => snapshotCompare(id) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không so sánh được" />;
  const c = q.data;
  return (
    <section className="flex flex-col gap-3" data-testid="snapshot-compare-panel" aria-label="So sánh snapshot với hiện tại">
      <p className="text-sm">Quý {c.quarter}: dự báo lúc chụp <strong>{formatCurrency(c.forecast)}</strong>, thực tế Won <strong>{formatCurrency(c.actual)}</strong>, độ chính xác <strong data-testid="accuracy">{c.accuracy === null ? "chưa có" : formatPercent(c.accuracy)}</strong>.</p>
      <Table>
        <thead><tr><th>Nhóm</th><th className="text-right">Số deal</th><th className="text-right">Dự báo</th><th className="text-right">Thực tế</th></tr></thead>
        <tbody>{c.groups.map((g) => <tr key={g.group}><td>{GROUP_LABEL[g.group]}</td><td className="text-right tabular-nums">{g.count}</td><td className="text-right">{formatCurrency(g.forecast)}</td><td className="text-right">{formatCurrency(g.actual)}</td></tr>)}</tbody>
      </Table>
      {c.by_type.length > 0 && (
        <Table>
          <thead><tr><th>Loại deal</th><th className="text-right">Dự báo</th><th className="text-right">Thực tế</th><th className="text-right">Chính xác</th></tr></thead>
          <tbody>{c.by_type.map((t) => <tr key={t.type}><td>{t.type}</td><td className="text-right">{formatCurrency(t.forecast)}</td><td className="text-right">{formatCurrency(t.actual)}</td><td className="text-right tabular-nums">{t.accuracy === null ? "—" : formatPercent(t.accuracy)}</td></tr>)}</tbody>
        </Table>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">Từng deal ({c.deals.length})</summary>
        <Table>
          <thead><tr><th>Deal</th><th>Loại</th><th>Nhóm</th><th className="text-right">Dự báo</th><th className="text-right">Thực tế</th></tr></thead>
          <tbody>{c.deals.map((d) => <tr key={d.deal_id}><td>{d.name ?? "(đã xoá)"}</td><td>{d.type}</td><td>{GROUP_LABEL[d.group]}</td><td className="text-right">{formatCurrency(d.forecast)}</td><td className="text-right">{formatCurrency(d.actual)}</td></tr>)}</tbody>
        </Table>
      </details>
    </section>
  );
}
