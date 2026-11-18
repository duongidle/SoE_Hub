import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchHealth } from "@/lib/api";

const WORKER_LABEL = { ok: "Đang chạy", stale: "Không phản hồi", unknown: "Chưa có tín hiệu" } as const;

export function HealthCard() {
  const q = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 15_000, retry: false });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tình trạng hệ thống</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Row label="API">
          {q.isPending ? <Badge>Đang kiểm tra</Badge> : q.isError ? <Badge tone="bad">Không kết nối được</Badge> : <Badge tone="ok">Hoạt động</Badge>}
        </Row>
        <Row label="Cơ sở dữ liệu">
          {q.data ? <Badge tone={q.data.db === "ok" ? "ok" : "bad"}>{q.data.db === "ok" ? "Hoạt động" : "Lỗi"}</Badge> : <Badge>-</Badge>}
        </Row>
        <Row label="Worker (tác vụ nền)">
          {q.data ? <Badge tone={q.data.worker.status === "ok" ? "ok" : q.data.worker.status === "stale" ? "bad" : "warn"}>{WORKER_LABEL[q.data.worker.status]}</Badge> : <Badge>-</Badge>}
        </Row>
        {q.data?.worker.age_seconds != null && <p className="text-xs text-muted-foreground">Tín hiệu worker gần nhất cách đây {q.data.worker.age_seconds} giây.</p>}
        {q.isError && <p className="text-xs text-bad">{q.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
