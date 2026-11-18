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
    super(body?.error.message ?? `HTTP ${status}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body as ErrorBody | null);
  return body as T;
}

export const fetchHealth = () => getJson<HealthResponse>("/health");
