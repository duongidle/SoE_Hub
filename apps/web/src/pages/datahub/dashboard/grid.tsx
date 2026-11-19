import { GripVertical, MoveDiagonal2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COLS, MAX_ROWS, compact, place, readingOrder, sameLayout, type Item } from "@/lib/dashboard/layout";
import { cn } from "@/lib/utils";

const ROW_H = 76;
const GAP = 12;

export interface GridCard {
  id: string;
  layout: { x: number; y: number; w: number; h: number };
  min: { w: number; h: number };
  title: string;
  /** Menu button of the card (Sửa, Nhân bản, Xoá). */
  menu: React.ReactNode;
  body: React.ReactNode;
}

interface Drag {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  base: Item[];
}

/**
 * Drag-and-drop grid of 12 columns. A card moves by its handle (mouse, touch, or the arrow keys on the handle) and resizes by the
 * corner (or the arrow keys on it). While dragging, the rest of the cards are pushed down so nothing overlaps; the final layout is
 * handed to `onCommit`, which saves it. Below 640px the cards stack in one column and do not move.
 */
export function DashboardGrid({ cards, onCommit, readOnly }: { cards: GridCard[]; onCommit: (items: Item[]) => void; readOnly?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Item[] | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const minOf = useMemo(() => new Map(cards.map((c) => [c.id, c.min])), [cards]);
  const items: Item[] = useMemo(() => compact(cards.map((c) => ({ id: c.id, ...c.layout }))), [cards]);
  const shown = preview ?? items;
  const wide = width >= 640;
  const colW = wide ? (width - GAP * (COLS - 1)) / COLS : width;
  const stepX = colW + GAP;
  const stepY = ROW_H + GAP;

  const move = (id: string, mode: Drag["mode"], dx: number, dy: number, base: Item[]) => {
    const cur = base.find((i) => i.id === id)!;
    const change = mode === "move" ? { x: cur.x + dx, y: cur.y + dy } : { w: cur.w + dx, h: cur.h + dy };
    return place(base, id, change, minOf.get(id));
  };

  const start = (e: React.PointerEvent, id: string, mode: Drag["mode"]) => {
    if (readOnly || !wide || e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, startY: e.clientY, base: items });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setPreview(move(drag.id, drag.mode, Math.round((e.clientX - drag.startX) / stepX), Math.round((e.clientY - drag.startY) / stepY), drag.base));
  };
  const end = () => {
    if (drag && preview && !sameLayout(preview, drag.base)) onCommit(preview);
    setDrag(null);
    setPreview(null);
  };
  const key = (e: React.KeyboardEvent, id: string, mode: Drag["mode"]) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || readOnly) return;
    e.preventDefault();
    const next = move(id, mode, d[0]!, d[1]!, items);
    if (!sameLayout(next, items)) onCommit(next);
  };

  const rows = shown.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const ordered = wide ? cards : readingOrder(cards.map((c) => ({ ...c, ...c.layout }))).map((c) => cards.find((x) => x.id === c.id)!);

  return (
    <div ref={box} className="relative w-full" style={wide ? { height: Math.min(rows, MAX_ROWS * 4) * stepY - GAP } : undefined} data-testid="dashboard-grid">
      {ordered.map((c) => {
        const it = shown.find((i) => i.id === c.id)!;
        const dragging = drag?.id === c.id;
        const style: React.CSSProperties = wide
          ? { position: "absolute", left: it.x * stepX, top: it.y * stepY, width: it.w * colW + (it.w - 1) * GAP, height: it.h * ROW_H + (it.h - 1) * GAP, transition: dragging ? "none" : undefined }
          : { height: Math.max(it.h, 3) * ROW_H + (Math.max(it.h, 3) - 1) * GAP, marginBottom: GAP };
        return (
          <section key={c.id} style={style} data-chart-id={c.id} data-layout={`${it.x},${it.y},${it.w},${it.h}`} aria-label={c.title} className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-card p-3 shadow-sm", dragging && "z-10 ring-2 ring-ring")}>
            <header className="mb-1 flex shrink-0 items-center gap-1">
              {wide && !readOnly && (
                <button
                  type="button"
                  aria-label={`Di chuyển biểu đồ ${c.title} (kéo, hoặc dùng phím mũi tên)`}
                  className="-ml-1 inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
                  onPointerDown={(e) => start(e, c.id, "move")}
                  onPointerMove={onMove}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(e) => key(e, c.id, "move")}
                  data-testid="chart-move"
                >
                  <GripVertical size={16} aria-hidden />
                </button>
              )}
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={c.title}>{c.title}</h3>
              {!readOnly && c.menu}
            </header>
            <div className="min-h-0 flex-1">{c.body}</div>
            {wide && !readOnly && (
              <button
                type="button"
                aria-label={`Đổi kích thước biểu đồ ${c.title} (kéo, hoặc dùng phím mũi tên)`}
                className="absolute bottom-0.5 right-0.5 inline-flex size-6 cursor-nwse-resize touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted"
                onPointerDown={(e) => start(e, c.id, "resize")}
                onPointerMove={onMove}
                onPointerUp={end}
                onPointerCancel={end}
                onKeyDown={(e) => key(e, c.id, "resize")}
                data-testid="chart-resize"
              >
                <MoveDiagonal2 size={14} aria-hidden />
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
