import { Toaster as Sonner, toast } from "sonner";

/** Mounted once, in the shell. Toasts leave by themselves after 4 seconds and never take focus. */
export function Toaster() {
  return <Sonner position="bottom-center" duration={4000} closeButton toastOptions={{ classNames: { toast: "!rounded-card !border-border !bg-card !font-sans !text-sm !text-foreground !shadow-md", actionButton: "!rounded-md !bg-primary !text-primary-foreground" } }} />;
}

/** Short results: "Đã lưu", "Đã xoá 3 dòng". `action` adds a button such as "Hoàn tác". */
export const notify = {
  ok: (message: string, action?: { label: string; onClick: () => void }) => toast.success(message, action ? { action: { label: action.label, onClick: action.onClick }, duration: 8000 } : undefined),
  error: (message: string) => toast.error(message, { duration: 6000 }),
  info: (message: string) => toast(message),
};
