import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, DateTimeInput, ErrorText, Field, Input, Modal, PageTitle, Select, Table } from "@/components/ui/form";
import { api, apiList, fmtTime, parseVnDateTime, qs, ApiError } from "@/lib/api";
import { dhKeys, getDatahub, getTable, listDatahubs } from "@/lib/datahub/api";

const DATAHUB_TABLE = "datahub_table";
/** The server's reasons for a refused table grant, in words a Manager understands. */
const GRANT_REASONS: Record<string, string> = {
  grant_column_personal: "Cột cá nhân không cấp cho Guest được. Bỏ cột đó khỏi danh sách.",
  grant_column_attachment: "Cột đính kèm không cấp cho Guest được. Bỏ cột đó khỏi danh sách.",
  grant_table_not_yours: "Chỉ cấp được bảng của chính bạn.",
  grant_options: "Chọn một bảng và ít nhất một cột.",
  grant_column_unknown: "Có cột không còn trong bảng. Chọn lại cột.",
};
function grantError(e: unknown): unknown {
  const reason = e instanceof ApiError ? ((e.details as { reason?: string } | undefined)?.reason ?? null) : null;
  return reason && GRANT_REASONS[reason] ? new Error(GRANT_REASONS[reason]) : e;
}

interface DataType {
  key: string;
  label: string;
  channels: string[];
}
interface Grant {
  id: string;
  guest_name: string | null;
  data_type: string;
  scope_label: string;
  channels: string[];
  expires_at: string | null;
  note: string | null;
  revoked_at: string | null;
  created_at: string;
  version: number;
}
const CHANNEL_LABELS: Record<string, string> = { web: "Xem trên web", export: "Tải file", api: "API" };

