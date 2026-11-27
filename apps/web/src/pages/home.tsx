import { useMe } from "@/lib/session";
import { DashboardTabs } from "./home-tabs";
import { AnnouncementSide, OnboardingSide, RecentSide, RemindersSide } from "./home-side";

const TZ = "Asia/Ho_Chi_Minh";

/** "Chào buổi chiều" by the hour in Vietnam. */
export function greetingFor(now: Date): string {
  const h = Number(now.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2));
  return h < 11 ? "Chào buổi sáng" : h < 13 ? "Chào buổi trưa" : h < 18 ? "Chào buổi chiều" : "Chào buổi tối";
}

/** "Thứ Năm 27/11/2026" */
export function dateLine(now: Date): string {
  const weekday = now.toLocaleDateString("vi-VN", { timeZone: TZ, weekday: "long" });
  const [y, m, d] = now.toLocaleDateString("en-CA", { timeZone: TZ }).split("-");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d}/${m}/${y}`;
}

/** Tổng quan (design module12 mockup `de_xuat/tong_quan.html`): one greeting line, the dashboard tabs, and a right column of what to do next. */
export function Home() {
  const me = useMe().data;
  const now = new Date();
  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <h1 className="sr-only">Xin chào, {me?.user.full_name}</h1>
      <p className="mb-3 text-sm text-muted-foreground" data-testid="home-greeting">
        {greetingFor(now)}, <b className="text-foreground">{me?.user.full_name}</b> · {dateLine(now)}
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <DashboardTabs />
        <div className="flex flex-col gap-4">
          <OnboardingSide />
          <RecentSide />
          <RemindersSide />
          <AnnouncementSide />
        </div>
      </div>
    </div>
  );
}
