import { Link, Navigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type Me } from "@/lib/session";
import { useMe } from "@/lib/session";
import { canAny, SETTINGS_LINKS, settingsLinkFor } from "./shell";

const WIDE = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true);

const visibleLinks = (me: Me) => SETTINGS_LINKS.filter((l) => !l.permission || canAny(me, l.permission));

/**
 * Two columns for every settings page (12A-2): groups on the left, the page on the right. The pages keep their own routes and
 * render inside this layout. On a phone the left column is the list at /cai-dat; a page opens alone with a back link.
 */
export function SettingsLayout({ me, path, children }: { me: Me; path: string; children: ReactNode }) {
  const links = visibleLinks(me);
  const current = settingsLinkFor(path)?.to ?? null;
  const groups = [
    { name: "Cá nhân", links: links.filter((l) => l.permission === null) },
    { name: "Quản trị", links: links.filter((l) => l.permission !== null) },
  ].filter((g) => g.links.length > 0);
  const atList = path === "/cai-dat";
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <nav aria-label="Menu cài đặt" className={cn("shrink-0 md:block md:w-56", atList ? "block" : "hidden")}>
        <h1 className="mb-3 text-xl font-semibold tracking-tight md:sr-only">Cài đặt</h1>
        <div className="flex flex-col gap-5 md:sticky md:top-4">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="flex flex-col gap-0.5">
              <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.name}</div>
              {g.links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-label={l.label}
                  aria-current={l.to === current ? "page" : undefined}
                  className={cn("flex min-h-10 items-center rounded-control px-3 text-sm transition-colors hover:bg-primary-soft", l.to === current ? "bg-primary-soft font-medium text-primary" : "text-foreground")}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>
      {!atList && (
        <div className="min-w-0 flex-1">
          <Link to="/cai-dat" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-primary md:hidden">
            <ChevronLeft size={16} aria-hidden /> Cài đặt
          </Link>
          {children}
        </div>
      )}
    </div>
  );
}

/** /cai-dat: on a wide screen opens the first page the person may use; on a phone the layout shows the list. */
export function SettingsHubPage() {
  const me = useMe().data;
  const wide = useWide();
  if (!me || !wide) return null;
  const first = visibleLinks(me)[0];
  return first ? <Navigate to={first.to} replace /> : null;
}
