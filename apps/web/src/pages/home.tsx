import { Link } from "@tanstack/react-router";
import { ROLE_LABELS, type Role } from "@soe/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/lib/session";
import { HealthCard } from "./health-card";

export function Home() {
  const me = useMe().data;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Xin chào, {me?.user.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Vai trò: {me?.user.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ")}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Việc thường dùng</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link to="/thong-bao" className="text-primary underline">Hộp thông báo</Link>
            <Link to="/tai-khoan" className="text-primary underline">Đổi mật khẩu, thiết bị đăng nhập</Link>
            <Link to="/tai-khoan/token" className="text-primary underline">Token cá nhân</Link>
          </CardContent>
        </Card>
        <HealthCard />
      </div>
    </div>
  );
}
