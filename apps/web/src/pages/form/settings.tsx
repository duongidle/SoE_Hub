// Tabs Share, Settings and Quiz of the form editor (design module7 3, 6.3, 8, 14).
import { useMutation } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Select, Textarea } from "@/components/ui/form";
import { PeopleField } from "@/components/ui/people-field";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/toast";
import { api, fmtTime, parseVnDateTime } from "@/lib/api";
import { ACCENTS, type Appearance, type FormConfig, type FormDetail, type Quiz } from "./model";

const Check = ({ checked, onChange, children, disabled, testid }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean; testid?: string }) => (
  <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />{children}</label>
);
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => <section className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-5"><div><h2 className="font-semibold">{title}</h2>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>{children}</section>;

/** A list of people (ids) as a field: label, a button to the multi picker and the chosen people. */
function PeopleList({ label, value, onChange, teams }: { label: string; value: string[]; onChange: (v: string[]) => void; teams?: boolean }) {
  return <Field label={label}><PeopleField testid={`people-${label}`} label={label} value={value} onChange={onChange} teams={teams} /></Field>;
}

const toIso = (t: string): string | null => parseVnDateTime(t)?.toISOString() ?? null;

export function ShareTab({ form, reload }: { form: FormDetail; reload: () => void }) {
  const [rotate, setRotate] = useState(false);
  const link = `${window.location.origin}/f/${form.code}`;
  const upd = useMutation({ mutationFn: (b: Record<string, unknown>) => api("PATCH", `/forms/${form.id}`, b), onSuccess: reload });
  const rot = useMutation({ mutationFn: () => api("POST", `/forms/${form.id}/rotate-link`), onSuccess: () => { setRotate(false); notify.ok("Đã đổi link, link cũ không dùng được nữa"); reload(); } });
  const aud = form.audience;
  const setAud = (p: Partial<FormDetail["audience"]>) => upd.mutate({ audience: { ...aud, ...p } });
  return (
    <div>
      <Section title="Ai điền được">
        <Field label="Cách mở">
          <Select value={form.access} onChange={(e) => upd.mutate({ access: e.target.value })} data-testid="access">
            <option value="public">Công khai (ai có link)</option>
            <option value="all_accounts">Mọi tài khoản (không gồm Guest)</option>
            <option value="selected">Chọn người</option>
          </Select>
        </Field>
        {form.access === "selected" && (
          <div className="flex flex-col gap-3" data-testid="audience">
            <PeopleList label="Người được điền" value={aud.user_ids} onChange={(v) => setAud({ user_ids: v })} />
            <PeopleList label="Leader (cả team của họ)" value={aud.team_ids} onChange={(v) => setAud({ team_ids: v })} teams={false} />
            <div>
              <p className="text-sm font-medium">Vai trò</p>
              {(["manager", "leader", "user"] as const).map((r) => <Check key={r} checked={aud.roles.includes(r)} onChange={(v) => setAud({ roles: v ? [...aud.roles, r] : aud.roles.filter((x) => x !== r) })}>{{ manager: "Manager", leader: "Leader", user: "User" }[r]}</Check>)}
            </div>
            <div>
              <p className="text-sm font-medium">Guest</p>
              {(["sale", "data"] as const).map((r) => <Check key={r} checked={aud.guest_presets.includes(r)} onChange={(v) => setAud({ guest_presets: v ? [...aud.guest_presets, r] : aud.guest_presets.filter((x) => x !== r) })}>Mọi Guest mẫu {r === "sale" ? "Sale" : "Data"}</Check>)}
            </div>
          </div>
        )}
        <ErrorText error={upd.error} />
      </Section>
      <Section title="Link">
        <Input readOnly value={link} aria-label="Link form" data-testid="form-link" onFocus={(e) => e.currentTarget.select()} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(link).then(() => notify.ok("Đã sao chép link")); }} data-testid="copy-link"><Copy size={14} aria-hidden /> Sao chép</Button>
          <Button variant="secondary" onClick={() => setRotate(true)} data-testid="rotate-link"><RefreshCw size={14} aria-hidden /> Đổi link</Button>
        </div>
        <ErrorText error={rot.error} />
      </Section>
      {rotate && <ConfirmDialog title="Đổi link" message="Link cũ sẽ không dùng được ngay. Người đang giữ link cũ phải nhận link mới." confirmLabel="Đổi link" busy={rot.isPending} onConfirm={() => rot.mutate()} onClose={() => setRotate(false)} />}
    </div>
  );
}

