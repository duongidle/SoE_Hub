import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DhNameSchema, formatCount, formatDate, formatDateTime } from "@soe/shared";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText, Field, Input, Modal, PageTitle, Table } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { dhKeys, getTrash, restoreColumn, restoreDatahub, restoreRow, restoreTable, type TrashList } from "@/lib/datahub/api";

const trashKey = (tableId?: string) => ["dh-trash", tableId ?? null] as const;

/** An item whose name is taken again: the server answers `conflict` with `reason: duplicate_name`. */
const isNameTaken = (e: unknown) => e instanceof ApiError && e.code === "conflict" && e.details?.reason === "duplicate_name";

/** Restore button. When the name is taken by something else, asks for a new name and restores under it. */
function RestoreButton({ name, kind, restore, onDone }: { name: string; kind: string; restore: (newName?: string) => Promise<unknown>; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const m = useMutation({
    mutationFn: (newName?: string) => restore(newName),
    onSuccess: () => {
      notify.ok(`Đã khôi phục ${kind} "${name}"`);
      setAsking(false);
      onDone();
    },
    onError: (e) => {
      if (isNameTaken(e)) setAsking(true);
    },
  });
  return (
    <>
      <Button variant="secondary" loading={m.isPending && !asking} onClick={() => m.mutate(undefined)} aria-label={`Khôi phục ${kind} ${name}`}>
        <RotateCcw size={16} aria-hidden /> Khôi phục
      </Button>
      {m.error && !isNameTaken(m.error) && <ErrorText error={m.error} />}
      {asking && <RenameDialog kind={kind} name={name} busy={m.isPending} error={m.error && !isNameTaken(m.error) ? m.error : null} onClose={() => setAsking(false)} onSubmit={(n) => m.mutate(n)} />}
    </>
  );
}

function RenameDialog({ kind, name, busy, error, onClose, onSubmit }: { kind: string; name: string; busy: boolean; error: unknown; onClose: () => void; onSubmit: (n: string) => void }) {
  const [v, setV] = useState(name);
  const [touched, setTouched] = useState(false);
  const parsed = DhNameSchema.safeParse(v);
  const err = touched && !parsed.success ? (parsed.error.issues[0]?.message ?? "Tên không hợp lệ.") : null;
  return (
    <Modal title={`Tên ${kind} đã bị dùng`} open onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (parsed.success) onSubmit(v.trim()); }}>
        <p className="text-sm">Tên "{name}" đang được một {kind} khác dùng. Đặt tên mới để khôi phục.</p>
        <Field label="Tên mới *" error={err}>
          <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => setTouched(true)} autoFocus autoComplete="off" aria-invalid={!!err} />
        </Field>
        <ErrorText error={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={busy}>Khôi phục với tên này</Button>
        </div>
      </form>
    </Modal>
  );
}

function Purge({ at, days }: { at: string; days: number }) {
  return <span title={`Xoá hẳn lúc ${formatDateTime(at)} (giữ ${days} ngày)`}>Xoá hẳn {formatDate(at)}</span>;
}

/** `/datahub/thung-rac` — datahubs and tables deleted in the last days, with their purge date. */
export function TrashPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: trashKey(), queryFn: () => getTrash() });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["dh-trash"] });
    void qc.invalidateQueries({ queryKey: dhKeys.list });
    void qc.invalidateQueries({ queryKey: dhKeys.limits });
  };
  return (
    <div className="flex flex-col gap-4">
      <Link to="/datahub" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-9">
        <ArrowLeft size={16} aria-hidden /> Datahub
      </Link>
      <PageTitle>Thùng rác datahub</PageTitle>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" aria-busy="true" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được thùng rác" />
      ) : (
        <TrashBody data={q.data!} onDone={done} />
      )}
    </div>
  );
}

