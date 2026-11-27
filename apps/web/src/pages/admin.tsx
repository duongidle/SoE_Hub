import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PERMISSIONS, SERVICE_ACCOUNT_PERMISSIONS, type Permission } from "@soe/shared";
import { Badge } from "@/components/ui/badge";
import { PersonChip } from "@/components/ui/person";
import { disambiguate } from "@/lib/people";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ConfirmDialog, DateTimeInput, ErrorText, Field, Input, Modal, Notice, PageTitle, Select, Table, Tabs } from "@/components/ui/form";
import { ApiError, api, apiList, fmtTime, parseVnDateTime, qs } from "@/lib/api";
import { listUserLimits, setUserLimit, type UserLimit } from "@/lib/datahub/api";
import { notify } from "@/components/ui/toast";
import { FilteredEmptyState } from "@/components/ui/states";
import { useUrlState } from "@/lib/use-url-state";
import { LEVELS, TokenTable, menusText, type TokenRow } from "./account";

/* ------------------------------------------------------------------ shared pieces */

interface Member {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  status: string;
  manager_id: string | null;
}

/** Search box + list filled from the server (limit 50), so it stays cheap with many people. */
function PersonPicker({ label, value, onChange, filter, testId }: { label: string; value: string; onChange: (id: string) => void; filter?: unknown; testId?: string }) {
  const [search, setSearch] = useState("");
  const conds: unknown[] = [];
  if (search) conds.push({ or: [{ field: "full_name", op: "contains", value: search }, { field: "email", op: "contains", value: search }] });
  if (filter) conds.push(filter);
  const q = useQuery({
    queryKey: ["org", "picker", search, JSON.stringify(filter ?? null)],
    queryFn: async () => (await apiList<Member>(`/org/members${qs({ limit: 50, filter: conds.length ? { and: conds } : undefined })}`)).data,
  });
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input placeholder="Tìm theo tên hoặc email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`${label}: tìm`} />
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testId}>
        <option value="">— Chọn —</option>
        {q.data?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name} ({u.email})
          </option>
        ))}
      </Select>
      <ErrorText error={q.error} />
    </div>
  );
}

const permLabel = (p: string) => PERMISSIONS[p as Permission] ?? p;

/* ------------------------------------------------------------------ token approval */

type TokenFilter = "pending" | "active" | "rejected" | "revoked" | "all";

