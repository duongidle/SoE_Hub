import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** A plain HTTP client of one person (cookie + CSRF), for preparing data without clicking through the pages. */
export class ApiClient {
  private cookie = "";
  private csrf = "";
  constructor(readonly base: string) {}

  async login(email: string, password: string): Promise<this> {
    const res = await fetch(`${this.base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error(`Đăng nhập ${email} lỗi ${res.status}: ${await res.text()}`);
    this.absorb(res);
    this.csrf = ((await res.json()) as { data: { csrf_token: string } }).data.csrf_token;
    return this;
  }

  private absorb(res: Response): void {
    const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0]!, c] as const));
    for (const sc of res.headers.getSetCookie()) {
      const kv = sc.split(";")[0]!;
      jar.set(kv.split("=")[0]!, kv);
    }
    this.cookie = [...jar.values()].join("; ");
  }

  /** A GET that keeps the whole answer of a list (`data`, `next_cursor`, `total`). */
  async raw<T = any>(url: string): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await fetch(`${this.base}/api/v1${url}`, { headers: { cookie: this.cookie, accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${JSON.stringify(json)}`);
    return json as T;
  }

  async call<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await fetch(`${this.base}/api/v1${url}`, {
      method,
      headers: { cookie: this.cookie, accept: "application/json", ...(method !== "GET" ? { "x-csrf-token": this.csrf } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
    return (json as { data: T }).data;
  }
}

async function publicPost(base: string, url: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/v1${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** The first Admin, made by the CLI command of the design (needs the database variables of the running stack). */
export async function createAdmin(base: string, email: string, name: string, password: string, cwd: string): Promise<ApiClient> {
  const { stdout } = await run("pnpm", ["cli", "admin:create", "--email", email, "--name", name], { cwd, env: process.env });
  const code = /Mã kích hoạt: (\d{6})/.exec(stdout)?.[1];
  if (!code) throw new Error(`Không đọc được mã từ admin:create:\n${stdout}`);
  const res = await publicPost(base, "/auth/codes/verify", { email, purpose: "activate", code, password });
  if (!res.ok) throw new Error(`Kích hoạt admin lỗi: ${await res.text()}`);
  return new ApiClient(base).login(email, password);
}

export interface SeedPerson {
  email: string;
  name: string;
  roles: ("manager" | "leader" | "user" | "guest")[];
  manager?: string;
  /** Email of the direct leader (a user under a leader). */
  leader?: string;
  guestPreset?: "sale" | "data";
}

/** Adds people to the org chart as the admin, then activates each one (the approver, here the admin, reads the code in the inbox). */
export async function seedPeople(base: string, admin: ApiClient, people: SeedPerson[], password: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const p of people) {
    const m = await admin.call<{ id: string }>("POST", "/org/members", { email: p.email, full_name: p.name, roles: p.roles, ...(p.manager ? { manager_id: ids[p.manager] } : {}), ...(p.leader ? { leader_id: ids[p.leader] } : {}), ...(p.guestPreset ? { guest_preset: p.guestPreset } : {}) });
    ids[p.email] = m.id;
  }
  for (const p of people) {
    const r = await publicPost(base, "/auth/codes", { email: p.email, purpose: "activate" });
    if (!r.ok) throw new Error(`Xin mã cho ${p.email} lỗi ${r.status}`);
    let code = "";
    for (let i = 0; i < 60 && !code; i++) {
      const list = await admin.call<{ title?: string; body?: string; data?: unknown }[]>("GET", "/notifications?limit=100");
      for (const n of list) {
        const text = JSON.stringify(n);
        if (text.includes(p.email)) code = /\b(\d{6})\b/.exec(text.replace(p.email, ""))?.[1] ?? code;
        if (code) break;
      }
      if (!code) await new Promise((r2) => setTimeout(r2, 300));
    }
    if (!code) throw new Error(`Không thấy mã của ${p.email} trong hộp thông báo`);
    const v = await publicPost(base, "/auth/codes/verify", { email: p.email, purpose: "activate", code, password });
    if (!v.ok) throw new Error(`Kích hoạt ${p.email} lỗi: ${await v.text()}`);
  }
  return ids;
}
