import * as D from "@radix-ui/react-dropdown-menu";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Menu in a portal (never cut by a scroll box); arrow keys, Esc and type-ahead come from Radix. */
export function Menu({ trigger, children, align = "end" }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content align={align} sideOffset={4} className="contain-scroll z-[60] min-w-44 max-w-xs rounded-xl border border-border bg-card p-1 text-sm shadow-md">
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function MenuItem({ className, danger, ...props }: React.ComponentProps<typeof D.Item> & { danger?: boolean }) {
  return <D.Item className={cn("flex min-h-11 cursor-default sm:min-h-9 select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-primary-soft", danger && "text-bad", className)} {...props} />;
}

export const MenuSeparator = () => <D.Separator className="my-1 h-px bg-border" />;