export function TokenApprovalPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TokenFilter>("pending");
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["admin-tokens", status], queryFn: () => api<TokenRow[]>("GET", `/admin/tokens${qs({ status })}`) });
  const done = () => {
    setNote("");
    void qc.invalidateQueries({ queryKey: ["admin-tokens"] });
  };
  const [editing, setEditing] = useState<TokenRow | null>(null);
  const approve = useMutation({
    mutationFn: (v: { id: string; menus?: Record<string, string> }) => api("POST", `/admin/tokens/${v.id}/approve`, { note: note || undefined, ...(v.menus ? { menus: v.menus } : {}) }),
    onSuccess: () => {
      setEditing(null);
      done();
    },
  });
  const reject = useMutation({ mutationFn: (id: string) => api("POST", `/admin/tokens/${id}/reject`, { note: note || undefined }), onSuccess: done });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/auth/tokens/${id}`, { reason: note || undefined }), onSuccess: done });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Kết nối AI</PageTitle>
      <AiPolicyCard />
      <p className="text-sm text-muted-foreground">Kết nối chỉ dùng được sau khi Admin duyệt. Có thể duyệt ít quyền hơn chủ kết nối xin (bỏ menu, hạ mức). Danh sách hiển thị tối đa 500 kết nối mới nhất.</p>
      <Tabs
        value={status}
        onChange={setStatus}
        items={[
          { value: "pending", label: "Chờ duyệt" },
          { value: "active", label: "Đang dùng" },
          { value: "revoked", label: "Đã thu hồi" },
          { value: "rejected", label: "Bị từ chối" },
          { value: "all", label: "Tất cả" },
        ]}
      />
      <Field label="Ghi chú cho lần duyệt / từ chối / thu hồi (không bắt buộc)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <ErrorText error={q.error ?? approve.error ?? reject.error ?? revoke.error} />
      <TokenTable
        owner
        rows={q.data ?? []}
        onRevoke={(id) => revoke.mutate(id)}
        actions={(t) =>
          t.status === "pending" && (
            <>
              <Button disabled={approve.isPending} onClick={() => approve.mutate({ id: t.id })}>
                Duyệt
              </Button>{" "}
              <Button variant="secondary" onClick={() => setEditing(t)}>
                Duyệt bớt quyền
              </Button>{" "}
              <Button variant="secondary" disabled={reject.isPending} onClick={() => reject.mutate(t.id)}>
                Từ chối
              </Button>
            </>
          )
        }
      />
      {editing && <ApproveNarrow row={editing} busy={approve.isPending} onClose={() => setEditing(null)} onSave={(m) => approve.mutate({ id: editing.id, menus: m })} />}
    </div>
  );
}

function ApproveNarrow({ row, busy, onClose, onSave }: { row: TokenRow; busy: boolean; onClose: () => void; onSave: (m: Record<string, string>) => void }) {
  const [m, setM] = useState<Record<string, string>>({ ...row.menus });
  const rank = (l: string) => LEVELS.findIndex((x) => x.key === l);
  return (
    <Modal title={`Duyệt "${row.name}" của ${row.user_name ?? ""}`} open onClose={onClose}>
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">Xin: {menusText(row.menus) || "—"}. Bỏ menu hoặc hạ mức rồi duyệt.</p>
        {Object.entries(row.menus).map(([k, held]) => (
          <div key={k} className="flex items-center gap-2">
            <label className="flex w-56 items-center gap-2">
              <input
                type="checkbox"
                checked={k in m}
                onChange={() =>
                  setM((cur) => {
                    const { [k]: _d, ...rest } = cur;
                    return k in cur ? rest : { ...cur, [k]: held };
                  })
                }
              />
              {menusText({ [k]: held }).split(":")[0]}
            </label>
            <Select aria-label={`Mức ${k}`} disabled={!(k in m)} value={m[k] ?? held} onChange={(e) => setM((cur) => ({ ...cur, [k]: e.target.value }))}>
              {LEVELS.filter((l) => rank(l.key) <= rank(held)).map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={busy || Object.keys(m).length === 0} onClick={() => onSave(m)}>
            Duyệt với quyền này
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const AI_GROUP_LABELS: Record<string, string> = { org: "Tổ chức", guest_grant: "Cấp dữ liệu Guest", transfer: "Chuyển giao dữ liệu", settings: "Cài đặt hệ thống", audit_log: "Nhật ký" };

/** Emergency switch and the five groups the Admin may open to AI (module5 3.4, 7). Saved through the settings API. */
function AiPolicyCard() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["settings", "rows"], queryFn: () => apiList<SettingRow>(`/system/settings${qs({ limit: 200 })}`) });
  const get = (key: string) => rows.data?.data.find((r) => r.key === key);
  const killed = get("ai.killed")?.value === true;
  const groups = (get("ai.groups_enabled")?.value as string[] | undefined) ?? [];
  const save = useMutation({
    mutationFn: (v: { key: string; value: unknown }) => api("PUT", `/system/settings/${v.key}`, { value: v.value, ...(get(v.key) ? { version: get(v.key)!.version } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chính sách kết nối AI</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" data-testid="ai-killed" checked={killed} disabled={!rows.data || save.isPending} onChange={() => save.mutate({ key: "ai.killed", value: !killed })} />
          Tạm tắt mọi kết nối AI (khẩn cấp)
        </label>
        <fieldset>
          <legend className="mb-1 text-muted-foreground">Nhóm thao tác cho phép AI (mặc định cấm)</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(AI_GROUP_LABELS).map(([g, label]) => (
              <label key={g} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid={`ai-group-${g}`}
                  checked={groups.includes(g)}
                  disabled={!rows.data || save.isPending}
                  onChange={() => save.mutate({ key: "ai.groups_enabled", value: groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g] })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={rows.error ?? save.error} />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ service accounts */

interface ServiceAccount {
  id: string;
  name: string;
  description: string | null;
  status: string;
  scopes: string[];
  tree_manager_ids: string[];
  version: number;
  tokens: TokenRow[];
}

export function ServiceAccountsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["service-accounts"], queryFn: () => api<ServiceAccount[]>("GET", "/admin/service-accounts") });
  const managers = useQuery({
    queryKey: ["org", "managers"],
    queryFn: async () => (await apiList<Member>(`/org/members${qs({ limit: 200, filter: { field: "roles", op: "contains", value: "manager" } })}`)).data.filter((m) => m.manager_id === m.id),
  });
  const [creating, setCreating] = useState<ServiceAccount | "new" | null>(null);
  const [tokenFor, setTokenFor] = useState<ServiceAccount | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["service-accounts"] });
  const toggle = useMutation({ mutationFn: (a: ServiceAccount) => api("POST", `/admin/service-accounts/${a.id}/${a.status === "active" ? "disable" : "enable"}`), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/auth/tokens/${id}`), onSuccess: refresh });
  const treeName = (id: string) => managers.data?.find((m) => m.id === id)?.full_name ?? id.slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle actions={<Button onClick={() => setCreating("new")}>Tạo tài khoản hệ thống</Button>}>Tài khoản hệ thống</PageTitle>
      <p className="text-sm text-muted-foreground">Dùng cho hệ thống ngoài đẩy dữ liệu vào. Không đăng nhập web. Mỗi thao tác ghi tên tài khoản trong nhật ký. Token tiền tố <code>soe_svc_</code>, không cần duyệt.</p>
      {shown && (
        <Notice>
          Token mới (chỉ hiện một lần, hãy lưu lại ngay): <code className="break-all font-mono" data-testid="new-token">{shown}</code>
        </Notice>
      )}
      <ErrorText error={q.error ?? toggle.error ?? revoke.error} />
      {q.data?.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {a.name} <Badge tone={a.status === "active" ? "ok" : "muted"}>{a.status === "active" ? "Đang hoạt động" : "Đã tắt"}</Badge>
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setTokenFor(a)}>Cấp token</Button>
                <Button variant="secondary" onClick={() => setCreating(a)}>Sửa</Button>
                <Button variant="secondary" onClick={() => toggle.mutate(a)}>{a.status === "active" ? "Tắt" : "Bật"}</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {a.description && <p>{a.description}</p>}
            <p>
              <span className="font-medium">Giới hạn cây:</span> {a.tree_manager_ids.length ? a.tree_manager_ids.map(treeName).join(", ") : "Không giới hạn trong cây nào (chưa đọc được dữ liệu của cây)"}
            </p>
            <p>
              <span className="font-medium">Scope:</span> {a.scopes.map(permLabel).join(", ")}
            </p>
            <TokenTable rows={a.tokens} onRevoke={(id) => revoke.mutate(id)} />
          </CardContent>
        </Card>
      ))}
      {q.data?.length === 0 && <p className="text-sm text-muted-foreground">Chưa có tài khoản hệ thống.</p>}
      {creating && <ServiceAccountForm row={creating === "new" ? null : creating} managers={managers.data ?? []} onClose={() => setCreating(null)} onSaved={refresh} />}
      {tokenFor && (
        <ServiceTokenForm
          account={tokenFor}
          onClose={() => setTokenFor(null)}
          onCreated={(t) => {
            setShown(t);
            setTokenFor(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ServiceAccountForm({ row, managers, onClose, onSaved }: { row: ServiceAccount | null; managers: Member[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [scopes, setScopes] = useState<string[]>(row?.scopes ?? ["system:whoami"]);
  const [trees, setTrees] = useState<string[]>(row?.tree_manager_ids ?? []);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const m = useMutation({
    mutationFn: () =>
      row
        ? api("PATCH", `/admin/service-accounts/${row.id}`, { version: row.version, name, description, scopes, tree_manager_ids: trees })
        : api("POST", "/admin/service-accounts", { name, description: description || undefined, scopes, tree_manager_ids: trees }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal title={row ? "Sửa tài khoản hệ thống" : "Tạo tài khoản hệ thống"} open onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Tên">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </Field>
        <Field label="Mô tả">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Scope</legend>
          {SERVICE_ACCOUNT_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="checkbox" checked={scopes.includes(p)} onChange={() => toggle(scopes, setScopes, p)} />
              {permLabel(p)} <span className="text-xs text-muted-foreground">({p})</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Giới hạn trong cây của Manager</legend>
          {managers.length === 0 && <p className="text-muted-foreground">Chưa có Manager nào.</p>}
          {managers.map((mg) => (
            <label key={mg.id} className="flex items-center gap-2">
              <input type="checkbox" checked={trees.includes(mg.id)} onChange={() => toggle(trees, setTrees, mg.id)} />
              {mg.full_name} <span className="text-xs text-muted-foreground">({mg.email})</span>
            </label>
          ))}
        </fieldset>
        <ErrorText error={m.error} />
        <Button type="submit" disabled={m.isPending || scopes.length === 0}>
          Lưu
        </Button>
      </form>
    </Modal>
  );
}

function ServiceTokenForm({ account, onClose, onCreated }: { account: ServiceAccount; onClose: () => void; onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState(365);
  const m = useMutation({ mutationFn: () => api<{ token: string }>("POST", `/admin/service-accounts/${account.id}/tokens`, { name, expires_in_days: days }), onSuccess: (r) => onCreated(r.token) });
  return (
    <Modal title={`Cấp token cho ${account.name}`} open onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Tên token">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </Field>
        <Field label="Hạn dùng (ngày)" hint="Tối đa 365 ngày.">
          <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
        <ErrorText error={m.error} />
        <Button type="submit" disabled={m.isPending}>
          Tạo token
        </Button>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ audit log */

interface AuditRow {
  id: string;
  at: string;
  request_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  via: string;
  connection_id: string | null;
  command: string;
  result: "success" | "denied" | "error";
  error_code: string | null;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  user_agent: string | null;
  details: unknown;
}

const VIA_LABELS: Record<string, string> = { web: "Web", api: "API", mcp: "MCP (AI)", worker: "Worker / lệnh server", automation: "Automation" };
const RESULT_LABELS: Record<string, string> = { success: "Thành công", denied: "Bị từ chối", error: "Lỗi" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditFilters {
  from: string;
  to: string;
  actor: string;
  via: string;
  connection: string;
  command: string;
  result: string;
  target: string;
}
/** Who did it. Without a signed-in actor (login, codes): "Chưa đăng nhập", the email that was tried, and the IP. */
function ActorCell({ r }: { r: AuditRow }) {
  if (r.actor_name) {
    const conn = (r.details as { connection_name?: unknown } | null)?.connection_name;
    return (
      <>
        {r.actor_user_id ? <PersonChip person={{ id: r.actor_user_id, full_name: r.actor_name, email: r.actor_email }} /> : r.actor_name}
        <div className="text-xs text-muted-foreground">{r.actor_email}</div>
        {typeof conn === "string" && <div className="text-xs text-muted-foreground">Kết nối: {conn}</div>}
      </>
    );
  }
  // Successful rows keep the email in `details`; failed ones keep it under `details.target`.
  const d = (r.details ?? {}) as { email?: unknown; target?: { email?: unknown } };
  const tried = d.email ?? d.target?.email;
  const email = typeof tried === "string" ? tried : null;
  const known = r.target_type === "user" && r.target_id; // the email belongs to a person in the org chart
  return (
    <>
      <span className="text-muted-foreground">Chưa đăng nhập</span>
      {email && (
        <div className="text-xs">
          {known ? (
            <Link to="/to-chuc" search={{ q: email } as never} className="text-primary underline">
              {email}
            </Link>
          ) : (
            email
          )}
        </div>
      )}
      {r.ip && <div className="text-xs text-muted-foreground">IP {r.ip}</div>}
    </>
  );
}

const EMPTY_FILTERS: AuditFilters = { from: "", to: "", actor: "", via: "", connection: "", command: "", result: "", target: "" };

function buildAuditFilter(f: AuditFilters): object | undefined {
  const c: unknown[] = [];
  if (f.from) { const d = parseVnDateTime(f.from); if (d) c.push({ field: "at", op: "gte", value: d.toISOString() }); }
  if (f.to) { const d = parseVnDateTime(f.to); if (d) c.push({ field: "at", op: "lte", value: d.toISOString() }); }
  if (f.actor) c.push({ or: [{ field: "actor_name", op: "contains", value: f.actor }, { field: "actor_email", op: "contains", value: f.actor }] });
  if (f.via) c.push({ field: "via", op: "eq", value: f.via });
  if (f.connection && UUID_RE.test(f.connection.trim())) c.push({ field: "connection_id", op: "eq", value: f.connection.trim() });
  if (f.command) c.push({ field: "command", op: "contains", value: f.command });
  if (f.result) c.push({ field: "result", op: "eq", value: f.result });
  if (f.target) c.push({ or: [{ field: "target_type", op: "contains", value: f.target }, { field: "target_id", op: "eq", value: f.target }] });
  return c.length ? { and: c } : undefined;
}

export function AuditLogPage() {
  // The applied filters live in the URL (reload, shared link and back button keep them); the form holds the draft.
  const [applied, setApplied] = useUrlState<AuditFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<AuditFilters>(applied);
  // Cursor stack for server (keyset) pagination: pages[i] is the cursor that opens page i.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const filter = buildAuditFilter(applied);
  const page = cursors.length - 1;
  const q = useQuery({
    queryKey: ["audit", JSON.stringify(filter ?? null), cursors[page]],
    queryFn: () => apiList<AuditRow>(`/system/audit-log${qs({ limit: 50, filter, cursor: cursors[page], include_total: page === 0 })}`),
    placeholderData: (prev) => prev,
  });
  const total = q.data?.total;
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setCursors([null]);
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setCursors([null]);
  };
  const exportCsv = async () => {
    setExportError(null);
    try {
      const res = await fetch(`/api/v1/system/audit-log/export${qs({ filter })}`, { credentials: "same-origin" });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nhat-ky-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setExportError(e);
    }
  };
  const set = (k: keyof AuditFilters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <div className="flex flex-col gap-4">
      <PageTitle actions={<Button variant="secondary" onClick={exportCsv}>Xuất CSV</Button>}>Nhật ký hệ thống</PageTitle>
      <p className="text-sm text-muted-foreground">Chỉ thêm, không sửa hay xoá. Giữ tối thiểu 730 ngày. Giá trị của dữ liệu riêng (dòng datahub) không được ghi ở đây. Việc xem và xuất nhật ký cũng được ghi lại.</p>
      <form onSubmit={apply} className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Bộ lọc nhật ký">
        <Field label="Từ lúc">
          <DateTimeInput value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
        </Field>
        <Field label="Đến lúc">
          <DateTimeInput value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
        </Field>
        <Field label="Người thực hiện" hint="Tên hoặc email">
          <Input value={draft.actor} onChange={set("actor")} />
        </Field>
        <Field label="Kênh">
          <Select value={draft.via} onChange={set("via")}>
            <option value="">Tất cả</option>
            {Object.entries(VIA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Kết nối AI" hint="Mã kết nối (uuid)">
          <Input value={draft.connection} onChange={set("connection")} />
        </Field>
        <Field label="Hành động" hint="Ví dụ org.member">
          <Input value={draft.command} onChange={set("command")} />
        </Field>
        <Field label="Kết quả">
          <Select value={draft.result} onChange={set("result")}>
            <option value="">Tất cả</option>
            {Object.entries(RESULT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Đối tượng" hint="Loại (user, api_token...) hoặc mã đối tượng">
          <Input value={draft.target} onChange={set("target")} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">Lọc</Button>
          <Button variant="secondary" onClick={reset}>Xoá lọc</Button>
        </div>
      </form>
      <ErrorText error={q.error ?? exportError} />
      {/* Phone: one card per row. From sm up: the table. */}
      <div className="flex flex-col gap-2 sm:hidden" data-testid="audit-cards">
        {q.data?.data.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs break-all">{r.command}</span>
              <Badge tone={r.result === "success" ? "ok" : r.result === "denied" ? "warn" : "bad"}>{RESULT_LABELS[r.result]}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {fmtTime(r.at)} · {VIA_LABELS[r.via] ?? r.via ?? "—"}
            </div>
            <div className="mt-1">
              <ActorCell r={r} />
            </div>
            <Button variant="ghost" className="mt-1" onClick={() => setSelected(r.id)}>Chi tiết</Button>
          </div>
        ))}
        {q.data?.data.length === 0 && (filter ? <FilteredEmptyState onClear={reset} /> : <p className="text-muted-foreground">Chưa có dòng nhật ký nào.</p>)}
      </div>
      <div className="hidden sm:block">
      <Table>
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>Người thực hiện</th>
            <th>Kênh</th>
            <th>Hành động</th>
            <th>Kết quả</th>
            <th>Đối tượng</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data?.data.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtTime(r.at)}</td>
              <td>
                <ActorCell r={r} />
              </td>
              <td>{VIA_LABELS[r.via] ?? r.via ?? "—"}</td>
              <td className="font-mono text-xs">{r.command}</td>
              <td>
                <Badge tone={r.result === "success" ? "ok" : r.result === "denied" ? "warn" : "bad"}>{RESULT_LABELS[r.result]}</Badge>
                {r.error_code && <div className="text-xs text-muted-foreground">{r.error_code}</div>}
              </td>
              <td className="text-xs">
                {r.target_type}
                <div className="font-mono text-muted-foreground">{r.target_id?.slice(0, 8)}</div>
              </td>
              <td>
                <Button variant="ghost" onClick={() => setSelected(r.id)}>Chi tiết</Button>
              </td>
            </tr>
          ))}
          {q.data?.data.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted-foreground">{filter ? <FilteredEmptyState onClear={reset} /> : "Chưa có dòng nhật ký nào."}</td>
            </tr>
          )}
        </tbody>
      </Table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button variant="secondary" disabled={page === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>Trang trước</Button>
        <span>Trang {page + 1}{total !== undefined ? ` · ${total} dòng` : ""}</span>
        <Button variant="secondary" disabled={!q.data?.next_cursor} onClick={() => q.data?.next_cursor && setCursors((c) => [...c, q.data!.next_cursor])}>Trang sau</Button>
      </div>
      {selected && <AuditDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function AuditDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["audit", "detail", id], queryFn: () => api<AuditRow>("GET", `/system/audit-log/${id}`) });
  const r = q.data;
  const details = (r?.details ?? {}) as Record<string, unknown>;
  const changes = Array.isArray(details.changes) ? (details.changes as FieldChange[]) : [];
  const { changes: _omit, ...rest } = details;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside role="dialog" aria-label="Chi tiết nhật ký" className="h-full w-full max-w-xl overflow-y-auto bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Chi tiết nhật ký</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Đóng">✕</Button>
        </div>
        <ErrorText error={q.error} />
        {r && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              {[
                ["Thời điểm", fmtTime(r.at)],
                ["Người thực hiện", r.actor_name ? `${r.actor_name} ${r.actor_email ? `(${r.actor_email})` : ""}` : `Chưa đăng nhập${typeof (details.email ?? (details.target as { email?: unknown } | undefined)?.email) === "string" ? ` (email thử: ${String(details.email ?? (details.target as { email?: unknown }).email)})` : ""}`],
                ["Kênh", VIA_LABELS[r.via] ?? r.via ?? "—"],
                ["Kết nối AI", typeof details.connection_name === "string" ? details.connection_name : (r.connection_id ?? "—")],
                ["Hành động", r.command],
                ["Kết quả", `${RESULT_LABELS[r.result]}${r.error_code ? ` (${r.error_code})` : ""}`],
                ["Đối tượng", `${r.target_type ?? "—"} ${r.target_id ?? ""}`],
                ["IP", r.ip ?? "—"],
                ["Thiết bị", r.user_agent ?? "—"],
                ["Mã yêu cầu", r.request_id ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {changes.length > 0 && (
              <div>
                <h3 className="mb-1 font-medium">Thay đổi (cũ → mới)</h3>
                <Table>
                  <thead>
                    <tr>
                      <th>Trường</th>
                      <th>Cũ</th>
                      <th>Mới</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.field}>
                        <td>{c.field}</td>
                        <td className="whitespace-normal break-all">{show(c.old)}</td>
                        <td className="whitespace-normal break-all">{show(c.new)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            {Object.keys(rest).length > 0 && (
              <div>
                <h3 className="mb-1 font-medium">Chi tiết khác</h3>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(rest, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ data transfer */

interface TransferGroup {
  handler: string;
  label: string;
  items: { type: string; id: string; label: string; action: "move" | "revoke" | "keep" }[];
}
const ACTION_LABELS = { move: "Đổi chủ sang người nhận", revoke: "Thu hồi (người nhận tự tạo lại)", keep: "Giữ nguyên với người cũ" };

export function TransferPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [personal, setPersonal] = useState<"keep" | "move">("keep");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const key = `${from}:${to}`;
  const preview = useQuery({
    queryKey: ["transfer-preview", previewKey],
    enabled: !!previewKey,
    queryFn: () => api<{ groups: TransferGroup[] }>("GET", `/admin/transfer/preview${qs({ from_user_id: from, to_user_id: to })}`),
    gcTime: 0,
  });
  const run = useMutation({ mutationFn: () => api<{ groups: TransferGroup[] }>("POST", "/admin/transfer", { from_user_id: from, to_user_id: to, personal_columns: personal }) });
  const [ask, setAsk] = useState(false);
  const stale = previewKey !== null && previewKey !== key;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Chuyển giao dữ liệu</PageTitle>
      <p className="text-sm text-muted-foreground">Chọn tài khoản nguồn và tài khoản nhận, xem trước, rồi xác nhận. Làm trong một giao dịch, ghi nhật ký từng đối tượng. Xong thì tài khoản nguồn bị khoá. Deal đã đóng giữ nguyên người cũ.</p>
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          <PersonPicker label="Tài khoản nguồn" value={from} onChange={(v) => { setFrom(v); run.reset(); }} testId="transfer-from" />
          <PersonPicker label="Tài khoản nhận" value={to} onChange={(v) => { setTo(v); run.reset(); }} testId="transfer-to" />
          <Field label="Cột cá nhân trên deal (từ Stage 4)">
            <Select value={personal} onChange={(e) => setPersonal(e.target.value as "keep" | "move")}>
              <option value="keep">Giữ làm lưu trữ</option>
              <option value="move">Chuyển giá trị sang người nhận</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button disabled={!from || !to || from === to} onClick={() => { run.reset(); setPreviewKey(key); }}>
              Xem trước
            </Button>
          </div>
          {from && to && from === to && <p className="text-sm text-bad sm:col-span-2">Hai tài khoản phải khác nhau.</p>}
        </CardContent>
      </Card>
      <ErrorText error={preview.error} />
      {preview.data && !run.data && (
        <Card>
          <CardHeader>
            <CardTitle>Sẽ chuyển</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {stale && <p className="text-bad">Bạn đã đổi tài khoản sau khi xem trước. Hãy bấm Xem trước lại.</p>}
            <GroupList groups={preview.data.groups} />
            <ErrorText error={run.error} />
            <div>
              <Button variant="danger" disabled={run.isPending || stale} onClick={() => setAsk(true)}>
                Xác nhận chuyển giao
              </Button>
              {ask && <ConfirmDialog title="Chuyển giao dữ liệu?" message="Chuyển giao dữ liệu và khoá tài khoản nguồn. Không hoàn tác được." confirmLabel="Chuyển giao" busy={run.isPending} onClose={() => setAsk(false)} onConfirm={() => { setAsk(false); run.mutate(); }} />}
            </div>
          </CardContent>
        </Card>
      )}
      {run.data && (
        <Card>
          <CardHeader>
            <CardTitle>Kết quả</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Notice>Đã chuyển giao xong. Tài khoản nguồn đã bị khoá.</Notice>
            <GroupList groups={run.data.groups} />
          </CardContent>
        </Card>
      )}
      <TreeTransfer />
    </div>
  );
}

function GroupList({ groups }: { groups: TransferGroup[] }) {
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.handler}>
          <div className="font-medium">
            {g.label}: {g.items.length}
          </div>
          {g.items.length === 0 ? (
            <p className="text-muted-foreground">Không có.</p>
          ) : (
            <ul className="ml-4 list-disc">
              {g.items.slice(0, 50).map((i) => (
                <li key={i.id}>
                  {i.label} <span className="text-xs text-muted-foreground">— {ACTION_LABELS[i.action]}</span>
                </li>
              ))}
              {g.items.length > 50 && <li className="text-muted-foreground">và {g.items.length - 50} mục khác</li>}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function TreeTransfer() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const isManager = { field: "roles", op: "contains", value: "manager" };
  const m = useMutation({ mutationFn: () => api<{ moved: number }>("POST", `/admin/trees/${from}/transfer`, { to_manager_id: to }) });
  const [ask, setAsk] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chuyển cả một cây sang Manager khác</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
        <PersonPicker label="Manager hiện tại" value={from} onChange={setFrom} filter={isManager} testId="tree-from" />
        <PersonPicker label="Manager nhận cây" value={to} onChange={setTo} filter={isManager} testId="tree-to" />
        <div className="sm:col-span-2 flex flex-col gap-2">
          <ErrorText error={m.error} />
          {m.data && <Notice>Đã chuyển {m.data.moved} người sang cây mới. Lịch sử cây được giữ.</Notice>}
          <div>
            <Button variant="danger" disabled={!from || !to || from === to || m.isPending} onClick={() => setAsk(true)}>
              Chuyển cây
            </Button>
            {ask && <ConfirmDialog title="Chuyển cả cây?" message="Chuyển cả cây sang Manager khác. Lịch sử cây được giữ." confirmLabel="Chuyển cây" busy={m.isPending} onClose={() => setAsk(false)} onConfirm={() => { setAsk(false); m.mutate(); }} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ system settings */

interface CatalogItem {
  key: string;
  label: string;
  description: string;
  default: unknown;
  schema?: { minimum?: number; maximum?: number };
}
interface SettingRow {
  key: string;
  value: unknown;
  version: number;
}

export function SettingsPage() {
  const catalog = useQuery({ queryKey: ["settings", "catalog"], queryFn: () => api<CatalogItem[]>("GET", "/system/settings-catalog") });
  const rows = useQuery({ queryKey: ["settings", "rows"], queryFn: () => apiList<SettingRow>(`/system/settings${qs({ limit: 200 })}`) });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Cài đặt hệ thống</PageTitle>
      <ErrorText error={catalog.error ?? rows.error} />
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-5 text-sm">
          <span>Bộ template mặc định của Quản lý Deal (bảng, cột, công thức cho cây mới) sửa ở trang riêng.</span>
          <Link to="/quan-tri/template-deal" className="font-medium text-primary underline">Template Quản lý Deal</Link>
        </CardContent>
      </Card>
      {catalog.data?.filter((c) => c.key !== DEAL_DEFAULTS_KEY).map((c) => (
        <SettingEditor key={c.key} def={c} row={rows.data?.data.find((r) => r.key === c.key)} loaded={!!rows.data} />
      ))}
    </div>
  );
}

function SettingEditor({ def, row, loaded }: { def: CatalogItem; row: SettingRow | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const current = row ? row.value : def.default;
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (Array.isArray(current) ? current.join(", ") : String(current));
  const save = useMutation({
    mutationFn: (value: unknown) => api("PUT", `/system/settings/${def.key}`, { value, ...(row ? { version: row.version } : {}) }),
    onSuccess: () => {
      setText(null);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const isBool = typeof def.default === "boolean";
  const isNum = typeof def.default === "number";
  const [localError, setLocalError] = useState<string | null>(null);
  const parse = (): unknown => (isNum ? Number(shown) : shown.split(",").map((s) => s.trim()).filter(Boolean));
  // The limits come from the catalog (same rules as the server), shown in Vietnamese before sending.
  const submit = () => {
    setLocalError(null);
    const value = parse();
    if (typeof value === "number") {
      const { minimum, maximum } = def.schema ?? {};
      if (!Number.isFinite(value)) return setLocalError("Hãy nhập một số.");
      if (minimum !== undefined && value < minimum) return setLocalError(`Giá trị tối thiểu là ${minimum}.`);
      if (maximum !== undefined && value > maximum) return setLocalError(`Giá trị tối đa là ${maximum}.`);
    }
    save.mutate(value);
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5 text-sm" data-testid={`setting-${def.key}`}>
        <div className="font-medium">{def.label}</div>
        <p className="text-muted-foreground">{def.description}</p>
        {isBool ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={current === true} disabled={!loaded || save.isPending} onChange={(e) => save.mutate(e.target.checked)} aria-label={def.label} />
            {current === true ? "Đang bật" : "Đang tắt"}
          </label>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              aria-label={def.label}
              type={isNum ? "number" : "text"}
              value={shown}
              onChange={(e) => setText(e.target.value)}
              placeholder={isNum ? undefined : "base.vn, example.com"}
            />
            <Button type="submit" disabled={!loaded || save.isPending || text === null}>
              Lưu
            </Button>
          </form>
        )}
        {def.key === "audit.retention_days" && <p className="text-xs text-muted-foreground">Sàn cứng 730 ngày: hệ thống từ chối mọi giá trị thấp hơn và không bao giờ dọn nhật ký trẻ hơn mốc này.</p>}
        {!isNum && !isBool && <p className="text-xs text-muted-foreground">Nhiều giá trị cách nhau bằng dấu phẩy.</p>}
        <ErrorText error={localError ?? save.error} />
        {save.isSuccess && text === null && !localError && <p className="text-xs text-ok">Đã lưu.</p>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ Datahub limits per person */

const LIMIT_FIELDS = [
  { key: "max_datahubs", label: "Datahub tối đa", max: 1000 },
  { key: "max_tables", label: "Bảng tối đa mỗi datahub", max: 1000 },
  { key: "max_columns", label: "Cột tối đa mỗi bảng", max: 200 },
] as const;
type LimitKey = (typeof LIMIT_FIELDS)[number]["key"];

/** `/quan-tri/datahub-gioi-han` — limits of one person that differ from the system defaults (design module2 section 11). */
export function DatahubLimitsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["dh-user-limits"], queryFn: listUserLimits });
  const limitNames = disambiguate((list.data ?? []).map((u) => ({ id: u.user_id, full_name: u.full_name, email: u.email })));
  const [userId, setUserId] = useState("");
  const [vals, setVals] = useState<Record<LimitKey, string>>({ max_datahubs: "", max_tables: "", max_columns: "" });
  const [localError, setLocalError] = useState<string | null>(null);
  const pick = (u: UserLimit) => {
    setUserId(u.user_id);
    setVals({ max_datahubs: u.max_datahubs?.toString() ?? "", max_tables: u.max_tables?.toString() ?? "", max_columns: u.max_columns?.toString() ?? "" });
    setLocalError(null);
  };
  const save = useMutation({
    mutationFn: (body: Record<LimitKey, number | null>) => setUserLimit(userId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dh-user-limits"] });
      notify.ok("Đã lưu giới hạn");
    },
  });
  const submit = () => {
    setLocalError(null);
    if (!userId) return setLocalError("Hãy chọn một người.");
    const body = {} as Record<LimitKey, number | null>;
    for (const f of LIMIT_FIELDS) {
      const t = vals[f.key].trim();
      if (t === "") {
        body[f.key] = null;
        continue;
      }
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1) return setLocalError(`${f.label}: nhập số nguyên từ 1, hoặc để trống để dùng mặc định.`);
      if (n > f.max) return setLocalError(`${f.label}: tối đa ${f.max}.`);
      body[f.key] = n;
    }
    save.mutate(body);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Giới hạn Datahub theo người</PageTitle>
      <Notice>Giới hạn chung chỉnh ở Cài đặt hệ thống. Ở đây đặt giới hạn riêng cho một người; ô để trống nghĩa là dùng mặc định.</Notice>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <PersonPicker label="Người dùng" value={userId} onChange={(id) => { setUserId(id); const u = list.data?.find((x) => x.user_id === id); if (u) pick(u); else setVals({ max_datahubs: "", max_tables: "", max_columns: "" }); }} testId="limit-user" />
          <div className="grid gap-3 sm:grid-cols-3">
            {LIMIT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={`Để trống = mặc định. Tối đa ${f.max}.`}>
                <Input inputMode="numeric" value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} data-testid={`limit-${f.key}`} />
              </Field>
            ))}
          </div>
          {localError && <p role="alert" className="text-sm text-bad">{localError}</p>}
          <ErrorText error={save.error} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} loading={save.isPending} data-testid="limit-save">Lưu giới hạn</Button>
            <Button variant="secondary" disabled={!userId || save.isPending} onClick={() => { setVals({ max_datahubs: "", max_tables: "", max_columns: "" }); save.mutate({ max_datahubs: null, max_tables: null, max_columns: null }); }}>Về mặc định</Button>
          </div>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-2" aria-label="Giới hạn riêng đã đặt">
        <h2 className="text-base font-semibold">Đã đặt giới hạn riêng</h2>
        <ErrorText error={list.error} />
        {list.data && list.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa đặt giới hạn riêng cho ai.</p>
        ) : (
          <Table>
            <thead><tr><th>Người</th><th>Datahub</th><th>Bảng</th><th>Cột</th><th><span className="sr-only">Sửa</span></th></tr></thead>
            <tbody>
              {list.data?.map((u) => (
                <tr key={u.user_id} data-testid="limit-row">
                  <td className="[overflow-wrap:anywhere]"><PersonChip person={{ id: u.user_id, full_name: u.full_name, email: u.email }} label={limitNames.get(u.user_id)} /><div className="text-xs text-muted-foreground">{u.email}</div></td>
                  <td>{u.max_datahubs ?? "Mặc định"}</td>
                  <td>{u.max_tables ?? "Mặc định"}</td>
                  <td>{u.max_columns ?? "Mặc định"}</td>
                  <td><Button variant="secondary" onClick={() => pick(u)} aria-label={`Sửa giới hạn của ${u.full_name}`}>Sửa</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Template Quản lý Deal (default set) */

const DEAL_DEFAULTS_KEY = "deal.default_templates";

/** `/quan-tri/template-deal` — Admin edits the default template set a NEW tree gets (design module4 3.1, 3.8). Trees that exist keep theirs and change at the Template page. */
export function DealDefaultsPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["settings", "catalog"], queryFn: () => api<CatalogItem[]>("GET", "/system/settings-catalog") });
  const rows = useQuery({ queryKey: ["settings", "rows"], queryFn: () => apiList<SettingRow>(`/system/settings${qs({ limit: 200 })}`) });
  const def = catalog.data?.find((c) => c.key === DEAL_DEFAULTS_KEY);
  const row = rows.data?.data.find((r) => r.key === DEAL_DEFAULTS_KEY);
  const current = row ? row.value : def?.default;
  const [text, setText] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = text ?? JSON.stringify(current ?? [], null, 2);
  const save = useMutation({
    mutationFn: (value: unknown) => api("PUT", `/system/settings/${DEAL_DEFAULTS_KEY}`, { value, ...(row ? { version: row.version } : {}) }),
    onSuccess: () => {
      setText(null);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const tables = Array.isArray(current) ? (current as { name: string; kind: string; columns?: unknown[] }[]) : [];
  const submit = () => {
    setLocalError(null);
    try {
      save.mutate(JSON.parse(shown));
    } catch {
      setLocalError("Nội dung không phải JSON hợp lệ. Kiểm dấu ngoặc và dấu phẩy.");
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Template Quản lý Deal</PageTitle>
      <p className="text-sm text-muted-foreground">{def?.description}</p>
      <ErrorText error={catalog.error ?? rows.error} />
      <Card>
        <CardContent className="flex flex-col gap-2 pt-5 text-sm" data-testid="deal-defaults">
          <div className="font-medium">Các bảng của bộ mặc định ({tables.length})</div>
          <ul className="flex flex-wrap gap-2" aria-label="Các bảng của bộ mặc định">
            {tables.map((t) => <li key={t.name} className="rounded-md bg-muted px-2 py-1">{t.name} · {t.kind === "shared" ? "chung" : "riêng"} · {(t.columns ?? []).length} cột</li>)}
          </ul>
          <label className="mt-2 font-medium" htmlFor="deal-defaults-json">Nội dung (JSON)</label>
          <textarea id="deal-defaults-json" className="min-h-96 w-full rounded-md border border-border bg-card p-2 font-mono text-xs" spellCheck={false} value={shown} disabled={!def || !rows.data} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} disabled={!def || save.isPending || text === null} loading={save.isPending}>Lưu bộ mặc định</Button>
            <Button variant="secondary" disabled={!def || save.isPending} onClick={() => setText(JSON.stringify(def?.default ?? [], null, 2))}>Đặt lại về bộ dựng sẵn</Button>
          </div>
          <ErrorText error={localError ?? save.error} />
          {save.isSuccess && text === null && !localError && <p className="text-xs text-ok">Đã lưu. Chỉ cây tạo sau này nhận bộ mới.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
