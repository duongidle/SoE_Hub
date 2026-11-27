// What the editor shows for each kind of question and block: icon, color group (the type picker), and the groups themselves.
import { AlignLeft, Banknote, Calendar, CalendarClock, CircleDot, FolderTree, Heading, Hash, Image, Link as LinkIcon, Link2, ListChecks, Mail, Minus, Paperclip, Percent, Phone, Pilcrow, Scissors, SlidersHorizontal, SquareCheck, Star, Type, UserRound } from "lucide-react";
import type * as React from "react";

export type KindTone = "info" | "warn" | "ok" | "primary" | "ai" | "muted";
export interface KindMeta { icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; tone: KindTone }

/** Soft background + text color of a tone, as in the badges and chips elsewhere (colors by meaning). */
export const TONE_CLS: Record<KindTone, string> = {
  info: "bg-info-bg text-info",
  warn: "bg-warn-bg text-warn",
  ok: "bg-ok-bg text-ok",
  primary: "bg-primary-soft text-primary",
  ai: "bg-ai-bg text-ai",
  muted: "bg-muted text-muted-foreground",
};

export const DOT_CLS: Record<KindTone, string> = { info: "bg-info-dot", warn: "bg-warn-dot", ok: "bg-ok-dot", primary: "bg-primary", ai: "bg-ai-dot", muted: "bg-faint" };

export const KIND_META: Record<string, KindMeta> = {
  text: { icon: Type, tone: "info" },
  long_text: { icon: AlignLeft, tone: "info" },
  email: { icon: Mail, tone: "info" },
  phone: { icon: Phone, tone: "info" },
  url: { icon: LinkIcon, tone: "info" },
  number: { icon: Hash, tone: "warn" },
  currency: { icon: Banknote, tone: "warn" },
  percent: { icon: Percent, tone: "warn" },
  rating: { icon: Star, tone: "warn" },
  scale: { icon: SlidersHorizontal, tone: "warn" },
  single_select: { icon: CircleDot, tone: "ok" },
  multi_select: { icon: ListChecks, tone: "ok" },
  checkbox: { icon: SquareCheck, tone: "ok" },
  date: { icon: Calendar, tone: "primary" },
  datetime: { icon: CalendarClock, tone: "primary" },
  attachment: { icon: Paperclip, tone: "ai" },
  user: { icon: UserRound, tone: "ai" },
  relation: { icon: Link2, tone: "ai" },
  heading: { icon: Heading, tone: "muted" },
  plain_text: { icon: Pilcrow, tone: "muted" },
  image: { icon: Image, tone: "muted" },
  divider: { icon: Minus, tone: "muted" },
  page_break: { icon: Scissors, tone: "muted" },
  group: { icon: FolderTree, tone: "muted" },
};

/** The groups of the type picker. `items` are question inputs, or `block:<type>` for the other blocks. */
export const PICKER_GROUPS: { title: string; tone: KindTone; items: string[] }[] = [
  { title: "Văn bản", tone: "info", items: ["text", "long_text", "email", "phone", "url"] },
  { title: "Số", tone: "warn", items: ["number", "currency", "percent", "rating", "scale"] },
  { title: "Lựa chọn", tone: "ok", items: ["single_select", "multi_select", "checkbox"] },
  { title: "Ngày", tone: "primary", items: ["date", "datetime"] },
  { title: "Dữ liệu", tone: "ai", items: ["attachment", "user", "relation"] },
  { title: "Bố cục", tone: "muted", items: ["block:heading", "block:text", "block:image", "block:divider", "block:page_break", "block:group"] },
];
export const BLOCK_NAME: Record<string, string> = { heading: "Tiêu đề", text: "Đoạn chữ", image: "Ảnh", divider: "Đường kẻ", page_break: "Ngắt trang", group: "Nhóm câu" };
/** The icon of a block in the table of contents and the picker. */
export const metaOf = (type: string, input?: string): KindMeta => (type === "question" ? KIND_META[input ?? ""] : KIND_META[type === "text" ? "plain_text" : type]) ?? KIND_META.text!;
