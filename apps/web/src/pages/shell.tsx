import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Briefcase, ChartColumn, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardCheck, Database, FileText, FolderInput, LayoutDashboard, LogOut, Menu, Network, Settings, Sparkles, UserCheck, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Brand, BRAND_NAME } from "@/components/brand";
import { Button } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { can, useLiveUpdates, useMe } from "@/lib/session";
import { useSearchHotkey } from "@/lib/search-hotkey";
import { BellButton } from "./notify/inbox";
import { SettingsLayout } from "./settings";

const PUBLIC_PATHS = ["/dang-nhap", "/dang-ky", "/quen-mat-khau"];

type NavItem = { to: string; label: string; icon: LucideIcon; permission: string | null; dealOnly?: boolean; guestOnly?: boolean; onboarding?: boolean };

/** Menu items. A user sees an item only when the permission list returned by the API contains its permission. */
const NAV: NavItem[] = [
  { to: "/", label: "Tổng quan", icon: LayoutDashboard, permission: null },
  { to: "/datahub", label: "Datahub", icon: Database, permission: "datahub:datahub:use" },
  { to: "/du-lieu-duoc-cap", label: "Dữ liệu được cấp", icon: FolderInput, permission: "datahub:datahub:use", guestOnly: true },
  { to: "/quan-ly-deal", label: "Quản lý Deal", icon: Briefcase, permission: "datahub:datahub:use", dealOnly: true },
  { to: "/form", label: "Dynamic Form", icon: FileText, permission: "form:form:create" },
  { to: "/onboarding", label: "Onboarding", icon: UserCheck, permission: "onboarding:path:read", onboarding: true },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, permission: "knowledge:article:read" },
  { to: "/ai-hub", label: "AI Hub", icon: Sparkles, permission: "aihub:skill:read" },
  { to: "/duyet", label: "Duyệt bài", icon: ClipboardCheck, permission: "knowledge:article:review|aihub:skill:review" },
  { to: "/dashboard", label: "Dashboard chia sẻ", icon: ChartColumn, permission: null },
  { to: "/to-chuc", label: "Org chart", icon: Network, permission: "org:member:read" },
];

/** Admin pages. Not in the sidebar: they are listed on the Cài đặt page (/cai-dat), by permission. */
export const SETTINGS_LINKS: { to: string; label: string; hint: string; permission: string | null }[] = [
  { to: "/tai-khoan", label: "Tài khoản của tôi", hint: "Mật khẩu, thiết bị, token cá nhân", permission: null },
  { to: "/tai-khoan/thong-bao", label: "Cài đặt thông báo", hint: "Kênh nhận và giờ yên tĩnh", permission: null },
  { to: "/cap-du-lieu", label: "Cấp dữ liệu Guest", hint: "Cho Guest xem dữ liệu được chọn", permission: "guest:grant:manage" },
  { to: "/quan-tri/token", label: "Kết nối AI", hint: "Duyệt kết nối AI và token", permission: "auth:token:approve" },
  { to: "/quan-tri/tai-khoan-he-thong", label: "Tài khoản hệ thống", hint: "Tài khoản dịch vụ và key API", permission: "auth:service_account:manage" },
  { to: "/quan-tri/nhat-ky", label: "Nhật ký", hint: "Nhật ký thao tác của Admin", permission: "system:audit:read" },
  { to: "/quan-tri/chuyen-giao", label: "Chuyển giao", hint: "Chuyển dữ liệu của một người sang người khác", permission: "data:transfer" },
  { to: "/quan-tri/datahub-gioi-han", label: "Giới hạn Datahub", hint: "Giới hạn dòng, cột, dung lượng", permission: "system:setting:write" },
  { to: "/quan-tri/cai-dat", label: "Cài đặt hệ thống", hint: "Thiết lập chung của hệ thống", permission: "system:setting:write" },
  { to: "/quan-tri/template-deal", label: "Template Quản lý Deal", hint: "Mặc định của bảng Deals", permission: "system:setting:write" },
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
  { prefix: "/onboarding", permission: "onboarding:path:read" },
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
export const canAny = (me: Parameters<typeof can>[0], permission: string) => permission.split("|").some((p) => can(me, p));
const isPublic = (path: string) => PUBLIC_PATHS.includes(path);
const requiredPermission = (path: string) => ROUTE_PERMISSIONS.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))?.permission ?? null;

/** The settings entry a path belongs to (longest match), or null. `/tai-khoan/*` (tokens, notification settings) belongs to Cài đặt too. */
export function settingsLinkFor(path: string) {
  const hit = SETTINGS_LINKS.filter((s) => path === s.to || path.startsWith(`${s.to}/`)).sort((x, y) => y.to.length - x.to.length)[0];
  return hit ?? null;
}
export const isSettingsPath = (path: string) => path === "/cai-dat" || settingsLinkFor(path) !== null;

