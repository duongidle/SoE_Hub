import { formatRelative } from "@soe/shared";

/** "Cập nhật vừa xong", "Cập nhật 5 phút trước", "Cập nhật ngày 21/11/2026 09:30": the sentence that goes on a datahub card. */
export function updatedText(iso: string | null | undefined, now?: Date): string {
  if (!iso) return "";
  const r = formatRelative(iso, now);
  if (!r || r === "—") return "";
  if (r === "Vừa xong") return "Cập nhật vừa xong";
  return /^\d{2}\/\d{2}\//.test(r) ? `Cập nhật ngày ${r}` : `Cập nhật ${r}`;
}
