import { useQuery } from "@tanstack/react-query";
import { Check, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { PersonOption } from "@/components/ui/person";
import { Skeleton } from "@/components/ui/skeleton";
import { listTeams, lookupPeople } from "@/lib/datahub/api";
import type { PersonInfo } from "@/lib/people";
import { cn } from "@/lib/utils";

/**
 * Pick several people in one go: type to search (name or email), tick as many as needed, or add a whole team. The email is always on the
 * second line. Arrow keys move, Enter/Space ticks, Esc cancels; "Xong" hands over the list, "Huỷ" drops the changes.
 * A panel, not a popup: put it inside a Popover or a dialog. `tableId` limits the suggestions to the owner and members of that table;
 * `teams={false}` hides "Chọn cả team" (a field of Leaders, where a team is not the answer); `accept` drops people a field may not take; `excludeIds` hides people who must not be offered (the owner of a share, people already chosen elsewhere).
 */
export function PeoplePicker({ value, onDone, onCancel, tableId, excludeIds, autoFocus = true, doneLabel = "Xong", teams: withTeams = true, accept }: { value: PersonInfo[]; onDone: (people: PersonInfo[]) => void; onCancel?: () => void; tableId?: string; excludeIds?: readonly string[]; autoFocus?: boolean; doneLabel?: string; teams?: boolean; accept?: (p: PersonInfo) => boolean }) {
  const [sel, setSel] = useState<PersonInfo[]>(value);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setActive(0);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const hidden = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const found = useQuery({ queryKey: ["people-picker", term, tableId ?? ""], queryFn: () => lookupPeople({ q: term, tableId }), enabled: term.length > 0 });
  const teams = useQuery({ queryKey: ["people-teams"], queryFn: listTeams, staleTime: 60_000 });
  const list = term ? (found.data ?? []).filter((p) => !hidden.has(p.id) && (accept?.(p) ?? true)) : [];
  const picked = (id: string) => sel.some((p) => p.id === id);
  const toggle = (p: PersonInfo) => setSel((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));

  const addTeam = async (id: string, name: string) => {
    setTeamBusy(id);
    setTeamNote(null);
    try {
      const members = (await lookupPeople({ teamId: id, tableId })).filter((p) => !hidden.has(p.id) && (accept?.(p) ?? true));
      setSel((s) => [...s, ...members.filter((p) => !s.some((x) => x.id === p.id))]);
      setTeamNote(members.length ? `Đã thêm ${members.length} người của team ${name}.` : tableId ? `Chưa ai của team ${name} là thành viên của bảng này.` : `Team ${name} chưa có ai để thêm.`);
    } catch {
      setTeamNote("Không tải được team này. Thử lại sau.");
    } finally {
      setTeamBusy(null);
    }
  };

  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(list.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if ((e.key === "Enter" || e.key === " ") && list[active] && (e.key === "Enter" || (e.target as HTMLElement).tagName !== "INPUT")) toggle(list[active]!);
    else if (e.key === "Enter" && !list.length) onDone(sel);
    else if (e.key === "Escape") onCancel?.();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} onKeyDown={onKey} data-testid="people-picker" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 text-sm">
      {sel.length > 0 && (
        <ul aria-label="Đã chọn" className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {sel.map((p) => (
            <li key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs">
              <span className="min-w-0 [overflow-wrap:anywhere]">{p.full_name}</span>
              <button type="button" aria-label={`Bỏ ${p.full_name}`} onClick={() => toggle(p)} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-border"><X size={12} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <Input aria-label="Tìm người" placeholder="Gõ tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} autoComplete="off" />
      {withTeams && !term && (teams.isLoading ? <Skeleton className="h-9 w-full" /> : (teams.data ?? []).length > 0 && (
        <div className="flex flex-col gap-1" aria-label="Chọn cả team">
          <p className="px-1 text-xs text-muted-foreground">Chọn cả team</p>
          <div className="contain-scroll-y flex max-h-28 flex-col gap-0.5 overflow-y-auto">
            {teams.data!.map((t) => (
              <button key={t.id} type="button" disabled={teamBusy !== null} onClick={() => void addTeam(t.id, t.name)} className="flex min-h-11 items-center gap-2 rounded px-2 text-left hover:bg-muted disabled:opacity-60 sm:min-h-9">
                <Users size={14} aria-hidden className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Team {t.name}</span>
                <span className="text-xs text-muted-foreground">{t.member_count} người</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {teamNote && <p role="status" className="px-1 text-xs text-muted-foreground">{teamNote}</p>}
      {term && (
        <div role="listbox" aria-multiselectable aria-label="Người" className="contain-scroll-y flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {found.isLoading && <Skeleton className="h-10 w-full" />}
          {!found.isLoading && list.length === 0 && <p className="px-2 py-3 text-muted-foreground">{tableId ? "Không có thành viên nào khớp. Chủ bảng cần chia sẻ bảng cho người này trước." : "Không tìm thấy ai."}</p>}
          {list.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={picked(p.id)} onClick={() => toggle(p)} onMouseMove={() => setActive(i)} className={cn("flex min-h-11 items-center gap-2 rounded px-2 py-1 text-left sm:min-h-9", i === active && "bg-muted")}>
              <span className="flex size-4 shrink-0 items-center justify-center">{picked(p.id) && <Check size={16} aria-hidden />}</span>
              <PersonOption person={p} />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <button type="button" className="min-h-11 rounded px-2 text-muted-foreground hover:bg-muted sm:min-h-9" onClick={() => (onCancel ? onCancel() : setSel(value))}>Huỷ</button>
        <button type="button" className="min-h-11 rounded bg-primary px-3 text-primary-foreground sm:min-h-9" onClick={() => onDone(sel)}>{doneLabel}{sel.length ? ` (${sel.length})` : ""}</button>
      </div>
    </div>
  );
}
