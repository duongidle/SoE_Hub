import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/form";
import { fetchHealth } from "@/lib/api";
import { HealthCard } from "./health-card";

export function SystemPage() {
  const q = useQuery({ queryKey: ["health"], queryFn: fetchHealth, retry: false });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Tình trạng hệ thống</PageTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <HealthCard />
        <Card>
          <CardHeader>
            <CardTitle>Phản hồi của /health</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{q.data ? JSON.stringify(q.data, null, 2) : q.isError ? q.error.message : "Đang tải..."}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
