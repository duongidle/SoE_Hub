import { createPortal } from "react-dom";
import { GridCellKind, type CustomCell, type CustomRenderer, type ProvideEditorComponent } from "@glideapps/glide-data-grid";
import type { SelectOption } from "@/lib/datahub/types";
import { optionColor, token } from "@/lib/theme";
import { PersonPicker, RatingPicker, SelectPicker } from "./pickers";

/** Cells the grid draws itself: select chips, stars, a person. Their editors are the pickers shared with the detail panel. */

export type SoeData =
  | { t: "select"; ids: string[]; options: SelectOption[]; multi: boolean; readonly: boolean }
  | { t: "rating"; value: number | null; max: number; readonly: boolean }
  | { t: "person"; id: string | null; name: string; readonly: boolean };
export type SoeCell = CustomCell<SoeData>;

const isSoe = (c: CustomCell): c is SoeCell => typeof (c.data as { t?: unknown })?.t === "string";

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return "";
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * The grid clips its own overlay to the height of the cell, so a list of options is drawn in a portal on the page, beside the cell
 * (below it, or above when there is no room). `isOutsideClick` of the grid ignores clicks inside it (see `isInsidePopup`).
 */
export const POPUP_ATTR = "data-soe-popup";
export const isInsidePopup = (e: Event) => (e.target instanceof Element ? e.target.closest(`[${POPUP_ATTR}]`) !== null : false);

const Overlay: React.FC<{ children: React.ReactNode; target: { x: number; y: number; width: number; height: number } }> = ({ children, target }) => {
  const below = target.y + target.height + 320 < window.innerHeight || target.y < 320;
  const style: React.CSSProperties = { position: "fixed", zIndex: 60, left: Math.max(8, Math.min(target.x, window.innerWidth - 300)), ...(below ? { top: target.y + target.height + 2 } : { bottom: window.innerHeight - target.y + 2 }) };
  return createPortal(<div {...{ [POPUP_ATTR]: "" }} style={style}>{children}</div>, document.body);
};

const SelectEditor: ProvideEditorComponent<SoeCell> = ({ value, onChange, onFinishedEditing, target }) => {
  const d = value.data as Extract<SoeData, { t: "select" }>;
  const set = (ids: string[]) => ({ ...value, data: { ...d, ids }, copyData: ids.map((id) => d.options.find((o) => o.id === id)?.name ?? "").join(", ") });
  return (
    <Overlay target={target}>
      <SelectPicker options={d.options} value={d.ids} multi={d.multi} onChange={(ids) => onChange(set(ids))} onDone={(ids) => onFinishedEditing(set(ids), [0, 0])} onCancel={() => onFinishedEditing(undefined)} />
    </Overlay>
  );
};

const RatingEditor: ProvideEditorComponent<SoeCell> = ({ value, onFinishedEditing, target }) => {
  const d = value.data as Extract<SoeData, { t: "rating" }>;
  return (
    <Overlay target={target}>
      <RatingPicker value={d.value} max={d.max} onPick={(n) => onFinishedEditing({ ...value, data: { ...d, value: n }, copyData: n === null ? "" : String(n) }, [0, 0])} />
    </Overlay>
  );
};

const PersonEditor: ProvideEditorComponent<SoeCell> = ({ value, onFinishedEditing, target }) => {
  const d = value.data as Extract<SoeData, { t: "person" }>;
  return (
    <Overlay target={target}>
      <PersonPicker value={d.id} valueName={d.name} onCancel={() => onFinishedEditing(undefined)} onDone={(p) => onFinishedEditing({ ...value, data: { ...d, id: p?.id ?? null, name: p?.full_name ?? "" }, copyData: p?.full_name ?? "" }, [0, 0])} />
    </Overlay>
  );
};

export const soeRenderer: CustomRenderer<SoeCell> = {
  kind: GridCellKind.Custom,
  isMatch: isSoe,
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const d = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.textBaseline = "middle";
    ctx.font = theme.baseFontFull;
    const midY = rect.y + rect.height / 2;
    if (d.t === "rating") {
      const r = 7;
      for (let i = 0; i < d.max; i++) {
        const cx = rect.x + padX + r + i * (r * 2 + 3);
        if (cx + r > rect.x + rect.width - 2) break;
        star(ctx, cx, midY, r);
        if (d.value !== null && i < d.value) {
          ctx.fillStyle = token("--warn");
          ctx.fill();
        } else {
          ctx.strokeStyle = token("--border");
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
      }
    } else if (d.t === "person") {
      ctx.fillStyle = theme.textDark;
      ctx.textAlign = "left";
      if (d.name) ctx.fillText(fitText(ctx, d.name, rect.width - padX * 2), rect.x + padX, midY + 1);
      else {
        ctx.fillStyle = theme.textLight;
        ctx.fillText("—", rect.x + padX, midY + 1);
      }
    } else {
      let x = rect.x + padX;
      const max = rect.x + rect.width - padX;
      ctx.textAlign = "left";
      if (d.ids.length === 0) {
        ctx.fillStyle = theme.textLight;
        ctx.fillText("—", x, midY + 1);
      }
      d.ids.forEach((id, i) => {
        const o = d.options.find((x2) => x2.id === id);
        if (!o) return;
        const label = fitText(ctx, o.name, Math.max(24, max - x - 16));
        const w = ctx.measureText(label).width + 12;
        if (x + w > max + 1 && i > 0) return;
        ctx.fillStyle = optionColor(o.color);
        ctx.beginPath();
        ctx.roundRect(x, midY - 10, w, 20, 4);
        ctx.fill();
        ctx.fillStyle = theme.textDark;
        ctx.fillText(label, x + 6, midY + 1);
        x += w + 4;
      });
    }
    ctx.restore();
  },
  provideEditor: (cell) => {
    const d = cell.data;
    if (d.readonly) return undefined;
    return { editor: d.t === "select" ? SelectEditor : d.t === "rating" ? RatingEditor : PersonEditor, disablePadding: true, disableStyling: true };
  },
  onPaste: () => undefined,
};
