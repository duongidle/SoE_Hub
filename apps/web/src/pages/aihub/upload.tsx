import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { CircleCheck, CircleX, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, ErrorText, Field, Input, PageTitle, Select, Textarea } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { CLIENT_LABEL, GROUP_LABEL, IssueList, issuesOf, type CheckResult } from "../library/common";

type Pkg = { kind: "zip"; name: string; zip_base64: string } | { kind: "files"; name: string; files: { path: string; content: string; encoding: "utf8" | "base64" }[] };
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
async function readFiles(list: { path: string; file: File }[]): Promise<Pkg> {
  // A folder is dropped as "<folder>/SKILL.md": the folder name is not part of the package.
  const roots = new Set(list.map((x) => x.path.split("/")[0]));
  const strip = roots.size === 1 && list.every((x) => x.path.includes("/"));
  const files = await Promise.all(
    list.map(async ({ path, file }) => {
      const p = strip ? path.split("/").slice(1).join("/") : path;
      return IMAGE.test(p) ? { path: p, content: toBase64(await file.arrayBuffer()), encoding: "base64" as const } : { path: p, content: await file.text(), encoding: "utf8" as const };
    }),
  );
  return { kind: "files", name: `${[...roots][0] ?? "thư mục"} (${files.length} file)`, files };
}
type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void) => void } };
async function walk(entry: Entry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res) => entry.file!(res));
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader!();
    for (;;) {
      const batch = await new Promise<Entry[]>((res) => reader.readEntries(res));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
    }
  }
}

