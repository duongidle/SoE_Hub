import { cn } from "@/lib/utils";

export const BRAND_NAME = "SoE HUB";
export const BRAND_SLOGAN = "Solution of Excellence";

/** The square logo mark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-primary text-sm font-bold text-primary-foreground shadow-sm", className)}>
      SH
    </span>
  );
}

/** Name with the slogan under it. `center` stacks it for the sign-in pages. */
export function Brand({ center, compact }: { center?: boolean; compact?: boolean }) {
  if (compact) return <BrandMark />;
  return (
    <span className={cn("flex items-center gap-2.5", center && "flex-col gap-2 text-center")}>
      <BrandMark className={center ? "size-11 text-base" : undefined} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("font-bold tracking-tight text-foreground", center ? "text-xl" : "text-[15px]")}>{BRAND_NAME}</span>
        <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">{BRAND_SLOGAN}</span>
      </span>
    </span>
  );
}
