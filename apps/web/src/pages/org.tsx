import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import "./org-tree.css";
import { GUEST_PRESET_LABELS, ROLES, ROLE_LABELS, USER_STATUS_LABELS, type Role } from "@soe/shared";
import { Badge } from "@/components/ui/badge";
import { PersonChip } from "@/components/ui/person";
import { disambiguate } from "@/lib/people";
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, UserPlus } from "lucide-react";
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
  const all = useMembers("", "");
  const memberNames = disambiguate(members.data ?? []);
  const writable = can(me, "org:member:write");
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageTitle actions={writable && <Button onClick={() => setEditing("new")}><UserPlus size={14} aria-hidden />Thêm người</Button>}>Org chart</PageTitle>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} label="Cách xem" items={[{ value: "table", label: "Bảng" }, { value: "tree", label: "Dạng cây" }]} />
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
                <th className="hidden md:table-cell">Vai trò</th>
                <th className="hidden md:table-cell">Manager · Cấp trên</th>
                <th className="hidden md:table-cell">Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="max-w-md">
                    <div className="font-medium"><PersonChip person={{ id: u.id, full_name: u.full_name, email: u.email }} label={memberNames.get(u.id)} /></div>
                    {u.title && <div className="text-xs text-muted-foreground">{u.title}</div>}
                    {/* The email sits under the name (a 1280px screen with the sidebar has no room for it as a column); on a phone the rest of the row follows, and the actions stay in view at the right. */}
                    <div className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{u.email}</div>
                    </div>
                    <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground md:hidden">
                      <span>{roleText(u)}{u.manager_id === u.id ? " · gốc cây" : u.manager_name ? ` · Manager ${u.manager_name}` : ""}{u.leader_name ? ` · Cấp trên ${u.leader_name}` : ""}</span>
                      <span><StatusBadge s={u.status} /></span>
                    </div>
                  </td>
                  <td className="hidden md:table-cell">{roleText(u)}</td>
                  <td className="hidden md:table-cell">
                    <div className="max-w-xs [overflow-wrap:anywhere]">{u.manager_id === u.id ? "(gốc cây)" : (u.manager_name ?? "—")}</div>
                    {u.leader_name && <div className="max-w-xs text-xs text-muted-foreground [overflow-wrap:anywhere]">Cấp trên: {u.leader_name}</div>}
                  </td>
                  <td className="hidden md:table-cell">
                    <StatusBadge s={u.status} />
                  </td>
                  <td className="md:whitespace-nowrap">
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
                  <td colSpan={5} className="text-muted-foreground">
                    Không có ai.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </>
      ) : (
        <OrgTree onOpen={(id) => { const r = all.data?.find((x) => x.id === id); if (r) setDetail(r); }} />
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

const ROLE_CHIP: Record<string, string> = {
  admin: "border-amber-200 bg-amber-50 text-amber-700",
  manager: "border-indigo-200 bg-indigo-50 text-indigo-700",
  leader: "border-violet-200 bg-violet-50 text-violet-700",
  user: "border-slate-200 bg-slate-50 text-slate-600",
  guest: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const topRole = (p: TreeNode) => ROLES.find((r) => p.roles.includes(r)) ?? "user";
const countBelow = (n: TNode): number => n.children.reduce((a, c) => a + 1 + countBelow(c), 0);

interface TNode { p: TreeNode; children: TNode[] }

function OrgCard({ n, collapsed, onToggle, onOpen, compact }: { n: TNode; collapsed: boolean; onToggle: () => void; onOpen: () => void; compact?: boolean }) {
  const role = topRole(n.p);
  const below = countBelow(n);
  return (
    <div className={cn("relative", n.children.length > 0 && "pb-3")}>
      <button
        type="button"
        onClick={onOpen}
        title={`${n.p.full_name} · ${n.p.email}`}
        aria-label={`Chi tiết ${n.p.full_name}`}
        className={cn("flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left shadow-2xs transition-[border-color,box-shadow] duration-150 hover:border-primary-border hover:shadow-md", compact ? "w-[160px]" : "w-[184px]")}
      >
        <Avatar name={n.p.full_name} size="md" className="size-8" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium leading-4">{n.p.full_name}</span>
          <span className="flex items-center gap-1">
            <span className={cn("rounded-full border px-1.5 text-[11px] font-medium leading-4", ROLE_CHIP[role])}>{roleText(n.p)}</span>
            {n.p.status !== "active" && <span title={USER_STATUS_LABELS[n.p.status]} aria-label={USER_STATUS_LABELS[n.p.status]} className={cn("size-1.5 rounded-full", n.p.status === "locked" ? "bg-bad" : "bg-warn")} />}
          </span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">{below > 0 ? `Team · ${below} người` : n.p.email}</span>
        </span>
      </button>
      {n.children.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Mở" : "Thu"} nhánh ${n.p.full_name}`}
          className="absolute bottom-0 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground shadow-2xs hover:border-primary-border hover:text-primary"
        >
          {collapsed ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
          {n.children.length}
        </button>
      )}
    </div>
  );
}

function OrgBranch({ n, closed, toggle, onOpen, depth = 0, compact }: { n: TNode; closed: Set<string>; toggle: (id: string) => void; onOpen: (id: string) => void; depth?: number; compact?: boolean }) {
  const collapsed = closed.has(n.p.id);
  const vertical = depth > 0 && n.children.length > 0 && n.children.every((c) => c.children.length === 0);
  return (
    <li>
      <OrgCard n={n} collapsed={collapsed} onToggle={() => toggle(n.p.id)} onOpen={() => onOpen(n.p.id)} compact={compact} />
      {n.children.length > 0 && !collapsed && (
        <ul className={vertical ? "otree-v" : undefined}>
          {n.children.map((c) => (
            <OrgBranch key={c.p.id} n={c} closed={closed} toggle={toggle} onOpen={onOpen} depth={depth + 1} compact={vertical} />
          ))}
        </ul>
      )}
    </li>
  );
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.5;

function OrgTree({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["org", "tree"], queryFn: () => api<{ trees: { manager: TreeNode; leaders: TreeNode[]; direct: TreeNode[] }[]; outside: TreeNode[] }>("GET", "/org/tree") });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const fitted = useRef(false);
  const roots: TNode[] = (q.data?.trees ?? []).map((tr) => ({
    p: tr.manager,
    children: [
      ...tr.leaders.map((l) => ({ p: l, children: (l.members ?? []).map((m) => ({ p: m, children: [] })) })),
      ...tr.direct.map((d) => ({ p: d, children: [] })),
    ],
  }));
  const toggle = (id: string) => setClosed((s) => { const x = new Set(s); if (!x.delete(id)) x.add(id); return x; });
  const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(v * 100) / 100));
  const fit = () => {
    if (!frame.current || !inner.current) return;
    const w = inner.current.offsetWidth;
    setScale(w > 0 ? clamp(Math.min(1, (frame.current.clientWidth - 32) / w)) : 1);
    frame.current.scrollTo({ left: 0, top: 0 });
  };
  useLayoutEffect(() => {
    if (inner.current) setSize({ w: inner.current.offsetWidth, h: inner.current.offsetHeight });
  }, [q.data, closed]);
  useEffect(() => {
    if (q.data && size.w > 0 && !fitted.current) {
      fitted.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit once, when the first size is known
  }, [q.data, size.w]);
  const el = frame.current;
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !el) return;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !el || !(e.buttons & 1)) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    d.moved = true;
    el.scrollLeft = d.sl - dx;
    el.scrollTop = d.st - dy;
  };
  const endDrag = () => { setTimeout(() => { drag.current = null; }, 0); };
  return (
    <div className="flex flex-col gap-4">
      <ErrorText error={q.error} />
      {roots.length > 0 && (
        <div className="relative">
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-2xs" role="toolbar" aria-label="Phóng to thu nhỏ">
            <Button variant="ghost" aria-label="Thu nhỏ" disabled={scale <= MIN_ZOOM} onClick={() => setScale((s) => clamp(s - 0.1))}><Minus size={14} aria-hidden /></Button>
            <span className="w-10 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{Math.round(scale * 100)}%</span>
            <Button variant="ghost" aria-label="Phóng to" disabled={scale >= MAX_ZOOM} onClick={() => setScale((s) => clamp(s + 0.1))}><Plus size={14} aria-hidden /></Button>
            <Button variant="ghost" onClick={fit}><Maximize2 size={14} aria-hidden />Vừa khung</Button>
          </div>
          <div
            ref={frame}
            className="otree-dots max-h-[calc(100vh-260px)] min-h-[360px] cursor-grab touch-pan-x touch-pan-y overflow-auto rounded-card border border-border active:cursor-grabbing"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onClickCapture={(e) => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); } }}
          >
            <div className="mx-auto p-6" style={{ width: size.w * scale + 48, height: size.h * scale + 48 }}>
              <div ref={inner} className="otree flex w-max flex-col items-center gap-8" style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
                {roots.map((r) => (
                  <div key={r.p.id} className="flex flex-col items-center gap-3">
                    <div className="text-[11px] font-medium text-muted-foreground">Cây của {r.p.full_name}</div>
                    <ul className="otree-root">
                      <OrgBranch n={r} closed={closed} toggle={toggle} onOpen={onOpen} />
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {q.data && q.data.outside.length > 0 && (
        <section className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 text-[13px] font-medium">Ngoài cây (Admin, Guest tự đăng ký)</div>
          <div className="flex flex-wrap gap-3">
            {q.data.outside.map((p) => (
              <OrgCard key={p.id} n={{ p, children: [] }} collapsed={false} onToggle={() => {}} onOpen={() => onOpen(p.id)} />
            ))}
          </div>
        </section>
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
