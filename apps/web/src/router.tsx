import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AuditLogPage, ServiceAccountsPage, SettingsPage, TokenApprovalPage, TransferPage } from "@/pages/admin";
import { AccountPage, NotificationsPage, TokensPage } from "@/pages/account";
import { CodeFlowPage, LoginPage, SetPasswordPage } from "@/pages/auth";
import { GuestGrantsPage } from "@/pages/guest";
import { Home } from "@/pages/home";
import { OrgPage } from "@/pages/org";
import { Shell } from "@/pages/shell";
import { SystemPage } from "@/pages/system";

// The Shell gates every route by login and by permission (see pages/shell.tsx).
const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p className="text-muted-foreground">Không tìm thấy trang này.</p>,
});
const r = <P extends string>(path: P, component: () => React.ReactNode) => createRoute({ getParentRoute: () => rootRoute, path, component });

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    r("/", Home),
    r("/he-thong", SystemPage),
    r("/dang-nhap", LoginPage),
    r("/dang-ky", () => <CodeFlowPage purpose="activate" />),
    r("/quen-mat-khau", () => <CodeFlowPage purpose="reset" />),
    r("/dat-mat-khau", SetPasswordPage),
    r("/to-chuc", OrgPage),
    r("/tai-khoan", AccountPage),
    r("/tai-khoan/token", TokensPage),
    r("/thong-bao", NotificationsPage),
    r("/cap-du-lieu", GuestGrantsPage),
    r("/quan-tri/token", TokenApprovalPage),
    r("/quan-tri/tai-khoan-he-thong", ServiceAccountsPage),
    r("/quan-tri/nhat-ky", AuditLogPage),
    r("/quan-tri/chuyen-giao", TransferPage),
    r("/quan-tri/cai-dat", SettingsPage),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
