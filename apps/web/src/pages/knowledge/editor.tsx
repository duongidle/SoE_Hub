import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useRef, useState } from "react";
import { Button, ErrorText, Field, Input, Notice, PageTitle, Select, Textarea } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { BackLink, CATEGORY_LABEL, EDITOR_EXTENSIONS, IssueList, issuesOf, otherIssues, TYPE_LABEL, type CheckResult } from "../library/common";
import type { ArticleDetail } from "./read";

interface Form {
  title: string;
  summary: string;
  category: string;
  type: string;
  tags: string;
  for_sale: boolean;
}
const EMPTY: Form = { title: "", summary: "", category: "", type: "", tags: "", for_sale: false };
const FIELDS = ["title", "summary", "body", "category", "type", "tags", "for_sale", "file_ids"];

function Toolbar({ editor }: { editor: Editor }) {
  const [url, setUrl] = useState("");
  const b = (label: string, run: () => void, active?: boolean) => (
    <Button type="button" variant={active ? "primary" : "ghost"} aria-label={label} title={label} onClick={run}>{label}</Button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-1" data-testid="toolbar">
      {b("H2", () => c().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {b("H3", () => c().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
      {b("Đậm", () => c().toggleBold().run(), editor.isActive("bold"))}
      {b("Nghiêng", () => c().toggleItalic().run(), editor.isActive("italic"))}
      {b("Danh sách", () => c().toggleBulletList().run(), editor.isActive("bulletList"))}
      {b("Số thứ tự", () => c().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {b("Ghi chú", () => c().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {b("Khối code", () => c().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      {b("Bảng", () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      <Input className="w-44" aria-label="Địa chỉ link hoặc ảnh" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
      {b("Link", () => { if (url.trim()) c().extendMarkRange("link").setLink({ href: url.trim() }).run(); else c().unsetLink().run(); }, editor.isActive("link"))}
      {b("Ảnh", () => { if (/^https?:\/\//.test(url.trim())) c().setImage({ src: url.trim() }).run(); })}
    </div>
  );
}

export function ArticleEditorPage() {
  const params = useParams({ strict: false }) as { id?: string };
  const q = useQuery({ queryKey: ["knowledge", "edit", params.id], enabled: !!params.id, gcTime: 0, queryFn: () => api<ArticleDetail>("GET", `/knowledge/articles/${params.id}?source=working`) });
  if (params.id && q.error) return <ErrorText error={q.error} />;
  if (params.id && !q.data) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  return <ArticleEditor key={params.id ?? "new"} id={params.id} initial={q.data ?? null} />;
}

function ArticleEditor({ id: initialId, initial }: { id?: string; initial: ArticleDetail | null }) {
  const params = { id: initialId };
  const nav = useNavigate();
  const c0 = initial?.content;
  const [id, setId] = useState<string | undefined>(params.id);
  const [form, setForm] = useState<Form>(c0 ? { title: c0.title, summary: c0.summary, category: c0.category ?? "", type: c0.type ?? "", tags: c0.tags.join(", "), for_sale: c0.for_sale } : EMPTY);
  const [files, setFiles] = useState<{ id: string; filename: string }[]>(initial?.attachments.map((f) => ({ id: f.id, filename: f.filename })) ?? []);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const loaded = true;
  const docRef = useRef<JSONContent | null>(c0?.body ?? null);
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: c0?.body ?? "", editorProps: { attributes: { class: "tiptap-doc", "aria-label": "Nội dung bài", "data-testid": "body-editor" } }, onUpdate: ({ editor: e }) => { docRef.current = e.getJSON(); } });
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const tagSuggest = useQuery({ queryKey: ["knowledge", "tags"], queryFn: () => api<{ items: (string | { tag: string })[] }>("GET", "/knowledge/tags") });

  const payload = () => ({
    title: form.title,
    summary: form.summary,
    body: docRef.current ?? { type: "doc", content: [] },
    category: form.category || null,
    type: form.type || null,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    for_sale: form.for_sale,
    file_ids: files.map((f) => f.id),
  });
  const onFail = (e: unknown) => setCheck(issuesOf(e));
  const save = useMutation({
    mutationFn: () => api<{ post_id: string; check: CheckResult }>("POST", "/knowledge/articles", { id, ...payload() }),
    onSuccess: (r) => { setId(r.post_id); setCheck(r.check); notify.ok("Đã lưu nháp"); },
  });
  const dry = useMutation({
    mutationFn: () => api<{ ok: boolean } & CheckResult>("POST", "/knowledge/articles/submit", { id, check_only: true, ...payload() }),
    onSuccess: (r) => { setCheck(r); notify.ok(r.ok ? (r.warnings.length ? "Đạt, có cảnh báo" : "Đạt kiểm tra") : "Chưa đạt kiểm tra"); },
  });
  const send = useMutation({
    mutationFn: () => api<{ published: boolean }>("POST", "/knowledge/articles/submit", { id, ...payload() }),
    onSuccess: (r) => { notify.ok(r.published ? "Đã xuất bản" : "Đã gửi duyệt"); void nav({ to: "/knowledge/cua-toi" }); },
    onError: onFail,
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const init = await api<{ file: { id: string }; upload: { url: string; headers: Record<string, string> } }>("POST", "/files", { filename: f.name, content_type: f.type || "application/octet-stream", size_bytes: f.size });
      const put = await fetch(init.upload.url, { method: "PUT", headers: init.upload.headers, body: f });
      if (!put.ok) throw new ApiError(put.status, null);
      await api("POST", `/files/${init.file.id}/complete`, {});
      return { id: init.file.id, filename: f.name };
    },
    onSuccess: (f) => setFiles((x) => [...x, f]),
  });
  const known = (suggest: Array<string | { tag: string }> | undefined) => (suggest ?? []).map((t) => (typeof t === "string" ? t : t.tag));
  const busy = save.isPending || send.isPending || dry.isPending;
  return (
    <div className="mx-auto max-w-[1100px]">
      <BackLink to="/knowledge/cua-toi">Bài của tôi</BackLink>
      <PageTitle>{params.id ? "Sửa bài" : "Viết bài"}</PageTitle>
      <div className="mt-2 grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-sm">
          <Field label="Tiêu đề" required hint="Tối đa 150 ký tự" name="title">
            <Input value={form.title} maxLength={1000} onChange={(e) => set({ title: e.target.value })} data-testid="f-title" className="!text-lg !font-semibold" />
          </Field>
          <IssueList check={check} path="title" />
          <Field label="Tóm tắt" required hint="Tối đa 300 ký tự, hiện ở thẻ bài và kết quả tìm" name="summary">
            <Textarea rows={2} value={form.summary} onChange={(e) => set({ summary: e.target.value })} data-testid="f-summary" />
          </Field>
          <IssueList check={check} path="summary" />
          <div>
            <span className="text-sm font-medium">Nội dung <span className="text-bad" aria-hidden>*</span></span>
            <div className="tiptap-edit mt-1 rounded-md border border-border bg-card">
              {editor && <Toolbar editor={editor} />}
              <EditorContent editor={editor} />
            </div>
          </div>
          <IssueList check={check} path="body" />
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-2">
          <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Thuộc tính</h2>
            <Field label="Danh mục" required name="category">
              <Select value={form.category} onChange={(e) => set({ category: e.target.value })} data-testid="f-category">
                <option value="">Chọn...</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <IssueList check={check} path="category" />
            <Field label="Loại bài" required name="type">
              <Select value={form.type} onChange={(e) => set({ type: e.target.value })} data-testid="f-type">
                <option value="">Chọn...</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <IssueList check={check} path="type" />
            <Field label="Thẻ" hint="Cách nhau dấu phẩy, tối đa 10" name="tags">
              <Input list="kn-tags" value={form.tags} onChange={(e) => set({ tags: e.target.value })} data-testid="f-tags" />
            </Field>
            <datalist id="kn-tags">{known(tagSuggest.data?.items).map((t) => <option key={t} value={t} />)}</datalist>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.for_sale} onChange={(e) => set({ for_sale: e.target.checked })} data-testid="f-for-sale" /> Cho sale (Guest mẫu Sale đọc được)</label>
            <IssueList check={check} path="for_sale" />
            <div className="text-sm">
              <span className="font-medium">File đính kèm</span>
              <ul className="my-1">{files.map((f) => <li key={f.id} className="flex items-center gap-2 [overflow-wrap:anywhere]">{f.filename}<Button variant="ghost" type="button" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>Bỏ</Button></li>)}</ul>
              <input type="file" className="max-w-full text-xs" aria-label="Chọn file đính kèm" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
              <IssueList check={check} path="file_ids" />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 shadow-sm" aria-label="Kết quả kiểm tra">
            <IssueList check={otherIssues(check, FIELDS)} all />
            <ErrorText error={save.error ?? dry.error ?? upload.error ?? (issuesOf(send.error) ? null : send.error)} />
            {check && !check.errors.length && !check.warnings.length && <Notice>Đạt kiểm tra tự động.</Notice>}
            {!check && <p className="text-xs text-muted-foreground">Bấm "Kiểm tra" để xem lỗi và cảnh báo trước khi gửi duyệt.</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={save.isPending} disabled={busy || !loaded} onClick={() => save.mutate()} data-testid="save-draft">Lưu nháp</Button>
              <Button variant="secondary" loading={dry.isPending} disabled={busy || !loaded} onClick={() => dry.mutate()} data-testid="check">Kiểm tra</Button>
              <Button loading={send.isPending} disabled={busy || !loaded} onClick={() => send.mutate()} data-testid="submit">Gửi duyệt</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
