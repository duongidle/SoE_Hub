import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Side panel that slides in from the right (420px, or 560px with `wide`) for the detail of a row or an item.
 * Same behaviour as Modal: focus trap, Esc and the close button close it, and `dirty` asks before dropping unsaved changes.
 * Full width under 640px.
 */
export function Drawer({ title, open, onClose, children, dirty, wide, footer }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode; dirty?: boolean; wide?: boolean; footer?: React.ReactNode }) {
  const [asking, setAsking] = React.useState(false);
  const tryClose = () => {
    if (dirty) setAsking(true);
    else onClose();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && tryClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-fade fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn("drawer-panel fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-lg sm:rounded-l-card", wide ? "sm:w-[560px]" : "sm:w-[420px]")}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-soft px-5 py-3">
            <Dialog.Title className="text-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{title}</Dialog.Title>
            <Button variant="ghost" onClick={tryClose} aria-label="Đóng" className="shrink-0 !px-2">
              <X size={20} aria-hidden />
            </Button>
          </div>
          <div className="contain-scroll-y min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="border-t border-border-soft px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
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
