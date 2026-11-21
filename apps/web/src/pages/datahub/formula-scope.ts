import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { getTable, listDatahubs } from "@/lib/datahub/api";
import { dealKeys, getDealHome } from "@/lib/datahub/deal-api";
import type { FormulaScope, RefDatahub } from "@/lib/datahub/formula-assist";
import type { Column, TableDetail } from "@/lib/datahub/types";

/**
 * What a formula (and a link, lookup or rollup) of this table may point at: the table itself, the other tables of its datahub and the
 * other datahubs of the same owner. The lists come from the server; the columns of another table are fetched when first needed.
 */
export function useFormulaScope(table: TableDetail, selfKey?: string) {
  const q = useQuery({ queryKey: ["dh-ref-scope"], queryFn: () => listDatahubs("mine"), staleTime: 30_000 });
  // The datahub "Quản lý Deal" is not in the list of datahubs; its tables are a group of their own (Module 4 mục 1.1).
  const dealQ = useQuery({ queryKey: dealKeys.home, queryFn: getDealHome, staleTime: 30_000 });
  const [loaded, setLoaded] = useState<Record<string, Column[]>>({});
  const asked = useRef(new Set<string>());

  const ensure = useCallback((tableId: string) => {
    if (asked.current.has(tableId)) return;
    asked.current.add(tableId);
    void getTable(tableId)
      .then((t) => setLoaded((l) => ({ ...l, [tableId]: t.columns })))
      .catch(() => asked.current.delete(tableId));
  }, []);

  const scope: FormulaScope = useMemo(() => {
    const names = (cols: Column[]) => cols.map((c) => c.name);
    const own = names(table.columns.filter((c) => c.key !== selfKey));
    const build = (d: { id: string; name: string; tables: { id: string; name: string }[] }): RefDatahub => ({
      id: d.id,
      name: d.name,
      tables: d.tables.map((t) => ({ id: t.id, name: t.name, columns: t.id === table.id ? own : loaded[t.id] ? names(loaded[t.id]!) : null })),
    });
    const all = (q.data ?? []).map(build);
    const dealTables = dealQ.data?.tables ?? [];
    if (dealTables.length) all.push(build({ id: "deal", name: "Quản lý Deal", tables: dealTables.map((t) => ({ id: t.id, name: t.name })) }));
    // A table of Quản lý Deal sees the others of the group like tables of its own datahub.
    const inDeal = dealTables.some((t) => t.id === table.id);
    const here = (inDeal ? all.find((d) => d.id === "deal") : all.find((d) => d.id === table.datahub_id)) ?? { id: table.datahub_id, name: table.datahub_name, tables: [{ id: table.id, name: table.name, columns: own }] };
    return { current: { id: table.id, name: table.name, columns: own }, datahub: here, others: all.filter((d) => d.id !== here.id && d.id !== table.datahub_id) };
  }, [q.data, dealQ.data, loaded, table, selfKey]);

  return { scope, ensure, loading: q.isLoading, columnsOf: (tableId: string): Column[] | null => (tableId === table.id ? table.columns : (loaded[tableId] ?? null)) };
}
