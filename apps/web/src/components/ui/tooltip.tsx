import * as T from "@radix-ui/react-tooltip";
import type * as React from "react";

/** Short explanation on hover and keyboard focus. Renders in a portal so a scroll box never cuts it. */
export function Tip({ label, children, side = "top" }: { label: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="z-[70] max-w-xs rounded-lg bg-foreground px-2 py-1 text-xs font-medium text-white shadow-md [overflow-wrap:anywhere]">
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
