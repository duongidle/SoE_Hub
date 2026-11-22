import { api, qs } from "@/lib/api";

/** Calls of the period close, snapshot and policy-compare screens (Module 4 mục 9, 11, 12). The server decides every number; the screens only show them. */

export type ReviewKind = "overdue_payment" | "received_unconfirmed" | "unmatched_receipt" | "com_cap_mismatch" | "com_blank" | "unchecked_source" | "stale_processing";
export interface ReviewItem { kind: ReviewKind; table: "payments" | "receipts" | "ledger" | "deals"; row_id: string; deal_id: string | null; deal_name: string | null; detail: Record<string, unknown> }
export interface PeriodReview { month: string; closed: boolean; lock_id: string | null; stale: boolean; total: number; counts: Record<string, number>; items: ReviewItem[] }
export const periodReview = (month: string) => api<PeriodReview>("GET", `/deal/periods/review${qs({ month })}`);

export interface PeriodCom {
  month: string;
  ledger_table_id: string;
  people: { person_id: string; total: number; lines: number; blank_lines: number }[];
  lines: { id: string; deal_id: string | null; payment_id: string | null; status: string | null; com: number | null; pct: number | null; reason: string | null }[];
}
export const periodCom = (month: string, personId?: string) => api<PeriodCom>("GET", `/deal/periods/com${qs({ month, person_id: personId })}`);

export interface PeriodRow { month: string; lock_id: string; locked_at: string; locked_by: string | null }
export const periodList = () => api<PeriodRow[]>("GET", "/deal/periods");

export interface CloseResult { month: string; lock_ids: string[]; closed_ledger_ids: string[]; blank_com_ids: string[]; checked_on_close: number; pending: number }
export const closePeriod = (body: { month: string; close_anyway: boolean }) => api<CloseResult>("POST", "/deal/periods/close", body);
export interface ConfirmReceivedResult { month: string; payments: number; won_deal_ids: string[]; ledger_ids: string[]; skipped_ledger: number }
export const confirmReceived = (body: { month: string }) => api<ConfirmReceivedResult>("POST", "/deal/periods/confirm-received", body);
export const reopenPeriod = (body: { month: string; reason: string }) => api<{ month: string; lock_ids: string[] }>("POST", "/deal/periods/reopen", body);

export interface SnapshotRow { id: string; name: string; taken_at: string; row_count: number; auto: boolean; quarter: string | null; note: string | null }
export const snapshotList = () => api<SnapshotRow[]>("GET", "/deal/snapshots");
export const snapshotCreate = (note?: string) => api<{ id: string; name: string; quarter: string; row_count: number; forecast: number }>("POST", "/deal/snapshots", { note: note || undefined });
export type CompareGroup = "won" | "slipped" | "lost" | "open";
export interface SnapshotCompare {
  snapshot_id: string;
  quarter: string;
  forecast: number;
  actual: number;
  accuracy: number | null;
  groups: { group: CompareGroup; count: number; forecast: number; actual: number }[];
  by_type: { type: string; forecast: number; actual: number; accuracy: number | null }[];
  deals: { deal_id: string; name: string | null; type: string; group: CompareGroup; forecast: number; actual: number }[];
}
export const snapshotCompare = (snapshot_id: string) => api<SnapshotCompare>("GET", `/deal/snapshots/compare${qs({ snapshot_id })}`);

export interface PolicyDiff {
  old_from: string | null;
  new_from: string | null;
  versions: string[];
  rows: { kind: "added" | "changed" | "removed"; lead: string; level: string; performance: string; old_rate: number | null; new_rate: number | null }[];
  unchanged: number;
  params: { kind: "added" | "changed" | "removed"; name: string; old_value: number | null; new_value: number | null }[];
  affected_open_deals: number;
  affected_deal_ids: string[];
}
export const policyDiff = (new_from?: string) => api<PolicyDiff>("GET", `/deal/commission/policy-diff${qs({ new_from })}`);

export const periodKeys = { list: ["period-list"] as const, review: (m: string) => ["period-review", m] as const, com: (m: string, p?: string) => ["period-com", m, p ?? ""] as const, snaps: ["deal-snapshots"] as const };
