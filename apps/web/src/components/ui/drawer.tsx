import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Side panel that slides in from the right (420px, or 560px with `wide`) for the detail of a row or an item.
 * Same behaviour as Modal: focus trap, Esc and the close button close it, and `dirty` asks before dropping unsaved changes.
 * Full width under 640px. `headerExtra` sits beside the title, `subHeader` is a fixed strip under it (tabs); `width` replaces the default width class (for example "sm:w-[480px]"). `soft` is kept for old callers and no longer changes anything (every drawer has the same veil). A floating card 12px from the edges, 490px at most (`wide` or `width` for the few that need more).
 */
export function Drawer({ title, titleNode, open, onClose, children, dirty, wide, footer, headerExtra, subHeader, width }: { title: string; /** What the header shows in place of the text of `title` (chips of the row number and main value); `title` stays the accessible name. */ titleNode?: React.ReactNode; open: boolean; onClose: () => void; children: React.ReactNode; dirty?: boolean; wide?: boolean; footer?: React.ReactNode; headerExtra?: React.ReactNode; subHeader?: React.ReactNode; soft?: boolean; width?: string }) {
  const [asking, setAsking] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const tryClose = () => {
    if (dirty) setAsking(true);
    else onClose();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && tryClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-fade fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          // Open on the panel itself, not on the first button (the "previous row" arrow would show a focus ring at once).
          tabIndex={-1}
          ref={panelRef}
          onOpenAutoFocus={(e) => { e.preventDefault(); panelRef.current?.focus({ preventScroll: true }); }}
          className={cn("drawer-panel outline-none fixed bottom-3 right-3 top-3 z-50 flex w-[calc(100%-1.5rem)] max-w-[490px] flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-2xl", wide && "sm:max-w-[640px]", width ?? (wide ? "sm:w-[640px]" : "sm:w-[490px]"))}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-soft bg-muted/50 px-5 py-3">
            <Dialog.Title className="min-w-0 flex-1 text-base font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
              {titleNode ? (
                <>
                  <span className="sr-only">{title}</span>
                  <span aria-hidden className="flex min-w-0 items-center gap-2">{titleNode}</span>
                </>
              ) : title}
            </Dialog.Title>
            {headerExtra}
            <Button variant="ghost" onClick={tryClose} aria-label="Đóng" className="shrink-0 !px-2">
              <X size={20} aria-hidden />
            </Button>
          </div>
          {subHeader}
          <div className="contain-scroll-y min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="border-t border-border-soft bg-muted/50 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
          {asking && (
            <div role="alertdialog" aria-label="Bỏ thay đổi?" className="flex flex-wrap items-center justify-between gap-2 border-t border-warn-border bg-warn-bg p-3 text-sm">
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
