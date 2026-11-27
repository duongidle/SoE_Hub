import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { AuditLogPage, DealDefaultsPage, DatahubLimitsPage, ServiceAccountsPage, SettingsPage, TokenApprovalPage, TransferPage } from "@/pages/admin";
import { AccountPage, TokensPage } from "@/pages/account";
import { AnnouncementsPage } from "@/pages/notify/announcements";
import { NotificationsPage } from "@/pages/notify/inbox";
import { RemindersPage } from "@/pages/notify/reminders";
import { NotificationSettingsPage } from "@/pages/notify/settings";
import { CodeFlowPage, LoginPage, SetPasswordPage } from "@/pages/auth";
import { SharedDashboardPage, SharedDashboardsPage } from "@/pages/dashboard/shared";
import { GuestGrantsPage } from "@/pages/guest";
import { GuestDataPage, GuestTablePage } from "@/pages/guest-data";
import { Home } from "@/pages/home";
import { OrgPage } from "@/pages/org";
import { SettingsHubPage } from "@/pages/settings";
import { Shell } from "@/pages/shell";
import { SystemPage } from "@/pages/system";

// The Shell gates every route by login and by permission (see pages/shell.tsx).
const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p className="text-muted-foreground">Không tìm thấy trang này.</p>,
});
const r = <P extends string>(path: P, component: () => React.ReactNode) => createRoute({ getParentRoute: () => rootRoute, path, component });

// The Datahub screens (grid library included) load when first opened, not with the login page.
const lazyPage = <P extends string>(path: P, load: () => Promise<Record<string, unknown>>, exportName: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: lazyRouteComponent(load as never, exportName as never) });

export const router = createRouter({
  // Back or forward returns to the old scroll position; a new page opens at the top. The scrolling box is the Shell's (data-scroll-restoration-id).
  scrollRestoration: true,
  scrollToTopSelectors: ["[data-scroll-restoration-id='shell-main']"],
  routeTree: rootRoute.addChildren([
    r("/", Home),
    r("/dang-nhap", LoginPage),
    r("/dang-ky", () => <CodeFlowPage purpose="activate" />),
    r("/quen-mat-khau", () => <CodeFlowPage purpose="reset" />),
    r("/dat-mat-khau", SetPasswordPage),
    lazyPage("/datahub", () => import("@/pages/datahub/list"), "DatahubListPage"),
    lazyPage("/datahub/thung-rac", () => import("@/pages/datahub/trash"), "TrashPage"),
    lazyPage("/datahub/$datahubId", () => import("@/pages/datahub/detail"), "DatahubPage"),
    lazyPage("/datahub/$datahubId/dashboard", () => import("@/pages/datahub/detail"), "DatahubPage"),
    lazyPage("/datahub/$datahubId/dashboard/$dashboardId", () => import("@/pages/datahub/detail"), "DatahubPage"),
    lazyPage("/datahub/$datahubId/$tableId", () => import("@/pages/datahub/detail"), "DatahubPage"),
    lazyPage("/quan-ly-deal", () => import("@/pages/deal/home"), "DealHomePage"),
    lazyPage("/quan-ly-deal/dashboard", () => import("@/pages/deal/home"), "DealDashboardPage"),
    lazyPage("/quan-ly-deal/template", () => import("@/pages/deal/template"), "TemplatePage"),
    lazyPage("/quan-ly-deal/thanh-toan", () => import("@/pages/deal/payments"), "PaymentsPage"),
    lazyPage("/quan-ly-deal/chot-ky", () => import("@/pages/deal/period"), "PeriodPage"),
    lazyPage("/quan-ly-deal/$tableId", () => import("@/pages/deal/home"), "DealHomePage"),
    lazyPage("/f/$code", () => import("@/pages/form/fill"), "FillPage"),
    lazyPage("/form", () => import("@/pages/form/list"), "FormListPage"),
    lazyPage("/form/cham-bai", () => import("@/pages/form/grading"), "GradingPage"),
    lazyPage("/form/bai-lam", () => import("@/pages/form/grading"), "MyQuizPage"),
    lazyPage("/form/$id", () => import("@/pages/form/editor"), "FormEditorPage"),
    lazyPage("/onboarding", () => import("@/pages/onboarding/me"), "MyOnboardingPage"),
    lazyPage("/onboarding/theo-doi", () => import("@/pages/onboarding/follow"), "FollowPage"),
    lazyPage("/onboarding/nhan-su/$planId", () => import("@/pages/onboarding/follow"), "StaffPage"),
    lazyPage("/onboarding/lo-trinh", () => import("@/pages/onboarding/plans"), "PlanListPage"),
    lazyPage("/onboarding/lo-trinh/$planId", () => import("@/pages/onboarding/editor"), "PlanEditorPage"),
    lazyPage("/knowledge", () => import("@/pages/knowledge/home"), "KnowledgeHomePage"),
    lazyPage("/knowledge/cua-toi", () => import("@/pages/knowledge/mine-page"), "MyArticlesPage"),
    lazyPage("/knowledge/soan", () => import("@/pages/knowledge/editor"), "ArticleEditorPage"),
    lazyPage("/knowledge/soan/$id", () => import("@/pages/knowledge/editor"), "ArticleEditorPage"),
    lazyPage("/knowledge/$id", () => import("@/pages/knowledge/read"), "ArticlePage"),
    lazyPage("/ai-hub", () => import("@/pages/aihub/list"), "AiHubPage"),
    lazyPage("/ai-hub/cua-toi", () => import("@/pages/aihub/mine-page"), "MySkillsPage"),
    lazyPage("/ai-hub/tai-len", () => import("@/pages/aihub/upload"), "SkillUploadPage"),
    lazyPage("/ai-hub/tai-len/$id", () => import("@/pages/aihub/upload"), "SkillUploadPage"),
    lazyPage("/ai-hub/$id", () => import("@/pages/aihub/list"), "SkillRoute"),
    lazyPage("/duyet", () => import("@/pages/review/queue"), "ReviewQueuePage"),
    r("/dashboard", SharedDashboardsPage),
    r("/dashboard/$dashboardId", SharedDashboardPage),
    r("/to-chuc", OrgPage),
    r("/cai-dat", SettingsHubPage),
    r("/tai-khoan", AccountPage),
    r("/tai-khoan/token", TokensPage),
    r("/thong-bao", NotificationsPage),
    r("/thong-bao-chung", AnnouncementsPage),
    r("/nhac-hen", RemindersPage),
    r("/tai-khoan/thong-bao", NotificationSettingsPage),
    r("/cap-du-lieu", GuestGrantsPage),
    r("/du-lieu-duoc-cap", GuestDataPage),
    r("/du-lieu-duoc-cap/$tableId", GuestTablePage),
    r("/quan-tri/token", TokenApprovalPage),
    r("/quan-tri/tai-khoan-he-thong", ServiceAccountsPage),
    r("/quan-tri/nhat-ky", AuditLogPage),
    r("/quan-tri/chuyen-giao", TransferPage),
    r("/quan-tri/datahub-gioi-han", DatahubLimitsPage),
    r("/quan-tri/cai-dat", SettingsPage),
    r("/quan-tri/he-thong", SystemPage),
    r("/quan-tri/template-deal", DealDefaultsPage),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
