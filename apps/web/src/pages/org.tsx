import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GUEST_PRESET_LABELS, ROLES, ROLE_LABELS, USER_STATUS_LABELS, type Role } from "@soe/shared";
import { Badge } from "@/components/ui/badge";
import { PersonChip } from "@/components/ui/person";
import { disambiguate } from "@/lib/people";
import { UserPlus } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button, ErrorText, Field, Input, Modal, PageTitle, Select, Table } from "@/components/ui/form";
import { Segmented } from "./onboarding/common";
import { Avatar } from "@/components/ui/person";
import { api, apiList, fmtTime, qs } from "@/lib/api";
import { can, useMe, type UserView } from "@/lib/session";

type Row = UserView & { manager_name: string | null; leader_name: string | null; created_at: string };

function useMembers(search: string, status: string) {
  const conds: unknown[] = [];
  if (search) conds.push({ or: [{ field: "full_name", op: "contains", value: search }, { field: "email", op: "contains", value: search }] });
  if (status) conds.push({ field: "status", op: "eq", value: status });
  const filter = conds.length ? { and: conds } : undefined;
  return useQuery({
    queryKey: ["org", "members", search, status],
    queryFn: async () => (await apiList<Row>(`/org/members${qs({ limit: 500, filter, include_total: true })}`)).data,
  });
}

function roleText(u: { roles: string[]; guest_preset?: string | null }) {
  return u.roles.map((r) => (r === "guest" && u.guest_preset ? `Guest ${GUEST_PRESET_LABELS[u.guest_preset as "sale"]}` : ROLE_LABELS[r as Role] ?? r)).join(", ");
}

function StatusBadge({ s }: { s: UserView["status"] }) {
  return <Badge tone={s === "active" ? "ok" : s === "locked" ? "bad" : "warn"}>{USER_STATUS_LABELS[s]}</Badge>;
}

