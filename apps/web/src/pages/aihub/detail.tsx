import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { BackLink, CLIENT_LABEL, GROUP_LABEL, StateBadge, TagChips } from "../library/common";

export interface SkillDetail {
  id: string;
  state: string;
  name: string;
  description: string;
  group: string | null;
  tags: string[];
  clients: string[];
  package_version: string;
  change_note: string;
  author: { id: string; name: string };
  published_at: string | null;
  download_count: number;
  tree: { path: string; size: number; type: "text" | "image" | "other" }[];
  skill_md: string | null;
  install: { claude_code: string; claude_code_path: string; claude_desktop: string; claude_ai: string };
  is_author: boolean;
  can_review: boolean;
  file?: { path: string; encoding: string; content: string };
}
interface VersionRow {
  version: number;
  status: string;
  published_at: string | null;
}

/** The text of a zip the server sends as base64: a Blob the browser saves. */
export function saveBase64(name: string, b64: string, type = "application/zip") {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SkillPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"unpublish" | "archive" | null>(null);
  const q = useQuery({ queryKey: ["aihub", "skill", id], queryFn: () => api<SkillDetail>("GET", `/aihub/skills/${id}`) });
  const versions = useQuery({ queryKey: ["aihub", "versions", id], queryFn: () => api<{ items: VersionRow[] }>("GET", `/posts/${id}/versions`) });
  const file = useQuery({ queryKey: ["aihub", "file", id, open], enabled: !!open, queryFn: () => api<SkillDetail>("GET", `/aihub/skills/${id}?path=${encodeURIComponent(open!)}`) });
  const dl = useMutation({
    mutationFn: () => api<{ filename: string; content_base64: string }>("POST", `/aihub/skills/${id}/download`, {}),
    onSuccess: (r) => { saveBase64(r.filename, r.content_base64); void qc.invalidateQueries({ queryKey: ["aihub", "skill", id] }); },
  });
  const act = useMutation({
    mutationFn: (op: "unpublish" | "archive") => api("POST", `/posts/${id}/${op}`, {}),
    onSuccess: (_d, op) => { void qc.invalidateQueries({ queryKey: ["aihub"] }); notify.ok(op === "unpublish" ? "Đã gỡ xuất bản" : "Đã lưu trữ skill"); void nav({ to: "/ai-hub" }); },
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.install.claude_code);
      notify.ok("Đã sao chép lệnh");
    } catch {
      notify.error("Không sao chép được, hãy chọn và chép tay");
    }
  };
  return (
    <div className="max-w-4xl">
      <BackLink to="/ai-hub">AI Hub</BackLink>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]" data-testid="skill-name">{s.name}</h1>
        {s.state !== "published" && <StateBadge state={s.state} />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {s.group && <Badge>{GROUP_LABEL[s.group] ?? s.group}</Badge>}
        {s.clients.map((c) => <Badge key={c}>{CLIENT_LABEL[c] ?? c}</Badge>)}
        <span>v{s.package_version} · {s.author.name}{s.published_at ? ` · ${fmtTime(s.published_at)}` : ""} · <span data-testid="download-count">{s.download_count}</span> lượt tải</span>
      </div>
      <TagChips tags={s.tags} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => dl.mutate()} loading={dl.isPending} data-testid="download-skill">Tải zip</Button>
        {s.is_author && <Link to="/ai-hub/tai-len/$id" params={{ id }} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm">Sửa</Link>}
        {s.can_review && <Button variant="secondary" onClick={() => setConfirm("unpublish")}>Gỡ xuất bản</Button>}
        {(s.is_author || s.can_review) && <Button variant="secondary" onClick={() => setConfirm("archive")}>Lưu trữ</Button>}
      </div>
      <ErrorText error={dl.error ?? act.error} />

      <section className="mt-6" data-testid="install">
        <h2 className="mb-1 text-base font-semibold">Cách cài</h2>
        <p className="text-sm">Claude Code: chạy lệnh sau (cần file zip đã tải ở thư mục hiện tại), skill nằm ở <code>{s.install.claude_code_path}</code>.</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="block max-w-full overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs" data-testid="install-cmd">{s.install.claude_code}</code>
          <Button variant="secondary" onClick={() => void copy()}>Sao chép</Button>
        </div>
        <p className="mt-2 text-sm"><b>Claude Desktop:</b> {s.install.claude_desktop}</p>
        <p className="text-sm"><b>claude.ai:</b> {s.install.claude_ai}</p>
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-base font-semibold">SKILL.md</h2>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs [overflow-wrap:anywhere]" data-testid="skill-md">{s.skill_md ?? "(không có SKILL.md)"}</pre>
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-base font-semibold">Các file ({s.tree.length})</h2>
        <ul className="text-sm" data-testid="tree">
          {s.tree.map((t) => (
            <li key={t.path}>
              {t.type === "text" ? <button type="button" className="min-h-8 text-left text-primary underline" onClick={() => setOpen(t.path)}>{t.path}</button> : <span>{t.path}</span>}
              <span className="text-muted-foreground"> ({t.size} byte{t.type !== "text" ? ", không xem được" : ""})</span>
            </li>
          ))}
        </ul>
        {open && file.data?.file && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs [overflow-wrap:anywhere]" data-testid="file-view">{file.data.file.content}</pre>}
        <ErrorText error={file.error} />
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-base font-semibold">Lịch sử phiên bản</h2>
        <ul className="text-sm" data-testid="versions">
          {versions.data?.items.map((v) => <li key={v.version}>Bản {v.version} · {v.status}{v.published_at ? ` · ${fmtTime(v.published_at)}` : ""}</li>)}
        </ul>
        {s.change_note && <p className="mt-1 text-sm text-muted-foreground">Ghi chú bản hiện tại: {s.change_note}</p>}
      </section>
      {confirm && (
        <ConfirmDialog
          title={confirm === "unpublish" ? "Gỡ xuất bản skill này?" : "Lưu trữ skill này?"}
          message={confirm === "unpublish" ? "Skill về lại nháp của tác giả, người dùng không thấy và không tải được nữa." : "Skill ẩn khỏi danh sách và tìm kiếm."}
          confirmLabel={confirm === "unpublish" ? "Gỡ xuất bản" : "Lưu trữ"}
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate(confirm)}
        />
      )}
    </div>
  );
}
