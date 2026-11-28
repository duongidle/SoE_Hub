import { Link, useNavigate } from "@tanstack/react-router";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { Button, PageTitle } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnbAccess } from "./common";
import { OverviewBody } from "./follow";
import { PlanView } from "./plan-view";

/** Entry of Onboarding. Own running plan: the Journey. No own plan but may follow or manage people: the overview. Nothing: the empty screen. */
export function MyOnboardingPage() {
  const a = useOnbAccess();
  const nav = useNavigate();
  if (a.error) return <div><PageTitle>Onboarding</PageTitle><ErrorState error={a.error} onRetry={a.refetch} /></div>;
  if (a.loading) return <div><PageTitle>Onboarding</PageTitle><div aria-busy="true" className="flex flex-col gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /><p className="sr-only">Đang tải...</p></div></div>;
  if (a.ownPlan) {
    return (
      <div>
        <PageTitle actions={a.overview ? <Button variant="secondary" onClick={() => void nav({ to: "/onboarding/theo-doi" })} data-testid="onb-open-overview">Tổng quan</Button> : undefined}>Onboarding</PageTitle>
        <PlanView planId={a.ownPlan.id} />
      </div>
    );
  }
  if (a.overview) return <OverviewBody />;
  return (
    <div>
      <PageTitle>Onboarding</PageTitle>
      <EmptyState title="Bạn chưa có lộ trình onboarding" hint="Khi Leader gắn lộ trình cho bạn, hành trình và việc của bạn hiện ở đây." action={<Link to="/" className="text-sm font-medium text-primary">Về trang chủ</Link>} />
    </div>
  );
}