function TrashBody({ data, onDone }: { data: TrashList; onDone: () => void }) {
  if (data.datahubs.length === 0 && data.tables.length === 0) {
    return <EmptyState title="Thùng rác trống" hint={`Datahub và bảng bạn xoá sẽ nằm ở đây ${data.retention_days} ngày. Cột và dòng đã xoá xem trong thùng rác của từng bảng.`} />;
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">Mục trong thùng rác được giữ {data.retention_days} ngày rồi xoá hẳn. Cột và dòng đã xoá xem trong thùng rác của từng bảng.</p>
      {data.datahubs.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Datahub đã xoá">
          <h2 className="text-base font-semibold">Datahub ({data.datahubs.length})</h2>
          <Table>
            <thead><tr><th>Tên</th><th>Đã xoá</th><th>Hạn</th><th><span className="sr-only">Khôi phục</span></th></tr></thead>
            <tbody>
              {data.datahubs.map((d) => (
                <tr key={d.id} data-testid="trash-datahub">
                  <td className="max-w-80 [overflow-wrap:anywhere]">{d.name}</td>
                  <td>{formatDateTime(d.deleted_at)}</td>
                  <td><Purge at={d.purge_at} days={data.retention_days} /></td>
                  <td><RestoreButton kind="datahub" name={d.name} restore={(n) => restoreDatahub(d.id, n)} onDone={onDone} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      {data.tables.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Bảng đã xoá">
          <h2 className="text-base font-semibold">Bảng ({data.tables.length})</h2>
          <Table>
            <thead><tr><th>Bảng</th><th>Datahub</th><th>Đã xoá</th><th>Hạn</th><th><span className="sr-only">Khôi phục</span></th></tr></thead>
            <tbody>
              {data.tables.map((t) => (
                <tr key={t.id} data-testid="trash-table">
                  <td className="max-w-80 [overflow-wrap:anywhere]">{t.name}</td>
                  <td className="max-w-64 [overflow-wrap:anywhere]">{t.datahub_name}</td>
                  <td>{formatDateTime(t.deleted_at)}</td>
                  <td><Purge at={t.purge_at} days={data.retention_days} /></td>
                  <td><RestoreButton kind="bảng" name={t.name} restore={(n) => restoreTable(t.id, n)} onDone={onDone} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </>
  );
}

/** Trash of one table: deleted columns (owner only) and rows. */
export function TableTrashDialog({ tableId, onClose, onRestored }: { tableId: string; onClose: () => void; onRestored: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: trashKey(tableId), queryFn: () => getTrash(tableId), gcTime: 0 });
  const done = () => {
    void qc.invalidateQueries({ queryKey: trashKey(tableId) });
    onRestored();
  };
  const data = q.data;
  return (
    <Modal title="Thùng rác của bảng" open onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" aria-busy="true" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được thùng rác" />
        ) : data && data.columns.length === 0 && data.rows.length === 0 ? (
          <EmptyState title="Thùng rác của bảng trống" hint={`Cột và dòng đã xoá được giữ ${data.retention_days} ngày.`} />
        ) : data ? (
          <>
            {data.columns.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Cột đã xoá">
                <h3 className="text-sm font-medium">Cột ({data.columns.length})</h3>
                <Table>
                  <tbody>
                    {data.columns.map((c) => (
                      <tr key={c.id} data-testid="trash-column">
                        <td className="max-w-64 [overflow-wrap:anywhere]">{c.name}</td>
                        <td>{formatDateTime(c.deleted_at)}</td>
                        <td><Purge at={c.purge_at} days={data.retention_days} /></td>
                        <td><RestoreButton kind="cột" name={c.name} restore={(n) => restoreColumn(tableId, c.key, n)} onDone={done} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            )}
            {data.rows.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Dòng đã xoá">
                <h3 className="text-sm font-medium">Dòng ({formatCount(data.rows.length, "dòng")}{data.rows.length >= 500 ? ", hiện 500 dòng mới nhất" : ""})</h3>
                <Table>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} data-testid="trash-row">
                        <td className="font-number">#{r.row_no}</td>
                        <td>{formatDateTime(r.deleted_at)}</td>
                        <td><Purge at={r.purge_at} days={data.retention_days} /></td>
                        <td><RestoreButton kind="dòng" name={`#${r.row_no}`} restore={() => restoreRow(tableId, r.id)} onDone={done} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            )}
          </>
        ) : null}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </Modal>
  );
}
