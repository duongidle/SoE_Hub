import type { FilterNode } from "@soe/shared";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { lookupPeople } from "@/lib/datahub/api";
import { optionsOf, parseCellText } from "@/lib/datahub/cells";
import type { Column } from "@/lib/datahub/types";
import {
  condValue,
  draftToFilter,
  emptyGroup,
  filterToDraft,
  isFilterable,
  kindOf,
  LIST_OPS,
  N_OPS,
  newCond,
  NO_VALUE_OPS,
  OPS_BY_KIND,
  opLabel,
  type DraftCond,
  type DraftGroup,
  type DraftNode,
  type Op,
} from "@/lib/datahub/view-config";
import { cn } from "@/lib/utils";
import { PersonPicker } from "./pickers";

const MAX_DEPTH = 3;

const parse = (col: Column, text: string) => parseCellText(col, text);

/**
 * Editor of a filter tree: conditions and nested groups of "tất cả" (AND) or "một trong" (OR). The tree is kept as a draft while
 * the person types; only finished conditions reach `onChange`, so an unfinished row never breaks the table.
 * Every choice is a list made from the table (columns, operators, options, people); typing is only for text, numbers and dates.
 */
export function FilterEditor({ columns, value, onChange, idPrefix }: { columns: Column[]; value: FilterNode | undefined; onChange: (node: FilterNode | undefined) => void; idPrefix: string }) {
  const [draft, setDraft] = useState<DraftGroup>(() => filterToDraft(value, columns));
  const last = useRef(JSON.stringify(value ?? null));
  const usable = useMemo(() => columns.filter(isFilterable), [columns]);

  const commit = (next: DraftGroup) => {
    setDraft(next);
    const node = draftToFilter(next, columns, parse);
    const text = JSON.stringify(node ?? null);
    if (text !== last.current) {
      last.current = text;
      onChange(node);
    }
  };

  const update = (id: string, fn: (n: DraftNode) => DraftNode | null): DraftGroup => {
    const walk = (n: DraftNode): DraftNode | null => {
      if (n.id === id) return fn(n);
      if (n.kind === "group") return { ...n, children: n.children.map(walk).filter((x): x is DraftNode => x !== null) };
      return n;
    };
    return walk(draft) as DraftGroup;
  };

  const names = useNames(draft, columns);

  return (
    <GroupNode
      node={draft}
      depth={0}
      columns={columns}
      usable={usable}
      names={names}
      idPrefix={idPrefix}
      onChange={(id, fn) => commit(update(id, fn))}
    />
  );
}

/** Names of the people chosen in user conditions (the filter stores ids). */
function useNames(draft: DraftGroup, columns: Column[]): Map<string, string> {
  const ids: string[] = [];
  const userKeys = new Set(columns.filter((c) => kindOf(c) === "user").map((c) => c.key));
  const walk = (n: DraftNode) => {
    if (n.kind === "group") n.children.forEach(walk);
    else if (userKeys.has(n.field)) ids.push(...n.ids);
  };
  walk(draft);
  const key = [...new Set(ids)].sort().join(",");
  const q = useQuery({ queryKey: ["dh-people-names", key], queryFn: () => lookupPeople({ ids: key.split(",") }), enabled: key !== "", staleTime: 60_000 });
  return useMemo(() => new Map((q.data ?? []).map((p) => [p.id, p.full_name] as const)), [q.data]);
}

type Change = (id: string, fn: (n: DraftNode) => DraftNode | null) => void;

