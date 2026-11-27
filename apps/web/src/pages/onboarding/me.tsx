import { Link } from "@tanstack/react-router";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/session";
import { OnbNav, usePlans } from "./common";
import { PlanView } from "./plan-view";

/** The page of the person being onboarded: Journey, Today, My results. */
export function MyOnboardingPage() {
  const me = useMe().data;
  const plans = usePlans("mine");
  const mine = (plans.data ?? []).filter((p) => p.staff_id === me?.user.id);
  const plan = mine.find((p) => p.status === "active") ?? mine[0];
  return (
    <div>
      <PageTitle>Onboarding</PageTitle>
      <OnbNav active="me" />
      {plans.error ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : plans.isLoading ? <div aria-busy="true" className="flex flex-col gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /><p className="sr-only">Đang tải...</p></div> : !plan
        ? <EmptyState title="Bạn chưa có lộ trình onboarding" hint="Khi Leader gắn lộ trình cho bạn, hành trình và việc của bạn hiện ở đây." action={<Link to="/" className="text-sm font-medium text-primary">Về trang chủ</Link>} />
        : <PlanView planId={plan.id} />}
    </div>
  );
}
