import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      ok: "bg-ok/15 text-ok",
      warn: "bg-warn/20 text-foreground",
      bad: "bg-bad/15 text-bad",
      muted: "bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { tone: "muted" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
