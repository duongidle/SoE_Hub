import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Menu, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/form";
import { api } from "@/lib/api";
import { can, useLiveUpdates, useMe } from "@/lib/session";
import { BellButton } from "./notify/inbox";

const PUBLIC_PATHS = ["/dang-nhap", "/dang-ky", "/quen-mat-khau"];

/** Menu items. A user sees an item only when the permission list returned by the API contains its permission. */
const NAV: { to: string; label: string; permission: string | null; dealOnly?: boolean; guestOnly?: boolean }[] = [
  { to: "/", label: "Tổng quan", permission: null },
  { to: "/datahub", label: "Datahub", permission: "datahub:datahub:use" },
  { to: "/du-lieu-duoc-cap", label: "Dữ liệu được cấp", permission: "datahub:datahub:use", guestOnly: true },
  { to: "/quan-ly-deal", label: "Quản lý Deal", permission: "datahub:datahub:use", dealOnly: true },
  { to: "/form", label: "Form", permission: "form:form:create" },
  { to: "/knowledge", label: "Knowledge", permission: "knowledge:article:read" },
  { to: "/ai-hub", label: "AI Hub", permission: "aihub:skill:read" },
  { to: "/duyet", label: "Duyệt bài", permission: "knowledge:article:review|aihub:skill:review" },
  { to: "/dashboard", label: "Dashboard chia sẻ", permission: null },
  { to: "/nhac-hen", label: "Nhắc hẹn", permission: "notification:manage" },
  { to: "/thong-bao-chung", label: "Thông báo chung", permission: "notification:announce" },
  { to: "/to-chuc", label: "Org chart", permission: "org:member:read" },
  { to: "/cap-du-lieu", label: "Cấp dữ liệu Guest", permission: "guest:grant:manage" },
  { to: "/quan-tri/token", label: "Kết nối AI", permission: "auth:token:approve" },
  { to: "/quan-tri/tai-khoan-he-thong", label: "Tài khoản hệ thống", permission: "auth:service_account:manage" },
  { to: "/quan-tri/nhat-ky", label: "Nhật ký", permission: "system:audit:read" },
  { to: "/quan-tri/chuyen-giao", label: "Chuyển giao", permission: "data:transfer" },
  { to: "/quan-tri/datahub-gioi-han", label: "Giới hạn Datahub", permission: "system:setting:write" },
  { to: "/quan-tri/cai-dat", label: "Cài đặt hệ thống", permission: "system:setting:write" },
  { to: "/quan-tri/template-deal", label: "Template Quản lý Deal", permission: "system:setting:write" },
];

/** Pages that need a permission when opened by URL (same permissions the API checks). */
const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  { prefix: "/quan-ly-deal/template", permission: "datahub:template:write" },
  { prefix: "/quan-ly-deal", permission: "datahub:datahub:use" },
  { prefix: "/du-lieu-duoc-cap", permission: "datahub:datahub:use" },
  { prefix: "/datahub", permission: "datahub:datahub:use" },
  { prefix: "/form/cham-bai", permission: "form:form:create" },
  { prefix: "/form/bai-lam", permission: "form:response:submit" },
  { prefix: "/form", permission: "form:form:create" },
  { prefix: "/knowledge/soan", permission: "knowledge:article:post" },
  { prefix: "/knowledge", permission: "knowledge:article:read" },
  { prefix: "/ai-hub/tai-len", permission: "aihub:skill:post" },
  { prefix: "/ai-hub", permission: "aihub:skill:read" },
  { prefix: "/duyet", permission: "knowledge:article:review|aihub:skill:review" },
  { prefix: "/to-chuc", permission: "org:member:read" },
  { prefix: "/cap-du-lieu", permission: "guest:grant:manage" },
  { prefix: "/quan-tri/token", permission: "auth:token:approve" },
  { prefix: "/quan-tri/tai-khoan-he-thong", permission: "auth:service_account:manage" },
  { prefix: "/quan-tri/nhat-ky", permission: "system:audit:read" },
  { prefix: "/quan-tri/chuyen-giao", permission: "data:transfer" },
  { prefix: "/quan-tri/datahub-gioi-han", permission: "system:setting:write" },
  { prefix: "/quan-tri/cai-dat", permission: "system:setting:write" },
  { prefix: "/quan-tri/template-deal", permission: "system:setting:write" },
];