/** Upload a skill (zip, folder, or dropped folder), run the check, send it. `/ai-hub/tai-len/$id` sends a new package for an existing skill of mine. */
export function SkillUploadPage() {
  const params = useParams({ strict: false }) as { id?: string };
  const nav = useNavigate();
  const [id, setId] = useState(params.id);
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [form, setForm] = useState({ group: "", tags: "", clients: [] as string[], version: "1.0.0", change_note: "", replaces: "" });
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const folder = useRef<HTMLInputElement>(null);
  const published = useQuery({ queryKey: ["aihub", "published-names"], queryFn: () => api<{ id: string; name: string }[]>("GET", "/aihub/search?limit=50&sort=newest") });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const body = () => ({
    ...(pkg ? (pkg.kind === "zip" ? { zip_base64: pkg.zip_base64 } : { files: pkg.files }) : {}),
    group: form.group || null,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    clients: form.clients,
    version: form.version,
    change_note: form.change_note,
    replaces: form.replaces || null,
  });
  const pick = async (fn: () => Promise<Pkg>) => {
    setReadErr(null);
    try { setPkg(await fn()); setCheck(null); } catch (e) { setReadErr(e instanceof Error ? e.message : "Không đọc được gói."); }
  };
  const onZip = (f: File) => void pick(async () => ({ kind: "zip", name: f.name, zip_base64: toBase64(await f.arrayBuffer()) }));
  const dry = useMutation({
    mutationFn: () => api<{ ok: boolean } & CheckResult>("POST", "/aihub/skills/submit", { id, check_only: true, ...body() }),
    onSuccess: (r) => { setCheck(r); notify.ok(r.ok ? (r.warnings.length ? "Đạt, có cảnh báo" : "Đạt kiểm tra") : "Chưa đạt kiểm tra"); },
  });
  const send = useMutation({
    mutationFn: () => api<{ post_id: string; published: boolean; check: CheckResult }>("POST", "/aihub/skills/submit", { id, ...body() }),
    onSuccess: (r) => { setId(r.post_id); notify.ok(r.published ? "Đã xuất bản" : "Đã gửi duyệt"); void nav({ to: "/ai-hub/cua-toi" }); },
    onError: (e) => setCheck(issuesOf(e)),
  });
  const ready = !!pkg || !!id;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageTitle>{params.id ? "Gửi bản mới của skill" : "Tải lên skill"}</PageTitle>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div
            className="rounded-card border-2 border-dashed border-primary-border bg-primary-soft/40 p-5 text-sm"
            data-testid="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry() as Entry | null).filter((x): x is Entry => !!x);
              const zip = [...e.dataTransfer.files].find((f) => /\.zip$/i.test(f.name));
              if (zip) return onZip(zip);
              void pick(async () => { const out: { path: string; file: File }[] = []; for (const en of items) await walk(en, "", out); return readFiles(out); });
            }}
          >
            <div className="mb-2 flex items-center gap-2 font-semibold"><Upload size={18} aria-hidden className="text-primary" />Gói skill</div>
            <p className="mb-3 text-muted-foreground">Chọn file zip, chọn thư mục, hoặc kéo thả vào đây. Thư mục có <code>SKILL.md</code> ở gốc, đầu file có <code>name</code> và <code>description</code>.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">File zip <input type="file" accept=".zip" aria-label="Chọn file zip" data-testid="zip-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) onZip(f); }} /></label>
              <Button type="button" variant="secondary" onClick={() => folder.current?.click()}>Chọn thư mục</Button>
              <input
                ref={folder}
                type="file"
                className="hidden"
                aria-label="Chọn thư mục"
                // @ts-expect-error webkitdirectory is not in the React types
                webkitdirectory=""
                multiple
                onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void pick(() => readFiles(fs.map((file) => ({ path: (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name, file })))); e.target.value = ""; }}
              />
            </div>
            {pkg && <p className="mt-2 font-medium" data-testid="pkg-name">Đã chọn: {pkg.name}</p>}
            {params.id && !pkg && <p className="mt-2 text-muted-foreground">Không chọn gói mới thì chỉ lưu và gửi lại các trường bên dưới.</p>}
            {readErr && <p role="alert" className="mt-2 text-bad">{readErr}</p>}
          </div>
  
          <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap gap-4">
              <Field label="Nhóm">
                <Select value={form.group} onChange={(e) => set({ group: e.target.value })} data-testid="f-group">
                  <option value="">Chọn...</option>
                  {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Phiên bản"><Input value={form.version} onChange={(e) => set({ version: e.target.value })} data-testid="f-version" /></Field>
            </div>
            <Field label="Thẻ" hint="Cách nhau dấu phẩy"><Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} data-testid="f-tags" /></Field>
            <fieldset className="text-sm">
              <legend className="font-medium">Client dùng được</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {Object.entries(CLIENT_LABEL).map(([k, v]) => (
                  <label key={k} className="flex min-h-9 items-center gap-1.5"><input type="checkbox" checked={form.clients.includes(k)} onChange={(e) => set({ clients: e.target.checked ? [...form.clients, k] : form.clients.filter((c) => c !== k) })} /> {v}</label>
                ))}
              </div>
            </fieldset>
            <Field label="Phiên bản mới của skill đã có" hint="Chọn nếu đây là bản cập nhật: skill cũ được lưu trữ khi bản này xuất bản">
              <Select value={form.replaces} onChange={(e) => set({ replaces: e.target.value })} data-testid="f-replaces">
                <option value="">Không, đây là skill mới</option>
                {published.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Ghi chú thay đổi"><Textarea rows={2} value={form.change_note} onChange={(e) => set({ change_note: e.target.value })} /></Field>
          </div>
        </div>
        <aside className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm lg:sticky lg:top-2" aria-label="Kết quả kiểm tra">
          <h2 className="text-sm font-semibold">Kết quả kiểm tra</h2>
          {!check && <p className="text-xs text-muted-foreground">Chọn gói rồi bấm "Kiểm tra": lỗi chặn gửi duyệt, cảnh báo thì người duyệt xem xét.</p>}
          {check && <p className="flex items-center gap-1.5 text-sm">{check.errors.length ? <><CircleX size={16} aria-hidden className="text-bad" />{check.errors.length} lỗi, {check.warnings.length} cảnh báo</> : check.warnings.length ? <><TriangleAlert size={16} aria-hidden className="text-warn" />Đạt, {check.warnings.length} cảnh báo</> : <><CircleCheck size={16} aria-hidden className="text-ok" />Đạt kiểm tra tự động</>}</p>}
          <IssueList check={check} all />
          <ErrorText error={dry.error ?? (issuesOf(send.error) ? null : send.error)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={dry.isPending} disabled={!ready || send.isPending} onClick={() => dry.mutate()} data-testid="check">Kiểm tra</Button>
            <Button loading={send.isPending} disabled={!ready || dry.isPending} onClick={() => send.mutate()} data-testid="submit">Gửi duyệt</Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
