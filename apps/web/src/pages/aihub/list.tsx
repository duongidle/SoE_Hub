import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Bookmark, Download, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { buttonClass, ErrorText, PageTitle, Select } from "@/components/ui/form";
import { ReviewLink } from "../review/review-link";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { useUrlState } from "@/lib/use-url-state";
import { ChipTabs, CLIENT_LABEL, CodeFrame, ColorChip, CopyButton, GROUP_LABEL, LibraryHead, SearchBox, Snippet, TagStrip } from "../library/common";
import { SkillDrawer, type SkillDetail } from "./detail";

interface SkillCard {
  id: string;
  name: string;
  description: string;
  tags: string[];
  group: string | null;
  clients: string[];
  version: string | null;
  author: { name: string };
  download_count: number;
  snippet?: string;
}
const DEFAULTS = { q: "", group: "", client: "", tag: "", sort: "relevance" };

/** The library of skills. `openId` (the /ai-hub/$id route) opens the drawer of that skill over the same list, so the filters stay. */
export function AiHubPage({ openId }: { openId?: string }) {
  const me = useMe().data;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, set] = useUrlState(DEFAULTS);
  const [text, setText] = useState(f.tag ? `#${f.tag}` : f.q);
  const p = new URLSearchParams({ limit: "50", sort: f.q ? f.sort : f.sort === "relevance" ? "newest" : f.sort });
  for (const k of ["q", "group", "client", "tag"] as const) if (f[k]) p.set(k, f[k]);
  const q = useQuery({ queryKey: ["aihub", "search", p.toString()], queryFn: () => api<SkillCard[]>("GET", `/aihub/search?${p}`) });
  const popular = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of q.data ?? []) for (const t of s.tags) n.set(t, (n.get(t) ?? 0) + 1);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t]) => t);
    return f.tag && !top.includes(f.tag) ? [f.tag, ...top] : top;
  }, [q.data, f.tag]);
  const submit = () => {
    const t = text.trim();
    if (t.startsWith("#")) set({ q: "", tag: t.slice(1).trim().toLowerCase() });
    else set({ q: t, tag: "" });
  };
  const goto = (id: string | null) => void (nav as (o: unknown) => Promise<void>)(id ? { to: "/ai-hub/$id", params: { id }, search: (s: unknown) => s } : { to: "/ai-hub", search: (s: unknown) => s });
  const installOf = async (id: string) => (await qc.fetchQuery({ queryKey: ["aihub", "skill", id], queryFn: () => api<SkillDetail>("GET", `/aihub/skills/${id}`) })).install.claude_code;
  return (
    <div className="mx-auto flex max-w-[1260px] flex-col gap-4">
      <PageTitle
        actions={
          <>
            <ReviewLink kind="skill" />
            {can(me, "aihub:skill:post") && (
              <>
                <Link to="/ai-hub/cua-toi" className={buttonClass({ variant: "secondary" })}><Bookmark size={14} aria-hidden className="text-muted-foreground" />Skill của tôi</Link>
                <Link to="/ai-hub/tai-len" className={buttonClass()} data-testid="upload-skill"><Upload size={14} aria-hidden />Tải lên skill</Link>
              </>
            )}
          </>
        }
      >
        AI Hub
      </PageTitle>
      <LibraryHead title="Thư viện Skill AI dùng chung" desc="Skill đã được kiểm tra và duyệt: sao chép lệnh cài để dùng trong Claude Code, Claude Desktop hoặc claude.ai." count={q.data ? `${q.data.length >= 50 ? "50+" : q.data.length} skill` : undefined}>
        <SearchBox value={text} onChange={setText} onSubmit={submit} label="Tìm skill" placeholder="Tìm tên skill, mô tả (không dấu cũng được) hoặc gõ #thẻ" testid="ah-search" />
        <TagStrip tags={popular} active={f.tag} onPick={(t) => { setText(t ? `#${t}` : ""); set({ tag: t, q: "" }); }} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3">
          <ChipTabs label="Dùng với" value={f.client} onChange={(v) => set({ client: v })} items={[{ value: "", label: "Tất cả" }, ...Object.entries(CLIENT_LABEL).map(([value, label]) => ({ value, label }))]} />
          <div className="flex shrink-0 items-center gap-2">
            <Select className="h-8 min-h-8 w-auto text-xs sm:min-h-8" aria-label="Nhóm" value={f.group} onChange={(e) => set({ group: e.target.value })}>
              <option value="">Nhóm: tất cả</option>
              {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select className="h-8 min-h-8 w-auto text-xs sm:min-h-8" aria-label="Sắp xếp" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="relevance">Sắp xếp: Độ khớp</option>
              <option value="downloads">Sắp xếp: Nhiều lượt tải</option>
            </Select>
          </div>
        </div>
      </LibraryHead>
      <ErrorText error={q.error} />
      {q.data?.length === 0 && <EmptyState title="Chưa có skill nào" hint="Đổi bộ lọc, hoặc tải lên skill đầu tiên." />}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="skill-list">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-2xs transition-shadow hover:shadow-md" data-testid="skill-card">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap gap-1">{s.clients.map((c, n) => <ColorChip key={c} index={n} color="blue">{CLIENT_LABEL[c] ?? c}</ColorChip>)}</div>
              {s.group && <span className="shrink-0 text-[11px] text-muted-foreground">{GROUP_LABEL[s.group] ?? s.group}</span>}
            </div>
            <Link to="/ai-hub/$id" params={{ id: s.id }} search={(x: unknown) => x as never} className="font-mono text-base font-semibold text-foreground [overflow-wrap:anywhere] hover:text-primary">{s.name}</Link>
            <CodeFrame label="description" className="line-clamp-4 min-h-[4.5rem]">{s.snippet ? <Snippet html={s.snippet} /> : s.description}</CodeFrame>
            {s.tags.length > 0 && <div className="flex flex-wrap gap-1">{s.tags.slice(0, 4).map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">#{t}</span>)}</div>}
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-soft pt-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">v{s.version} · {s.author.name}</span>
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap"><Download size={13} aria-hidden />{s.download_count} lượt tải</span>
            </div>
            <div className="flex gap-2">
              <CopyButton variant="secondary" className="flex-1 !border-primary-border !bg-primary-soft !text-primary" getText={() => installOf(s.id)}>Sao chép lệnh cài</CopyButton>
              <Link to="/ai-hub/$id" params={{ id: s.id }} search={(x: unknown) => x as never} className="inline-flex min-h-11 items-center rounded-[9px] border border-border bg-card px-3.5 text-sm font-medium hover:bg-primary-soft sm:min-h-8">Xem</Link>
            </div>
          </li>
        ))}
      </ul>
      {openId && <SkillDrawer key={openId} id={openId} onClose={() => goto(null)} />}
    </div>
  );
}

/** The route /ai-hub/$id: the library with this skill's drawer open. */
export function SkillRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  return <AiHubPage openId={id} />;
}
