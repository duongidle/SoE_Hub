/**
 * Layout of the dashboard grid: pure functions on integer cells (12 columns). Moving or resizing one item pushes the items it
 * lands on down, then every item rises as far as it can (vertical compaction), so the grid never overlaps and never keeps gaps.
 */
export const COLS = 12;
export const MAX_ROWS = 40;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Item extends Rect {
  id: string;
}

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Keeps a rectangle inside the grid with at least the minimum size. */
export function clampRect(r: Rect, min: { w: number; h: number } = { w: 1, h: 1 }): Rect {
  const w = Math.min(COLS, Math.max(min.w, Math.round(r.w)));
  const h = Math.min(MAX_ROWS, Math.max(min.h, Math.round(r.h)));
  return { x: Math.min(COLS - w, Math.max(0, Math.round(r.x))), y: Math.max(0, Math.round(r.y)), w, h };
}

/**
 * Places every item: `fixed` (the one being moved) keeps its place; the others, in order of their current top then left, rise to the
 * first free row. Items are never reordered within a column by this, only pushed.
 */
export function compact(items: Item[], fixedId?: string): Item[] {
  const placed: Item[] = [];
  const fixed = fixedId ? items.find((i) => i.id === fixedId) : undefined;
  if (fixed) placed.push({ ...fixed });
  const rest = items.filter((i) => i.id !== fixedId).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const it of rest) {
    let y = 0;
    const next: Item = { ...it, y };
    while (placed.some((p) => hit(p, next))) next.y = ++y;
    placed.push(next);
  }
  // Same order as the input.
  return items.map((i) => placed.find((p) => p.id === i.id)!);
}

/** Moves or resizes one item (any of x, y, w, h), clamped to the grid, and settles the rest around it. */
export function place(items: Item[], id: string, change: Partial<Rect>, min?: { w: number; h: number }): Item[] {
  const cur = items.find((i) => i.id === id);
  if (!cur) return items;
  const r = clampRect({ ...cur, ...change }, min);
  return compact(items.map((i) => (i.id === id ? { ...i, ...r } : i)), id);
}

/** Item at the first free place at the bottom for a new chart. */
export function bottom(items: Item[]): number {
  return items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
}

/** Order for a single column (phone): top to bottom, left to right. */
export function readingOrder<T extends Rect>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

export const sameLayout = (a: Item[], b: Item[]): boolean => a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.x === b[i]!.x && x.y === b[i]!.y && x.w === b[i]!.w && x.h === b[i]!.h);

/** Smallest size a chart type can be drawn at (cells). */
export const MIN_SIZE: Record<string, { w: number; h: number }> = {
  kpi: { w: 2, h: 2 },
  note: { w: 2, h: 1 },
  pie: { w: 3, h: 3 },
  donut: { w: 3, h: 3 },
};
export const minSizeOf = (type: string) => MIN_SIZE[type] ?? { w: 3, h: 3 };
export const defaultSizeOf = (type: string): { w: number; h: number } => (type === "kpi" ? { w: 3, h: 3 } : type === "note" ? { w: 4, h: 2 } : type === "pie" || type === "donut" ? { w: 4, h: 5 } : { w: 6, h: 5 });
