import { api, qs } from "@/lib/api";

/** Calls of the payment screens (Module 4 mục 7, 16). Every number is decided by the server; the screens only send what the Manager typed and show the result. */

export interface ScheduleItem {
  id?: string;
  legal_entity?: string;
  tax_code?: string;
  contract_no?: string;
  seq?: number;
  /** Before VAT. */
  amount: number;
  /** YYYY-MM-DD. */
  due: string;
  com_split?: { user_id: string; pct: number }[];
}
export interface ScheduleResult { deal_id: string; payments: { id: string; seq: number; amount: number; due: string; created: boolean }[]; removed: string[] }
export const schedulePayments = (body: { deal_id: string; payments: ScheduleItem[]; remove_ids?: string[] }) => api<ScheduleResult>("POST", "/deal/payments/schedule", body);

export interface Allocation {
  payment_id: string;
  /** Before VAT. */
  amount: number;
  /** With VAT: the parts of one transfer add up to its amount. */
  amount_received?: number;
  com_split?: { user_id: string; pct: number }[];
  shortfall: "split" | "keep";
}
export interface ReceiptInput { id?: string; amount?: number; payer_name?: string; account_no?: string; bank?: string; content?: string }
export interface ConfirmResult { receipt_id: string; payments: { id: string; split_off_id: string | null }[]; won_deal_ids: string[]; ledger_ids: string[] }
export const confirmPayments = (body: { received_on: string; receipt: ReceiptInput; allocations: Allocation[] }) => api<ConfirmResult>("POST", "/deal/payments/confirm", body);

export const unconfirmPayments = (payment_ids: string[]) => api<{ payment_ids: string[]; reopened_deal_ids: string[]; removed_ledger_ids: string[] }>("POST", "/deal/payments/unconfirm", { payment_ids });

export const adjustCommission = (body: { payment_id: string; person_id: string; amount: number; reason: string }) => api<{ ledger_id: string }>("POST", "/deal/commission/adjust", body);

export interface MatchCandidate { payment_id: string; deal_id: string; deal_name: string; seq: number | null; planned: number; due: string | null; score: number; strong: boolean; reasons: string[] }
export interface MatchQuery { amount?: number; payer_name?: string; account_no?: string; tax_code?: string; content?: string; received_on?: string; limit?: number }
export const matchCandidates = (q: MatchQuery) => api<MatchCandidate[]>("GET", `/deal/payments/match${qs({ ...q })}`);

export const payKeys = { home: ["pay-home"] as const, table: (id: string) => ["pay-table", id] as const, rows: (id: string, view: string) => ["pay-rows", id, view] as const };
