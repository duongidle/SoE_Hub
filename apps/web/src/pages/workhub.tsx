import { EmptyState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/form";

/** Workhub: where the team will hand out and follow work. A placeholder until module 10 (no API yet). */
export function WorkhubPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Workhub</PageTitle>
      <EmptyState title="Tính năng đang phát triển" hint="Nơi giao việc và theo dõi công việc của team. Sẽ có trong bản cập nhật tới." />
    </div>
  );
}
