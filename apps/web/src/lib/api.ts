import type { ErrorBody } from "@soe/shared";

export interface HealthResponse {
  status: "ok";
  db: string;
  worker: { status: "ok" | "stale" | "unknown"; last_heartbeat: string | null; age_seconds: number | null };
  time: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | null,
  ) {
    super(body?.error.message ?? `Lỗi HTTP ${status}`);
  }
  get code() {
    return this.body?.error.code;
  }
  get details() {
    return this.body?.error.details as Record<string, unknown> | undefined;
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

/** Calls the REST API with the session cookie. Writes send the CSRF header (double submit). Returns `data`. */
export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") {
    const csrf = readCookie("soe_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: "same-origin", body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json as ErrorBody | null);
  return (json as { data: T }).data;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
  total?: number;
}

/** List endpoints keep `next_cursor` / `total`. */
export async function apiList<T = Record<string, unknown>>(path: string): Promise<Page<T>> {
  const res = await fetch(`/api/v1${path}`, { headers: { accept: "application/json" }, credentials: "same-origin" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json as ErrorBody | null);
  return json as Page<T>;
}

export const fetchHealth = async (): Promise<HealthResponse> => {
  const res = await fetch("/health", { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body as ErrorBody | null);
  return body as HealthResponse;
};

export function qs(params: Record<string, string | number | boolean | null | undefined | object>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const VN_ZONE = "Asia/Ho_Chi_Minh";

/** Shows a timestamp as `dd/mm/yyyy HH:mm:ss` (24h, Vietnam time), the same everywhere in the UI. */
export function fmtTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: VN_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** Parses `dd/mm/yyyy` or `dd/mm/yyyy HH:mm` (Vietnam time). Returns null when it is not a real date. */
export function parseVnDateTime(text: string): Date | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const [d, mo, y, h = "0", mi = "0"] = m.slice(1);
  const pad = (n: string) => n.padStart(2, "0");
  const date = new Date(`${y}-${pad(mo!)}-${pad(d!)}T${pad(h)}:${pad(mi)}:00+07:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rolled-over dates such as 31/02/2026.
  const back = fmtTime(date.toISOString());
  return back.startsWith(`${pad(d!)}/${pad(mo!)}/${y} ${pad(h)}:${pad(mi)}`) ? date : null;
}
