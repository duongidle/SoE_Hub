import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Home } from "@/pages/home";
import { Shell } from "@/pages/shell";
import { SystemPage } from "@/pages/system";

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p className="text-muted-foreground">Không tìm thấy trang này.</p>,
});
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const systemRoute = createRoute({ getParentRoute: () => rootRoute, path: "/he-thong", component: SystemPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, systemRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
