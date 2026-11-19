import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { getTable, listDatahubs } from "@/lib/datahub/api";
import type { FormulaScope, RefDatahub } from "@/lib/datahub/formula-assist";
import type { Column, TableDetail } from "@/lib/datahub/types";

/**
 * What a formula (and a link, lookup or rollup) of this table may point at: the table itself, the other tables of its datahub and the
 * other datahubs of the same owner. The lists come from the server; the columns of another table are fetched when first needed.
 */
export function useFormulaScope(table: TableDetail, selfKey?: string) {
  const q = useQuery({ queryKey: ["dh-ref-scope"], queryFn: () => listDatahubs("mine"), staleTime: 30_000 });
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
    const here = all.find((d) => d.id === table.datahub_id) ?? { id: table.datahub_id, name: table.datahub_name, tables: [{ id: table.id, name: table.name, columns: own }] };
    return { current: { id: table.id, name: table.name, columns: own }, datahub: here, others: all.filter((d) => d.id !== table.datahub_id) };
  }, [q.data, loaded, table, selfKey]);

  return { scope, ensure, loading: q.isLoading, columnsOf: (tableId: string): Column[] | null => (tableId === table.id ? table.columns : (loaded[tableId] ?? null)) };
}
