// The page of a person filling a form: `/f/<code>`, outside the app shell. A public form needs no login; an internal form uses the login
// (design module7 3, 4, 5). The page asks the internal door first when someone is logged in and falls back to the public one.
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Check, CheckCircle2, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/form";
import { PersonChip } from "@/components/ui/person";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { accentOf, FormRenderer, formProgress } from "./renderer";
import { flat, type FormConfig, isSelect, type Question } from "./model";

interface FillView {
  mode: "public" | "internal";
  code: string;
  name: string;
  state: string;
  message: string | null;
  config: FormConfig | null;
  fill_token: string | null;
  attempt_id: string;
  draft?: Record<string, unknown> | null;
  form_updated?: boolean;
  already_submitted?: boolean;
  quiz?: { max_attempts: number; attempts_used: number; show: string } | null;
}
interface QuizOut { score: number; max: number; result: string | null; pending: boolean }
interface Done { thank_you: { text?: string; redirect_url?: string; again?: boolean } | null; quiz: QuizOut | null }

async function loadView(code: string, loggedIn: boolean): Promise<FillView | { notFound: true }> {
  if (loggedIn) {
    try {
      return { mode: "internal", ...(await api<Omit<FillView, "mode">>("GET", `/fill/${code}`)) };
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "not_found")) throw e;
    }
  }
  try {
    return { mode: "public", ...(await api<Omit<FillView, "mode">>("GET", `/public/forms/${code}`)) };
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_found") return { notFound: true };
    throw e;
  }
}

const questionsOf = (cfg: FormConfig): Question[] => flat(cfg.blocks).filter((f) => f.block.type === "question").map((f) => f.block as Question);

/** Answers that come from the link: `?<param>=<value>`. Select values are names there; the form keeps option ids. */
function fromLink(cfg: FormConfig): { all: Record<string, unknown>; hidden: Record<string, unknown> } {
  const sp = new URLSearchParams(window.location.search);
  const all: Record<string, unknown> = {};
  const hidden: Record<string, unknown> = {};
  for (const q of questionsOf(cfg)) {
    if (!q.param) continue;
    const raw = sp.get(q.param);
    if (raw === null || raw === "") continue;
    let v: unknown = raw;
    if (isSelect(q.input)) {
      const one = (x: string) => (q.options ?? []).find((o) => o.id === x.trim())?.id ?? (q.options ?? []).find((o) => o.label.trim().toLowerCase() === x.trim().toLowerCase())?.id ?? x.trim();
      v = q.input === "multi_select" ? raw.split(",").map(one) : one(raw);
    } else if (["number", "currency", "percent", "rating", "scale"].includes(q.input) && Number.isFinite(Number(raw.replace(",", ".")))) v = Number(raw.replace(",", "."));
    else if (q.input === "checkbox") v = ["true", "1", "yes", "co", "có"].includes(raw.toLowerCase());
    all[q.id] = v;
    if (q.hidden) hidden[q.id] = v;
  }
  return { all, hidden };
}

