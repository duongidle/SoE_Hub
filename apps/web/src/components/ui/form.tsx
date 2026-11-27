import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import * as React from "react";
import { ERROR_CODES, type ErrorCode } from "@soe/shared";
import { ApiError, parseVnDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { useCrumbs, usePageChrome } from "@/lib/page-chrome";

export function Button({ className, variant = "primary", loading, disabled, children, ...props }: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
    secondary: "border border-border bg-card text-foreground hover:border-primary-border hover:bg-primary-soft",
    danger: "bg-bad text-white shadow-sm hover:opacity-90",
    ghost: "text-foreground hover:bg-primary-soft",
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-[transform,background-color,border-color] duration-100 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 sm:min-h-9 sm:min-w-0", styles, className)}
      {...props}
    >
      {loading && <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn("min-h-11 w-full rounded-md border border-border bg-card px-3 py-1.5 text-base outline-none transition-colors placeholder:text-faint hover:border-primary-border focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-bad sm:min-h-9 sm:text-sm", className)} {...props} />;
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

export { Select } from "./select";
export type { SelectChange } from "./select";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("w-full rounded-md border border-border bg-card px-3 py-1.5 text-base outline-none transition-colors placeholder:text-faint hover:border-primary-border focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-bad sm:text-sm", className)} {...props} />;
}

export function Field({ label, hint, error, required, name, children }: { label: string; hint?: string; error?: string | null; required?: boolean; name?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm" data-field={name}>
      <span className="font-medium text-foreground">{label}{required && <span className="text-bad" aria-hidden> *</span>}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
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
  return <p className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{msg}</p>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-ok-border bg-ok-bg px-3 py-2 text-sm text-ok">{children}</p>;
}

/**
 * Page title. Inside the shell the breadcrumb already names the page, so the h1 stays only for screen readers (sr-only)
 * and the title becomes the last breadcrumb when the menu does not already say it. `actions` move to the top bar.
 */
export function PageTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const chrome = usePageChrome();
  const text = typeof children === "string" ? children : null;
  useCrumbs(text);
  const add = chrome?.addActions;
  const has = !!actions;
  React.useLayoutEffect(() => {
    if (!add || !has) return;
    add(1);
    return () => add(-1);
  }, [add, has]);
  const slot = chrome?.actionsEl ?? null;
  if (chrome && text !== null) {
    return <>
      <h1 className="sr-only">{children}</h1>
      {actions && slot ? createPortal(actions, slot) : null}
    </>;
  }
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{children}</h1>
      {actions && (slot ? createPortal(actions, slot) : <div className="flex flex-wrap gap-2">{actions}</div>)}
    </div>
  );
}

/** Horizontal scroll on small screens instead of squashing columns. */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card shadow-card">
      <table className="w-full min-w-max text-left text-sm [&_td]:border-t [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2.5 [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_tbody_tr:hover]:bg-primary-soft/40">{children}</table>
    </div>
  );
}

/** Dialog with focus trap, Esc to close and a close button. `dirty` asks before closing with unsaved changes. */
export function Modal({ title, open, onClose, children, dirty, wide }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode; dirty?: boolean; wide?: boolean }) {
  const [asking, setAsking] = React.useState(false);
  const tryClose = () => {
    if (dirty) setAsking(true);
    else onClose();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && tryClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-fade fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn("contain-scroll-y fixed bottom-0 left-1/2 z-50 max-h-[90dvh] w-full -translate-x-1/2 overflow-y-auto rounded-t-card border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-card", wide ? "max-w-2xl" : "max-w-lg")}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <Dialog.Title className="text-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{title}</Dialog.Title>
            <Button variant="ghost" onClick={tryClose} aria-label="Đóng" className="shrink-0 !px-2">
              <X size={20} aria-hidden />
            </Button>
          </div>
          {children}
          {asking && (
            <div role="alertdialog" aria-label="Bỏ thay đổi?" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn-border bg-warn-bg p-3 text-sm">
              <span>Có thay đổi chưa lưu. Đóng và bỏ thay đổi?</span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => setAsking(false)}>Tiếp tục sửa</Button>
                <Button variant="danger" onClick={() => { setAsking(false); onClose(); }}>Bỏ thay đổi</Button>
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmation of a destructive action: the danger button is apart from the safe one. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, busy }: { title: string; message: React.ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal title={title} open onClose={onClose}>
      <p className="text-sm [overflow-wrap:anywhere]">{message}</p>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={onClose}>Giữ lại</Button>
        <Button variant="danger" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border-soft">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)} className={cn("-mb-px whitespace-nowrap rounded-t-md border-b-2 px-3 py-3 text-sm transition-colors sm:py-2", value === i.value ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:bg-primary-soft hover:text-foreground")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
