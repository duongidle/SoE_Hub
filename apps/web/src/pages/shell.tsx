import { Link, Outlet } from "@tanstack/react-router";

export function Shell() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <span className="text-lg font-semibold text-primary">SoE Hub</span>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">
              Tổng quan
            </Link>
            <Link to="/he-thong" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">
              Hệ thống
            </Link>
          </nav>
          <a href="/api/docs" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            Tài liệu API
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
