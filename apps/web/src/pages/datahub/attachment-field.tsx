import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button, errorMessage } from "@/components/ui/form";
import { Tip } from "@/components/ui/tooltip";
import { attachmentInfo, attachmentUrl, storageAddress, uploadFile, type FileBrief } from "@/lib/datahub/api";
import { ApiError } from "@/lib/api";

const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB` : `${(n / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`);

/** Upload errors as a sentence that says what to do. */
export function uploadError(e: unknown, name: string): string {
  if (e instanceof ApiError) {
    if (e.code === "payload_too_large") return `File "${name}" quá lớn. Chọn file nhỏ hơn.`;
    if (e.code === "unsupported_media_type") return `Chưa nhận loại file của "${name}". Dùng ảnh, PDF, CSV, văn bản, Excel hoặc Word.`;
    if (e.code === "quota_exceeded") return "Tài khoản đã hết dung lượng lưu file. Xoá bớt file cũ rồi thử lại.";
  }
  return `Không tải được "${name}". ${errorMessage(e)}`;
}

/**
 * The files of one cell: names and sizes (from the server, since the cell only holds file ids), a download button for each, remove, and
 * upload. Uploads go through the file storage of Stage 0 (init, PUT, complete); the cell changes only after a file is complete.
 */
export function AttachmentField({ tableId, ids, max, readonly, onChange }: { tableId: string; ids: string[]; max: number; readonly: boolean; onChange: (ids: string[]) => void }) {
  const [known, setKnown] = useState<Record<string, FileBrief>>({});
  const q = useQuery({ queryKey: ["dh-attachments", tableId, ids.join(",")], queryFn: () => attachmentInfo(tableId, ids.filter((i) => !known[i])), enabled: ids.some((i) => !known[i]), staleTime: 60_000 });
  const info = (id: string): FileBrief | undefined => known[id] ?? q.data?.find((f) => f.id === id);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    let next = [...ids];
    for (const file of Array.from(list)) {
      if (next.length >= max) {
        setError(`Mỗi ô chỉ có tối đa ${max} file.`);
        break;
      }
      setBusy((b) => [...b, file.name]);
      try {
        const f = await uploadFile(file);
        setKnown((k) => ({ ...k, [f.id]: f }));
        next = [...next, f.id];
        onChange(next);
      } catch (e) {
        setError(uploadError(e, file.name));
      } finally {
        setBusy((b) => b.filter((x) => x !== file.name));
      }
    }
    if (input.current) input.current.value = "";
  };

  const download = async (id: string) => {
    try {
      const d = await attachmentUrl(tableId, id);
      const a = document.createElement("a");
      a.href = storageAddress(d.url);
      a.download = d.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(`Không mở được file. ${errorMessage(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      {ids.length === 0 && busy.length === 0 && <p className="text-muted-foreground">Chưa có file nào.</p>}
      <ul aria-label="File đính kèm" className="flex flex-col gap-1">
        {ids.map((id) => {
          const f = info(id);
          return (
            <li key={id} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
              <Paperclip size={16} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block [overflow-wrap:anywhere]">{f ? f.filename : q.isLoading ? "Đang tải tên file…" : "File"}</span>
                {f && <span className="text-xs text-muted-foreground">{sizeText(f.size_bytes)}</span>}
              </span>
              <Tip label="Tải về"><Button variant="ghost" aria-label={`Tải về ${f?.filename ?? "file"}`} onClick={() => void download(id)} className="!px-2"><Download size={16} aria-hidden /></Button></Tip>
              {!readonly && <Tip label="Gỡ khỏi ô"><Button variant="ghost" aria-label={`Gỡ ${f?.filename ?? "file"} khỏi ô`} onClick={() => onChange(ids.filter((x) => x !== id))} className="!px-2 !text-bad"><X size={16} aria-hidden /></Button></Tip>}
            </li>
          );
        })}
        {busy.map((n) => (
          <li key={`busy-${n}`} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-muted-foreground" aria-busy="true">
            <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />
            <span className="[overflow-wrap:anywhere]">Đang tải lên {n}…</span>
          </li>
        ))}
      </ul>
      {!readonly && (
        <div>
          <input ref={input} type="file" multiple hidden aria-label="Chọn file để tải lên" onChange={(e) => void add(e.target.files)} data-testid="attachment-input" />
          <Button variant="secondary" disabled={busy.length > 0 || ids.length >= max} onClick={() => input.current?.click()}><Paperclip size={16} aria-hidden /> Tải file lên</Button>
          {ids.length >= max && <span className="ml-2 text-xs text-muted-foreground">Đã đủ {max} file.</span>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-bad [overflow-wrap:anywhere]">{error}</p>}
    </div>
  );
}