/** "a|b" means any one of the permissions. */
const canAny = (me: Parameters<typeof can>[0], permission: string) => permission.split("|").some((p) => can(me, p));
const isPublic = (path: string) => PUBLIC_PATHS.includes(path);
const requiredPermission = (path: string) => ROUTE_PERMISSIONS.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))?.permission ?? null;

export function Shell() {
  const location = useRouterState({ select: (s) => s.location });
  const path = location.pathname;
  // During a navigation the router still renders the previous page for a moment. Gate on the page actually shown,
  // so a protected page never mounts (and fetches) for someone who may not see it.
  const shown = useRouterState({ select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname });
  const nav = useNavigate();
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data;
  // The phone menu closes by itself when the page changes: it is "open" only for the path it was opened on.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  useLiveUpdates(!!me);

  useEffect(() => {
  if (meQ.isLoading || path.startsWith("/f/")) return;
    if (!me) {
      if (!isPublic(path)) void nav({ href: `/dang-nhap?next=${encodeURIComponent(path + location.searchStr)}`, replace: true });
    } else if (me.must_set_password) {
      if (path !== "/dat-mat-khau") void nav({ to: "/dat-mat-khau", replace: true });
    } else if (isPublic(path) || path === "/dat-mat-khau") {
      void nav({ to: "/", replace: true });
    }
  }, [me, meQ.isLoading, path, location.searchStr, nav]);

  // The page of a person filling a form stands alone, with or without a login.
  if (path.startsWith("/f/") && shown.startsWith("/f/")) return <div className="min-h-dvh bg-muted/30 px-3 py-3"><Outlet /></div>;
  if (meQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  if (meQ.error) return <p className="p-6 text-sm text-bad" role="alert">Không kết nối được máy chủ. Hãy tải lại trang sau ít phút.</p>;

  // Signed out: only the public pages render. Everything else waits for the redirect above.
  if (!me) {
    return (
      <div className="min-h-dvh px-4 py-6">
        <div className="mx-auto mb-2 max-w-md text-center text-lg font-semibold text-primary">SoE Hub</div>
        {isPublic(path) && isPublic(shown) ? <Outlet /> : null}
      </div>
    );
  }
  if (me.must_set_password) {
    return (
      <div className="min-h-dvh px-4 py-6">
        <div className="mx-auto mb-2 max-w-md text-center text-lg font-semibold text-primary">SoE Hub</div>
        {path === "/dat-mat-khau" && shown === "/dat-mat-khau" ? <Outlet /> : null}
      </div>
    );
  }

  // "Quản lý Deal" is for people who have the datahub (Manager, Leader, User); Admin and Guest have none (Module 4 mục 1.1).
  const hasDeal = me.user.roles.some((r) => ["manager", "leader", "user"].includes(r));
  const items = NAV.filter((n) => (!n.permission || canAny(me, n.permission)) && (!n.dealOnly || hasDeal) && (!n.guestOnly || me.user.roles.includes("guest")));
  const needed = requiredPermission(shown);
  const denied = needed !== null && !canAny(me, needed);
  const logout = async () => {
    try {
      await api("POST", "/auth/logout");
    } finally {
      // Hide the signed-in pages first, then drop their cached data, so no page refetches with a dead session.
      qc.setQueryData(["me"], null);
      await nav({ to: "/dang-nhap", replace: true });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    }
  };

  // An open table fills the window (the grid scrolls inside it); other pages are a centered column.
  const wide = shown.startsWith("/datahub/") || shown.startsWith("/du-lieu-duoc-cap/") || (shown.startsWith("/quan-ly-deal") && shown !== "/quan-ly-deal/template");
  return (
    <div className={wide ? "flex h-dvh flex-col" : "min-h-dvh"}>
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-md">
        Bỏ qua, tới nội dung
      </a>
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
      <main id="noi-dung" tabIndex={-1} className={wide ? "mx-auto flex min-h-0 w-full flex-1 flex-col px-4 py-3 sm:px-6" : "mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"}>{denied ? <Forbidden /> : <Outlet />}</main>
    </div>
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
