import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArchiveRestore, ArrowLeft, Archive, Lock, Pencil, Plus, Search, Table2, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { columnTypes, dhKeys, getTable, lookupPeople } from "@/lib/datahub/api";
import {
  archiveTemplate, changeTemplateColumnType, columnUsage, createTemplate, listLeaders, createTemplateColumn, dealKeys, deleteTemplateColumn, getTemplate, listTemplates, restoreTemplate, restoreTemplateColumn,
  setColumnRole, setShareOptions, templateImpact, updateTemplate, updateTemplateColumn, type ColumnUsage, type Template, type TemplateDetail, type TemplateRole,
} from "@/lib/datahub/deal-api";
import { previewTypeChange, optionImpact } from "@/lib/datahub/api";
import type { Column, TableDetail } from "@/lib/datahub/types";
import { nameError } from "../datahub/list";
import { attrsOf } from "@/lib/datahub/cells";
import { ColumnEditor, type ColumnAdapter } from "../datahub/column-editor";
import { TableNameDialog } from "../datahub/detail";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

/** `/quan-ly-deal/template`: the one page where template tables and their columns change (Module 4 mục 3.8). Nothing here is data; every change is previewed ("Áp dụng cho N người") and then reaches everyone in scope. */
export function TemplatePage() {
  const search = useSearch({ strict: false }) as { template?: string; column?: string };
  const nav = useNavigate();
  const meQ = useMe();
  const me = meQ.data;
  const listQ = useQuery({ queryKey: dealKeys.templates, queryFn: () => listTemplates(true) });
  const list = useMemo(() => listQ.data ?? [], [listQ.data]);
  const [creating, setCreating] = useState(false);
  const leaderIds = useMemo(() => [...new Set(list.map((t) => t.leader_id).filter((x): x is string => !!x))], [list]);
  const leadersQ = useQuery({ queryKey: ["tpl-leaders", leaderIds.join(",")], queryFn: () => lookupPeople({ ids: leaderIds }), enabled: leaderIds.length > 0 });
  const leaderName = (id: string | null) => (id ? (leadersQ.data?.find((p) => p.id === id)?.full_name ?? "…") : "");
  const select = (id: string) => void nav({ href: `/quan-ly-deal/template?template=${encodeURIComponent(id)}`, replace: true });

  useEffect(() => {
    if (!search.template && list[0]) select(list.find((t) => !t.archived)?.id ?? list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, search.template]);

  const [find, setFind] = useState("");
  const shown = useMemo(() => list.filter((t) => t.name.toLowerCase().includes(find.trim().toLowerCase())), [list, find]);
  const groups = useMemo(() => {
    const tree = shown.filter((t) => t.scope === "tree");
    const teams = new Map<string, Template[]>();
    for (const t of shown.filter((x) => x.scope === "team")) teams.set(t.leader_id ?? "", [...(teams.get(t.leader_id ?? "") ?? []), t]);
    return { tree, teams: [...teams] };
  }, [shown]);

  if (listQ.isLoading) return <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (listQ.error) return <ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} title="Không tải được danh sách template" />;
  const roles = me?.user.roles ?? [];
  const item = (t: Template) => (
    <li key={t.id}>
      <button type="button" data-testid={`template-item`} aria-current={t.id === search.template ? "true" : undefined} onClick={() => select(t.id)} className={cn("flex w-full flex-col gap-1 rounded-xl border border-transparent px-3 py-2.5 text-left hover:bg-muted", t.id === search.template && "border-primary-border bg-primary-soft")}>
        <span className={cn("text-sm [overflow-wrap:anywhere]", t.id === search.template ? "font-semibold text-primary" : "font-medium")}>{t.name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <Badge tone={t.kind === "shared" ? "ok" : "warn"}>{t.kind === "shared" ? "Chung" : "Riêng"}</Badge>
          {t.archived && <Badge>Đã lưu trữ</Badge>}
          {!t.can_edit && <span className="inline-flex items-center gap-0.5"><Lock size={12} aria-hidden /> Chỉ xem</span>}
          <span>{t.members} người</span>
        </span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageTitle actions={<Button variant="secondary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> Tạo bảng template</Button>}>Template</PageTitle>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/quan-ly-deal" className="inline-flex min-h-8 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} aria-hidden /> Quản lý Deal</Link>
        <p className="min-w-0 flex-1 basis-80 text-sm text-muted-foreground">Bảng và cột của template áp dụng ngay cho mọi người trong phạm vi. Cột riêng của từng người không bị ảnh hưởng. Bộ mặc định cho cây mới do Admin sửa ở Cài đặt hệ thống.</p>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Chưa có bảng template nào" hint={roles.includes("manager") || roles.includes("leader") ? "Tạo bảng template đầu tiên cho cây hoặc team của bạn." : undefined} />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[19rem_minmax(0,1fr)]">
          <nav aria-label="Bảng template" className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-card md:sticky md:top-0" data-testid="template-list">
            <label className="relative block">
              <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Tìm bảng trong cây" placeholder="Tìm bảng trong cây…" value={find} onChange={(e) => setFind(e.target.value)} autoComplete="off" className="!pl-9" />
            </label>
            {shown.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Không có bảng nào khớp.</p>}
            {groups.tree.length > 0 && (
              <section><h2 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cây của tôi</h2><ul className="flex flex-col gap-0.5">{groups.tree.map(item)}</ul></section>
            )}
            {groups.teams.map(([leader, ts]) => (
              <section key={leader}><h2 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team {leaderName(leader || null)}</h2><ul className="flex flex-col gap-0.5">{ts.map(item)}</ul></section>
            ))}
          </nav>
          {search.template ? <TemplatePanel key={search.template} id={search.template} focusColumn={search.column} leaderName={leaderName} /> : null}
        </div>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(t) => select(t.id)} />}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Template) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"shared" | "personal">("shared");
  const [perm, setPerm] = useState<"view" | "edit_data">("view");
  const [touched, setTouched] = useState(false);
  // A Manager makes a table for the whole tree or for the team of one Leader; a Leader only for their own team (the server decides).
  const isManager = !!useMe().data?.user.roles.includes("manager");
  const [scope, setScope] = useState<"tree" | "team">("tree");
  const [leader, setLeader] = useState("");
  const leadersQ = useQuery({ queryKey: ["tpl-leader-choices"], queryFn: listLeaders, enabled: isManager });
  const m = useMutation({
    mutationFn: () => createTemplate({ name: name.trim(), kind, member_permission: perm, ...(isManager && scope === "team" ? { scope, leader_id: leader } : {}) }),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: dealKeys.templates });
      await qc.invalidateQueries({ queryKey: dealKeys.home });
      notify.ok(`Đã tạo bảng template "${t.name}"`);
      onCreated(t);
      onClose();
    },
  });
  const err = touched ? nameError(name) : null;
  return (
    <Modal title="Tạo bảng template" open onClose={onClose} dirty={name !== "" && !m.isPending}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!nameError(name) && !(isManager && scope === "team" && !leader)) m.mutate(); }}>
        <Field label="Tên bảng *" error={err}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} autoFocus autoComplete="off" aria-invalid={!!err} />
        </Field>
        {isManager && (
          <Field label="Phạm vi" hint="Bảng của team chỉ hiện cho Leader và thành viên của team đó.">
            <Select value={scope} onChange={(e) => setScope(e.target.value as "tree" | "team")} aria-label="Phạm vi">
              <option value="tree">Cả cây của tôi</option>
              <option value="team">Một team</option>
            </Select>
          </Field>
        )}
        {isManager && scope === "team" && (
          <Field label="Leader của team *" error={touched && !leader ? "Chọn Leader của team." : null}>
            <Select value={leader} onChange={(e) => setLeader(e.target.value)} aria-label="Leader của team" aria-invalid={touched && !leader}>
              <option value="">Chọn Leader</option>
              {(leadersQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Kiểu bảng" hint="Không đổi được sau khi tạo.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "shared" | "personal")} aria-label="Kiểu bảng">
            <option value="shared">Bảng chung: một bộ dòng, khoá phân chia quyết định ai thấy dòng nào</option>
            <option value="personal">Bảng riêng: mỗi người một bảng cùng cấu trúc</option>
          </Select>
        </Field>
        <Field label="Quyền mặc định của thành viên" hint={kind === "shared" ? "Bật khoá phân chia (1–5 cột Người dùng) sau khi thêm cột Người dùng đầu tiên." : undefined}>
          <Select value={perm} onChange={(e) => setPerm(e.target.value as "view" | "edit_data")} aria-label="Quyền mặc định">
            <option value="view">Xem</option>
            <option value="edit_data">Sửa dữ liệu (ở các cột cho phép sửa)</option>
          </Select>
        </Field>
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending}>Tạo bảng</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The chip color of a column type, by meaning (the same colors as a table and a chart). */
function typeTone(type: string): "ok" | "info" | "warn" | "ai" | "primary" | "muted" {
  if (type === "formula" || type === "lookup" || type === "rollup") return "ai";
  if (type === "date" || type === "datetime" || type === "created_time" || type === "modified_time" || type === "field_modified") return "warn";
  if (type === "single_select" || type === "multi_select") return "info";
  if (type === "number" || type === "percent" || type === "currency" || type === "auto_number") return "ok";
  if (type === "user") return "primary";
  return "muted";
}

const LAYER_LABEL = { basic: "Cơ bản", role: "Theo vai trò", team: "Theo team" } as const;
const ROLE_NAMES: Record<string, string> = { manager: "Manager", leader: "Leader", user: "User" };

function TemplatePanel({ id, focusColumn, leaderName }: { id: string; focusColumn?: string; leaderName: (id: string | null) => string }) {
  const qc = useQueryClient();
  const meQ = useMe();
  const meId = meQ.data?.user.id;
  const q = useQuery({ queryKey: dealKeys.template(id), queryFn: () => getTemplate(id) });
  const typesQ = useQuery({ queryKey: ["dh-column-types"], queryFn: columnTypes, staleTime: Infinity });
  const d = q.data;
  const tpl = d?.template;
  const masterQ = useQuery({ queryKey: dhKeys.table(tpl?.master_table_id ?? ""), queryFn: () => getTable(tpl!.master_table_id!), enabled: !!tpl?.master_table_id });
  const [dialog, setDialog] = useState<{ kind: "rename" } | { kind: "archive" } | { kind: "add" } | { kind: "edit"; col: Column } | { kind: "delete"; col: Column } | { kind: "role"; col: Column } | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: dealKeys.template(id) });
    await qc.invalidateQueries({ queryKey: dealKeys.templates });
    await qc.invalidateQueries({ queryKey: dealKeys.home });
    if (tpl?.master_table_id) await qc.invalidateQueries({ queryKey: dhKeys.table(tpl.master_table_id) });
  };
  const [layerTab, setLayerTab] = useState<"all" | "basic" | "role" | "team">("all");
  const [colFind, setColFind] = useState("");
  const typeLabel = (t: string) => typesQ.data?.find((x) => x.type === t)?.label ?? t;

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error || !d || !tpl) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không mở được template" />;

  const isManager = (meQ.data?.user.roles ?? []).includes("manager");
  const canAddLayer = tpl.can_edit || tpl.leader_can_add_columns;
  const canEditCol = (c: Column) => tpl.can_edit || (c.layer === "team" && c.layer_ref === meId && tpl.leader_can_add_columns);
  const colMatch = (c: Column) => c.name.toLowerCase().includes(colFind.trim().toLowerCase());
  const byLayer = (l: "basic" | "role" | "team") => d.columns.filter((c) => c.layer === l && colMatch(c));
  const count = (l: "basic" | "role" | "team") => d.columns.filter((c) => c.layer === l).length;
  const teamGroups = [...new Set(byLayer("team").map((c) => c.layer_ref ?? ""))];
  const why = tpl.can_edit
    ? null
    : tpl.scope === "tree"
      ? `Bảng này do Manager tạo cho cả cây nên bạn chỉ xem.${tpl.leader_can_add_columns ? " Bạn thêm được cột lớp Theo team cho team của mình." : " Manager bật \"Leader được thêm cột team\" thì bạn thêm được cột lớp Theo team."}`
      : "Bạn không có quyền sửa template này.";

  const columnRow = (c: Column) => (
    <li key={c.id} data-testid="template-column" data-column={c.name} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", focusColumn === c.key && "bg-selected")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-base font-semibold [overflow-wrap:anywhere]">{c.name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge tone={typeTone(c.type)}>{typeLabel(c.type)}</Badge>
          {c.storage === "person" && <span>Mỗi người một giá trị</span>}
          {c.role && <Badge tone="muted" data-testid="role-badge">Vai trò: {d.roles.find((r) => r.key === c.role)?.label ?? c.role}</Badge>}
          {c.autofill ? <span>Hệ thống tự điền, không ai sửa ô</span> : c.type === "formula" || c.type === "lookup" || c.type === "rollup" ? <span>Công thức, không ai sửa ô</span> : <span>{c.allow_edit ? "Thành viên sửa được ô" : "Chỉ người tạo bảng sửa ô"}</span>}
          {c.layer === "role" && <span>Hiện cho {(c.layer_roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(", ")}</span>}
        </span>
      </div>
      {canEditCol(c) && (
        <span className="flex shrink-0 flex-wrap gap-1.5">
          <Button variant="secondary" className="!min-h-8 !px-3 text-sm" aria-label={`Sửa cột ${c.name}`} onClick={() => setDialog({ kind: "edit", col: c })}><Pencil size={14} aria-hidden /> Sửa</Button>
          {tpl.can_edit && d.roles.length > 0 && <Button variant="secondary" className="!min-h-8 !px-3 text-sm" aria-label={`Vai trò của cột ${c.name}`} onClick={() => setDialog({ kind: "role", col: c })}>Vai trò</Button>}
          <Button variant="secondary" className="!min-h-8 !px-3 text-sm !text-bad" aria-label={`Bỏ cột ${c.name}`} onClick={() => setDialog({ kind: "delete", col: c })}><Trash2 size={14} aria-hidden /> Bỏ</Button>
        </span>
      )}
    </li>
  );
  const section = (title: string, cols: Column[], extra?: React.ReactNode) => (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {extra}
      {cols.length === 0 ? <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{colFind ? "Không có cột nào khớp." : "Chưa có cột nào."}</p> : <ul className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft">{cols.map(columnRow)}</ul>}
    </section>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="template-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Table2 size={20} /></span>
        <h2 className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">{tpl.name}</h2>
        <Badge tone={tpl.kind === "shared" ? "ok" : "warn"}>{tpl.kind === "shared" ? "Bảng chung" : "Bảng riêng"}</Badge>
        {tpl.archived && <Badge>Đã lưu trữ</Badge>}
        <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-card px-2.5 py-0.5 text-xs text-muted-foreground"><Users size={14} aria-hidden /> Áp dụng cho {tpl.members} người</span>
        {tpl.can_edit && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: "rename" })}><Pencil size={16} aria-hidden /> Đổi tên</Button>
            {tpl.archived ? (
              <Button variant="secondary" onClick={() => void restoreTemplate(id).then(refresh).then(() => notify.ok("Đã khôi phục bảng template")).catch((e) => notify.error(String((e as Error).message)))}><ArchiveRestore size={16} aria-hidden /> Khôi phục</Button>
            ) : (
              <Button variant="secondary" onClick={() => setDialog({ kind: "archive" })}><Archive size={16} aria-hidden /> Lưu trữ</Button>
            )}
          </span>
        )}
      </div>
      {why && <p role="status" data-testid="template-readonly-reason" className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm"><Lock size={16} aria-hidden className="mt-0.5 shrink-0" /><span>{why}</span></p>}

      {tpl.can_edit && <TemplateSettings tpl={tpl} master={masterQ.data} isManager={isManager} onSaved={refresh} />}

      <section aria-label="Cột của bảng" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="text-base font-semibold">Cột của bảng</h3>
          <div role="group" aria-label="Lọc cột theo lớp" className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {([["all", "Tất cả", d.columns.length], ["basic", LAYER_LABEL.basic, count("basic")], ["role", LAYER_LABEL.role, count("role")], ["team", LAYER_LABEL.team, count("team")]] as const).map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={layerTab === k} onClick={() => setLayerTab(k)} className={cn("min-h-7 rounded-md px-2.5 text-sm", layerTab === k ? "bg-card font-semibold text-primary shadow-card" : "text-muted-foreground hover:text-foreground")}>{label} ({n})</button>
            ))}
          </div>
          <label className="relative ml-auto block min-w-40 max-w-64 flex-1 basis-44">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Tìm tên cột" placeholder="Tìm tên cột…" value={colFind} onChange={(e) => setColFind(e.target.value)} autoComplete="off" className="!pl-9" />
          </label>
          {canAddLayer && !tpl.archived && <Button onClick={() => setDialog({ kind: "add" })}><Plus size={16} aria-hidden /> Thêm cột</Button>}
        </div>
        <div className="flex flex-col gap-4" data-testid="template-columns">
          {(layerTab === "all" || layerTab === "basic") && section(LAYER_LABEL.basic, byLayer("basic"))}
          {(layerTab === "all" || layerTab === "role") && section(LAYER_LABEL.role, byLayer("role"))}
          {(layerTab === "all" || layerTab === "team") && section("Theo team (bản sửa của các team)", byLayer("team"), teamGroups.length ? <p className="text-xs text-muted-foreground">Team có cột riêng: {teamGroups.map((l) => leaderName(l || null)).join(", ")}.</p> : undefined)}
        </div>
      </section>

      {dialog?.kind === "rename" && <TableNameDialog title="Đổi tên bảng template" submit="Lưu" initial={tpl.name} onClose={() => setDialog(null)} save={async (name) => { await updateTemplate(id, { name, ...(tpl.can_edit ? {} : {}) }); await refresh(); notify.ok("Đã lưu"); }} />}
      {dialog?.kind === "archive" && <ArchiveConfirm tpl={tpl} onClose={() => setDialog(null)} onDone={refresh} />}
      {(dialog?.kind === "add" || dialog?.kind === "edit") && masterQ.data && (
        <ColumnFlow tpl={tpl} d={d} master={masterQ.data} column={dialog.kind === "edit" ? dialog.col : undefined} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {dialog?.kind === "delete" && <DeleteColumn tpl={tpl} col={dialog.col} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === "role" && <RoleDialog tpl={tpl} d={d} col={dialog.col} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

/** Member permission, "Leader được thêm cột team" and the split lock of a shared table. */
function TemplateSettings({ tpl, master, isManager, onSaved }: { tpl: Template; master?: TableDetail; isManager: boolean; onSaved: () => Promise<void> }) {
  const [err, setErr] = useState<unknown>(null);
  const run = (fn: () => Promise<unknown>, ok: string) => void fn().then(onSaved).then(() => { setErr(null); notify.ok(ok); }).catch(setErr);
  const userCols = (master?.columns ?? []).filter((c) => c.type === "user" && c.layer !== "custom");
  const split = master?.key_split;
  const [keys, setKeys] = useState<string[] | null>(null);
  const [primary, setPrimary] = useState<string | null | undefined>(undefined);
  const [on, setOn] = useState<boolean | null>(null);
  const curKeys = keys ?? split?.key_columns.map((k) => k.key) ?? [];
  const curOn = on ?? split?.enabled ?? false;
  const curPrimary = primary === undefined ? (split?.primary ?? null) : primary;
  return (
    <section aria-label="Quyền theo bảng" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-card" data-testid="template-settings">
      <h3 className="text-base font-semibold">Quyền theo bảng</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quyền mặc định của thành viên">
          <Select aria-label="Quyền mặc định của thành viên" value={tpl.member_permission} onChange={(e) => run(() => updateTemplate(tpl.id, { member_permission: e.target.value as "view" | "edit_data" }), "Đã lưu quyền mặc định")}>
            <option value="view">Xem</option>
            <option value="edit_data">Sửa dữ liệu (ở các cột cho phép sửa)</option>
          </Select>
        </Field>
        {isManager && (
          <label className="flex min-h-9 items-center gap-2 self-end text-sm">
            <input type="checkbox" className="h-4 w-4" checked={tpl.leader_can_add_columns} onChange={(e) => run(() => updateTemplate(tpl.id, { leader_can_add_columns: e.target.checked }), e.target.checked ? "Leader được thêm cột team" : "Leader không thêm cột team nữa")} />
            Leader được thêm cột team
          </label>
        )}
      </div>
      {tpl.kind === "shared" && (
        <div className="flex flex-col gap-2" data-testid="template-split">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4" checked={curOn} disabled={userCols.length === 0 && !curOn} onChange={(e) => setOn(e.target.checked)} />
            Khoá phân chia: mỗi người chỉ thấy dòng có tên mình (và cấp dưới)
          </label>
          {userCols.length === 0 ? <p className="text-xs text-muted-foreground">Thêm một cột kiểu Người dùng để làm cột khoá (1–5 cột).</p> : curOn && (
            <>
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="mb-1 text-xs text-muted-foreground">Cột khoá (tối đa 5)</legend>
                {userCols.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={curKeys.includes(c.key)} onChange={(e) => setKeys(e.target.checked ? [...curKeys, c.key].slice(0, 5) : curKeys.filter((k) => k !== c.key))} /> {c.name}</label>
                ))}
              </fieldset>
              {curKeys.length > 1 && (
                <Field label="Cột khoá chính">
                  <Select aria-label="Cột khoá chính" value={curPrimary ?? ""} onChange={(e) => setPrimary(e.target.value || null)}>
                    <option value="">Chọn cột</option>
                    {curKeys.map((k) => <option key={k} value={k}>{userCols.find((c) => c.key === k)?.name ?? k}</option>)}
                  </Select>
                </Field>
              )}
            </>
          )}
          <div>
            <Button variant="secondary" disabled={!master || (on === null && keys === null && primary === undefined)} onClick={() => run(() => setShareOptions(tpl.master_table_id!, { key_split: curOn, key_columns: curOn ? curKeys : split?.key_columns.map((k) => k.key) ?? [], key_primary: curOn && curKeys.length > 1 ? curPrimary : null }).then(() => { setKeys(null); setOn(null); setPrimary(undefined); }), "Đã lưu khoá phân chia")}>Lưu khoá phân chia</Button>
          </div>
        </div>
      )}
      <ErrorText error={err} />
    </section>
  );
}

function ArchiveConfirm({ tpl, onClose, onDone }: { tpl: Template; onClose: () => void; onDone: () => Promise<void> }) {
  const m = useMutation({ mutationFn: () => archiveTemplate(tpl.id), onSuccess: async () => { await onDone(); notify.ok(`Đã lưu trữ "${tpl.name}". Dữ liệu giữ nguyên, khôi phục được.`); onClose(); } });
  return (
    <>
      <ConfirmDialog title="Lưu trữ bảng template?" message={<>Bảng "{tpl.name}" sẽ ẩn khỏi {tpl.members} người. Dữ liệu và lịch sử giữ nguyên, bạn khôi phục được.</>} confirmLabel="Lưu trữ" busy={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />
      {m.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={m.error} /></div>}
    </>
  );
}

/** Step 1 (add): which layer and who sees it, with the preview "Áp dụng cho N người". Step 2: the shared column editor, which asks once more before the first write. */
function ColumnFlow({ tpl, d, master, column, onClose, onSaved }: { tpl: Template; d: TemplateDetail; master: TableDetail; column?: Column; onClose: () => void; onSaved: () => Promise<void> }) {
  const meQ = useMe();
  const meId = meQ.data?.user.id;
  const leaderOnly = !tpl.can_edit;
  const [step, setStep] = useState<"layer" | "editor">(column ? "editor" : "layer");
  const [layer, setLayer] = useState<"basic" | "role" | "team">(column ? (column.layer as "basic" | "role" | "team") : leaderOnly ? "team" : "basic");
  const [roles, setRoles] = useState<string[]>(column?.layer_roles ?? ["user"]);
  const [storage, setStorage] = useState<"shared" | "person">(column?.storage ?? "shared");
  const [role, setRole] = useState("");
  // "Gửi xuống": the system fills this column from an attribute of the people in a Người dùng column of the same row (module4 4.5).
  const [fillCol, setFillCol] = useState("");
  const [fillAttr, setFillAttr] = useState("");
  const [fillSum, setFillSum] = useState<"" | "team" | "tree">("");
  const sources = master.columns.filter((c) => c.type === "user" && attrsOf(c).length > 0);
  const fillSrc = sources.find((c) => c.key === fillCol);
  const fillAttrs = fillSrc ? attrsOf(fillSrc) : [];
  const leader = column?.layer_ref ?? (layer === "team" && leaderOnly ? meId : undefined);
  const impactQ = useQuery({
    queryKey: ["tpl-impact", tpl.id, layer, roles.join(","), leader ?? ""],
    queryFn: () => templateImpact(tpl.id, { layer, ...(layer === "role" ? { layer_roles: roles } : {}), ...(layer === "team" && leader ? { team_leader_id: leader } : {}) }),
    enabled: layer !== "role" || roles.length > 0,
  });
  const n = impactQ.data?.count;
  const confirmText = n === undefined ? "Thay đổi này áp dụng ngay cho mọi người trong phạm vi." : `Áp dụng cho ${n} người${impactQ.data?.names.length ? `: ${impactQ.data.names.join(", ")}${n > impactQ.data.names.length ? "…" : ""}` : ""}. Xác nhận?`;
  const key = (c?: string) => c ?? "";
  const adapter: ColumnAdapter = {
    create: (b) => createTemplateColumn(tpl.id, { ...b, layer, ...(layer === "role" ? { layer_roles: roles } : {}), ...(layer === "team" && leader ? { team_leader_id: leader } : {}), storage, ...(role ? { role } : {}), ...(storage === "person" && fillSrc && fillAttr ? { autofill: { column: fillSrc.key, attr: fillAttr, ...(fillSum ? { sum: fillSum } : {}) } } : {}) }),
    update: (k, b) => updateTemplateColumn(tpl.id, k, b),
    changeType: (k, t, c, a) => changeTemplateColumnType(tpl.id, key(k), t, c, a),
    preview: (k, t, c) => previewTypeChange(master.id, k, t, c),
    optionImpact: (k, o) => optionImpact(master.id, k, o),
    refresh: onSaved,
  };
  if (step === "layer") {
    const fitting: TemplateRole[] = d.roles.filter((r) => r.column === null);
    return (
      <Modal title="Thêm cột vào template" open onClose={onClose}>
        <div className="flex flex-col gap-4" data-testid="template-layer-step">
          <Field label="Lớp của cột" hint="Cơ bản: mọi người. Theo vai trò: chỉ người có vai trò chọn. Theo team: chỉ một team.">
            <Select aria-label="Lớp của cột" value={layer} disabled={leaderOnly} onChange={(e) => setLayer(e.target.value as "basic" | "role" | "team")}>
              {(leaderOnly ? (["team"] as const) : (["basic", "role"] as const)).map((l) => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}
              {!leaderOnly && <option value="team">{LAYER_LABEL.team} (cho team của chính tôi)</option>}
            </Select>
          </Field>
          {layer === "role" && (
            <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-sm font-medium">Hiện cho vai trò</legend>
              {(["manager", "leader", "user"] as const).map((r) => <label key={r} className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} /> {ROLE_NAMES[r]}</label>)}
            </fieldset>
          )}
          <Field label="Cách lưu giá trị" hint="Một giá trị chung mỗi dòng, hoặc mỗi người một giá trị (ghi chú riêng của từng người).">
            <Select aria-label="Cách lưu giá trị" value={storage} onChange={(e) => setStorage(e.target.value as "shared" | "person")}>
              <option value="shared">Một giá trị chung mỗi dòng</option>
              <option value="person">Mỗi người một giá trị</option>
            </Select>
          </Field>
          {storage === "person" && !column && sources.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="autofill-step">
              <Field label="Tự điền từ người tham gia (tuỳ chọn)" hint="Hệ thống điền cột này cho từng người từ thuộc tính của họ trong cột Người dùng của dòng; không ai sửa ô.">
                <Select aria-label="Cột người tham gia" value={fillCol} onChange={(e) => { setFillCol(e.target.value); setFillAttr(""); setFillSum(""); }}>
                  <option value="">Không tự điền</option>
                  {sources.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </Select>
              </Field>
              {fillSrc && (
                <>
                  <Field label="Thuộc tính">
                    <Select aria-label="Thuộc tính gửi xuống" value={fillAttr} onChange={(e) => { setFillAttr(e.target.value); setFillSum(""); }}>
                      <option value="">Chọn thuộc tính</option>
                      {fillAttrs.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </Select>
                  </Field>
                  {fillAttrs.find((a) => a.key === fillAttr)?.kind === "percent" && (
                    <Field label="Giá trị" hint="Leader và Manager có thể nhận tổng của cả team hoặc cả cây.">
                      <Select aria-label="Cách gửi xuống" value={fillSum} onChange={(e) => setFillSum(e.target.value as "" | "team" | "tree")}>
                        <option value="">Phần của chính người đó</option>
                        <option value="team">Tổng của team</option>
                        <option value="tree">Tổng của cả cây</option>
                      </Select>
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
          {fitting.length > 0 && tpl.can_edit && (
            <Field label="Vai trò của cột (tuỳ chọn)">
              <Select aria-label="Vai trò của cột" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Không có</option>
                {fitting.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </Select>
            </Field>
          )}
          <p role="status" data-testid="template-impact" className="rounded-md bg-muted px-3 py-2 text-sm">{n === undefined ? "Đang tính số người..." : `Cột này sẽ hiện cho ${n} người.`}</p>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={onClose}>Huỷ</Button>
            <Button disabled={layer === "role" && roles.length === 0} onClick={() => setStep("editor")}>Tiếp tục</Button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <ColumnEditor
      table={master}
      column={column}
      onClose={onClose}
      adapter={adapter}
      confirmText={confirmText}
      notice={<p className="rounded-md bg-muted px-3 py-2 text-sm">Cột của template, lớp <strong>{LAYER_LABEL[layer]}</strong>{n !== undefined ? `, hiện cho ${n} người` : ""}. Người nhận không sửa được cột này, chỉ thêm cột riêng của mình.</p>}
    />
  );
}

function DeleteColumn({ tpl, col, onClose, onDone }: { tpl: Template; col: Column; onClose: () => void; onDone: () => Promise<void> }) {
  const usageQ = useQuery({ queryKey: ["tpl-usage", tpl.master_table_id, col.key], queryFn: () => columnUsage(tpl.master_table_id!, col.key), enabled: !!tpl.master_table_id && tpl.can_edit });
  const u: ColumnUsage | undefined = usageQ.data;
  const m = useMutation({
    mutationFn: () => deleteTemplateColumn(tpl.id, col.key),
    onSuccess: async () => {
      await onDone();
      notify.ok(`Đã bỏ cột "${col.name}"`, { label: "Hoàn tác", onClick: () => void restoreTemplateColumn(tpl.id, col.key).then(onDone).then(() => notify.ok(`Đã khôi phục cột "${col.name}"`)).catch(() => notify.error("Không khôi phục được cột.")) });
      onClose();
    },
  });
  const used = u ? [...(u.role ? [`vai trò ${u.role.label} (${u.role.used_by.join(", ")})`] : []), ...u.formulas.map((f) => `công thức ${f.column_name} của bảng ${f.table_name}`), ...u.views.map((v) => `view ${v.view_name}`), ...u.metrics.map((x) => `chỉ số ${x.metric_name}`), ...u.dashboards.map((x) => `dashboard ${x.dashboard_name}`)] : [];
  return (
    <>
      <ConfirmDialog title="Bỏ cột khỏi template?" message={<div className="flex flex-col gap-2"><p>Cột "{col.name}" bị ẩn và lưu trữ với mọi người trong phạm vi. Dữ liệu giữ nguyên, khôi phục được.</p>{used.length > 0 && <p data-testid="usage-warning" className="rounded-md bg-warn/15 px-3 py-2">Đang được dùng bởi: {used.join("; ")}.</p>}</div>} confirmLabel="Bỏ cột" busy={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />
      {m.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={m.error} /></div>}
    </>
  );
}

/** Columns that hold a role besides this one. A role of several columns (Người tham gia) lists all of them; this column joins, nobody lets go. */
function holdersNote(d: TemplateDetail, r: TemplateRole, col: Column): string {
  const others = r.columns.filter((k) => k !== col.key).map((k) => d.columns.find((c) => c.key === k)?.name ?? k);
  if (others.length === 0) return "";
  return r.multi ? ` (đang gắn cho cột ${others.join(", ")})` : ` (đang gắn cột ${others.join(", ")})`;
}

function holderNames(d: TemplateDetail, role: string, col: Column, includeSelf: boolean): string {
  const keys = new Set(d.roles.find((r) => r.key === role)?.columns ?? []);
  if (includeSelf) keys.add(col.key);
  return d.columns.filter((c) => keys.has(c.key)).map((c) => c.name).join(", ");
}

function RoleDialog({ tpl, d, col, onClose, onDone }: { tpl: Template; d: TemplateDetail; col: Column; onClose: () => void; onDone: () => Promise<void> }) {
  const [role, setRole] = useState<string>(col.role ?? "");
  const [result, setResult] = useState<{ previous: string | null; used: string[] } | null>(null);
  const m = useMutation({
    mutationFn: () => setColumnRole(tpl.id, col.key, role || null),
    onSuccess: async (r) => {
      await onDone();
      setResult({ previous: r.previous?.name ?? null, used: r.usage.role?.used_by ?? [] });
      notify.ok(role ? "Đã gắn vai trò cho cột" : "Đã bỏ vai trò của cột");
    },
  });
  return (
    <Modal title={`Vai trò của cột "${col.name}"`} open onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Chức năng tìm cột theo vai trò, không theo tên. Vai trò thường chỉ có một cột: gắn cho cột này thì cột đang giữ nó thả ra. Vai trò nhiều cột (như Người tham gia) cho nhiều cột cùng giữ, không cột nào bị thả.</p>
        <Field label="Vai trò">
          <Select aria-label="Vai trò" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Không có vai trò</option>
            {d.roles.map((r) => <option key={r.key} value={r.key}>{r.label}{holdersNote(d, r, col)}</option>)}
          </Select>
        </Field>
        {role && <p className="text-xs text-muted-foreground">Dùng bởi: {d.roles.find((r) => r.key === role)?.used_by.join(", ")}.</p>}
        {role && d.roles.find((r) => r.key === role)?.multi && <p className="text-xs text-muted-foreground" data-testid="role-multi-note">Vai trò này có thể gắn cho nhiều cột. Hiện có: {holderNames(d, role, col, role === col.role) || "chưa có cột nào"}.</p>}
        {result && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">{result.previous ? `Cột "${result.previous}" không còn giữ vai trò này.` : "Đã lưu."}</p>}
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          <Button loading={m.isPending} disabled={role === (col.role ?? "")} onClick={() => m.mutate()}>Lưu vai trò</Button>
        </div>
      </div>
    </Modal>
  );
}