const draftKey = (code: string) => `soe-form-draft:${code}`;
const readLocal = (key: string): Record<string, unknown> | null => {
  try {
    const t = window.localStorage.getItem(key);
    return t ? (JSON.parse(t) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: Record<string, unknown> | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the browser may block storage: the draft is a convenience only */
  }
};

/** The file box of an `attachment` question on a public form: asks for an upload link, sends the file, confirms it. */
function FileBox({ code, token, attemptId, q, value, set }: { code: string; token: string; attemptId: string; q: Question; value: unknown; set: (v: unknown) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      const next = [...ids];
      const nm = { ...names };
      for (const file of Array.from(files)) {
        const init = await api<{ file_id: string; upload: { url: string; method: string; headers: Record<string, string> } }>("POST", `/public/forms/${code}/uploads`, { fill_token: token, attempt_id: attemptId, question_id: q.id, filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size });
        const put = await fetch(init.upload.url, { method: init.upload.method, headers: init.upload.headers, body: file });
        if (!put.ok) throw new Error("Không tải được file lên.");
        await api("POST", `/public/forms/${code}/uploads/${init.file_id}/complete`, { fill_token: token, attempt_id: attemptId });
        next.push(init.file_id);
        nm[init.file_id] = file.name;
      }
      setNames(nm);
      set(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tải được file lên.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`file-${q.id}`}>
      <input id={`q-${q.id}`} type="file" multiple disabled={busy} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} className="max-w-full text-sm" />
      {busy && <span className="text-xs text-muted-foreground">Đang tải file…</span>}
      {ids.map((id) => (
        <div key={id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-sm">
          <span className="min-w-0 [overflow-wrap:anywhere]">{names[id] ?? "File đã tải"}</span>
          <button type="button" className="text-xs text-bad" onClick={() => set(ids.filter((x) => x !== id))}>Bỏ</button>
        </div>
      ))}
      {err && <span role="alert" className="text-xs text-bad">{err}</span>}
    </div>
  );
}

/** The page outside the app shell: a soft two-glow background, a frosted bar pinned to the top, the content below (module 12: public form). */
function Shell({ bar, children }: { bar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background" style={{ backgroundImage: "radial-gradient(48rem 26rem at 8% -8%, rgb(79 70 229 / 0.12), transparent 65%), radial-gradient(44rem 26rem at 100% 4%, rgb(16 185 129 / 0.10), transparent 65%)" }} data-testid="fill-page">
      {bar}
      <div className="mx-auto w-full px-3 py-4 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}

function TopBar({ name, chip, progress, draft, accent }: { name: string; chip?: string; progress?: { done: number; total: number } | null; draft?: string | null; accent?: string }) {
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-border-soft bg-card/80 backdrop-blur-md" data-testid="fill-bar">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-3 sm:px-6">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-primary text-sm font-bold text-primary-foreground" aria-hidden>S</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:flex-none sm:text-base" title={name}>{name}</span>
        {chip && <Badge tone="primary" className="hidden shrink-0 sm:inline-flex">{chip}</Badge>}
        <span className="hidden flex-1 sm:block" />
        {draft && <span className="hidden shrink-0 items-center gap-1 text-xs text-ok sm:inline-flex lg:hidden"><Check size={14} aria-hidden />Đã lưu nháp</span>}
        {progress && progress.total > 0 && <Badge tone="primary" className="shrink-0 tabular-nums" data-testid="fill-progress">{progress.done}/{progress.total} câu</Badge>}
      </div>
      {progress && <div className="h-[3px] bg-border-soft"><div className="h-full transition-[width] duration-300" style={{ width: pct + "%", background: "linear-gradient(90deg, " + (accent ?? "var(--primary)") + ", color-mix(in srgb, " + (accent ?? "var(--primary)") + " 55%, #38bdf8))" }} /></div>}
    </header>
  );
}

function Notice({ title, text, children, icon }: { title: string; text?: string | null; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Shell bar={<TopBar name="SoE HUB" />}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-card border border-border bg-card p-6 text-center shadow-card sm:p-8" data-testid="fill-notice">
        {icon}
        <h1 className="text-lg font-semibold [overflow-wrap:anywhere]">{title}</h1>
        {text && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{text}</p>}
        {children}
      </div>
    </Shell>
  );
}

export function FillPage() {
  const { code } = useParams({ strict: false }) as { code: string };
  const meQ = useMe();
  const q = useQuery({ queryKey: ["fill-view", code, meQ.data?.user.id ?? null], queryFn: () => loadView(code, !!meQ.data), enabled: !meQ.isLoading, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  if (meQ.isLoading || q.isLoading) return <Notice title="Đang tải…" />;
  if (q.error) return <Notice title="Không mở được form" text={q.error instanceof ApiError ? q.error.message : "Không kết nối được máy chủ."} />;
  const v = q.data!;
  if ("notFound" in v) {
    return (
      <Notice title="Không tìm thấy form" text="Link không đúng, form đã bị xoá, hoặc form này cần đăng nhập.">
        {!meQ.data && <a className="text-sm text-primary underline" href={`/dang-nhap?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>Đăng nhập</a>}
      </Notice>
    );
  }
  return <Filler key={`${v.code}:${v.attempt_id}`} view={v} reload={() => void q.refetch()} />;
}

function Filler({ view, reload }: { view: FillView; reload: () => void }) {
  const cfg = view.config;
  const internal = view.mode === "internal";
  const key = draftKey(view.code);
  const initial = useMemo(() => {
    if (!cfg) return {};
    const link = fromLink(cfg);
    const saved = internal ? (view.draft ?? null) : readLocal(key);
    return { ...link.all, ...(saved ?? {}), ...link.hidden };
  }, [cfg, internal, key, view.draft]);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const trap = useRef<HTMLInputElement>(null);
  const touched = useRef(false);
  const meQ = useMe();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restored] = useState(() => Object.keys(initial).length > 0 && (internal ? !!view.draft : readLocal(key) !== null));

  // The draft: the browser keeps a public one, the server an internal one (after each change, a moment later).
  useEffect(() => {
    if (!touched.current || done) return;
    if (!internal) return;
    const t = window.setTimeout(() => { void api("PUT", `/fill/${view.code}/draft`, { answers }).then(() => setSavedAt(new Date())).catch(() => undefined); }, 600);
    return () => window.clearTimeout(t);
  }, [answers, done, internal, key, view.code]);

  const change = useCallback((next: Record<string, unknown>) => {
    touched.current = true;
    if (!internal) {
      writeLocal(key, next);
      setSavedAt(new Date());
    }
    setAnswers(next);
    setErrors({});
    setBanner(null);
  }, [internal, key]);

  if (view.state !== "open" || !cfg) return <Notice title={view.state === "closed" ? "Form đã đóng" : view.state === "paused" ? "Form đang tạm dừng" : "Form chưa mở"} text={closed ?? view.message ?? "Form này hiện không nhận phản hồi."} />;
  if (closed) return <Notice title="Form đã đóng" text={closed} />;
  if (internal && view.already_submitted) {
    return (
      <Notice title={view.quiz ? "Bạn đã làm hết số lần cho phép" : "Bạn đã gửi form này rồi"} text={view.name}>
        {view.quiz && <a className="text-sm text-primary underline" href={`/form/bai-lam?code=${view.code}`}>Bài làm của tôi</a>}
      </Notice>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setErrors({});
    setBanner(null);
    try {
      const body = { answers, attempt_id: view.attempt_id };
      const out = internal
        ? await api<{ thank_you: Done["thank_you"]; quiz: QuizOut | null }>("POST", `/fill/${view.code}/submit`, body)
        : await api<{ thank_you: Done["thank_you"]; quiz: QuizOut | null }>("POST", `/public/forms/${view.code}/submit`, { ...body, fill_token: view.fill_token, website: trap.current?.value ?? "" });
      if (internal) await api("DELETE", `/fill/${view.code}/draft`).catch(() => undefined);
      else writeLocal(key, null);
      const url = out.thank_you?.redirect_url;
      if (url && /^https?:\/\//i.test(url)) {
        window.location.href = url;
        return;
      }
      setDone({ thank_you: out.thank_you, quiz: out.quiz });
    } catch (e) {
      if (e instanceof ApiError) {
        const issues = (e.details?.issues as { question_id: string | null; message: string }[] | undefined) ?? [];
        const byQ: Record<string, string> = {};
        for (const i of issues) if (i.question_id) byQ[i.question_id] = i.message;
        const dupId = typeof e.details?.question_id === "string" ? (e.details.question_id as string) : null;
        if (dupId) byQ[dupId] = e.message;
        if (Object.keys(byQ).length) setErrors(byQ);
        const reason = e.details?.reason as string | undefined;
        if (reason && reason.startsWith("form_")) setClosed((e.details?.closed_message as string | undefined) ?? e.message);
        else setBanner(e.message);
      } else setBanner("Không gửi được, kiểm tra kết nối rồi thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    const ty = done.thank_you ?? {};
    const qz = done.quiz;
    return (
      <Notice title={ty.text || "Cảm ơn bạn đã gửi phản hồi."} icon={<span className="flex size-14 items-center justify-center rounded-full bg-ok-bg text-ok ring-8 ring-ok-bg/60"><CheckCircle2 size={30} aria-hidden /></span>}>
        {qz && (
          <p className="flex flex-wrap items-center justify-center gap-2 text-sm" data-testid="quiz-result">
            {qz.pending ? <><Badge tone="warn">Chờ chấm</Badge>Bài của bạn đang chờ chấm.</> : <><span className="text-2xl font-semibold tabular-nums">{qz.score}/{qz.max}</span>{qz.result && <Badge tone={/^đạt$/i.test(qz.result) ? "ok" : "bad"}>{qz.result}</Badge>}<span className="sr-only">Điểm: {qz.score}/{qz.max}{qz.result ? " · " + qz.result : ""}</span></>}
          </p>
        )}
        {internal && view.quiz && <a className="text-sm text-primary underline" href={`/form/bai-lam?code=${view.code}`} data-testid="my-quiz-link">Bài làm của tôi</a>}
        {!view.quiz && ty.again !== false && <Button variant="secondary" onClick={reload} data-testid="fill-again">Gửi phản hồi khác</Button>}
      </Notice>
    );
  }

  const attachment = !internal
    ? (qq: Question, value: unknown, set: (v: unknown) => void) => <FileBox code={view.code} token={view.fill_token ?? ""} attemptId={view.attempt_id} q={qq} value={value} set={set} />
    : (_q: Question) => <p className="text-sm text-muted-foreground">Tải file chỉ có ở form công khai.</p>;
  const info = view.form_updated ? <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="form-updated">Form vừa được cập nhật. Câu trả lời của các câu còn lại đã được giữ.</p> : null;
  const submitErr = banner ? <p role="alert" className="rounded-md border border-bad/40 px-3 py-2 text-sm text-bad" data-testid="fill-error">{banner}</p> : null;
  const me = meQ.data?.user;
  const today = new Date().toLocaleDateString("vi-VN");
  const progress = formProgress(cfg, answers);
  const quizOn = !!cfg.quiz?.enabled;
  const kind = quizOn ? "Bài kiểm tra" : internal ? "Form nội bộ" : "Form công khai";
  const draftNote = savedAt ? "Đã lưu nháp lúc " + savedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : restored ? "Đã khôi phục bản nháp" : null;
  const filler = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-soft bg-muted/60 px-4 py-3" data-testid="fill-who">
      <div className="flex min-w-0 items-center gap-3">
        {internal && me ? <PersonChip person={{ id: me.id, full_name: me.full_name }} /> : <span className="flex items-center gap-2 text-sm"><span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary"><User size={16} aria-hidden /></span>Khách, không cần đăng nhập</span>}
        <span className="text-xs text-muted-foreground">Ngày {today}</span>
      </div>
      <Badge tone="ok">Đang điền</Badge>
    </div>
  );
  return (
    <Shell bar={<TopBar name={cfg.title || view.name} chip={kind} progress={progress} draft={draftNote} accent={accentOf(cfg)} />}>
      <FormRenderer
        mode="fill"
        chip={kind}
        filler={filler}
        draftNote={draftNote}
        submitLabel={quizOn ? "Nộp bài" : "Gửi"}
        config={cfg}
        answers={answers}
        onChange={change}
        onSubmit={() => void submit()}
        submitting={submitting}
        errors={errors}
        renderAttachment={attachment}
        fallbackTitle={view.name}
        banner={<>{info}{submitErr}</>}
      />
      {!internal && (
        <div aria-hidden className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label>Website<input ref={trap} name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
        </div>
      )}
    </Shell>
  );
}