/** Breadcrumb from the path: the menu item it belongs to (longest prefix), under "Cài đặt" for settings pages. */
function crumbs(path: string): string[] {
  if (path === "/cai-dat") return ["Cài đặt"];
  const setting = settingsLinkFor(path);
  if (setting) return ["Cài đặt", setting.label];
  const item = NAV.filter((n) => (n.to === "/" ? path === "/" : path === n.to || path.startsWith(`${n.to}/`))).sort((x, y) => y.to.length - x.to.length)[0];
  if (item) return [item.label];
  if (path === "/nhac-hen") return ["Thông báo", "Nhắc hẹn"];
  if (path === "/thong-bao-chung") return ["Thông báo", "Thông báo chung"];
  if (path.startsWith("/thong-bao")) return ["Thông báo"];
  return [BRAND_NAME];
}

const SIDEBAR_KEY = "soe.sidebar.collapsed";
const readCollapsed = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
};

const linkBase = "relative flex min-h-10 items-center gap-3 rounded-control px-3 text-sm text-muted-foreground transition-colors hover:bg-primary-soft hover:text-foreground";
const linkActive = "[&.active]:bg-primary-soft [&.active]:font-semibold [&.active]:text-primary [&.active]:before:absolute [&.active]:before:-left-3 [&.active]:before:top-2 [&.active]:before:bottom-2 [&.active]:before:w-[3px] [&.active]:before:rounded-full [&.active]:before:bg-primary [&.active]:before:content-['']";

