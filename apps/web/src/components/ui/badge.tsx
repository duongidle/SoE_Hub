import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Colors by meaning: ok = done, info = in progress, warn = waiting / due soon, bad = overdue / error, ai = special group / AI. */
const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      ok: "border-ok-border bg-ok-bg text-ok",
      info: "border-info-border bg-info-bg text-info",
      warn: "border-warn-border bg-warn-bg text-warn",
      bad: "border-bad-border bg-bad-bg text-bad",
      ai: "border-ai-border bg-ai-bg text-ai",
      primary: "border-primary-border bg-primary-soft text-primary",
      muted: "border-border-soft bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { tone: "muted" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
