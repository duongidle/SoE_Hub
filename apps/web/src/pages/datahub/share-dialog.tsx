import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SHARE_PERMISSIONS, SHARE_PERMISSION_LABELS, type SharePermission } from "@soe/shared";
import { UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { dhKeys, getTable, listShares, lookupPeople, removeShare, setShare, setShareOptions, sharedTagged, type Share, type ShareOptionsBody } from "@/lib/datahub/api";
import type { DatahubBrief, Person, TableDetail } from "@/lib/datahub/types";

const keyOf = (datahubId: string) => ["dh-shares", datahubId] as const;

/** Share a whole datahub or one table with a person, as Xem or Sửa dữ liệu (design module2 section 10). Only the owner opens it. */
export function ShareDialog({ dh, onClose }: { dh: DatahubBrief; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keyOf(dh.id), queryFn: () => listShares(dh.id) });
  const tableName = (id: string | null) => (id === null ? "Cả datahub" : (dh.tables.find((t) => t.id === id)?.name ?? "Bảng đã xoá"));
  const change = useMutation({
    mutationFn: (v: { s: Share; permission: SharePermission }) => setShare(dh.id, { grantee_id: v.s.grantee_id, table_id: v.s.table_id, permission: v.permission }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      notify.ok("Đã đổi quyền");
    },
  });
  const revoke = useMutation({
    mutationFn: (s: Share) => removeShare(dh.id, s.id),
    onSuccess: (r, s) => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      void qc.invalidateQueries({ queryKey: ["datahub", dh.id] });
      notify.ok(`Đã thu hồi quyền của ${s.grantee_name ?? "người này"}${r.tagged_rows > 0 ? `. ${r.tagged_rows} dòng vẫn ghi tên người này, ô hiện "không còn quyền".` : ""}`);
      setWarn(null);
    },
    onError: () => setWarn(null),
  });
  // Before removing a member, say how many rows still carry their name (the tags stay; the cell then reads "không còn quyền").
  const [warn, setWarn] = useState<{ s: Share; rows: number } | null>(null);
  const askRevoke = useMutation({
    mutationFn: (s: Share) => sharedTagged(dh.id, s.id),
    onSuccess: (r, s) => (r.rows > 0 ? setWarn({ s, rows: r.rows }) : revoke.mutate(s)),
  });

  return (
    <Modal title={`Chia sẻ "${dh.name}"`} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <AddShare dh={dh} />
        <section aria-label="Người đang được chia sẻ" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Đang chia sẻ</h3>
          {q.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách chia sẻ" />
          ) : (q.data ?? []).length === 0 ? (
            <EmptyState title="Chưa chia sẻ cho ai" hint="Chọn một người ở trên để chia sẻ." />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="share-list">
              {q.data!.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-testid="share-row">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{s.grantee_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{s.grantee_email} · {tableName(s.table_id)}</div>
                  </div>
                  <Select value={s.permission} onChange={(e) => change.mutate({ s, permission: e.target.value as SharePermission })} aria-label={`Quyền của ${s.grantee_name ?? "người này"} với ${tableName(s.table_id)}`} disabled={change.isPending} className="w-auto">
                    {SHARE_PERMISSIONS.map((p) => (
                      <option key={p} value={p}>{SHARE_PERMISSION_LABELS[p]}</option>
                    ))}
                  </Select>
                  <Button variant="secondary" onClick={() => askRevoke.mutate(s)} loading={(askRevoke.isPending && askRevoke.variables?.id === s.id) || (revoke.isPending && revoke.variables?.id === s.id)} aria-label={`Thu hồi quyền của ${s.grantee_name ?? "người này"} với ${tableName(s.table_id)}`}>
                    <X size={16} aria-hidden /> Thu hồi
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={change.error ?? revoke.error ?? askRevoke.error} />
        </section>
        <SplitOptions dh={dh} />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </div>
      </div>
      {warn && (
        <ConfirmDialog
          title="Thu hồi quyền của người đang được tag?"
          message={<>{warn.s.grantee_name ?? "Người này"} đang được ghi tên ở {warn.rows} dòng (ô Người dùng). Thu hồi thì tên vẫn giữ nguyên ở các dòng đó, nhưng ô hiện "không còn quyền" và người này không thấy bảng nữa.</>}
          confirmLabel="Thu hồi quyền"
          busy={revoke.isPending}
          onConfirm={() => revoke.mutate(warn.s)}
          onClose={() => setWarn(null)}
        />
      )}
    </Modal>
  );
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function AddShare({ dh }: { dh: DatahubBrief }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [scope, setScope] = useState<string>("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const term = useDebounced(text.trim(), 250);
  const found = useQuery({ queryKey: ["dh-share-people", term], queryFn: () => lookupPeople({ q: term }), enabled: term.length > 0 && !person });
  const m = useMutation({
    mutationFn: () => setShare(dh.id, { grantee_id: person!.id, table_id: scope || null, permission }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      notify.ok(`Đã chia sẻ cho ${person!.full_name}`);
      setPerson(null);
      setText("");
    },
  });
  const results = (found.data ?? []).filter((p) => p.id !== dh.owner_id);
  return (
    <section aria-label="Thêm người" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Thêm người</h3>
      {person ? (
        <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm" data-testid="share-picked">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{person.full_name}{person.email ? ` · ${person.email}` : ""}</span>
          <Button variant="ghost" onClick={() => setPerson(null)} aria-label="Bỏ chọn người này" className="!px-2"><X size={16} aria-hidden /></Button>
        </div>
      ) : (
        <Field label="Tìm người *" hint="Gõ tên hoặc email, rồi chọn một người trong danh sách.">
          <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls="share-people" />
        </Field>
      )}
      {!person && term.length > 0 && (
        found.isLoading ? <Skeleton className="h-10 w-full" /> : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không tìm thấy người nào.</p>
        ) : (
          <ul id="share-people" role="listbox" aria-label="Kết quả tìm người" className="max-h-48 overflow-y-auto rounded-md border border-border">
            {results.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => setPerson(p)} className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-left text-sm hover:bg-muted sm:min-h-9">
                  <span className="[overflow-wrap:anywhere]">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phạm vi">
          <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Phạm vi chia sẻ">
            <option value="">Cả datahub (kể cả bảng tạo sau)</option>
            {dh.tables.map((t) => (
              <option key={t.id} value={t.id}>Chỉ bảng: {t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quyền">
          <Select value={permission} onChange={(e) => setPermission(e.target.value as SharePermission)} aria-label="Quyền chia sẻ">
            {SHARE_PERMISSIONS.map((p) => (
              <option key={p} value={p}>{SHARE_PERMISSION_LABELS[p]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText error={m.error} />
      <div>
        <Button onClick={() => m.mutate()} disabled={!person} loading={m.isPending}><UserPlus size={16} aria-hidden /> Chia sẻ</Button>
      </div>
    </section>
  );
}

/**
 * Split lock and bulk adding of one table (design module2 section 10): who sees which rows, which columns decide that, and whether members
 * may add many rows at once. Saved with one button; the server checks everything (key columns must be Người dùng columns).
 */
function SplitOptions({ dh }: { dh: DatahubBrief }) {
  const tables = dh.tables.filter((t) => t.kind !== "merged");
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const q = useQuery({ queryKey: dhKeys.table(tableId), queryFn: () => getTable(tableId), enabled: tableId !== "" });
  return (
    <section aria-label="Phân quyền theo dòng" className="flex flex-col gap-3 border-t border-border pt-4" data-testid="split-options">
      <h3 className="text-sm font-medium">Phân quyền theo dòng của bảng</h3>
      {tables.length === 0 ? (
        <p className="text-sm text-muted-foreground">Datahub chưa có bảng nào.</p>
      ) : (
        <>
          <Field label="Bảng">
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)} aria-label="Bảng cần đặt phân quyền">
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được bảng" /> : <SplitForm key={`${q.data.id}:${q.data.version}`} table={q.data} />}
        </>
      )}
    </section>
  );
}

function SplitForm({ table }: { table: TableDetail }) {
  const qc = useQueryClient();
  const userCols = table.columns.filter((c) => c.type === "user");
  const cur = table.key_split;
  const [enabled, setEnabled] = useState(cur?.enabled ?? false);
  const [keys, setKeys] = useState<string[]>(cur?.key_columns.map((k) => k.key) ?? []);
  const [primary, setPrimary] = useState<string>(cur?.primary ?? "");
  const [bulk, setBulk] = useState(table.members_bulk_create !== false);
  const m = useMutation({
    mutationFn: () => {
      const body: ShareOptionsBody = { key_split: enabled, key_columns: keys, key_primary: keys.length ? (keys.includes(primary) ? primary : keys[0]!) : null, members_bulk_create: bulk };
      return setShareOptions(table.id, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dhKeys.table(table.id) });
      void qc.invalidateQueries({ queryKey: dhKeys.datahub(table.datahub_id) });
      notify.ok("Đã lưu phân quyền theo dòng");
    },
  });
  const toggle = (key: string) => setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : k.length >= 5 ? k : [...k, key]));
  const noKeyCol = userCols.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-start gap-2 text-sm sm:min-h-9">
        <input type="checkbox" className="mt-0.5 h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="split-enabled" />
        <span>Khoá phân chia <span className="text-muted-foreground">(thành viên chỉ thấy dòng có tên mình hoặc người mình quản lý ở các cột khoá; chủ bảng thấy mọi dòng)</span></span>
      </label>
      {(enabled || keys.length > 0) && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="split-keys">
          <legend className="px-1 text-sm font-medium">Cột khoá (1–5 cột kiểu Người dùng)</legend>
          {noKeyCol ? (
            <p className="text-sm text-muted-foreground">Bảng chưa có cột kiểu Người dùng. Thêm một cột Người dùng rồi quay lại đây.</p>
          ) : (
            userCols.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input type="checkbox" className="h-5 w-5" checked={keys.includes(c.key)} onChange={() => toggle(c.key)} />
                <span className="[overflow-wrap:anywhere]">{c.name}</span>
              </label>
            ))
          )}
          {keys.length > 1 && (
            <Field label="Cột khoá chính" hint="Khi thành viên thêm dòng, tên họ tự điền vào cột này.">
              <Select value={keys.includes(primary) ? primary : keys[0]} onChange={(e) => setPrimary(e.target.value)} aria-label="Cột khoá chính">
                {keys.map((k) => <option key={k} value={k}>{userCols.find((c) => c.key === k)?.name ?? k}</option>)}
              </Select>
            </Field>
          )}
        </fieldset>
      )}
      <label className="flex min-h-11 items-start gap-2 text-sm sm:min-h-9">
        <input type="checkbox" className="mt-0.5 h-5 w-5" checked={bulk} onChange={(e) => setBulk(e.target.checked)} data-testid="split-bulk" />
        <span>Thành viên được thêm dòng hàng loạt <span className="text-muted-foreground">(nhập file, dán sinh dòng mới, API nhiều dòng; chủ luôn được)</span></span>
      </label>
      <ErrorText error={m.error} />
      <div>
        <Button onClick={() => m.mutate()} loading={m.isPending} disabled={enabled && keys.length === 0} data-testid="split-save">Lưu phân quyền theo dòng</Button>
      </div>
    </div>
  );
}
