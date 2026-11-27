import { Inbox, Lock, RefreshCw, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Button, errorMessage } from "@/components/ui/form";

/** Nothing here yet: says so and offers the next step. */
export function EmptyState({ title, hint, action, cta }: { title: string; hint?: string; action?: React.ReactNode; cta?: EmptyCta }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <span aria-hidden className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Inbox size={20} />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {cta ? (
        <div className="mt-2">
          <Button onClick={cta.onClick}>
            {cta.icon} {cta.label}
          </Button>
        </div>
      ) : (
        action && <div className="mt-2">{action}</div>
      )}
    </div>
  );
}

/** The next step offered by an empty state. The caller passes it only to people allowed to do it (leave `cta` out otherwise). */
export interface EmptyCta {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

/** A filter or search matched nothing: says so and clears the filter in one click. */
export function FilteredEmptyState({ onClear, title = "Không có kết quả phù hợp", hint = "Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá." }: { onClear: () => void; title?: string; hint?: string }) {
  return <EmptyState title={title} hint={hint} cta={{ label: "Xoá bộ lọc", onClick: onClear }} />;
}

/** A request failed: what happened and a retry button. No codes, no stack. */
export function ErrorState({ error, onRetry, title = "Không tải được dữ liệu" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <span aria-hidden className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-bad-bg text-bad">
        <TriangleAlert size={20} />
      </span>
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
      <span aria-hidden className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-warn-bg text-warn">
        <Lock size={20} />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
