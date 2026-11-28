import { parseLocaleDate, TIME_PRESETS, TIME_PRESET_LABELS, formatNumber, type FilterNode, type TimeFilter, type TimeRange } from "@soe/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, EyeOff, Filter, Group, MoreHorizontal, PaintBucket, Pin, Plus, Search, Trash2, X, ArrowUpDown, Rows3 } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Button, Input, Select } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { dhKeys, resolveTimeRange } from "@/lib/datahub/api";
import { currentPeriod, PERIOD_UNIT_LABELS, rangeDates, rangeName, stepPeriod } from "@/lib/datahub/time-ui";
import type { Column } from "@/lib/datahub/types";
import {
  countConditions,
  fullOrder,
  isDateColumn,
  isGroupable,
  isSortable,
  kindOf,
  MAX_COLORS,
  MAX_GROUP,
  MAX_SORT,
  moveColumn,
  ROW_HEIGHT_LABELS,
  type ColorRule,
  type DeadRefs,
  type GroupFn,
  type Kind,
  type RowHeight,
  type ViewConfig,
  DEFAULT_ROW_HEIGHT,
  layoutColumns,
} from "@/lib/datahub/view-config";
import { OPTION_COLORS, optionVar } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { searchHotkeyProps } from "@/lib/search-hotkey";
import { FilterEditor } from "./filter-editor";

export type Change = (patch: Partial<Record<keyof ViewConfig, unknown>>) => void;

/** A tool of the toolbar: icon, name and (once it holds settings) their number. */
type ToolMeta = { id: ToolId; icon: React.ReactNode; label: string; count?: number; active?: boolean; ariaLabel?: string };
type ToolId = "filter" | "sort" | "group" | "columns" | "colors" | "time" | "density";
/** The tools that move into the "..." menu when the line is too narrow, the least used first (design module12 12H-4). */
const FOLD_ORDER: ToolId[] = ["density", "colors", "time", "columns", "group"];
/** The width the line needs (without the period button) with the search open, then with it folded, then one more tool folded each step. */
/** The look of a button of the toolbar line (mockup `.lark-tool`, design module12 12H-15): 28px, radius 7px, 12px text, 10px of side padding. */
export const TOOL_BTN = "shrink-0 !gap-1.5 !rounded-[7px] !px-2.5 !text-xs sm:!min-h-7 sm:!py-0";
/** The one "on" look of a tool that holds settings: a pale primary tint and primary text, no border. */
export const TOOL_ON = "!bg-primary-soft !text-primary";
const LEVEL_ROOM = [1020, 1020, 920, 835, 745, 645, 570]; // the search is always the magnifier now (Dương 28/11): level 0 needs no more room than level 1

/** Which tools are folded into "..." now, the place their panel opens from, and the one panel opened from the menu. */
const FoldContext = createContext<{ folded: ReadonlySet<ToolId>; host: HTMLElement | null; openId: ToolId | null; setOpenId: (id: ToolId | null) => void }>({ folded: new Set(), host: null, openId: null, setOpenId: () => {} });

/**
 * The ONE toolbar line of an open table (design module12 section 2, 12H-4), in groups cut by a thin vertical line:
 * [view switcher] | [row actions the open grid portals into `rowSlotRef`: "Thêm dòng", selection] | [`period`, Lọc, Sắp xếp, Nhóm] | [Ẩn cột, Tô màu, Thời gian]
 * and, at the right, one search box, "Dòng" (row height) and the "..." menu (`moreItems`). EVERY tool has icon and name; none is an icon alone
 * (but the magnifier and "..."). When the line is too narrow whole tools move into "..." (the least used first, with their name and number there),
 * the search folds to its magnifier first; only a phone still too narrow wraps. Each tool saves what the person changes at once
 * (design module2 section 5) and shows how many settings it holds ("Lọc 2") with a soft tint while any applies.
 * `filterExtra`: ready-made filters of the table, drawn at the top of the Lọc panel (and counted in it).
 */
