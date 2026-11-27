import { useQuery } from "@tanstack/react-query";
import { Mail, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Popover } from "@/components/ui/popover";
import { lookupPeople } from "@/lib/datahub/api";
import { initialsOf, roleLabels, statusLabel, type PersonInfo } from "@/lib/people";
import { cn } from "@/lib/utils";

export { disambiguate } from "@/lib/people";
export type { PersonInfo } from "@/lib/people";

/** Round avatar: the initials (no photo yet). Decorative: the name is always written next to it. */
export function Avatar({ name, size = "sm", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary", size === "sm" ? "size-5 text-[10px]" : "size-9 text-sm", className)}>
      {initialsOf(name) || "?"}
    </span>
  );
}

/** What the server tells this viewer about one person, fetched when the card opens. Fields the viewer may not see come back null. */
export function usePersonInfo(id: string, enabled = true) {
  return useQuery({ queryKey: ["person-card", id], queryFn: async () => (await lookupPeople({ ids: [id] }))[0] ?? null, enabled, staleTime: 60_000 });
}

const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-start gap-2 text-xs text-muted-foreground">
    <span aria-hidden className="mt-0.5 shrink-0">{icon}</span>
    <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
  </div>
);

/** The detail card: email, team, roles and status. A line the server did not send is not drawn. */
export function PersonCard({ person }: { person: PersonInfo }) {
  const status = statusLabel(person.status);
  const roles = roleLabels(person.roles);
  return (
    <div className="flex w-72 max-w-full flex-col gap-2 p-3" data-testid="person-card">
      <div className="flex items-center gap-2">
        <Avatar name={person.full_name} size="md" />
        <div className="min-w-0">
          <div className="text-sm font-medium [overflow-wrap:anywhere]">{person.full_name}</div>
          {status && <div className={cn("text-xs", person.status === "active" ? "text-ok" : "text-muted-foreground")}>{status}</div>}
        </div>
      </div>
      {person.email && <Row icon={<Mail size={14} />}>{person.email}</Row>}
      {person.team && <Row icon={<Users size={14} />}>Team {person.team}</Row>}
      {roles && <Row icon={<span className="text-[10px] font-semibold">VT</span>}>{roles}</Row>}
    </div>
  );
}

/**
 * The one way to show a person: avatar and name; hover (mouse) or tap/Enter opens the card. `person` may be only {id, full_name};
 * the card then asks the server for the rest. `label` replaces the name (the disambiguated text of a list).
 */
export function PersonChip({ person, label, className }: { person: PersonInfo; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const byHover = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const later = (to: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      byHover.current = to;
      setOpen(to);
    }, ms);
  };
  const detailed = person.status !== undefined;
  const q = usePersonInfo(person.id, open && !detailed);
  const shown: PersonInfo = { ...person, ...(q.data ?? {}) };
  return (
    <Popover
      label={`Thông tin ${person.full_name}`}
      open={open}
      onOpenChange={(o) => {
        clearTimeout(timer.current);
        setOpen(o);
      }}
      width="w-auto"
      className="p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}
      trigger={
        <button
          type="button"
          data-testid="person-chip"
          onPointerEnter={(e) => e.pointerType === "mouse" && later(true, 250)}
          onPointerLeave={(e) => e.pointerType === "mouse" && later(false, 200)}
          onClick={(e) => {
            // A click right after the hover opened the card keeps it open (the click is not a request to close it).
            if (open && byHover.current) {
              e.preventDefault();
              byHover.current = false;
            }
          }}
          className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-left text-sm hover:bg-muted", className)}
        >
          <Avatar name={person.full_name} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{label ?? person.full_name}</span>
        </button>
      }
    >
      <div onPointerEnter={(e) => e.pointerType === "mouse" && later(true, 0)} onPointerLeave={(e) => e.pointerType === "mouse" && later(false, 200)}>
        <PersonCard person={shown} />
      </div>
    </Popover>
  );
}

/** A name and, under it, the email: the row of every list where someone is chosen (a wrong pick there corrupts real data). */
export function PersonOption({ person, className }: { person: PersonInfo; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar name={person.full_name} />
      <span className="flex min-w-0 flex-col">
        <span className="[overflow-wrap:anywhere]">{person.full_name}</span>
        {person.email && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{person.email}</span>}
      </span>
    </span>
  );
}
