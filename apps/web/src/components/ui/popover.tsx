import * as P from "@radix-ui/react-popover";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A panel that opens under a button, in a portal (never cut by a scroll box). Esc and a click outside close it; focus moves into
 * it and comes back to the button. It never grows past the window: taller content scrolls inside.
 */
export function Popover({ trigger, children, label, align = "start", width = "w-[28rem]", open, onOpenChange, className, fixedSide }: { fixedSide?: boolean; trigger: React.ReactNode; children: React.ReactNode; label: string; align?: "start" | "center" | "end"; width?: string; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string }) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          aria-label={label}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          // `fixedSide`: stay on the same side when the content grows (a panel that flips above and below as it grows never settles).
          avoidCollisions={!fixedSide}
          // Opened from inside a dialog, the modal dialog turns pointer events off for everything outside it; the panel must still be clickable.
          style={{ pointerEvents: "auto" }}
          className={cn("contain-scroll z-[60] max-h-[min(80dvh,var(--radix-popover-content-available-height))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-card p-3 text-sm shadow-md outline-none", width, className)}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** A popover whose anchor is a point on the screen (for a menu opened from a spot of the canvas). */
export function PointPopover({ at, label, children, onClose, className }: { at: { x: number; y: number } | null; label: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  return (
    <P.Root open={!!at} onOpenChange={(o) => !o && onClose()}>
      <P.Anchor asChild>
        <span aria-hidden className="pointer-events-none fixed h-px w-px" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} />
      </P.Anchor>
      <P.Portal>
        <P.Content aria-label={label} align="start" sideOffset={4} collisionPadding={8} className={cn("contain-scroll z-[60] max-h-[min(80dvh,var(--radix-popover-content-available-height))] min-w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-card p-1 text-sm shadow-md outline-none", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