/** Framework only: data types are registered by the modules that own the data (Deals in Stage 4). */
export function GuestGrantsPage() {
  const qc = useQueryClient();
  const [showRevoked, setShowRevoked] = useState(false);
  const [creating, setCreating] = useState(false);
  const types = useQuery({ queryKey: ["grants", "types"], queryFn: () => api<DataType[]>("GET", "/guest/data-types") });
  const grants = useQuery({ queryKey: ["grants", showRevoked], queryFn: () => api<Grant[]>("GET", `/guest/grants${qs({ include_revoked: showRevoked })}`) });
  const revoke = useMutation({ mutationFn: (g: Grant) => api("POST", `/guest/grants/${g.id}/revoke`, { version: g.version }), onSuccess: () => qc.invalidateQueries({ queryKey: ["grants"] }) });
  const noTypes = types.data?.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle actions={<Button disabled={!types.data?.length} onClick={() => setCreating(true)}>Cấp dữ liệu</Button>}>Cấp dữ liệu cho Guest</PageTitle>
      <p className="text-sm text-muted-foreground">Chỉ cấp được dữ liệu trong cây của bạn. Guest chỉ thấy cột hệ thống và cột chung, không bao giờ thấy cột cá nhân.</p>
      {noTypes && (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm" data-testid="grants-empty">
          <p className="font-medium">Chưa có loại dữ liệu nào để cấp.</p>
          <p className="mt-1 text-muted-foreground">Các loại dữ liệu (Deals, bảng tổng hợp, dashboard) sẽ xuất hiện khi các chức năng tương ứng được bật ở những giai đoạn sau. Phần quản lý quyền cấp đã sẵn sàng.</p>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Hiện cả quyền đã thu hồi
      </label>
      <ErrorText error={types.error ?? grants.error ?? revoke.error} />
      <Table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Dữ liệu</th>
            <th>Phạm vi</th>
            <th>Kênh</th>
            <th>Hết hạn</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {grants.data?.map((g) => (
            <tr key={g.id}>
              <td>{g.guest_name}</td>
              <td>{types.data?.find((t) => t.key === g.data_type)?.label ?? g.data_type}</td>
              <td>{g.scope_label}</td>
              <td>{g.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}</td>
              <td>{g.expires_at ? fmtTime(g.expires_at) : "Không hết hạn"}</td>
              <td>{g.revoked_at ? <Badge tone="muted">Đã thu hồi</Badge> : <Badge tone="ok">Đang hiệu lực</Badge>}</td>
              <td>
                {!g.revoked_at && (
                  <Button variant="ghost" onClick={() => revoke.mutate(g)}>
                    Thu hồi
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {grants.data?.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted-foreground">
                Chưa cấp dữ liệu cho Guest nào.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
      {creating && types.data && <GrantForm types={types.data} onClose={() => setCreating(false)} />}
    </div>
  );
}

interface Person {
  id: string;
  full_name: string;
  email: string;
}

function GrantForm({ types, onClose }: { types: DataType[]; onClose: () => void }) {
  const qc = useQueryClient();
  const guests = useQuery({
    queryKey: ["org", "guests"],
    queryFn: async () => (await apiList<Person>(`/org/members${qs({ limit: 100, filter: { and: [{ field: "roles", op: "contains", value: "guest" }, { field: "status", op: "neq", value: "locked" }] } })}`)).data,
  });
  const leaders = useQuery({
    queryKey: ["org", "leaders"],
    queryFn: async () => (await apiList<Person>(`/org/members${qs({ limit: 100, filter: { field: "roles", op: "contains", value: "leader" } })}`)).data,
  });
  const [guest, setGuest] = useState("");
  const [type, setType] = useState(types[0]?.key ?? "");
  const [leader, setLeader] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const allowed = types.find((t) => t.key === type)?.channels ?? [];
  const isTable = type === DATAHUB_TABLE;
  const [datahubId, setDatahubId] = useState("");
  const [tableId, setTableId] = useState("");
  const [cols, setCols] = useState<string[]>([]);
  const datahubs = useQuery({ queryKey: dhKeys.list, queryFn: () => listDatahubs("mine"), enabled: isTable });
  const dh = useQuery({ queryKey: dhKeys.datahub(datahubId), queryFn: () => getDatahub(datahubId), enabled: isTable && !!datahubId });
  const tbl = useQuery({ queryKey: dhKeys.table(tableId), queryFn: () => getTable(tableId), enabled: isTable && !!tableId });
  const grantable = (tbl.data?.columns ?? []).filter((c) => c.storage !== "person" && c.layer !== "custom" && c.type !== "attachment");
  const m = useMutation({
    mutationFn: () => api("POST", "/guest/grants", { guest_user_id: guest, data_type: type, scope_leader_id: leader || null, channels, expires_at: expires.trim() ? parseVnDateTime(expires)?.toISOString() : null, note: note || undefined, ...(isTable ? { options: { table_id: tableId, columns: cols } } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["grants"] });
      onClose();
    },
  });
  return (
    <Modal title="Cấp dữ liệu cho Guest" open onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Guest">
          <Select value={guest} onChange={(e) => setGuest(e.target.value)} required>
            <option value="">— Chọn —</option>
            {guests.data?.map((g) => (
              <option key={g.id} value={g.id}>{g.full_name} ({g.email})</option>
            ))}
          </Select>
        </Field>
        <Field label="Dữ liệu">
          <Select value={type} onChange={(e) => { setType(e.target.value); setChannels([]); setDatahubId(""); setTableId(""); setCols([]); }}>
            {types.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Phạm vi">
          <Select value={leader} onChange={(e) => setLeader(e.target.value)}>
            <option value="">Cả cây của tôi</option>
            {leaders.data?.map((l) => (
              <option key={l.id} value={l.id}>Team {l.full_name}</option>
            ))}
          </Select>
        </Field>
        {isTable && (
          <>
            <Field label="Datahub">
              <Select value={datahubId} onChange={(e) => { setDatahubId(e.target.value); setTableId(""); setCols([]); }} aria-label="Datahub">
                <option value="">— Chọn —</option>
                {datahubs.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Bảng">
              <Select value={tableId} onChange={(e) => { setTableId(e.target.value); setCols([]); }} disabled={!datahubId} aria-label="Bảng được cấp">
                <option value="">— Chọn —</option>
                {dh.data?.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            {tableId && (
              <fieldset className="text-sm" data-testid="grant-columns">
                <legend className="mb-1 font-medium">Cột Guest được thấy</legend>
                {tbl.isLoading && <p className="text-muted-foreground">Đang tải cột…</p>}
                {grantable.map((c) => (
                  <label key={c.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={cols.includes(c.key)} onChange={() => setCols((s) => (s.includes(c.key) ? s.filter((x) => x !== c.key) : [...s, c.key]))} />
                    {c.name}
                  </label>
                ))}
                <p className="mt-1 text-xs text-muted-foreground">Cột cá nhân và cột đính kèm không cấp được.</p>
              </fieldset>
            )}
          </>
        )}
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Kênh</legend>
          {allowed.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
              {CHANNEL_LABELS[c] ?? c}
            </label>
          ))}
        </fieldset>
        <Field label="Hết hạn (không bắt buộc)">
          <DateTimeInput value={expires} onChange={setExpires} />
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {!isTable && <p className="text-xs text-muted-foreground">Cột: chỉ cột hệ thống và cột chung.</p>}
        <ErrorText error={m.error ? grantError(m.error) : null} />
        <Button type="submit" disabled={m.isPending || !guest || channels.length === 0 || (isTable && (!tableId || cols.length === 0)) || (expires.trim() !== "" && !parseVnDateTime(expires))}>
          Cấp
        </Button>
      </form>
    </Modal>
  );
}
