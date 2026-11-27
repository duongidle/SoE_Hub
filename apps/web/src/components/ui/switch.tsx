import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An on/off setting as a sliding switch (a real checkbox underneath, laid transparently over the track, so a screen reader, the keyboard
 * and a test treat it as a checkbox named by its label). `hint` is the small grey line under the label.
 */
export function Switch({ checked, onChange, label, hint, disabled, className, testid }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean; className?: string; testid?: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start justify-between gap-4 py-1.5 sm:min-h-9", disabled && "cursor-not-allowed opacity-50", className)}>
      <span className="min-w-0 text-sm">
        <span className="block font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="relative mt-0.5 h-6 w-10 shrink-0">
        <input type="checkbox" className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
        />
      </span>
    </label>
  );
}