/** The menu list; the sidebar on a wide screen and the drawer on a narrow one use the same markup. */
function SideNav({ items, collapsed, label, onLogout, settingsActive }: { items: NavItem[]; collapsed: boolean; label: string; onLogout?: () => void; settingsActive?: boolean }) {
  const text = collapsed ? "sr-only" : "truncate";
  return (
    <nav aria-label={label} className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="contain-scroll-y flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {items.map((n) => (
          <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }} title={collapsed ? n.label : undefined} className={cn(linkBase, linkActive, collapsed && "justify-center px-0")}>
            <n.icon size={18} aria-hidden className="shrink-0" />
            <span className={text}>{n.label}</span>
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-0.5 border-t border-border-soft pt-2">
        <Link to="/cai-dat" title={collapsed ? "Cài đặt" : undefined} className={cn(linkBase, linkActive, settingsActive && "active", collapsed && "justify-center px-0")}>
          <Settings size={18} aria-hidden className="shrink-0" />
          <span className={text}>Cài đặt</span>
        </Link>
        {onLogout && (
          <button type="button" onClick={onLogout} aria-label="Đăng xuất" title={collapsed ? "Đăng xuất" : undefined} className={cn(linkBase, "cursor-pointer", collapsed && "justify-center px-0")}>
            <LogOut size={18} aria-hidden className="shrink-0" />
            <span className={text}>Đăng xuất</span>
          </button>
        )}
      </div>
    </nav>
  );
}

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
  const [closing, setClosing] = useState(false);
  // "Onboarding" shows for people who may create plans, and for anyone who has a plan (as the person or as a follower).
  const onb = useQuery({
    queryKey: ["onb", "nav"],
    enabled: !!me && !closing && canAny(me, "onboarding:path:read") && !can(me, "onboarding:path:create"),
        // Both requests leave together: a logout in between must not let the second one go out with a dead session (a stray 401).
    queryFn: async () => (await Promise.all([api<unknown[]>("GET", "/onboarding/plans?scope=mine"), api<unknown[]>("GET", "/onboarding/plans?scope=following")])).reduce((n, l) => n + l.length, 0),
  });
  // The narrow-screen menu closes by itself when the page changes: it is "open" only for the path it was opened on.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* storage blocked: the choice just is not remembered */
      }
      return !c;
    });
  };
  // While the session is being closed the signed-in screens leave first, so no page, focus refetch or live stream goes out with the dying session (stray 401).
  useLiveUpdates(!!me && !closing);
  useSearchHotkey();

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
  if (path.startsWith("/f/") && shown.startsWith("/f/")) return <div className="min-h-dvh px-3 py-3"><Outlet /></div>;
  if (meQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  if (meQ.error) return <p className="p-6 text-sm text-bad" role="alert">Không kết nối được máy chủ. Hãy tải lại trang sau ít phút.</p>;

  // Signed out: only the public pages render. Everything else waits for the redirect above.
  if (!me || closing) {
    return <div className="min-h-dvh px-4 py-6">{!closing && isPublic(path) && isPublic(shown) ? <Outlet /> : null}</div>;
  }
  if (me.must_set_password) {
    return <div className="min-h-dvh px-4 py-6">{path === "/dat-mat-khau" && shown === "/dat-mat-khau" ? <Outlet /> : null}</div>;
  }

  // "Quản lý Deal" is for people who have the datahub (Manager, Leader, User); Admin and Guest have none (Module 4 mục 1.1).
  const hasDeal = me.user.roles.some((r) => ["manager", "leader", "user"].includes(r));
  const items = NAV.filter((n) => (!n.permission || canAny(me, n.permission)) && (!n.dealOnly || hasDeal) && (!n.guestOnly || me.user.roles.includes("guest")) && (!n.onboarding || can(me, "onboarding:path:create") || (onb.data ?? 0) > 0));
  const needed = requiredPermission(shown);
  const denied = needed !== null && !canAny(me, needed);
  const logout = async () => {
    flushSync(() => setClosing(true));
    try {
      await qc.cancelQueries();
      await api("POST", "/auth/logout");
    } finally {
      // Hide the signed-in pages first, then drop their cached data, so no page refetches with a dead session.
      qc.setQueryData(["me"], null);
      await nav({ to: "/dang-nhap", replace: true });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      setClosing(false);
    }
  };

  // An open table fills the window (the grid scrolls inside it); other pages are a centered column that scrolls.
  const wide = shown.startsWith("/datahub/") || shown.startsWith("/du-lieu-duoc-cap/") || (shown.startsWith("/quan-ly-deal") && shown !== "/quan-ly-deal/template");
  const trail = crumbs(shown);
  const initials = me.user.full_name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="h-dvh md:p-3">
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-md">
        Bỏ qua, tới nội dung
      </a>
      <div className="flex h-full overflow-hidden bg-card md:rounded-frame md:shadow-frame">
        <aside className={cn("hidden shrink-0 flex-col border-r border-border-soft bg-sidebar transition-[width] duration-200 lg:flex", collapsed ? "w-16" : "w-[220px]")}>
          <div className={cn("flex h-14 shrink-0 items-center gap-1.5 px-2.5", collapsed ? "justify-center" : "justify-between")}>
            <Link to="/" aria-label="SoE HUB, về Tổng quan" className="min-w-0">
              <Brand compact={collapsed} />
            </Link>
            {!collapsed && (
              <button type="button" onClick={toggleCollapsed} aria-label="Thu gọn menu" className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-primary-soft hover:text-foreground">
                <ChevronsLeft size={18} aria-hidden />
              </button>
            )}
          </div>
          {collapsed && (
            <button type="button" onClick={toggleCollapsed} aria-label="Mở rộng menu" className="mx-auto mb-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-primary-soft hover:text-foreground">
              <ChevronsRight size={18} aria-hidden />
            </button>
          )}
          <SideNav items={items} collapsed={collapsed} label="Menu chính" onLogout={logout} settingsActive={isSettingsPath(shown)} />
        </aside>

        <Dialog.Root open={open} onOpenChange={(o) => setOpenPath(o ? path : null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="overlay-fade fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] lg:hidden" />
            <Dialog.Content aria-describedby={undefined} className="drawer-panel fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col bg-sidebar shadow-lg lg:hidden" style={{ animationName: "drawer-in-left" }}>
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <div className="flex h-14 shrink-0 items-center px-3">
                <Link to="/" aria-label="SoE HUB, về Tổng quan">
                  <Brand />
                </Link>
              </div>
              <SideNav items={items} collapsed={false} label="Menu điện thoại" settingsActive={isSettingsPath(shown)} />
            </Dialog.Content>
          </Dialog.Portal>

          <div className="flex min-w-0 flex-1 flex-col bg-workspace">
            <div data-scroll-restoration-id="shell-main" className={cn("contain-scroll-y flex min-h-0 flex-1 flex-col", wide ? "overflow-hidden" : "overflow-y-auto")}>
              <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border-soft bg-card/85 px-3 backdrop-blur-md sm:px-5">
                <Dialog.Trigger asChild>
                  <Button variant="ghost" className="shrink-0 !px-2 lg:hidden" aria-label="Mở menu" aria-expanded={open}>
                    <Menu size={20} aria-hidden />
                  </Button>
                </Dialog.Trigger>
                <nav aria-label="Vị trí" className="flex min-w-0 items-center gap-1.5 text-sm">
                  {trail.map((t, i) => (
                    <span key={t} className="flex min-w-0 items-center gap-1.5">
                      {i > 0 && <ChevronRight size={14} aria-hidden className="shrink-0 text-faint" />}
                      <span className={cn("truncate", i === trail.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground")} aria-current={i === trail.length - 1 ? "page" : undefined}>{t}</span>
                    </span>
                  ))}
                </nav>
                <div className="ml-auto flex items-center gap-1">
                  <BellButton me={me} />
                  <Link to="/tai-khoan" className="inline-flex min-h-9 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-primary-soft" aria-label="Tài khoản của tôi">
                    <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials || <UserRound size={14} />}</span>
                    <span className="hidden max-w-32 truncate font-medium sm:inline">{me.user.full_name}</span>
                  </Link>
                  <Button variant="ghost" onClick={logout} aria-label="Đăng xuất" className="!px-2 lg:hidden">
                    <LogOut size={18} aria-hidden />
                  </Button>
                </div>
              </header>
              <main id="noi-dung" tabIndex={-1} className={wide ? "flex min-h-0 w-full flex-1 flex-col px-4 py-3 sm:px-6" : "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"}>{denied ? <Forbidden /> : isSettingsPath(shown) ? <SettingsLayout me={me} path={shown}><Outlet /></SettingsLayout> : <Outlet />}</main>
            </div>
          </div>
        </Dialog.Root>
      </div>
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
