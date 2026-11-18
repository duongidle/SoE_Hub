import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, LogOut, Menu, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/form";
import { api } from "@/lib/api";
import { can, useLiveUpdates, useMe, type Me } from "@/lib/session";

const PUBLIC_PATHS = ["/dang-nhap", "/dang-ky", "/quen-mat-khau"];

/** Menu items. A user sees an item only when the permission list returned by the API contains its permission. */
const NAV: { to: string; label: string; permission: string | null }[] = [
  { to: "/", label: "Tổng quan", permission: null },
  { to: "/to-chuc", label: "Org chart", permission: "org:member:read" },
  { to: "/cap-du-lieu", label: "Cấp dữ liệu Guest", permission: "guest:grant:manage" },
  { to: "/quan-tri/token", label: "Duyệt token", permission: "auth:token:approve" },
  { to: "/quan-tri/tai-khoan-he-thong", label: "Tài khoản hệ thống", permission: "auth:service_account:manage" },
  { to: "/quan-tri/nhat-ky", label: "Nhật ký", permission: "system:audit:read" },
  { to: "/quan-tri/chuyen-giao", label: "Chuyển giao", permission: "data:transfer" },
  { to: "/quan-tri/cai-dat", label: "Cài đặt hệ thống", permission: "system:setting:write" },
];

/** Pages that need a permission when opened by URL (same permissions the API checks). */
const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  { prefix: "/to-chuc", permission: "org:member:read" },
  { prefix: "/cap-du-lieu", permission: "guest:grant:manage" },
  { prefix: "/quan-tri/token", permission: "auth:token:approve" },
  { prefix: "/quan-tri/tai-khoan-he-thong", permission: "auth:service_account:manage" },
  { prefix: "/quan-tri/nhat-ky", permission: "system:audit:read" },
  { prefix: "/quan-tri/chuyen-giao", permission: "data:transfer" },
  { prefix: "/quan-tri/cai-dat", permission: "system:setting:write" },
];

const isPublic = (path: string) => PUBLIC_PATHS.includes(path);
const requiredPermission = (path: string) => ROUTE_PERMISSIONS.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))?.permission ?? null;

export function Shell() {
  const location = useRouterState({ select: (s) => s.location });
  const path = location.pathname;
  const nav = useNavigate();
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data;
  // The phone menu closes by itself when the page changes: it is "open" only for the path it was opened on.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  useLiveUpdates(!!me);

  useEffect(() => {
    if (meQ.isLoading) return;
    if (!me) {
      if (!isPublic(path)) void nav({ href: `/dang-nhap?next=${encodeURIComponent(path + location.searchStr)}`, replace: true });
    } else if (me.must_set_password) {
      if (path !== "/dat-mat-khau") void nav({ to: "/dat-mat-khau", replace: true });
    } else if (isPublic(path) || path === "/dat-mat-khau") {
      void nav({ to: "/", replace: true });
    }
  }, [me, meQ.isLoading, path, location.searchStr, nav]);

  if (meQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  if (meQ.error) return <p className="p-6 text-sm text-bad" role="alert">Không kết nối được máy chủ. Hãy tải lại trang sau ít phút.</p>;

  // Signed out: only the public pages render. Everything else waits for the redirect above.
  if (!me) {
    return (
      <div className="min-h-screen px-4 py-6">
        <div className="mx-auto mb-2 max-w-md text-center text-lg font-semibold text-primary">SoE Hub</div>
        {isPublic(path) ? <Outlet /> : null}
      </div>
    );
  }
  if (me.must_set_password) {
    return (
      <div className="min-h-screen px-4 py-6">
        <div className="mx-auto mb-2 max-w-md text-center text-lg font-semibold text-primary">SoE Hub</div>
        {path === "/dat-mat-khau" ? <Outlet /> : null}
      </div>
    );
  }

  const items = NAV.filter((n) => !n.permission || can(me, n.permission));
  const needed = requiredPermission(path);
  const denied = needed !== null && !can(me, needed);
  const logout = async () => {
    try {
      await api("POST", "/auth/logout");
    } finally {
      qc.clear();
      qc.setQueryData(["me"], null);
      void nav({ to: "/dang-nhap", replace: true });
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
          <Link to="/" className="text-lg font-semibold text-primary">SoE Hub</Link>
          <nav aria-label="Menu chính" className="ml-4 hidden flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground lg:flex">
            {items.map((n) => (
              <Link key={n.to} to={n.to} className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <BellButton me={me} />
            <Link to="/tai-khoan" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-muted" aria-label="Tài khoản của tôi">
              <UserRound size={18} />
              <span className="hidden max-w-32 truncate sm:inline">{me.user.full_name}</span>
            </Link>
            <Button variant="ghost" onClick={logout} aria-label="Đăng xuất">
              <LogOut size={18} />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
            <Button variant="ghost" className="lg:hidden" aria-label="Mở menu" aria-expanded={open} onClick={() => setOpenPath(open ? null : path)}>
              <Menu size={20} />
            </Button>
          </div>
        </div>
        {open && (
          <nav aria-label="Menu điện thoại" className="flex flex-col border-t border-border px-4 py-2 text-sm lg:hidden">
            {items.map((n) => (
              <Link key={n.to} to={n.to} className="py-2 text-muted-foreground [&.active]:font-medium [&.active]:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{denied ? <Forbidden /> : <Outlet />}</main>
    </div>
  );
}

function BellButton({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ["unread"], queryFn: () => api<{ unread: number }>("GET", "/notifications/unread-count"), enabled: can(me, "notification:read") });
  const n = q.data?.unread ?? 0;
  return (
    <Link to="/thong-bao" aria-label={`Thông báo, ${n} chưa đọc`} className="relative inline-flex min-h-9 min-w-9 items-center justify-center rounded-md hover:bg-muted">
      <Bell size={18} />
      {n > 0 && (
        <span data-testid="bell-count" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}

export function Forbidden() {
  return (
    <div className="mx-auto mt-10 max-w-md text-center" role="alert">
      <h1 className="text-xl font-semibold">Không có quyền</h1>
      <p className="mt-2 text-sm text-muted-foreground">Tài khoản của bạn không được mở trang này. Nếu cần, hãy liên hệ quản lý hoặc Admin.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary underline">
        Về trang chủ
      </Link>
    </div>
  );
}