export function OrgPage() {
  const me = useMe().data;
  const [tab, setTab] = useState<"table" | "tree">("table");
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? ""); // opened from an audit row
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const members = useMembers(search, status);
  const memberNames = disambiguate(members.data ?? []);
  const writable = can(me, "org:member:write");
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageTitle actions={writable && <Button onClick={() => setEditing("new")}><UserPlus size={14} aria-hidden />Thêm người</Button>}>Org chart</PageTitle>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} label="Cách xem" items={[{ value: "table", label: "Bảng" }, { value: "tree", label: "Dạng cây" }]} />
        <p className="max-w-xl text-xs text-muted-foreground">Thêm người vào org chart là cách duy nhất để có tài khoản. Người mới ở trạng thái Chưa kích hoạt, tự vào Đăng ký để nhận mã.</p>
      </div>
      {tab === "table" ? (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Tìm theo tên hoặc email" aria-label="Tìm theo tên hoặc email" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48" aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {Object.entries(USER_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <ErrorText error={members.error} />
          <Table>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Manager</th>
                <th>Cấp trên</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium"><PersonChip person={{ id: u.id, full_name: u.full_name, email: u.email }} label={memberNames.get(u.id)} /></div>
                    {u.title && <div className="text-xs text-muted-foreground">{u.title}</div>}
                  </td>
                  <td>{u.email}</td>
                  <td>{roleText(u)}</td>
                  <td>{u.manager_id === u.id ? "(gốc cây)" : (u.manager_name ?? "—")}</td>
                  <td>{u.leader_name ?? "—"}</td>
                  <td>
                    <StatusBadge s={u.status} />
                  </td>
                  <td className="whitespace-nowrap">
                    <Button variant="ghost" onClick={() => setDetail(u)}>
                      Chi tiết
                    </Button>
                    {writable && (
                      <Button variant="ghost" onClick={() => setEditing(u)}>
                        Sửa
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {members.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground">
                    Không có ai.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </>
      ) : (
        <OrgTree />
      )}
      {editing && <MemberForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {detail && <MemberDetail row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

interface TreeNode {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  status: UserView["status"];
  guest_preset: string | null;
  members?: TreeNode[];
}

function OrgTree() {
  const q = useQuery({ queryKey: ["org", "tree"], queryFn: () => api<{ trees: { manager: TreeNode; leaders: TreeNode[]; direct: TreeNode[] }[]; outside: TreeNode[] }>("GET", "/org/tree") });
  const Person = ({ p }: { p: TreeNode }) => (
    <span>
      <PersonChip person={{ id: p.id, full_name: p.full_name, email: p.email }} /> <span className="text-xs text-muted-foreground">({roleText(p)})</span> {p.status !== "active" && <StatusBadge s={p.status} />}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <ErrorText error={q.error} />
      {q.data?.trees.map((tr) => (
        <div key={tr.manager.id} className="rounded-card border border-border bg-card p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <Badge tone="primary">Manager</Badge>Cây của <Person p={tr.manager} />
          </div>
          <ul className="ml-3 mt-3 space-y-2 border-l-2 border-primary-border pl-4">
            {tr.leaders.map((l) => (
              <li key={l.id}>
                <Person p={l} />
                {l.members && l.members.length > 0 && (
                  <ul className="mt-1.5 ml-3 space-y-1 border-l border-border pl-4">
                    {l.members.map((m) => (
                      <li key={m.id}>
                        <Person p={m} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {tr.direct.map((d) => (
              <li key={d.id}>
                <Person p={d} /> <span className="text-xs text-muted-foreground">— thuộc thẳng Manager</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {q.data && q.data.outside.length > 0 && (
        <div className="rounded-card border border-border bg-card p-4 text-sm shadow-sm">
          <div className="font-semibold">Ngoài cây (Admin, Guest tự đăng ký)</div>
          <ul className="ml-3 mt-3 space-y-1 border-l-2 border-border pl-4">
            {q.data.outside.map((p) => (
              <li key={p.id}>
                <Person p={p} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberForm({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe().data;
  const elevated = can(me, "org:role:elevated");
  const all = useMembers("", "");
  const managers = (all.data ?? []).filter((u) => u.roles.includes("manager") && u.manager_id === u.id);
  const [f, setF] = useState({
    email: row?.email ?? "",
    full_name: row?.full_name ?? "",
    title: row?.title ?? "",
    phone: row?.phone ?? "",
    roles: (row?.roles ?? ["user"]) as Role[],
    guest_preset: row?.guest_preset ?? "data",
    manager_id: row?.manager_id ?? (me?.user.roles.includes("manager") && !elevated ? me.user.id : ""),
    leader_id: row?.leader_id ?? "",
  });
  const leaders = (all.data ?? []).filter((u) => u.roles.includes("leader") && u.manager_id === f.manager_id && u.id !== row?.id);
  const toggle = (r: Role) => setF((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : r === "guest" ? ["guest"] : [...x.roles.filter((y) => y !== "guest"), r] }));
  const isGuest = f.roles.includes("guest");
  const isManager = f.roles.includes("manager");
  const m = useMutation({
    mutationFn: () => {
      const body = {
        full_name: f.full_name,
        title: f.title || null,
        phone: f.phone || null,
        roles: f.roles,
        guest_preset: isGuest ? f.guest_preset : null,
        manager_id: isManager ? null : f.manager_id || null,
        leader_id: isManager || f.roles.includes("leader") ? null : f.leader_id || null,
      };
      return row ? api("PATCH", `/org/members/${row.id}`, { ...body, version: row.version }) : api("POST", "/org/members", { ...body, email: f.email });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org"] });
      onClose();
    },
  });
  return (
    <Modal title={row ? `Sửa: ${row.full_name}` : "Thêm người vào org chart"} open onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {!row && (
          <Field label="Email" hint="Đúng tên miền công ty, ví dụ ten@base.vn">
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          </Field>
        )}
        <Field label="Họ tên">
          <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chức danh">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Số điện thoại">
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">Vai trò</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input type="checkbox" checked={f.roles.includes(r)} disabled={(r === "admin" || r === "manager") && !elevated} onChange={() => toggle(r)} />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
          {!elevated && <span className="text-xs text-muted-foreground">Chỉ Admin gán được Manager, Admin.</span>}
        </fieldset>
        {isGuest && (
          <Field label="Mẫu Guest" hint="Sale: chỉ đọc Knowledge. Data: không có gì cho đến khi được cấp dữ liệu.">
            <Select value={f.guest_preset} onChange={(e) => setF({ ...f, guest_preset: e.target.value as "sale" })}>
              <option value="sale">Sale</option>
              <option value="data">Data</option>
            </Select>
          </Field>
        )}
        {!isManager && (
          <Field label="Thuộc cây của Manager">
            <Select value={f.manager_id} onChange={(e) => setF({ ...f, manager_id: e.target.value, leader_id: "" })}>
              <option value="">(Không thuộc cây nào)</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!isManager && !f.roles.includes("leader") && f.manager_id && (
          <Field label="Cấp trên trực tiếp">
            <Select value={f.leader_id} onChange={(e) => setF({ ...f, leader_id: e.target.value })}>
              <option value="">(Thuộc thẳng Manager)</option>
              {leaders.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={m.isPending}>
            Lưu
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MemberDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe().data;
  const history = useQuery({ queryKey: ["org", "history", row.id], queryFn: () => api<{ manager_name: string; leader_name: string | null; valid_from: string; valid_to: string | null }[]>("GET", `/org/members/${row.id}/history`) });
  const perms = useQuery({ queryKey: ["org", "perms", row.id], queryFn: () => api<{ permission: string; granted_by_name: string | null; granted_at: string }[]>("GET", `/org/members/${row.id}/permissions`) });
  const catalog = useQuery({ queryKey: ["org", "catalog"], queryFn: () => api<{ permission: string; label: string; grantable_by: string[]; eligible_roles: string[] }[]>("GET", "/org/permissions/catalog") });
  const [perm, setPerm] = useState("");
  const done = async () => qc.invalidateQueries({ queryKey: ["org"] });
  const lock = useMutation({ mutationFn: () => api("POST", `/org/members/${row.id}/${row.status === "locked" ? "unlock" : "lock"}`, {}), onSuccess: async () => (await done(), onClose()) });
  const grant = useMutation({ mutationFn: () => api("POST", `/org/members/${row.id}/permissions`, { permission: perm }), onSuccess: done });
  const revoke = useMutation({ mutationFn: (p: string) => api("DELETE", `/org/members/${row.id}/permissions/${encodeURIComponent(p)}`), onSuccess: done });
  const revokeSessions = useMutation({ mutationFn: () => api("POST", `/admin/users/${row.id}/sessions/revoke`, {}) });
  const label = (p: string) => catalog.data?.find((c) => c.permission === p)?.label ?? p;
  const grantable = (catalog.data ?? []).filter((c) => c.grantable_by.some((r) => me?.user.roles.includes(r)) && c.eligible_roles.some((r) => row.roles.includes(r)));
  return (
    <Drawer title={row.full_name} open onClose={onClose} width="sm:w-[480px]">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-start gap-3 rounded-xl border border-border-soft bg-muted p-3">
          <Avatar name={row.full_name} size="md" />
          <div className="min-w-0">
          <div className="[overflow-wrap:anywhere]">{row.email}</div>
          <div className="text-muted-foreground">
            {roleText(row)} · <StatusBadge s={row.status} /> · Đăng nhập gần nhất: {fmtTime(row.last_login_at)}
          </div>
          </div>
        </div>
        <section className="rounded-xl border border-border-soft p-3">
          <h3 className="mb-1 font-semibold">Quyền bổ sung</h3>
          {perms.data?.length === 0 && <p className="text-muted-foreground">Chưa có.</p>}
          <ul className="space-y-1">
            {perms.data?.map((p) => (
              <li key={p.permission} className="flex items-center justify-between gap-2">
                <span>
                  {label(p.permission)} <span className="text-xs text-muted-foreground">({p.granted_by_name}, {fmtTime(p.granted_at)})</span>
                </span>
                {can(me, "org:permission:grant") && (
                  <Button variant="ghost" onClick={() => revoke.mutate(p.permission)}>
                    Thu hồi
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {can(me, "org:permission:grant") && grantable.length > 0 && (
            <div className="mt-2 flex gap-2">
              <Select value={perm} onChange={(e) => setPerm(e.target.value)}>
                <option value="">Chọn quyền để cấp…</option>
                {grantable.map((c) => (
                  <option key={c.permission} value={c.permission}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Button disabled={!perm || grant.isPending} onClick={() => grant.mutate()}>
                Cấp
              </Button>
            </div>
          )}
          <ErrorText error={grant.error ?? revoke.error} />
        </section>
        <section className="rounded-xl border border-border-soft p-3">
          <h3 className="mb-1 font-semibold">Lịch sử vị trí trong cây</h3>
          <ul className="space-y-1">
            {history.data?.map((h, i) => (
              <li key={i}>
                {fmtTime(h.valid_from)} → {h.valid_to ? fmtTime(h.valid_to) : "nay"}: cây {h.manager_name}
                {h.leader_name ? `, leader ${h.leader_name}` : ""}
              </li>
            ))}
            {history.data?.length === 0 && <li className="text-muted-foreground">Không thuộc cây nào.</li>}
          </ul>
        </section>
        <div className="flex flex-wrap justify-end gap-2">
          {can(me, "auth:session:manage") && (
            <Button variant="secondary" onClick={() => revokeSessions.mutate()} disabled={revokeSessions.isSuccess}>
              {revokeSessions.isSuccess ? "Đã đăng xuất mọi thiết bị" : "Đăng xuất mọi thiết bị"}
            </Button>
          )}
          {can(me, "org:member:write") && row.id !== me?.user.id && (
            <Button variant={row.status === "locked" ? "secondary" : "danger"} onClick={() => lock.mutate()} disabled={lock.isPending}>
              {row.status === "locked" ? "Mở khoá" : "Khoá tài khoản"}
            </Button>
          )}
        </div>
        <ErrorText error={lock.error ?? revokeSessions.error} />
      </div>
    </Drawer>
  );
}
