import type * as React from "react";
import { ERROR_CODES, type ErrorCode } from "@soe/shared";
import { ApiError, parseVnDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", ...props }: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    secondary: "border border-border bg-card hover:bg-muted",
    danger: "bg-bad text-white hover:opacity-90",
    ghost: "hover:bg-muted",
  }[variant];
  return <button type="button" className={cn("inline-flex min-h-9 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50", styles, className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn("min-h-9 w-full rounded-md border border-border bg-card px-3 py-1.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary/30", className)} {...props} />;
}

/** Text input for a date and time in the Vietnamese format `dd/mm/yyyy` or `dd/mm/yyyy hh:mm` (24h). */
export function DateTimeInput({ value, onChange, ...props }: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & { value: string; onChange: (v: string) => void }) {
  const bad = value.trim() !== "" && parseVnDateTime(value) === null;
  return (
    <>
      <Input inputMode="numeric" placeholder="dd/mm/yyyy hh:mm" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad} {...props} />
      {bad && <span className="text-xs text-bad">Nhập theo dạng dd/mm/yyyy hoặc dd/mm/yyyy hh:mm, ví dụ 18/11/2026 09:30.</span>}
    </>
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("min-h-9 w-full rounded-md border border-border bg-card px-2 py-1.5 text-base sm:text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("w-full rounded-md border border-border bg-card px-3 py-1.5 text-base sm:text-sm", className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Readable Vietnamese text for an API error: the server's own message when it is Vietnamese, else the description of its error code. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const generic = error.code && error.code in ERROR_CODES ? ERROR_CODES[error.code as ErrorCode].description : undefined;
    const own = error.body?.error.message;
    if (own && /[\u00C0-\u1EF9]/.test(own)) return own; // already Vietnamese
    return generic ?? own ?? `Lỗi ${error.status}`;
  }
  if (error instanceof TypeError) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  return error instanceof Error ? error.message : String(error);
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = errorMessage(error);
  return <p className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{msg}</p>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-ok/10 px-3 py-2 text-sm text-foreground">{children}</p>;
}

export function PageTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold sm:text-2xl">{children}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Horizontal scroll on small screens instead of squashing columns. */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-max text-left text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">{children}</table>
    </div>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-card p-5 shadow-lg sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Đóng">✕</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((i) => (
        <button key={i.value} type="button" onClick={() => onChange(i.value)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", value === i.value ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
