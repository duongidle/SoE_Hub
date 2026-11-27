import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/form";
import { useMe } from "@/lib/session";
import { canAny, SETTINGS_LINKS } from "./shell";

/**
 * Temporary Settings page (12A-1): a list of links by permission. 12A-2 replaces it with the two-column page
 * (groups on the left, content on the right); the links and their permissions stay in `SETTINGS_LINKS` (shell.tsx).
 */
export function SettingsHubPage() {
  const me = useMe().data;
  if (!me) return null;
  const links = SETTINGS_LINKS.filter((l) => !l.permission || canAny(me, l.permission));
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Cài đặt</PageTitle>
      <Card className="divide-y divide-border-soft">
        {links.map((l) => (
          <Link key={l.to} to={l.to} aria-label={l.label} className="flex flex-col gap-0.5 px-5 py-3 transition-colors first:rounded-t-card last:rounded-b-card hover:bg-primary-soft">
            <span className="text-sm font-medium text-foreground">{l.label}</span>
            <span className="text-xs text-muted-foreground">{l.hint}</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
