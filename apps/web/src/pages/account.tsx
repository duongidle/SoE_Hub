import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Clock, Monitor, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/person";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ErrorText, Field, Input, Modal, Notice, PageTitle, Select, Table } from "@/components/ui/form";
import { api, fmtTime } from "@/lib/api";
import { useMe } from "@/lib/session";

export function AccountPage() {
  const me = useMe().data;
  const links = [{ to: "/tai-khoan/thong-bao", label: "Cài đặt thông báo", icon: Bell }, { to: "/nhac-hen", label: "Nhắc hẹn", icon: Clock }, { to: "/tai-khoan/token", label: "Kết nối AI", icon: Sparkles }] as const;
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
      <PageTitle>Tài khoản của tôi</PageTitle>
      {me && (
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-card p-5 shadow-sm" data-testid="account-profile">
          <Avatar name={me.user.full_name} size="md" className="!size-14 !text-lg" />
          <div className="min-w-0 flex-1 basis-60">
            <div className="text-lg font-semibold [overflow-wrap:anywhere]">{me.user.full_name}</div>
            <div className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{me.user.email}</div>
          </div>
          <div className="flex w-full flex-wrap gap-2 border-t border-border-soft pt-3">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:border-primary-border hover:bg-primary-soft"><l.icon size={14} aria-hidden />{l.label}</Link>
            ))}
          </div>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChangePassword />
        <Devices />
      </div>
    </div>
  );
}

function ChangePassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const m = useMutation({
    mutationFn: () => api<{ other_sessions_revoked: number }>("POST", "/auth/password", { current_password: cur, new_password: next }),
    onSuccess: () => {
      setCur("");
      setNext("");
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Đổi mật khẩu</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label="Mật khẩu hiện tại">
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </Field>
          <Field label="Mật khẩu mới" hint="Tối thiểu 6 ký tự. Đổi xong, các thiết bị khác bị đăng xuất.">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <ErrorText error={m.error} />
          {m.data && <Notice>Đã đổi mật khẩu. {m.data.other_sessions_revoked} thiết bị khác đã bị đăng xuất.</Notice>}
          <Button type="submit" disabled={m.isPending}>
            Đổi mật khẩu
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  method: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

function Devices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("GET", "/auth/sessions") });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thiết bị đang đăng nhập</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <ErrorText error={q.error ?? revoke.error} />
        {q.data?.map((s) => (
          <div key={s.id} className="flex items-start justify-between gap-2 border-t border-border-soft pt-2">
            <Monitor size={18} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.user_agent ?? "Không rõ thiết bị"}</div>
              <div className="text-xs text-muted-foreground">
                IP {s.ip ?? "—"} · đăng nhập {fmtTime(s.created_at)} · dùng gần nhất {fmtTime(s.last_seen_at)}
              </div>
            </div>
            {s.current ? (
              <Badge tone="ok">Thiết bị này</Badge>
            ) : (
              <Button variant="secondary" onClick={() => revoke.mutate(s.id)}>
                Đăng xuất
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export interface TokenRow {
  id: string;
  user_name: string | null;
  user_email: string | null;
  kind: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  menus: Record<string, string>;
  status: "pending" | "active" | "rejected" | "revoked";
  expires_at: string;
  created_at: string;
  decided_by_name: string | null;
  decision_note: string | null;
  last_used_at: string | null;
}

export const TOKEN_STATUS: Record<TokenRow["status"], { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  active: { label: "Đang dùng", tone: "ok" },
  rejected: { label: "Bị từ chối", tone: "bad" },
  revoked: { label: "Đã thu hồi", tone: "muted" },
};

/** Menus a person can pick for a connection: only those with a module today (design module5 12). */
export const CONNECTION_MENUS = [
  { key: "deal", label: "Quản lý Deal", def: "write" },
  { key: "datahub", label: "Datahub", def: "write" },
  { key: "notify", label: "Thông báo và nhắc hẹn", def: "write" },
] as const;
export const LEVELS = [
  { key: "read", label: "Xem" },
  { key: "write", label: "Sửa" },
  { key: "full", label: "Toàn quyền" },
] as const;
type Level = (typeof LEVELS)[number]["key"];
const MENU_NAME: Record<string, string> = { deal: "Quản lý Deal", datahub: "Datahub", notify: "Thông báo", form: "Form", knowledge: "Knowledge", aihub: "AI Hub", workspace: "Workspace", onboarding: "Onboarding", feedback: "Feedback", admin: "Quản trị" };
const LEVEL_NAME: Record<string, string> = { read: "Xem", write: "Sửa", full: "Toàn quyền" };
export const menusText = (m: Record<string, string> | undefined) => Object.entries(m ?? {}).map(([k, v]) => `${MENU_NAME[k] ?? k}: ${LEVEL_NAME[v] ?? v}`).join(", ");

/** Ready-to-paste install commands for a new token. `origin` is this site; the token is shown once. */
export function installCommands(origin: string, token: string) {
  return {
    "Claude Code": `claude mcp add --transport http soe ${origin}/mcp --header "Authorization: Bearer ${token}"`,
    Codex: `# ~/.codex/config.toml\n[mcp_servers.soe]\nurl = "${origin}/mcp"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
    REST: `curl -H "Authorization: Bearer ${token}" ${origin}/api/v1/datahubs`,
  } as Record<string, string>;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs font-medium">
        {label}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
          }}
        >
          {done ? "Đã sao chép" : "Sao chép"}
        </Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs" data-testid={`cmd-${label}`}>
        {text}
      </pre>
    </div>
  );
}

export function TokensPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tokens"], queryFn: () => api<TokenRow[]>("GET", "/auth/tokens") });
  const [name, setName] = useState("");
  const [menus, setMenus] = useState<Record<string, Level>>(() => Object.fromEntries(CONNECTION_MENUS.map((m) => [m.key, m.def])));
  const [days, setDays] = useState(90);
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("POST", "/auth/tokens", { name, menus, expires_in_days: days }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/auth/tokens/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }) });
  const [narrowing, setNarrowing] = useState<TokenRow | null>(null);
  const narrow = useMutation({
    mutationFn: (v: { id: string; menus: Record<string, string> }) => api("PATCH", `/auth/tokens/${v.id}`, { menus: v.menus }),
    onSuccess: () => {
      setNarrowing(null);
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const chosen = Object.keys(menus).length;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Kết nối AI</PageTitle>
      <p className="text-sm text-muted-foreground">
        Dùng cho Claude Code, Codex, script. Chọn menu và mức cho kết nối; token chỉ hiện một lần lúc tạo và phải được Admin duyệt mới dùng được. Kết nối không bao giờ rộng hơn quyền của bạn.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Tạo kết nối</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tên kết nối">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Claude Code máy công ty" required />
              </Field>
              <Field label="Hạn dùng (ngày)" hint="Mặc định 90, tối đa 365.">
                <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </Field>
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">Menu và mức</legend>
              <div className="flex flex-col gap-1">
                {CONNECTION_MENUS.map((m) => (
                  <div key={m.key} className="flex items-center gap-2">
                    <label className="flex w-64 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={m.key in menus}
                        onChange={() =>
                          setMenus((cur) => {
                            const { [m.key]: _drop, ...rest } = cur;
                            return m.key in cur ? rest : { ...cur, [m.key]: m.def };
                          })
                        }
                      />
                      {m.label}
                    </label>
                    <Select aria-label={`Mức ${m.label}`} disabled={!(m.key in menus)} value={menus[m.key] ?? m.def} onChange={(e) => setMenus((cur) => ({ ...cur, [m.key]: e.target.value as Level }))}>
                      {LEVELS.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </fieldset>
            <ErrorText error={create.error} />
            {create.data && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm" role="status">
                <div className="flex flex-col gap-2" data-testid="new-connection">
                  <div>
                    Token mới (chỉ hiện một lần, hãy lưu lại ngay): <code className="break-all font-mono">{create.data.token}</code>. Kết nối đang chờ Admin duyệt; dán lệnh dưới đây vào máy của bạn.
                  </div>
                  {Object.entries(installCommands(window.location.origin, create.data.token)).map(([k, v]) => (
                    <CopyBlock key={k} label={k} text={v} />
                  ))}
                </div>
              </div>
            )}
            <Button type="submit" disabled={create.isPending || chosen === 0}>
              Tạo kết nối
            </Button>
          </form>
        </CardContent>
      </Card>
      <TokenTable
        rows={q.data ?? []}
        onRevoke={(id) => revoke.mutate(id)}
        actions={(t) =>
          t.status === "active" || t.status === "pending" ? (
            <Button variant="ghost" onClick={() => setNarrowing(t)}>
              Thu hẹp
            </Button>
          ) : null
        }
      />
      {narrowing && <NarrowForm row={narrowing} busy={narrow.isPending} error={narrow.error} onClose={() => setNarrowing(null)} onSave={(m) => narrow.mutate({ id: narrowing.id, menus: m })} />}
      <ErrorText error={q.error ?? revoke.error} />
    </div>
  );
}

/** Narrow a connection: drop menus or lower levels only (widening means a new connection). */
export function NarrowForm({ row, busy, error, onClose, onSave }: { row: TokenRow; busy: boolean; error: unknown; onClose: () => void; onSave: (m: Record<string, string>) => void }) {
  const [m, setM] = useState<Record<string, string>>({ ...row.menus });
  const rank = (l: string) => LEVELS.findIndex((x) => x.key === l);
  return (
    <Modal title={`Thu hẹp "${row.name}"`} open onClose={onClose}>
      <div className="flex flex-col gap-2 text-sm">
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
              {MENU_NAME[k] ?? k}
            </label>
            <Select aria-label={`Mức ${MENU_NAME[k] ?? k}`} disabled={!(k in m)} value={m[k] ?? held} onChange={(e) => setM((cur) => ({ ...cur, [k]: e.target.value }))}>
              {LEVELS.filter((l) => rank(l.key) <= rank(held)).map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={busy || Object.keys(m).length === 0} onClick={() => onSave(m)}>
            Lưu
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function TokenTable({ rows, onRevoke, owner, actions }: { rows: TokenRow[]; onRevoke?: (id: string) => void; owner?: boolean; actions?: (t: TokenRow) => React.ReactNode }) {
  return (
    <Table>
      <thead>
        <tr>
          {owner && <th>Người dùng</th>}
          <th>Tên</th>
          <th>Token</th>
          <th>Menu và mức</th>
          <th>Trạng thái</th>
          <th>Hết hạn</th>
          <th>Dùng gần nhất</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            {owner && (
              <td>
                {t.user_name}
                <div className="text-xs text-muted-foreground">{t.user_email}</div>
              </td>
            )}
            <td>{t.name}</td>
            <td className="font-mono text-xs">{t.token_prefix}</td>
            <td className="max-w-xs whitespace-normal text-xs">{Object.keys(t.menus ?? {}).length ? menusText(t.menus) : t.scopes.join(", ")}</td>
            <td>
              <Badge tone={TOKEN_STATUS[t.status].tone}>{TOKEN_STATUS[t.status].label}</Badge>
              {t.decision_note && <div className="text-xs text-muted-foreground">{t.decision_note}</div>}
            </td>
            <td>{fmtTime(t.expires_at)}</td>
            <td>{fmtTime(t.last_used_at)}</td>
            <td className="whitespace-nowrap">
              {actions?.(t)}
              {onRevoke && (t.status === "active" || t.status === "pending") && (
                <Button variant="ghost" onClick={() => onRevoke(t.id)}>
                  Thu hồi
                </Button>
              )}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={8} className="text-muted-foreground">
              Chưa có token.
            </td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}
