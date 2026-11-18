import { Lock, RefreshCw } from "lucide-react";
import type * as React from "react";
import { Button, errorMessage } from "@/components/ui/form";

/** Nothing here yet: says so and offers the next step. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A request failed: what happened and a retry button. No codes, no stack. */
export function ErrorState({ error, onRetry, title = "Không tải được dữ liệu" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

export function NoAccessState({ title = "Không có quyền", hint = "Bạn không được mở mục này. Nếu cần, hãy nhờ chủ datahub chia sẻ." }: { title?: string; hint?: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <Lock size={20} aria-hidden className="text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
