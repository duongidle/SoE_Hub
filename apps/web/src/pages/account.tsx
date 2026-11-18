import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PERMISSIONS, isTokenAllowedPermission, type Permission } from "@soe/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ErrorText, Field, Input, Notice, PageTitle, Table } from "@/components/ui/form";
import { api, apiList, fmtTime, qs } from "@/lib/api";
import { useMe } from "@/lib/session";

export function AccountPage() {
  const me = useMe().data;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Tài khoản của tôi</PageTitle>
      {me && (
        <Card>
          <CardContent className="pt-5 text-sm">
            <div className="font-medium">{me.user.full_name}</div>
            <div className="text-muted-foreground">{me.user.email}</div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
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
          <div key={s.id} className="flex items-start justify-between gap-2 border-t border-border pt-2">
            <div className="min-w-0">
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

const permLabel = (p: string) => PERMISSIONS[p as Permission] ?? p;

export function TokensPage() {
  const qc = useQueryClient();
  const me = useMe().data;
  const q = useQuery({ queryKey: ["tokens"], queryFn: () => api<TokenRow[]>("GET", "/auth/tokens") });
  const available = (me?.permissions ?? []).filter(isTokenAllowedPermission);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("POST", "/auth/tokens", { name, scopes, expires_in_days: days }),
    onSuccess: () => {
      setName("");
      setScopes([]);
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/auth/tokens/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }) });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Token cá nhân</PageTitle>
      <p className="text-sm text-muted-foreground">
        Dùng cho Claude Code, Codex, script. Token chỉ hiện một lần lúc tạo và phải được Admin duyệt mới dùng được. Gửi kèm header <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Tạo token</CardTitle>
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
              <Field label="Tên token">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Claude Code máy công ty" required />
              </Field>
              <Field label="Hạn dùng (ngày)" hint="Mặc định 90, tối đa 365.">
                <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </Field>
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">Scope (không rộng hơn quyền của bạn)</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {available.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="checkbox" checked={scopes.includes(p)} onChange={() => setScopes((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))} />
                    <span>
                      {permLabel(p)} <span className="text-xs text-muted-foreground">({p})</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorText error={create.error} />
            {create.data && (
              <Notice>
                Token mới (chỉ hiện một lần, hãy lưu lại ngay): <code className="break-all font-mono">{create.data.token}</code>. Token đang chờ Admin duyệt.
              </Notice>
            )}
            <Button type="submit" disabled={create.isPending || scopes.length === 0}>
              Tạo token
            </Button>
          </form>
        </CardContent>
      </Card>
      <TokenTable rows={q.data ?? []} onRevoke={(id) => revoke.mutate(id)} />
      <ErrorText error={q.error ?? revoke.error} />
    </div>
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
          <th>Scope</th>
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
            <td className="max-w-xs whitespace-normal text-xs">{t.scopes.join(", ")}</td>
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

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { code?: string };
  read_at: string | null;
  created_at: string;
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({ queryKey: ["notifications", unreadOnly], queryFn: () => apiList<NotificationRow>(`/notifications${qs({ limit: 100, unread_only: unreadOnly })}`) });
  const mark = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api("POST", "/notifications/read", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    },
  });
  return (
    <div>
      <PageTitle
        actions={
          <>
            <Button variant="secondary" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? "Xem tất cả" : "Chỉ chưa đọc"}
            </Button>
            <Button variant="secondary" onClick={() => mark.mutate({ all: true })}>
              Đánh dấu đã đọc hết
            </Button>
          </>
        }
      >
        Thông báo
      </PageTitle>
      <ErrorText error={q.error ?? mark.error} />
      <div className="flex flex-col gap-2">
        {q.data?.data.map((n) => (
          <div key={n.id} className={`rounded-lg border border-border p-3 text-sm ${n.read_at ? "bg-card" : "bg-primary/5"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{n.title}</div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtTime(n.created_at)}</span>
            </div>
            <p className="mt-1">{n.body}</p>
            {n.data.code && <p className="mt-1 font-mono text-lg tracking-widest">{n.data.code}</p>}
            {!n.read_at && (
              <Button variant="ghost" className="mt-1" onClick={() => mark.mutate({ ids: [n.id] })}>
                Đánh dấu đã đọc
              </Button>
            )}
          </div>
        ))}
        {q.data?.data.length === 0 && <p className="text-sm text-muted-foreground">Không có thông báo.</p>}
      </div>
    </div>
  );
}
