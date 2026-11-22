import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Input, PageTitle, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { CLIENT_LABEL, GROUP_LABEL, Snippet, TagChips } from "../library/common";

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

export function AiHubPage() {
  const me = useMe().data;
  const [text, setText] = useState("");
  const [f, setF] = useState({ q: "", group: "", client: "", tag: "", sort: "relevance" });
  const p = new URLSearchParams({ limit: "50", sort: f.q ? f.sort : f.sort === "relevance" ? "newest" : f.sort });
  for (const k of ["q", "group", "client", "tag"] as const) if (f[k]) p.set(k, f[k]);
  const q = useQuery({ queryKey: ["aihub", "search", p.toString()], queryFn: () => api<SkillCard[]>("GET", `/aihub/search?${p}`) });
  return (
    <div>
      <PageTitle
        actions={
          can(me, "aihub:skill:post") && (
            <>
              <Link to="/ai-hub/cua-toi" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Skill của tôi</Link>
              <Link to="/ai-hub/tai-len" className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" data-testid="upload-skill">Tải lên skill</Link>
            </>
          )
        }
      >
        AI Hub
      </PageTitle>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setF((x) => ({ ...x, q: text.trim() })); }}>
        <Input className="min-w-48 flex-1" aria-label="Tìm skill" placeholder="Tìm skill" value={text} onChange={(e) => setText(e.target.value)} data-testid="ah-search" />
        <Select aria-label="Nhóm" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
          <option value="">Mọi nhóm</option>
          {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
          <option value="">Mọi client</option>
          {Object.entries(CLIENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input className="w-32" aria-label="Thẻ" placeholder="Thẻ" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value.trim().toLowerCase() })} />
        <Select aria-label="Sắp xếp" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="relevance">Độ khớp / mới nhất</option>
          <option value="downloads">Nhiều lượt tải</option>
        </Select>
        <Button type="submit">Tìm</Button>
      </form>
      <ErrorText error={q.error} />
      {q.data?.length === 0 && <EmptyState title="Chưa có skill nào" hint="Đổi bộ lọc, hoặc tải lên skill đầu tiên." />}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="skill-list">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3" data-testid="skill-card">
            <Link to="/ai-hub/$id" params={{ id: s.id }} className="font-medium text-primary underline [overflow-wrap:anywhere]">{s.name}</Link>
            {s.snippet ? <Snippet html={s.snippet} /> : <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>}
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {s.group && <Badge>{GROUP_LABEL[s.group] ?? s.group}</Badge>}
              {s.clients.map((c) => <Badge key={c}>{CLIENT_LABEL[c] ?? c}</Badge>)}
              <span>v{s.version} · {s.author.name} · {s.download_count} lượt tải</span>
            </div>
            <TagChips tags={s.tags} />
          </li>
        ))}
      </ul>
    </div>
  );
}
