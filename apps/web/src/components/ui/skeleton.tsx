import type * as React from "react";
import { cn } from "@/lib/utils";

/** A grey block with the layout of the real content. Pulses slowly; stays still when the person asks for less motion. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} {...props} />;
}