export function ViewTools({ columns, config, dead, change, search, onSearch, onCleanDead, lead, rowSlotRef, period, filterExtra, filterExtraCount = 0, moreItems }: { lead?: React.ReactNode; period?: React.ReactNode; rowSlotRef?: (el: HTMLElement | null) => void; filterExtra?: React.ReactNode; filterExtraCount?: number; moreItems?: React.ReactNode; columns: Column[]; config: ViewConfig; dead: DeadRefs; change: Change; search: string; onSearch: (s: string) => void; onCleanDead: () => void }) {
  const dateCols = useMemo(() => columns.filter(isDateColumn), [columns]);
  const hiddenCount = (config.hidden ?? []).filter((k) => columns.some((c) => c.key === k)).length;
  const frozen = layoutColumns(config, columns).frozen;
  const rowHeight = config.row_height ?? DEFAULT_ROW_HEIGHT;
  const filterN = countConditions(config.filter) + filterExtraCount;
  const sortN = config.sort?.length ?? 0;
  const groupN = config.group?.length ?? 0;
  const colorN = config.colors?.length ?? 0;
  const icon = (I: typeof Filter) => <I size={14} aria-hidden />;
  const metas: Record<ToolId, ToolMeta> = {
    filter: { id: "filter", icon: icon(Filter), label: "Lọc", count: filterN, active: filterN > 0 },
    sort: { id: "sort", icon: icon(ArrowUpDown), label: "Sắp xếp", count: sortN, active: sortN > 0 },
    group: { id: "group", icon: icon(Group), label: "Nhóm", count: groupN, active: groupN > 0 },
    columns: { id: "columns", icon: icon(EyeOff), label: hiddenCount ? `Ẩn ${hiddenCount} cột` : "Ẩn cột", active: hiddenCount > 0 || frozen > 0, ariaLabel: hiddenCount ? `Ẩn cột, ${hiddenCount} cột đang ẩn` : "Ẩn cột" },
    colors: { id: "colors", icon: icon(PaintBucket), label: "Tô màu", count: colorN, active: colorN > 0 },
    time: { id: "time", icon: icon(CalendarRange), label: "Thời gian", active: !!config.time_filter },
    density: { id: "density", icon: icon(Rows3), label: `Dòng: ${ROW_HEIGHT_LABELS[rowHeight]}` },
  };
  const foldable = FOLD_ORDER.filter((id) => id !== "time" || dateCols.length > 0);

  // What folds, in order, as the line gets narrower: the search field to its magnifier, then the tools one by one (least used first), then
  // the line wraps. Fixed widths (the width of the line is the only thing read; folding never changes it), so nothing can loop.
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [openId, setOpenId] = useState<ToolId | null>(null);
  const fromMenu = useRef(false);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const room = width - 40 - (period ? 130 : 0); // 40 = the side padding of the line, 130 = the period button
  const level = LEVEL_ROOM.filter((r) => room < r).length; // 0 = everything open
  const wrap = level > LEVEL_ROOM.length - 0 || room < LEVEL_ROOM[LEVEL_ROOM.length - 1]! - 120;
  const setSlot = rowSlotRef;
  const folded = useMemo(() => new Set(foldable.slice(0, Math.max(0, level - 1))), [foldable, level]);
  const searchIcon = true; // a plain icon button at every width; the field opens on press (or "/")
  const foldedList = foldable.filter((id) => folded.has(id));

  return (
    <div data-slot="view-tools" className="flex shrink-0 flex-col">
      <FoldContext.Provider value={{ folded, host, openId, setOpenId }}>
        <div ref={barRef} role="toolbar" aria-label="Công cụ view" className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border-soft bg-card px-4 py-1.5 lg:px-5">
          {lead}
          <Divider />
          <span ref={setSlot} className="flex shrink-0 items-center gap-1" />
          <Divider />
          {period}
          <FilterButton columns={columns} config={config} change={change} meta={metas.filter} extra={filterExtra} />
          <SortButton columns={columns} config={config} change={change} meta={metas.sort} />
          <GroupButton columns={columns} config={config} change={change} meta={metas.group} />
          {(!folded.has("columns") || !folded.has("colors") || (dateCols.length > 0 && !folded.has("time"))) && <Divider />}
          <ColumnsButton columns={columns} config={config} change={change} meta={metas.columns} />
          <ColorsButton columns={columns} config={config} change={change} meta={metas.colors} />
          {dateCols.length > 0 && <TimeButton columns={columns} dateCols={dateCols} config={config} change={change} meta={metas.time} />}
          <div data-fold-group className={cn("flex shrink-0 items-center gap-1", wrap ? "w-full" : "ml-auto")}>
            <SearchBox value={search} onChange={onSearch} iconOnly={searchIcon && !wrap} wide={wrap} />
            <RowHeightButton value={rowHeight} change={change} meta={metas.density} />
            <span ref={setHost} className="relative size-0 shrink-0" />
            <Menu
              align="end"
              onCloseAutoFocus={(e) => {
                // A tool opened from this menu: its panel takes the focus, not the "..." button.
                if (fromMenu.current) { e.preventDefault(); fromMenu.current = false; }
              }}
              trigger={<Button variant="ghost" aria-label="Thêm thao tác" title="Thêm thao tác" className="shrink-0 !rounded-[7px] !px-2 !text-xs sm:!min-h-7 sm:!py-0"><MoreHorizontal size={16} aria-hidden /></Button>}
            >
              {foldedList.map((id) => {
                const m = metas[id];
                return (
                  <MenuItem key={id} onSelect={() => { fromMenu.current = true; setOpenId(id); }} className={m.active ? "text-primary" : undefined}>
                    {m.icon}
                    <span>{m.label}</span>
                    {m.count ? <span className="ml-auto pl-4 text-xs font-medium">{formatNumber(m.count)}</span> : null}
                  </MenuItem>
                );
              })}
              {foldedList.length > 0 && moreItems && <MenuSeparator />}
              {moreItems}
            </Menu>
          </div>
        </div>
      </FoldContext.Provider>
      <ActiveChips columns={columns} config={config} change={change} />
      {dead.total > 0 && (
        <div role="alert" className="mx-4 my-2 flex flex-wrap items-center gap-2 rounded-md bg-warn/15 px-3 py-2 text-sm lg:mx-5">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            View này dùng {dead.total === 1 ? "1 thiết lập" : `${dead.total} thiết lập`} trỏ tới cột đã bị xoá nên đang bỏ qua.
          </span>
          <Button variant="secondary" onClick={onCleanDead}>Xoá khỏi view</Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ pieces

/** A tool of the toolbar: icon and name always (28px, 12px/500), the number of settings it holds, a soft tint while any applies. */
function ToolButton({ meta, ...props }: React.ComponentProps<"button"> & { meta: ToolMeta }) {
  return (
    <Button
      variant="ghost"
      title={meta.label}
      className={cn(TOOL_BTN, meta.active ? TOOL_ON : "text-foreground hover:!bg-muted")}
      aria-label={meta.ariaLabel ?? (meta.count ? `${meta.label} ${formatNumber(meta.count)}` : meta.label)}
      {...props}
    >
      <span aria-hidden className={cn("flex shrink-0", !meta.active && "text-faint")}>{meta.icon}</span>
      <span>{meta.label}</span>
      {meta.count ? <span className="text-xs font-medium">{formatNumber(meta.count)}</span> : null}
    </Button>
  );
}

/**
 * The panel of a tool: a title (13px/600), the body, and a footnote cut off by a line. Open from its button; while the tool is folded into "..."
 * it has no button and opens, from the menu, under the "..." button instead.
 */
function ToolPopover({ meta, label, title, width, footer, children }: { meta: ToolMeta; label: string; title: string; width: string; footer?: React.ReactNode; children: React.ReactNode }) {
  const f = useContext(FoldContext);
  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {children}
      {footer && <p className="border-t border-border-soft pt-2 text-[11px] leading-relaxed text-muted-foreground">{footer}</p>}
    </div>
  );
  if (f.folded.has(meta.id)) {
    if (f.openId !== meta.id || !f.host) return null;
    return createPortal(
      <Popover open onOpenChange={(o) => !o && f.setOpenId(null)} align="end" label={label} width={width} trigger={<span aria-hidden className="block size-0" />}>{body}</Popover>,
      f.host,
    );
  }
  return <Popover label={label} width={width} trigger={<ToolButton meta={meta} />}>{body}</Popover>;
}

/** A thin vertical line between groups of tools: 8px of air each side (gap 4 + margin 4). */
const Divider = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;

const Label = ({ children }: { children: React.ReactNode }) => <p className="text-xs font-medium text-muted-foreground">{children}</p>;

/** One search box: a field of 176px; the first thing to fold is the magnifier (the field opens over its left neighbours while it has focus or text). */
function SearchBox({ value, onChange, iconOnly, wide }: { value: string; onChange: (s: string) => void; iconOnly: boolean; wide: boolean }) {
  return (
    <div className={cn("relative h-7 shrink-0", iconOnly ? "w-8" : wide ? "min-w-0 flex-1" : "w-44")}>
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 z-20 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        {...searchHotkeyProps}
        aria-label="Tìm trong bảng"
        placeholder="Tìm trong bảng (/)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "!min-h-7 !text-xs !border-transparent !bg-muted !pl-8 !py-0",
          iconOnly && "!bg-transparent hover:!bg-muted",
          iconOnly && "!absolute right-0 top-0 !w-8 cursor-pointer placeholder:text-transparent focus:z-10 focus:!w-60 focus:cursor-text focus:!border-border focus:!bg-card focus:hover:!bg-card focus:shadow-md focus:placeholder:text-muted-foreground",
          iconOnly && value && "!w-60 !border-border z-10 placeholder:text-muted-foreground",
        )}
        autoComplete="off"
        maxLength={200}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ filter

function FilterButton({ columns, config, change, meta, extra }: { columns: Column[]; config: ViewConfig; change: Change; meta: ToolMeta; extra?: React.ReactNode }) {
  return (
    <ToolPopover meta={meta} label="Lọc dòng" title="Lọc dòng" width="w-[36rem]" footer="Mỗi thay đổi được lưu ngay vào view. Điều kiện chưa đủ giá trị chưa có tác dụng.">
      {extra}
      <FilterEditor idPrefix="flt" columns={columns} value={config.filter} onChange={(node) => change({ filter: node })} />
    </ToolPopover>
  );
}

// ------------------------------------------------------------------------------------------------ sort

const DIR_LABELS: Record<Kind, [string, string]> = {
  text: ["A → Z", "Z → A"],
  number: ["Nhỏ → lớn", "Lớn → nhỏ"],
  date: ["Cũ → mới", "Mới → cũ"],
  datetime: ["Cũ → mới", "Mới → cũ"],
  boolean: ["Không → Có", "Có → Không"],
  select: ["Theo thứ tự lựa chọn", "Ngược thứ tự lựa chọn"],
  set: ["A → Z", "Z → A"],
  user: ["A → Z", "Z → A"],
};

function SortButton({ columns, config, change, meta }: { columns: Column[]; config: ViewConfig; change: Change; meta: ToolMeta }) {
  const sort = config.sort ?? [];
  const usable = columns.filter(isSortable);
  const free = (current: string) => usable.filter((c) => c.key === current || !sort.some((s) => s.field === c.key));
  const set = (next: NonNullable<ViewConfig["sort"]>) => change({ sort: next.length ? next : undefined });
  return (
    <ToolPopover meta={meta} label="Sắp xếp" title="Sắp xếp" width="w-[32rem]" footer={`Tối đa ${MAX_SORT} cấp. Cột Một lựa chọn xếp theo thứ tự các lựa chọn. Muốn xếp theo quy tắc riêng, tạo cột công thức rồi chọn cột đó. Khi có nhóm, dòng xếp theo cột nhóm trước.`}>
      <div className="flex flex-col gap-2">
        {sort.length === 0 && <p className="text-muted-foreground">Dòng đang xếp theo thứ tự thêm vào bảng.</p>}
        {sort.map((s, i) => {
          const col = columns.find((c) => c.key === s.field);
          const kind = col ? kindOf(col) : null;
          const labels = DIR_LABELS[kind ?? "text"];
          return (
            <div key={`${s.field}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">{i === 0 ? "Xếp theo" : "Rồi theo"}</span>
              <Select aria-label={`Cột sắp xếp cấp ${i + 1}`} className={cn("!w-40 max-w-full", !col && "border-bad text-bad")} value={s.field} onChange={(e) => set(sort.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {!col && <option value={s.field}>Cột đã bị xoá</option>}
                {free(s.field).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </Select>
              <Select aria-label="Chiều sắp xếp" className="!w-44 max-w-full" value={s.dir} onChange={(e) => set(sort.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}>
                <option value="asc">{labels[0]}</option>
                <option value="desc">{labels[1]}</option>
              </Select>
              <Select aria-label="Vị trí ô trống" className="!w-36 max-w-full" value={s.nulls ?? (s.dir === "asc" ? "last" : "first")} onChange={(e) => set(sort.map((x, j) => (j === i ? { ...x, nulls: e.target.value as "first" | "last" } : x)))}>
                <option value="last">Ô trống ở cuối</option>
                <option value="first">Ô trống ở đầu</option>
              </Select>
              <Button variant="ghost" className="!px-2" aria-label={`Bỏ cấp sắp xếp ${i + 1}`} onClick={() => set(sort.filter((_, j) => j !== i))}>
                <Trash2 size={16} aria-hidden />
              </Button>
            </div>
          );
        })}
        <div>
          <Button variant="secondary" disabled={sort.length >= MAX_SORT || free("").length === 0} onClick={() => set([...sort, { field: free("")[0]!.key, dir: "asc", nulls: "last" }])}>
            <Plus size={16} aria-hidden /> Thêm cấp sắp xếp
          </Button>
        </div>
      </div>
    </ToolPopover>
  );
}

// ------------------------------------------------------------------------------------------------ group

const AGG_LABELS: Record<GroupFn, string> = { count: "Đếm ô có giá trị", sum: "Tổng", avg: "Trung bình", min: "Nhỏ nhất", max: "Lớn nhất" };

function aggOptions(kind: Kind | null): GroupFn[] {
  if (kind === "number") return ["count", "sum", "avg", "min", "max"];
  if (kind === "date") return ["count", "min", "max"];
  return ["count"];
}

function GroupButton({ columns, config, change, meta }: { columns: Column[]; config: ViewConfig; change: Change; meta: ToolMeta }) {
  const group = config.group ?? [];
  const aggs = config.group_aggs ?? {};
  const usable = columns.filter(isGroupable);
  const free = (current: string) => usable.filter((c) => c.key === current || !group.some((g) => g.field === c.key));
  const set = (next: NonNullable<ViewConfig["group"]>) => change(next.length ? { group: next } : { group: undefined, group_aggs: undefined, groups_collapsed: undefined, groups_toggled: undefined });
  const setAgg = (key: string, fn: GroupFn | "") => {
    const next = { ...aggs };
    if (fn) next[key] = fn;
    else delete next[key];
    change({ group_aggs: Object.keys(next).length ? next : undefined });
  };
  return (
    <ToolPopover meta={meta} label="Nhóm dòng" title="Nhóm dòng" width="w-[32rem]" footer={`Tối đa ${MAX_GROUP} cấp. Không nhóm được theo cột Nhiều lựa chọn, Văn bản dài, Ngày giờ.`}>
      <div className="flex flex-col gap-2">
        {group.length === 0 && <p className="text-muted-foreground">Chưa nhóm. Chọn một cột để gom các dòng cùng giá trị lại với nhau.</p>}
        {group.map((g, i) => {
          const col = columns.find((c) => c.key === g.field);
          return (
            <div key={`${g.field}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">{i === 0 ? "Nhóm theo" : "Rồi theo"}</span>
              <Select aria-label={`Cột nhóm cấp ${i + 1}`} className={cn("!w-44 max-w-full", !col && "border-bad text-bad")} value={g.field} onChange={(e) => set(group.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {!col && <option value={g.field}>Cột đã bị xoá</option>}
                {free(g.field).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </Select>
              <Select aria-label="Thứ tự nhóm" className="!w-36" value={g.dir ?? "asc"} onChange={(e) => set(group.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}>
                <option value="asc">Tăng dần</option>
                <option value="desc">Giảm dần</option>
              </Select>
              <Button variant="ghost" className="!px-2" aria-label={`Bỏ cấp nhóm ${i + 1}`} onClick={() => set(group.filter((_, j) => j !== i))}>
                <Trash2 size={16} aria-hidden />
              </Button>
            </div>
          );
        })}
        <div>
          <Button variant="secondary" disabled={group.length >= MAX_GROUP || free("").length === 0} onClick={() => set([...group, { field: free("")[0]!.key, dir: "asc" }])}>
            <Plus size={16} aria-hidden /> Thêm cấp nhóm
          </Button>
        </div>
        {group.length > 0 && (
          <div className="mt-1 flex flex-col gap-2 border-t border-border-soft pt-3">
            <Label>Dòng tổng của mỗi nhóm (số dòng luôn hiện)</Label>
            <ul className="contain-scroll-y flex max-h-52 flex-col gap-1 overflow-y-auto">
              {columns.filter((c) => kindOf(c) !== null && kindOf(c) !== "set").map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
                  <Select aria-label={`Tổng của cột ${c.name}`} className="!w-44 shrink-0" value={aggs[c.key] ?? ""} onChange={(e) => setAgg(c.key, e.target.value as GroupFn | "")}>
                    <option value="">Không tính</option>
                    {aggOptions(kindOf(c)).map((f) => <option key={f} value={f}>{AGG_LABELS[f]}</option>)}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ToolPopover>
  );
}

// ------------------------------------------------------------------------------------------------ columns

function ColumnsButton({ columns, config, change, meta }: { columns: Column[]; config: ViewConfig; change: Change; meta: ToolMeta }) {
  const order = fullOrder(config, columns);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const hidden = new Set(config.hidden ?? []);
  const visible = layoutColumns(config, columns).columns;
  const frozen = layoutColumns(config, columns).frozen;
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else if (visible.length > 1) next.add(key);
    change({ hidden: next.size ? [...next] : undefined });
  };
  const move = (key: string, by: -1 | 1) => {
    const at = order.indexOf(key);
    change({ order: moveColumn(order, key, at + by) });
  };
  return (
    <ToolPopover meta={meta} label="Cột của view" title="Cột của view" width="w-[26rem]" footer="Kéo mép tiêu đề để đổi độ rộng, kéo tiêu đề để đổi chỗ. Cột có ghim được cố định bên trái khi cuộn ngang.">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Hiện, ẩn, đổi thứ tự và cố định cột</Label>
          {hidden.size > 0 && <Button variant="ghost" onClick={() => change({ hidden: undefined })}>Hiện tất cả</Button>}
        </div>
        <ul className="contain-scroll-y flex max-h-72 flex-col overflow-y-auto">
          {order.map((k, i) => {
            const c = byKey.get(k)!;
            const on = !hidden.has(k);
            const vi = visible.findIndex((v) => v.key === k);
            return (
              <li key={k} className="flex items-center gap-1">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 sm:min-h-8">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} onChange={() => toggle(k)} aria-label={`Hiện cột ${c.name}`} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
                </label>
                {on && (
                  <Button variant="ghost" className="!px-2" aria-label={vi + 1 === frozen ? `Bỏ cố định đến cột ${c.name}` : `Cố định đến cột ${c.name}`} title={vi + 1 === frozen ? "Bỏ cố định" : "Cố định đến cột này"} onClick={() => change({ frozen: vi + 1 === frozen ? undefined : vi + 1 })}>
                    <Pin size={16} aria-hidden className={vi < frozen ? "fill-primary text-primary" : "text-muted-foreground"} />
                  </Button>
                )}
                <Button variant="ghost" className="!px-2" aria-label={`Đưa cột ${c.name} lên`} disabled={i === 0} onClick={() => move(k, -1)}>
                  <ArrowUp size={16} aria-hidden />
                </Button>
                <Button variant="ghost" className="!px-2" aria-label={`Đưa cột ${c.name} xuống`} disabled={i === order.length - 1} onClick={() => move(k, 1)}>
                  <ArrowDown size={16} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </ToolPopover>
  );
}

// ------------------------------------------------------------------------------------------------ row height

function RowHeightButton({ value, change, meta }: { value: RowHeight; change: Change; meta: ToolMeta }) {
  return (
    <ToolPopover meta={meta} label="Chiều cao dòng" title="Chiều cao dòng" width="w-60">
      <div role="radiogroup" aria-label="Chiều cao dòng" className="flex flex-col">
        {(Object.keys(ROW_HEIGHT_LABELS) as RowHeight[]).map((h) => (
          <label key={h} className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-muted sm:min-h-8">
            <input type="radio" name="row-height" className="h-4 w-4" checked={value === h} onChange={() => change({ row_height: h === DEFAULT_ROW_HEIGHT ? undefined : h })} />
            {ROW_HEIGHT_LABELS[h]}
            {h === "tall" && <span className="text-xs text-muted-foreground">(chữ dài xuống 2 dòng)</span>}
          </label>
        ))}
      </div>
    </ToolPopover>
  );
}

// ------------------------------------------------------------------------------------------------ colour rules

const COLOR_NAMES: Record<string, string> = { gray: "Xám", blue: "Xanh dương", green: "Xanh lá", orange: "Cam", red: "Đỏ", purple: "Tím", yellow: "Vàng", teal: "Xanh ngọc", pink: "Hồng" };

type DraftRule = { id: number; color: string; filter: FilterNode | undefined };
let ruleSeq = 0;

function ColorsButton({ columns, config, change, meta }: { columns: Column[]; config: ViewConfig; change: Change; meta: ToolMeta }) {
  return (
    <ToolPopover meta={meta} label="Tô màu theo điều kiện" title="Tô màu theo điều kiện" width="w-[36rem]">
      <ColorRules columns={columns} saved={config.colors ?? []} onChange={(rules) => change({ colors: rules.length ? rules : undefined })} />
    </ToolPopover>
  );
}

function ColorRules({ columns, saved, onChange }: { columns: Column[]; saved: ColorRule[]; onChange: (rules: ColorRule[]) => void }) {
  const [rules, setRules] = useState<DraftRule[]>(() => saved.map((r) => ({ id: ++ruleSeq, color: r.color, filter: r.filter })));
  const commit = (list: DraftRule[]) => {
    setRules(list);
    onChange(list.filter((r): r is DraftRule & { filter: FilterNode } => !!r.filter).map((r) => ({ filter: r.filter, color: r.color })));
  };
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 && <p className="text-muted-foreground">Chưa có quy tắc. Dòng thoả điều kiện sẽ được tô màu nền; dòng khớp nhiều quy tắc lấy màu của quy tắc đầu tiên.</p>}
      {rules.map((r, i) => (
        <div key={r.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Quy tắc {i + 1}</span>
            <span aria-hidden className="h-5 w-5 shrink-0 rounded border border-border" style={{ background: optionVar(r.color) }} />
            <Select aria-label={`Màu của quy tắc ${i + 1}`} className="!w-40" value={r.color} onChange={(e) => commit(rules.map((x) => (x.id === r.id ? { ...x, color: e.target.value } : x)))}>
              {OPTION_COLORS.map((c) => <option key={c} value={c}>{COLOR_NAMES[c]}</option>)}
            </Select>
            {!r.filter && <span className="text-xs text-muted-foreground">Chưa đủ điều kiện nên chưa tô.</span>}
            <Button variant="ghost" className="ml-auto !px-2" aria-label={`Xoá quy tắc ${i + 1}`} onClick={() => commit(rules.filter((x) => x.id !== r.id))}>
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
          <FilterEditor idPrefix={`clr${r.id}`} columns={columns} value={r.filter} onChange={(node) => commit(rules.map((x) => (x.id === r.id ? { ...x, filter: node } : x)))} />
        </div>
      ))}
      <div>
        <Button variant="secondary" disabled={rules.length >= MAX_COLORS} onClick={() => setRules([...rules, { id: ++ruleSeq, color: OPTION_COLORS[(rules.length % (OPTION_COLORS.length - 1)) + 1]!, filter: undefined }])}>
          <Plus size={16} aria-hidden /> Thêm quy tắc
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ time

const META_DATE_COLUMNS = [
  { key: "_created_at", name: "Ngày tạo dòng" },
  { key: "_updated_at", name: "Ngày sửa dòng" },
];

function dateChoices(dateCols: Column[]): { key: string; name: string }[] {
  const real = dateCols.map((c) => ({ key: c.key, name: c.name }));
  const hasCreated = dateCols.some((c) => c.type === "created_time");
  const hasModified = dateCols.some((c) => c.type === "modified_time");
  return [...real, ...META_DATE_COLUMNS.filter((m) => !(m.key === "_created_at" && hasCreated) && !(m.key === "_updated_at" && hasModified))];
}

const PRESET_OPTIONS = TIME_PRESETS.filter((p) => p !== "last_n_days");

function useRangeInfo(range: TimeRange | undefined) {
  return useQuery({ queryKey: dhKeys.timeRange(range), queryFn: () => resolveTimeRange(range!), enabled: !!range, staleTime: 60_000 });
}

function TimeButton({ columns, dateCols, config, change, meta }: { columns: Column[]; dateCols: Column[]; config: ViewConfig; change: Change; meta: ToolMeta }) {
  const tf = config.time_filter;
  const choices = dateChoices(dateCols);
  const info = useRangeInfo(tf?.range);
  const set = (next: TimeFilter | undefined) => change({ time_filter: next });
  const nameOf = (key: string) => choices.find((c) => c.key === key)?.name ?? columns.find((c) => c.key === key)?.name ?? key;
  const kind = !tf ? "none" : tf.range.kind === "preset" ? (tf.range.preset === "last_n_days" ? "last_n_days" : tf.range.preset) : tf.range.kind;
  const defaultColumns = [dateCols[0]?.key ?? "_created_at"];

  const choose = (value: string) => {
    const cols = tf?.columns ?? defaultColumns;
    if (value === "none") return set(undefined);
    if (value === "period") {
      const today = info.data;
      return set({ columns: cols, range: today ? currentPeriod("month", today) : { kind: "period", unit: "month", year: new Date().getFullYear(), index: new Date().getMonth() + 1 } });
    }
    if (value === "between") return set({ columns: cols, range: { kind: "between", from: null, to: null } });
    if (value === "last_n_days") return set({ columns: cols, range: { kind: "preset", preset: "last_n_days", n: 30 } });
    set({ columns: cols, range: { kind: "preset", preset: value as (typeof TIME_PRESETS)[number] } });
  };

  const period = tf?.range.kind === "period" ? tf.range : null;
  const setPeriodUnit = (unit: "month" | "quarter" | "year") => {
    if (!tf || !info.data) return;
    set({ ...tf, range: currentPeriod(unit, info.data) });
  };
  return (
    <ToolPopover meta={meta} label="Lọc theo thời gian" title="Lọc theo thời gian" width="w-[28rem]" footer="Kết hợp với bộ lọc điều kiện. Tuần bắt đầu từ thứ Hai, giờ Việt Nam.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Khoảng thời gian</Label>
          <Select aria-label="Khoảng thời gian" value={kind} onChange={(e) => choose(e.target.value)}>
            <option value="none">Không lọc theo thời gian</option>
            {PRESET_OPTIONS.map((p) => <option key={p} value={p}>{TIME_PRESET_LABELS[p]}</option>)}
            <option value="last_n_days">N ngày qua</option>
            <option value="period">Một kỳ cụ thể (tháng, quý, năm)</option>
            <option value="between">Từ ngày – đến ngày</option>
          </Select>
        </div>
        {tf?.range.kind === "preset" && tf.range.preset === "last_n_days" && (
          <label className="flex items-center gap-2">
            <Input aria-label="Số ngày" className="!w-24" inputMode="numeric" value={tf.range.n ?? ""} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 3660) set({ ...tf, range: { kind: "preset", preset: "last_n_days", n } }); }} />
            ngày gần nhất, tính cả hôm nay
          </label>
        )}
        {period && tf && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Loại kỳ" className="!w-28" value={period.unit} onChange={(e) => setPeriodUnit(e.target.value as "month" | "quarter" | "year")}>
              {(Object.keys(PERIOD_UNIT_LABELS) as (keyof typeof PERIOD_UNIT_LABELS)[]).map((u) => <option key={u} value={u}>{PERIOD_UNIT_LABELS[u]}</option>)}
            </Select>
            <Button variant="secondary" className="!px-2" aria-label="Kỳ trước" onClick={() => set({ ...tf, range: stepPeriod(period, -1) })}><ChevronLeft size={16} aria-hidden /></Button>
            <span className="min-w-28 text-center font-medium">{rangeName(period, info.data?.fiscal_start_month)}</span>
            <Button variant="secondary" className="!px-2" aria-label="Kỳ sau" onClick={() => set({ ...tf, range: stepPeriod(period, 1) })}><ChevronRight size={16} aria-hidden /></Button>
          </div>
        )}
        {tf?.range.kind === "between" && <BetweenInputs key={tf.range.kind} tf={tf} range={tf.range} set={set} />}
        {tf && (
          <>
            <p className="text-muted-foreground" aria-live="polite">{rangeDates(info.data) || (info.isLoading ? "…" : "")}</p>
            <fieldset className="flex flex-col">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Cột ngày (dòng khớp khi một trong các cột rơi vào khoảng)</legend>
              {choices.map((c) => {
                const on = tf.columns.includes(c.key);
                return (
                  <label key={c.key} className="flex min-h-11 items-center gap-2 [overflow-wrap:anywhere] sm:min-h-8">
                    <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} disabled={on && tf.columns.length === 1} onChange={() => set({ ...tf, columns: on ? tf.columns.filter((k) => k !== c.key) : [...tf.columns, c.key] })} />
                    {c.name}
                  </label>
                );
              })}
              {tf.columns.filter((k) => !choices.some((c) => c.key === k)).map((k) => <p key={k} className="text-xs text-bad">Cột "{nameOf(k)}" không còn.</p>)}
            </fieldset>
          </>
        )}
      </div>
    </ToolPopover>
  );
}

function BetweenInputs({ tf, range, set }: { tf: TimeFilter; range: Extract<TimeRange, { kind: "between" }>; set: (next: TimeFilter) => void }) {
  // The text the person types is kept as typed; a range is saved only once the text reads as a date (or is empty).
  const [text, setText] = useState({ from: range.from ? isoToText(range.from) : "", to: range.to ? isoToText(range.to) : "" });
  const change = (side: "from" | "to", value: string) => {
    setText((t) => ({ ...t, [side]: value }));
    const iso = value.trim() === "" ? null : parseLocaleDate(value);
    if (value.trim() !== "" && !iso) return;
    set({ ...tf, range: { ...range, [side]: iso } });
  };
  const textError = (v: string) => (v.trim() !== "" && !parseLocaleDate(v) ? "Nhập dạng dd/mm/yyyy, ví dụ 18/11/2026." : null);
  const order = range.from && range.to && range.from > range.to ? "Ngày bắt đầu phải trước hoặc cùng ngày kết thúc." : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Từ ngày" className="!w-36" inputMode="numeric" placeholder="Từ dd/mm/yyyy" value={text.from} onChange={(e) => change("from", e.target.value)} />
        <span>đến</span>
        <Input aria-label="Đến ngày" className="!w-36" inputMode="numeric" placeholder="Đến dd/mm/yyyy" value={text.to} onChange={(e) => change("to", e.target.value)} />
      </div>
      {[textError(text.from), textError(text.to), order].filter(Boolean).map((m) => <p key={m} role="alert" className="text-xs text-bad">{m}</p>)}
      <p className="text-xs text-muted-foreground">Bỏ trống một đầu để không giới hạn đầu đó.</p>
    </div>
  );
}

function isoToText(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ------------------------------------------------------------------------------------------------ chips

function ActiveChips({ columns, config, change }: { columns: Column[]; config: ViewConfig; change: Change }) {
  const tf = config.time_filter;
  const info = useRangeInfo(tf?.range);
  if (!tf) return null;
  const names = tf.columns.map((k) => columns.find((c) => c.key === k)?.name ?? META_DATE_COLUMNS.find((m) => m.key === k)?.name ?? k);
  const dates = rangeDates(info.data);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-2 lg:px-5" aria-label="Bộ lọc đang bật">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-selected py-0.5 pl-3 pr-1 text-sm">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {names.join(" hoặc ")}: <strong className="font-medium">{rangeName(tf.range, info.data?.fiscal_start_month)}</strong>
          {dates && <span className="text-muted-foreground"> ({dates})</span>}
        </span>
        <button type="button" aria-label="Bỏ lọc theo thời gian" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted sm:h-6 sm:w-6" onClick={() => change({ time_filter: undefined })}>
          <X size={16} aria-hidden />
        </button>
      </span>
    </div>
  );
}

