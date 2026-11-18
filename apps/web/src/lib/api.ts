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

export function fmtTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}
