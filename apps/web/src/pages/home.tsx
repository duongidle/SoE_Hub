import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthCard } from "./health-card";

export function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Chào mừng đến SoE Hub</h1>
        <p className="mt-1 text-muted-foreground">Nền tảng của hệ thống đã chạy. Các chức năng nghiệp vụ sẽ được thêm theo từng giai đoạn.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <HealthCard />
        <Card>
          <CardHeader>
            <CardTitle>Giai đoạn hiện tại</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Stage 0: nền tảng (API, cơ sở dữ liệu, nhật ký, sự kiện, tác vụ nền, tài liệu API). Chưa có đăng nhập và chưa có dữ liệu nghiệp vụ.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
