import { useQuery } from "@tanstack/react-query";
import type { DealPeriodRule, FilterNode, SortItem, TimeRange } from "@soe/shared";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { dhKeys, resolveTimeRange } from "./api";
import { currentPeriod } from "./time-ui";
import type { Column, TableDetail } from "./types";
import type { SessionQuery, ViewConfig } from "./view-config";

/**
 * The shared period bar of Quản lý Deal and the ready-made filters of the Deals table (Module 4 mục 8, 11a).
 * The web only chooses WHICH period and WHICH rule; the server turns them into dates and rows (`time_filter`, `deal_rule`).
 * A period only narrows what the person may already see.
 */

export type PeriodUnit = "month" | "quarter" | "year";
export interface PeriodChoice { unit: PeriodUnit; year: number; index?: number }
export interface SharedPeriod {
  range: Extract<TimeRange, { kind: "period" }>;
  rule: DealPeriodRule;
}

/** The tables that follow the shared period, by role set (never by name). */
export const FOLLOWS_PERIOD = ["deals", "index", "kpi"] as const;
export const followsPeriod = (t: Pick<TableDetail, "role_set">): boolean => !!t.role_set && (FOLLOWS_PERIOD as readonly string[]).includes(t.role_set);

export const SharedPeriodContext = createContext<SharedPeriod | null>(null);
export const useSharedPeriod = () => useContext(SharedPeriodContext);

const KEY = "soe.deal.period";
const readStored = (): { choice: PeriodChoice | null; rule: DealPeriodRule } => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { choice?: PeriodChoice; rule?: DealPeriodRule } | null;
    const c = raw?.choice;
    const ok = c && ["month", "quarter", "year"].includes(c.unit) && Number.isInteger(c.year) && (c.unit === "year" || Number.isInteger(c.index));
    return { choice: ok ? c : null, rule: raw?.rule && ["related", "received", "closed", "expected"].includes(raw.rule) ? raw.rule : "related" };
  } catch {
    return { choice: null, rule: "related" };
  }
};

/** The period chosen on the bar (default: this quarter, from the server's calendar) and the way "a deal belongs to the period" is read. */
export function useSharedPeriodState() {
  const [stored, setStored] = useState(readStored);
  const now = useQuery({ queryKey: dhKeys.timeRange({ kind: "preset", preset: "this_quarter" }), queryFn: () => resolveTimeRange({ kind: "preset", preset: "this_quarter" }), staleTime: 60_000 });
  const save = useCallback((next: { choice: PeriodChoice | null; rule: DealPeriodRule }) => {
    setStored(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the choice just does not survive a reload */ }
  }, []);
  const range = useMemo(() => {
    if (stored.choice) return { kind: "period" as const, unit: stored.choice.unit, year: stored.choice.year, ...(stored.choice.unit === "year" ? {} : { index: stored.choice.index }) };
    return now.data ? currentPeriod("quarter", now.data) : null;
  }, [stored.choice, now.data]);
  const value: SharedPeriod | null = range ? { range, rule: stored.rule } : null;
  return {
    value,
    loading: now.isLoading,
    error: now.error,
    setChoice: (choice: PeriodChoice | null) => save({ choice, rule: stored.rule }),
    setRule: (rule: DealPeriodRule) => save({ choice: stored.choice, rule }),
    reset: () => save({ choice: null, rule: stored.rule }),
    isDefault: stored.choice === null,
  };
}

const colOf = (t: Pick<TableDetail, "columns">, role: string): Column | undefined => t.columns.find((c) => c.role === role);

/** What the open table reads for the shared period, or `null` when this table has nothing to filter on. */
export function periodFilter(table: TableDetail, shared: SharedPeriod): Pick<SessionQuery, "timeFilter" | "filter"> | null {
  if (table.role_set === "deals") return { timeFilter: { columns: [], range: shared.range, deal_rule: shared.rule } };
  if (table.role_set === "index") {
    const c = colOf(table, "thang");
    return c ? { timeFilter: { columns: [c.key], range: shared.range } } : null;
  }
  if (table.role_set === "kpi") {
    const c = colOf(table, "nam");
    return c ? { filter: { field: c.key, op: "eq", value: shared.range.year } } : null;
  }
  return null;
}

// ---- ready-made filters of Deals: Ưu tiên hôm nay, Cần chấm lại hôm nay (Module 4 mục 8) ------------------------------------

export type QuickView = "priority" | "recheck";
export const QUICK_LABEL: Record<QuickView, string> = { priority: "Ưu tiên hôm nay", recheck: "Cần chấm lại hôm nay" };

/** The columns the ready-made filters need, found by role. Missing columns (an old tree) mean no buttons. */
export function quickAvailable(table: Pick<TableDetail, "role_set" | "columns">): boolean {
  return table.role_set === "deals" && !!colOf(table, "thu_tu_uu_tien") && !!colOf(table, "can_cham_lai") && !!colOf(table, "trang_thai");
}

function quickParts(table: TableDetail, which: QuickView): { filter: FilterNode; sort: SortItem[] } | null {
  const order = colOf(table, "thu_tu_uu_tien");
  if (!order) return null;
  if (which === "recheck") {
    const c = colOf(table, "can_cham_lai");
    return c ? { filter: { field: c.key, op: "is_not_empty" }, sort: [{ field: order.key, dir: "asc", nulls: "last" }] } : null;
  }
  const status = colOf(table, "trang_thai");
  const open = ((status?.config as { options?: { id: string; meaning?: string }[] } | undefined)?.options ?? []).filter((o) => o.meaning === "open").map((o) => o.id);
  if (!status || open.length === 0) return null;
  const due = colOf(table, "ngay_du_kien_chot");
  const sort: SortItem[] = [{ field: order.key, dir: "asc", nulls: "last" }, ...(due ? [{ field: due.key, dir: "asc" as const, nulls: "last" as const }] : [])];
  return { filter: { field: status.key, op: "in", value: open }, sort };
}

/** The query of a view with the shared period and a ready-made filter laid over it. Nothing here is saved to the view. */
export function overlayQuery(base: SessionQuery, table: TableDetail, config: ViewConfig, shared: SharedPeriod | null, quick: QuickView | null): SessionQuery {
  let q = base;
  if (shared && followsPeriod(table) && !config.own_period) {
    const p = periodFilter(table, shared);
    if (p) {
      q = { ...q };
      if (p.timeFilter) q.timeFilter = p.timeFilter;
      if (p.filter) q.filter = q.filter ? { and: [q.filter, p.filter] } : p.filter;
    }
  }
  if (quick) {
    const parts = quickParts(table, quick);
    if (parts) {
      q = { ...q, filter: q.filter ? { and: [q.filter, parts.filter] } : parts.filter };
      const own = q.sort ? (JSON.parse(q.sort) as SortItem[]) : [];
      q.sort = JSON.stringify([...parts.sort, ...own.filter((s) => !parts.sort.some((x) => x.field === s.field))]);
    }
  }
  return q;
}