function GroupNode({ node, depth, columns, usable, names, idPrefix, onChange }: { node: DraftGroup; depth: number; columns: Column[]; usable: Column[]; names: Map<string, string>; idPrefix: string; onChange: Change }) {
  const add = (child: DraftNode) => onChange(node.id, (n) => ({ ...(n as DraftGroup), children: [...(n as DraftGroup).children, child] }));
  const noColumns = usable.length === 0;
  return (
    <div className={cn("flex flex-col gap-2", depth > 0 && "rounded-md border border-border p-2")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Thoả</span>
        <Select aria-label="Cách ghép các điều kiện" className="!w-auto" value={node.mode} onChange={(e) => onChange(node.id, (n) => ({ ...(n as DraftGroup), mode: e.target.value as "and" | "or" }))}>
          <option value="and">tất cả</option>
          <option value="or">một trong</option>
        </Select>
        <span className="text-muted-foreground">các điều kiện sau</span>
        {depth > 0 && (
          <Button variant="ghost" className="ml-auto !px-2" aria-label="Xoá nhóm điều kiện" onClick={() => onChange(node.id, () => null)}>
            <Trash2 size={16} aria-hidden />
          </Button>
        )}
      </div>
      {node.children.length === 0 && <p className="text-muted-foreground">Chưa có điều kiện nào.</p>}
      {node.children.map((c) =>
        c.kind === "group" ? (
          <GroupNode key={c.id} node={c} depth={depth + 1} columns={columns} usable={usable} names={names} idPrefix={idPrefix} onChange={onChange} />
        ) : (
          <CondRow key={c.id} cond={c} columns={columns} usable={usable} names={names} idPrefix={idPrefix} onChange={onChange} />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={noColumns} onClick={() => add(newCond(usable[0]))}>
          <Plus size={16} aria-hidden /> Thêm điều kiện
        </Button>
        {depth < MAX_DEPTH - 1 && (
          <Button variant="secondary" disabled={noColumns} onClick={() => add({ ...emptyGroup(node.mode === "and" ? "or" : "and"), children: [newCond(usable[0])] })}>
            <Plus size={16} aria-hidden /> Thêm nhóm điều kiện
          </Button>
        )}
      </div>
    </div>
  );
}

function CondRow({ cond, columns, usable, names, idPrefix, onChange }: { cond: DraftCond; columns: Column[]; usable: Column[]; names: Map<string, string>; idPrefix: string; onChange: Change }) {
  const col = columns.find((c) => c.key === cond.field);
  const kind = col ? kindOf(col) : null;
  const dead = !col || !kind;
  const set = (patch: Partial<DraftCond>) => onChange(cond.id, (n) => ({ ...(n as DraftCond), ...patch }));
  const [touched, setTouched] = useState(false);
  const v = col ? condValue(col, cond, parse) : null;
  const problem = touched && v && !v.ok && v.reason === "invalid" ? v.message : null;
  const pickColumn = (key: string) => {
    const next = columns.find((c) => c.key === key);
    const k = next ? kindOf(next) : null;
    // A new column starts clean: its first operator, no value (a value of one type means nothing for another).
    set({ field: key, op: k ? OPS_BY_KIND[k][0]! : cond.op, text: "", text2: "", ids: [] });
    setTouched(false);
  };
  const id = `${idPrefix}-${cond.id}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Cột" className={cn("!w-44 max-w-full", dead && "border-bad text-bad")} value={cond.field} onChange={(e) => pickColumn(e.target.value)} id={`${id}-col`}>
          {dead && <option value={cond.field}>Cột đã bị xoá</option>}
          {usable.map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </Select>
        {kind && (
          <Select aria-label="Toán tử" className="!w-44 max-w-full" value={cond.op} onChange={(e) => { set({ op: e.target.value as Op, text: LIST_OPS.has(e.target.value as Op) ? "" : cond.text, ids: LIST_OPS.has(e.target.value as Op) ? cond.ids : cond.ids.slice(0, 1) }); setTouched(false); }}>
            {OPS_BY_KIND[kind].map((o) => (
              <option key={o} value={o}>{opLabel(kind, o)}</option>
            ))}
          </Select>
        )}
        {col && kind && <ValueInput col={col} kind={kind} cond={cond} names={names} set={set} onBlur={() => setTouched(true)} id={id} />}
        <Button variant="ghost" className="ml-auto !px-2" aria-label="Xoá điều kiện" onClick={() => onChange(cond.id, () => null)}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>
      {dead && <p role="alert" className="text-xs text-bad">Cột này đã bị xoá nên điều kiện không có tác dụng. Chọn cột khác hoặc xoá điều kiện.</p>}
      {problem && <p role="alert" className="text-xs text-bad">{problem}</p>}
    </div>
  );
}

function ValueInput({ col, kind, cond, names, set, onBlur, id }: { col: Column; kind: NonNullable<ReturnType<typeof kindOf>>; cond: DraftCond; names: Map<string, string>; set: (p: Partial<DraftCond>) => void; onBlur: () => void; id: string }) {
  if (NO_VALUE_OPS.has(cond.op)) return null;
  if (N_OPS.has(cond.op)) {
    return <Input aria-label="Số ngày" className="!w-24" inputMode="numeric" placeholder="Số ngày" value={cond.text} onChange={(e) => set({ text: e.target.value })} onBlur={onBlur} />;
  }
  if (kind === "boolean") {
    return (
      <Select aria-label="Giá trị" className="!w-32" value={cond.text === "false" ? "false" : "true"} onChange={(e) => set({ text: e.target.value })}>
        <option value="true">Có</option>
        <option value="false">Không</option>
      </Select>
    );
  }
  if (kind === "select" || kind === "set") {
    const options = optionsOf(col);
    if (LIST_OPS.has(cond.op)) {
      return (
        <fieldset className="contain-scroll flex max-h-40 w-full flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
          <legend className="px-1 text-xs text-muted-foreground">Chọn một hoặc nhiều</legend>
          {options.length === 0 && <span className="text-muted-foreground">Cột chưa có lựa chọn nào.</span>}
          {options.map((o) => (
            <label key={o.id} className="flex min-h-9 items-center gap-2 [overflow-wrap:anywhere]">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={cond.ids.includes(o.id)} onChange={(e) => set({ ids: e.target.checked ? [...cond.ids, o.id] : cond.ids.filter((x) => x !== o.id) })} />
              {o.name}
            </label>
          ))}
        </fieldset>
      );
    }
    const gone = cond.ids[0] && !options.some((o) => o.id === cond.ids[0]);
    return (
      <Select aria-label="Giá trị" className={cn("!w-44 max-w-full", gone && "border-bad text-bad")} value={cond.ids[0] ?? ""} onChange={(e) => set({ ids: e.target.value ? [e.target.value] : [] })}>
        <option value="">Chọn một lựa chọn</option>
        {gone && <option value={cond.ids[0]}>Lựa chọn đã bị xoá</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </Select>
    );
  }
  if (kind === "user") {
    const chosen = cond.ids[0];
    return (
      <Popover
        label="Chọn người"
        width="w-auto !p-0 border-0 bg-transparent shadow-none"
        trigger={
          <Button variant="secondary" className="max-w-56 !justify-start" aria-label="Chọn người">
            <span className="truncate">{chosen ? (names.get(chosen) ?? "…") : "Chọn người"}</span>
          </Button>
        }
      >
        <PersonPicker value={chosen ?? null} valueName={chosen ? names.get(chosen) : undefined} onDone={(p) => set({ ids: p ? [p.id] : [] })} />
      </Popover>
    );
  }
  const hint = kind === "date" ? "dd/mm/yyyy" : kind === "datetime" ? "dd/mm/yyyy hh:mm" : kind === "number" ? (col.type === "percent" ? "Ví dụ 12,5" : "Số") : "Nhập giá trị";
  const mode = kind === "number" ? "decimal" : undefined;
  if (cond.op === "between") {
    return (
      <>
        <Input aria-label="Từ" className="!w-32" inputMode={mode} placeholder={`Từ (${hint})`} value={cond.text} onChange={(e) => set({ text: e.target.value })} onBlur={onBlur} />
        <span className="text-muted-foreground">đến</span>
        <Input aria-label="Đến" className="!w-32" inputMode={mode} placeholder={`Đến (${hint})`} value={cond.text2} onChange={(e) => set({ text2: e.target.value })} onBlur={onBlur} />
      </>
    );
  }
  return <Input aria-label="Giá trị" id={`${id}-value`} className="!w-44 max-w-full" inputMode={mode} placeholder={hint} value={cond.text} onChange={(e) => set({ text: e.target.value })} onBlur={onBlur} autoComplete="off" />;
}

