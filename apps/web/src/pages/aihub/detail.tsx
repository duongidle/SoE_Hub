import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Monitor, Sparkles, Terminal, FileText, FileCode } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Button, ConfirmDialog, ErrorText } from "@/components/ui/form";
import { PersonChip } from "@/components/ui/person";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { ChipTabs, CLIENT_LABEL, CodeFrame, CopyButton, GROUP_LABEL, StateBadge, TagChips } from "../library/common";

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

type Tab = "install" | "md" | "files" | "versions";

/** The detail of one skill in a drawer over the library (module8 7): how to install per client, SKILL.md, the file tree, versions, and the zip. */
export function SkillDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("install");
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
    onSuccess: (_d, op) => { void qc.invalidateQueries({ queryKey: ["aihub"] }); notify.ok(op === "unpublish" ? "Đã gỡ xuất bản" : "Đã lưu trữ skill"); onClose(); },
  });
  const s = q.data;
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title="Chi tiết skill"
        width="sm:w-[520px]"
        footer={s && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="min-h-9 text-sm text-primary hover:underline" onClick={() => setTab("versions")}>Xem lịch sử phiên bản</button>
            <Button onClick={() => dl.mutate()} loading={dl.isPending} data-testid="download-skill"><Download size={14} aria-hidden />Tải gói zip</Button>
          </div>
        )}
      >
        {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
        {!s && !q.error && <p className="text-sm text-muted-foreground">Đang tải...</p>}
        {s && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.group && <Badge tone="primary">{GROUP_LABEL[s.group] ?? s.group}</Badge>}
                <Badge>v{s.package_version}</Badge>
                {s.state !== "published" && <StateBadge state={s.state} />}
              </div>
              <h2 className="mt-2 font-mono text-lg font-semibold [overflow-wrap:anywhere]" data-testid="skill-name">{s.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <PersonChip person={{ id: s.author.id, full_name: s.author.name }} />
                <span><span data-testid="download-count">{s.download_count}</span> lượt tải</span>
                {s.published_at && <span>duyệt {fmtTime(s.published_at)}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{s.clients.map((c) => <Badge key={c} tone="info">{CLIENT_LABEL[c] ?? c}</Badge>)}</div>
              <TagChips tags={s.tags} />
              {(s.is_author || s.can_review) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.is_author && <Link to="/ai-hub/tai-len/$id" params={{ id }} className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-primary-soft">Sửa</Link>}
                  {s.can_review && <Button variant="secondary" onClick={() => setConfirm("unpublish")}>Gỡ xuất bản</Button>}
                  <Button variant="secondary" onClick={() => setConfirm("archive")}>Lưu trữ</Button>
                </div>
              )}
              <ErrorText error={dl.error ?? act.error} />
            </div>

            <ChipTabs<Tab> label="Nội dung skill" value={tab} onChange={setTab} items={[{ value: "install", label: "Cài đặt" }, { value: "md", label: "SKILL.md" }, { value: "files", label: `Tệp (${s.tree.length})` }, { value: "versions", label: "Phiên bản" }]} />

            {tab === "install" && (
              <section className="flex flex-col gap-3" data-testid="install">
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium"><Terminal size={15} aria-hidden />Claude Code</span>
                    <CopyButton getText={() => s.install.claude_code} className="!min-h-8">Sao chép lệnh</CopyButton>
                  </div>
                  <CodeFrame><code data-testid="install-cmd" className="block whitespace-pre-wrap">{s.install.claude_code}</code></CodeFrame>
                  <p className="mt-2 text-xs text-muted-foreground">Cần file zip đã tải ở thư mục hiện tại. Skill nằm ở <code>{s.install.claude_code_path}</code>.</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="mb-1.5 flex items-center gap-1.5 font-medium"><Monitor size={15} aria-hidden />Claude Desktop · claude.ai</div>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>Tải gói zip ở nút bên dưới.</li>
                    <li><b className="text-foreground">Claude Desktop:</b> {s.install.claude_desktop}</li>
                    <li><b className="text-foreground">claude.ai:</b> {s.install.claude_ai}</li>
                  </ol>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-ai-border bg-ai-bg p-3 text-sm text-ai">
                  <Sparkles size={16} aria-hidden className="mt-0.5 shrink-0" />
                  <span>Đang nối SoE HUB qua MCP? Bảo AI: <b>"cài skill {s.name}"</b>, nó tự lấy bằng <code>skill_get</code>.</span>
                </div>
              </section>
            )}

            {tab === "md" && <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border-soft bg-muted p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="skill-md">{s.skill_md ?? "(không có SKILL.md)"}</pre>}

            {tab === "files" && (
              <section>
                <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cấu trúc gói</div>
                <ul className="rounded-lg border border-border-soft bg-muted p-2 text-sm" data-testid="tree">
                  {s.tree.map((t) => (
                    <li key={t.path} className="flex items-center gap-2 py-0.5">
                      {/\.(py|js|ts|sh)$/.test(t.path) ? <FileCode size={14} aria-hidden className="shrink-0 text-muted-foreground" /> : <FileText size={14} aria-hidden className="shrink-0 text-muted-foreground" />}
                      {t.type === "text" ? <button type="button" className="min-h-8 text-left font-mono text-xs text-primary hover:underline [overflow-wrap:anywhere]" onClick={() => setOpen(t.path)}>{t.path}</button> : <span className="font-mono text-xs [overflow-wrap:anywhere]">{t.path}</span>}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.size} byte{t.type !== "text" ? ", không xem được" : ""}</span>
                    </li>
                  ))}
                </ul>
                {open && file.data?.file && <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border-soft bg-muted p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="file-view">{file.data.file.content}</pre>}
                <ErrorText error={file.error} />
              </section>
            )}

            {tab === "versions" && (
              <section>
                <ul className="flex flex-col gap-1 text-sm" data-testid="versions">
                  {versions.data?.items.map((v) => <li key={v.version} className="flex flex-wrap items-center gap-2 rounded-md border border-border-soft px-3 py-2">Bản {v.version}<StateBadge state={v.status} />{v.published_at && <span className="text-xs text-muted-foreground">{fmtTime(v.published_at)}</span>}</li>)}
                </ul>
                {s.change_note && <p className="mt-2 text-sm text-muted-foreground">Ghi chú bản hiện tại: {s.change_note}</p>}
              </section>
            )}
          </div>
        )}
      </Drawer>
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
    </>
  );
}