export function SettingsTab({ form, cfg, change, reload, reloadDraft, flush }: { form: FormDetail; cfg: FormConfig; change: (c: FormConfig) => void; reload: () => void; reloadDraft: () => Promise<void>; flush: () => Promise<void> }) {
  const o = form.options;
  const [name, setName] = useState(form.name);
  const [openAt, setOpenAt] = useState(o.open_at ? fmtTime(o.open_at) : "");
  const [closeAt, setCloseAt] = useState(o.close_at ? fmtTime(o.close_at) : "");
  const upd = useMutation({ mutationFn: (b: Record<string, unknown>) => api("PATCH", `/forms/${form.id}`, b), onSuccess: reload });
  const setOpt = (p: Record<string, unknown>) => upd.mutate({ options: { ...o, ...p } });
  const status = useMutation({ mutationFn: (s: string) => api("POST", `/forms/${form.id}/status`, { status: s }), onSuccess: reload });
  const quiz: Quiz = cfg.quiz ?? { enabled: false, scale: "100", max_attempts: 1, show: "none", pass: null };
  const setQuiz = (p: Partial<Quiz>) => change({ ...cfg, quiz: { ...quiz, ...p } });
  const [quizErr, setQuizErr] = useState<string | null>(null);
  const graders = useMutation({ mutationFn: (ids: string[]) => api("PATCH", `/forms/${form.id}`, { options: { ...form.options, graders: ids } }), onSuccess: reload });
  const ap = cfg.appearance ?? {};
  const setAp = (p: Partial<Appearance>) => change({ ...cfg, appearance: { ...ap, ...p } });
  const ty = ap.thank_you ?? {};
  const [json, setJson] = useState("");
  const exp = useMutation({ mutationFn: async () => { await flush(); return api<unknown>("GET", `/forms/export?form_id=${form.id}`); }, onSuccess: (r) => setJson(JSON.stringify(r, null, 2)) });
  const imp = useMutation({ mutationFn: async () => { let parsed: unknown; try { parsed = JSON.parse(json); } catch { throw new Error("JSON không hợp lệ."); } return api("PUT", `/forms/${form.id}/json`, { json: parsed }); }, onSuccess: async () => { notify.ok("Đã nhập JSON vào bản nháp"); await reloadDraft(); } });
  return (
    <div>
      <Section title="Chung">
        <Field label="Tên form"><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== form.name && upd.mutate({ name: name.trim() })} data-testid="settings-name" /></Field>
        <Field label="Trạng thái" hint={form.state_reason ?? undefined}>
          <Select value={form.status === "draft" ? "" : form.status} onChange={(e) => e.target.value && status.mutate(e.target.value)} disabled={form.published_version === 0} data-testid="status">
            {form.status === "draft" && <option value="">Nháp (chưa xuất bản)</option>}
            <option value="open">Đang nhận</option><option value="paused">Tạm dừng</option><option value="closed">Đã đóng</option>
          </Select>
        </Field>
        <Field label="Mở lúc" hint="Giờ Việt Nam, dd/mm/yyyy hh:mm. Để trống nếu mở ngay."><Input value={openAt} placeholder="dd/mm/yyyy hh:mm" onChange={(e) => setOpenAt(e.target.value)} onBlur={() => setOpt({ open_at: openAt.trim() ? toIso(openAt) : null })} /></Field>
        <Field label="Đóng lúc"><Input value={closeAt} placeholder="dd/mm/yyyy hh:mm" onChange={(e) => setCloseAt(e.target.value)} onBlur={() => setOpt({ close_at: closeAt.trim() ? toIso(closeAt) : null })} /></Field>
        <Field label="Số phản hồi tối đa" hint="Tổng số phản hồi của cả form, đủ số này thì form tự đóng. Khác với “Số lần làm” của mỗi người trong Chế độ Bài kiểm tra."><Input type="number" min={1} defaultValue={o.max_responses ?? ""} onBlur={(e) => setOpt({ max_responses: e.target.value === "" ? null : Number(e.target.value) })} data-testid="max-responses" /></Field>
        {!quiz.enabled && <Switch checked={!!o.one_per_user} disabled={form.access === "public"} onChange={(v) => setOpt({ one_per_user: v })} testid="one-per-user" label="Mỗi người một phản hồi" hint="Chỉ dùng cho form nội bộ" />}
        <Field label="Câu hiện khi form đóng"><Input defaultValue={o.closed_message ?? ""} maxLength={300} onBlur={(e) => setOpt({ closed_message: e.target.value.trim() || null })} /></Field>
        <Switch checked={false} disabled onChange={() => undefined} testid="notify-new-response" label={<>Nhận thông báo khi có phản hồi mới <span className="rounded bg-muted px-1.5 text-xs font-normal">Sắp có</span></>} />
        <ErrorText error={upd.error ?? status.error} />
      </Section>
      <Section title="Bài kiểm tra" hint="Chấm điểm bài làm của người điền. Chỉ dùng cho form nội bộ.">
        <Switch
          checked={quiz.enabled}
          testid="quiz-enabled"
          label="Chế độ Bài kiểm tra"
          hint="Bật thì mỗi câu có điểm và đáp án; người làm được làm nhiều lần theo “Số lần làm”."
          onChange={(on) => {
            if (on && form.access === "public") { setQuizErr("Bài kiểm tra chỉ dùng cho form nội bộ. Đổi cách mở ở bước Chia sẻ trước."); return; }
            setQuizErr(null);
            setQuiz({ enabled: on, ...(on ? { scale: quiz.scale || "100" } : {}) });
          }}
        />
        {quizErr && <p className="text-sm text-bad" role="alert">{quizErr}</p>}
        {quiz.enabled && (
          <div className="flex flex-col gap-3 border-t border-border-soft pt-3" data-testid="quiz-settings">
            <Field label="Thang điểm"><Select value={quiz.scale} onChange={(e) => setQuiz({ scale: e.target.value as Quiz["scale"] })}><option value="100">Quy về 100</option><option value="raw">Giữ nguyên điểm</option></Select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Điểm đạt"><Input type="number" min={0} value={quiz.pass?.value ?? ""} placeholder="Không đặt" onChange={(e) => setQuiz({ pass: e.target.value === "" ? null : { type: quiz.pass?.type ?? "percent", value: Number(e.target.value) } })} data-testid="quiz-pass" /></Field>
              <Field label="Tính theo"><Select value={quiz.pass?.type ?? "percent"} disabled={!quiz.pass} onChange={(e) => setQuiz({ pass: { type: e.target.value as "points" | "percent", value: quiz.pass?.value ?? 0 } })}><option value="percent">%</option><option value="points">Điểm</option></Select></Field>
            </div>
            <Field label="Số lần làm tối đa" hint="Số lần mỗi người được làm bài. Khác với “Số phản hồi tối đa” ở trên, là tổng của cả form."><Input type="number" min={1} max={20} value={quiz.max_attempts} onChange={(e) => setQuiz({ max_attempts: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} data-testid="quiz-attempts" /></Field>
            <Field label="Người làm bài thấy">
              <Select value={quiz.show} onChange={(e) => setQuiz({ show: e.target.value as Quiz["show"] })} data-testid="quiz-show"><option value="none">Không thấy gì</option><option value="score">Chỉ điểm và Đạt / Không đạt</option><option value="score_answers">Điểm và đáp án đúng (sau khi form đóng)</option></Select>
            </Field>
            <PeopleList label="Người chấm (ngoài chủ form)" value={form.options.graders ?? []} onChange={(v) => graders.mutate(v)} />
            <ErrorText error={graders.error} />
            <p className="text-xs text-muted-foreground">Đáp án và điểm của từng câu đặt ở bước Thiết kế, khi chọn câu hỏi.</p>
          </div>
        )}
      </Section>
      <Section title="Giao diện form">
        <Field label="Ảnh bìa (URL)"><Input value={ap.cover ?? ""} onChange={(e) => setAp({ cover: e.target.value || undefined })} /></Field>
        <Field label="Logo (URL)"><Input value={ap.logo ?? ""} onChange={(e) => setAp({ logo: e.target.value || undefined })} /></Field>
        <Field label="Màu nhấn"><Select value={ap.accent ?? "blue"} onChange={(e) => setAp({ accent: e.target.value })}>{Object.entries(ACCENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        <Field label="Độ rộng"><Select value={ap.width ?? "medium"} onChange={(e) => setAp({ width: e.target.value as Appearance["width"] })}><option value="narrow">Hẹp</option><option value="medium">Vừa</option><option value="wide">Rộng</option></Select></Field>
        <Field label="Lời cảm ơn sau khi gửi"><Textarea rows={2} value={ty.text ?? ""} placeholder="Cảm ơn bạn đã gửi phản hồi." onChange={(e) => setAp({ thank_you: { ...ty, text: e.target.value || undefined } })} /></Field>
        <Field label="Hoặc chuyển tới URL"><Input value={ty.redirect_url ?? ""} onChange={(e) => setAp({ thank_you: { ...ty, redirect_url: e.target.value || undefined } })} /></Field>
        <Switch checked={ty.again !== false} onChange={(v) => setAp({ thank_you: { ...ty, again: v } })} label={'Hiện nút "Gửi phản hồi khác"'} />
        <p className="text-xs text-muted-foreground">Thay đổi giao diện nằm trong bản nháp, hiện cho người điền sau khi xuất bản.</p>
      </Section>
      <Section title="JSON">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exp.mutate()} loading={exp.isPending} data-testid="json-export">Xuất JSON</Button>
          <Button variant="secondary" onClick={() => imp.mutate()} loading={imp.isPending} disabled={!json.trim()} data-testid="json-import">Nhập JSON vào bản nháp</Button>
        </div>
        <Textarea rows={8} value={json} onChange={(e) => setJson(e.target.value)} aria-label="JSON của form" className="font-mono text-xs" data-testid="json-text" />
        <ErrorText error={exp.error ?? imp.error} />
      </Section>
    </div>
  );
}
