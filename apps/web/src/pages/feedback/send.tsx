import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ImagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorText, Field, Modal, Textarea } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { uploadFile } from "@/lib/datahub/api";
import { cn } from "@/lib/utils";
import { FEEDBACK_BODY_MAX, FEEDBACK_FILE_MAX_BYTES, FEEDBACK_MAX_FILES, KIND_LABEL, type FeedbackKind } from "./common";

const KINDS = Object.keys(KIND_LABEL) as FeedbackKind[];

/** The form to send a feedback (design module11 1): kind, text, up to three pictures (pick or paste), and the page info added by itself. */
export function SendFeedbackModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (list: File[]) => {
    setFileError(null);
    const next = [...files];
    for (const f of list) {
      if (!f.type.startsWith("image/")) {
        setFileError(`"${f.name}" không phải ảnh.`);
        continue;
      }
      if (f.size > FEEDBACK_FILE_MAX_BYTES) {
        setFileError(`Ảnh "${f.name}" lớn hơn 5 MB.`);
        continue;
      }
      if (next.length >= FEEDBACK_MAX_FILES) {
        setFileError(`Tối đa ${FEEDBACK_MAX_FILES} ảnh.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    add(imgs.map((f, i) => (f.name ? f : new File([f], `anh-dan-${Date.now()}-${i}.${f.type.split("/")[1] || "png"}`, { type: f.type }))));
  };

  const send = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploadFile(f)).id);
      return api("POST", "/feedback", {
        kind,
        body: body.trim(),
        file_ids: ids,
        context: { url: `${window.location.pathname}${window.location.search}`.slice(0, 500), user_agent: navigator.userAgent.slice(0, 500), viewport: `${window.innerWidth}x${window.innerHeight}` },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      onClose();
      notify.ok("Đã gửi góp ý", { label: "Xem góp ý của tôi", onClick: () => void nav({ to: "/gop-y" }) });
    },
  });
  const ready = kind !== null && body.trim().length > 0;
  return (
    <Modal title="Gửi góp ý" open onClose={onClose} dirty={body.trim().length > 0 || files.length > 0}>
      <form
        className="flex flex-col gap-4"
        onPaste={onPaste}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold">Loại<span className="text-bad" aria-hidden> *</span></span>
          <div role="radiogroup" aria-label="Loại góp ý" className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("min-h-8 cursor-pointer rounded-[9px] border px-3 text-[13px] font-medium transition-colors", kind === k ? "border-primary bg-primary-soft text-primary" : "border-border bg-card hover:border-primary-border hover:bg-primary-soft")}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Nội dung" required hint={`${body.length.toLocaleString("vi-VN")}/${FEEDBACK_BODY_MAX.toLocaleString("vi-VN")} ký tự`}>
          <Textarea aria-label="Nội dung góp ý" rows={6} maxLength={FEEDBACK_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mô tả lỗi hoặc ý tưởng. Có thể dán ảnh bằng Ctrl+V." />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold">Ảnh (tối đa {FEEDBACK_MAX_FILES}, mỗi ảnh 5 MB)</span>
          {files.length > 0 && (
            <ul aria-label="Ảnh đã chọn" className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative size-20 overflow-hidden rounded-[12px] border border-border bg-muted">
                  <img src={previews[i]} alt={f.name} className="size-full object-cover" />
                  <button type="button" aria-label={`Bỏ ảnh ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900/80">
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Chọn ảnh"
              data-testid="feedback-file-input"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button variant="secondary" disabled={files.length >= FEEDBACK_MAX_FILES} onClick={() => input.current?.click()}><ImagePlus size={16} aria-hidden /> Thêm ảnh</Button>
          </div>
          {fileError && <p role="alert" className="text-xs text-bad [overflow-wrap:anywhere]">{fileError}</p>}
        </div>
        <p className="text-xs text-muted-foreground">Hệ thống tự ghi kèm trang đang mở, trình duyệt và cỡ màn hình để dễ tìm lỗi.</p>
        <ErrorText error={send.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={send.isPending} disabled={!ready}>Gửi góp ý</Button>
        </div>
      </form>
    </Modal>
  );
}
