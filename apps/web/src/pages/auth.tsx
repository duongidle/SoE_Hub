import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ErrorText, Field, Input, Notice } from "@/components/ui/form";
import { api, fmtTime } from "@/lib/api";

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => api<{ google_enabled: boolean; allowed_domains: string[] }>("GET", "/auth/config") });
  const urlError = new URLSearchParams(window.location.search).get("loi");
  const m = useMutation({
    mutationFn: () => api("POST", "/auth/login", { email, password }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      await nav({ to: "/" });
    },
  });
  return (
    <AuthCard title="Đăng nhập">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder={`ten@${cfg.data?.allowed_domains[0] ?? "base.vn"}`} />
        </Field>
        <Field label="Mật khẩu">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {urlError && !m.error && <ErrorText error={urlError} />}
        <ErrorText error={m.error} />
        <Button type="submit" disabled={m.isPending}>
          {m.isPending ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>
      {cfg.data?.google_enabled && (
        <a href="/api/auth/google/start" className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-muted">
          Đăng nhập bằng Google
        </a>
      )}
      <div className="flex justify-between text-sm">
        <Link to="/dang-ky" className="text-primary underline">
          Đăng ký lần đầu
        </Link>
        <Link to="/quen-mat-khau" className="text-primary underline">
          Quên mật khẩu
        </Link>
      </div>
    </AuthCard>
  );
}

/**
 * Registration and forgotten password share one flow (module1 6.2, 6.3):
 * email -> a 6-digit code is sent as an in-app notification to the approvers -> enter code + new password.
 */
export function CodeFlowPage({ purpose }: { purpose: "activate" | "reset" }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const request = useMutation({
    mutationFn: () => api<{ expires_at: string; recipients: string[]; server_command_needed: boolean }>("POST", "/auth/codes", { email, purpose }),
    onSuccess: () => setStep("code"),
  });
  const verify = useMutation({
    mutationFn: () => api("POST", "/auth/codes/verify", { email, purpose, code, password }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      await nav({ to: "/" });
    },
  });
  const title = purpose === "activate" ? "Đăng ký lần đầu" : "Quên mật khẩu";
  return (
    <AuthCard title={title}>
      {step === "email" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Hệ thống không gửi email. Sau khi bấm nút, mã 6 số được gửi qua thông báo trong ứng dụng cho leader, manager hoặc Admin của bạn. Hãy liên hệ họ để xin mã.
          </p>
          <Field label="Email công ty">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <ErrorText error={request.error} />
          <Button type="submit" disabled={request.isPending}>
            Xin mã
          </Button>
          <Button variant="ghost" onClick={() => email && setStep("code")} disabled={!email}>
            Tôi đã có mã
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== password2) return setMismatch(true);
            setMismatch(false);
            verify.mutate();
          }}
        >
          {request.data && (
            <Notice>
              Đã gửi yêu cầu.{" "}
              {request.data.server_command_needed
                ? "Chưa có người nhận mã: Admin cần chạy lệnh auth:reset-code trên server."
                : `Người nhận mã: ${request.data.recipients.join(", ")}.`}{" "}
              Mã hết hạn lúc {fmtTime(request.data.expires_at)}.
            </Notice>
          )}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Mã 6 số">
            <Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          </Field>
          <Field label={purpose === "activate" ? "Đặt mật khẩu" : "Mật khẩu mới"} hint="Tối thiểu 6 ký tự, không dùng mật khẩu phổ biến.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Field label="Nhập lại mật khẩu">
            <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
          </Field>
          {mismatch && <ErrorText error="Hai mật khẩu không khớp." />}
          <ErrorText error={verify.error} />
          <Button type="submit" disabled={verify.isPending}>
            {purpose === "activate" ? "Kích hoạt và đăng nhập" : "Đặt lại mật khẩu"}
          </Button>
          <Button variant="ghost" onClick={() => setStep("email")}>
            Xin mã khác
          </Button>
        </form>
      )}
      <Link to="/dang-nhap" className="text-sm text-primary underline">
        Về trang đăng nhập
      </Link>
    </AuthCard>
  );
}

export function SetPasswordPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const m = useMutation({
    mutationFn: () => api("POST", "/auth/password/set", { new_password: pw }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      await nav({ to: "/" });
    },
  });
  return (
    <AuthCard title="Đặt mật khẩu">
      <p className="text-sm text-muted-foreground">Lần đầu đăng nhập bằng Google cần đặt mật khẩu, để sau này vẫn đăng nhập được bằng email + mật khẩu.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Mật khẩu" hint="Tối thiểu 6 ký tự.">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </Field>
        <ErrorText error={m.error} />
        <Button type="submit" disabled={m.isPending}>
          Lưu mật khẩu
        </Button>
      </form>
    </AuthCard>
  );
}
