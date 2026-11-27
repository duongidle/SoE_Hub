import { Toaster as Sonner, toast } from "sonner";

/**
 * Mounted once, in the shell. Toasts leave by themselves after 4 seconds and never take focus.
 * `expand`: toasts sit one above the other, each whole, so a new toast never covers the "Hoàn tác" button of an older one
 * (Sonner's default stacks them like a deck and hides all but the front one until the pointer hovers).
 */
export function Toaster() {
  return <Sonner position="bottom-center" duration={4000} closeButton expand visibleToasts={MAX_SHOWN} toastOptions={{ classNames: { toast: "!rounded-card !border-border !bg-card !font-sans !text-sm !text-foreground !shadow-md", actionButton: "!rounded-md !bg-primary !text-primary-foreground" } }} />;
}

/** At most this many toasts on screen; past it the oldest plain toast goes first, one with an action button stays until its time is up. */
const MAX_SHOWN = 4;
/** The toasts on screen, oldest first: id -> has an action button. */
const live = new Map<string | number, boolean>();

type Action = { label: string; onClick: () => void };

function show(kind: "success" | "error" | "message", message: string, duration: number | undefined, action?: Action) {
  // Make room: drop the oldest plain toast first, then (only if all have actions) the oldest one.
  while (live.size >= MAX_SHOWN) {
    const victim = [...live].find(([, hasAction]) => !hasAction)?.[0] ?? live.keys().next().value;
    if (victim === undefined) break;
    live.delete(victim);
    toast.dismiss(victim);
  }
  const forget = () => {
    live.delete(id);
  };
  const id: string | number = (kind === "message" ? toast : toast[kind])(message, {
    ...(duration ? { duration } : {}),
    ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}),
    onDismiss: forget,
    onAutoClose: forget,
  });
  live.set(id, !!action);
  return id;
}

/** Short results: "Đã lưu", "Đã xoá 3 dòng". `action` adds a button such as "Hoàn tác". */
export const notify = {
  ok: (message: string, action?: Action) => show("success", message, action ? 8000 : undefined, action),
  error: (message: string) => show("error", message, 6000),
  info: (message: string) => show("message", message, undefined),
};
