import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/form";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";

/** "Duyệt bài" / "Duyệt skill" button of the Knowledge and AI Hub pages: only for people who may review that kind; opens the queue filtered to it. */
export function ReviewLink({ kind }: { kind: "article" | "skill" }) {
  const me = useMe().data;
  const allowed = can(me, kind === "article" ? "knowledge:article:review" : "aihub:skill:review");
  const q = useQuery({ queryKey: ["review", "queue", kind], queryFn: () => api<unknown[]>("GET", `/review/queue?limit=100&kind=${kind}`), enabled: allowed });
  if (!allowed) return null;
  const n = q.data?.length ?? 0;
  return (
    <Link to="/duyet" search={{ kind } as never} className={buttonClass({ variant: "secondary" })} data-testid="open-review">
      <ClipboardCheck size={14} aria-hidden className="text-muted-foreground" />
      {kind === "article" ? "Duyệt bài" : "Duyệt skill"}
      {n > 0 && <span className="num min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground" data-testid="review-count">{n}</span>}
    </Link>
  );
}
