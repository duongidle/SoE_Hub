import type * as React from "react";
/**
 * The grid draws on a canvas, which cannot read CSS variables. These helpers resolve the design tokens of `index.css` to colors
 * the canvas understands, so the grid keeps the same colors as the rest of the app.
 */
let probe: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true })!;
  }
  return probe;
}

const cache = new Map<string, string>();

/** `token("--primary")` -> `rgb(r, g, b)`. */
export function token(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const el = document.createElement("span");
  el.style.color = `var(${name})`;
  document.body.appendChild(el);
  const raw = getComputedStyle(el).color;
  el.remove();
  const c = ctx();
  c.clearRect(0, 0, 1, 1);
  c.fillStyle = "#000";
  c.fillStyle = raw;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
  const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(3)})`;
  cache.set(name, out);
  return out;
}

export const FONT_STACK = '"SoE Number", "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif';

/** Option colors a column can use. Unknown names fall back to grey. */
export const OPTION_COLORS = ["gray", "blue", "green", "orange", "red", "purple", "yellow", "teal", "pink"] as const;
export function optionColor(name: string | undefined): string {
  return token(`--opt-${(OPTION_COLORS as readonly string[]).includes(name ?? "") ? name : "gray"}`);
}
/**
 * Option chip (mockup): a dot, a light fill, a light border and bold text of one color. Green = done, blue = in progress, orange = waiting,
 * red = overdue/error, purple = special/AI; teal, pink, yellow and grey follow the same four-part set (`--<name>`, `-bg`, `-border`, `-dot`).
 */
const CHIP_TOKEN: Record<string, string> = { green: "ok", blue: "info", orange: "warn", red: "bad", purple: "ai", teal: "teal", pink: "pink", yellow: "yellow", gray: "gray" };
/** Colors given by turns to options that have none yet (grey is left out: it reads as "no color"). */
const AUTO_ORDER = ["blue", "green", "orange", "purple", "red", "teal", "pink", "yellow"] as const;
/**
 * The color an option is shown with. A color the option has is kept; one without gets a color by its position in the column's options,
 * so it stays the same when the list is filtered. Display only: nothing is written to the data.
 */
export function resolveOptionColor(name: string | undefined, index: number): string {
  if ((OPTION_COLORS as readonly string[]).includes(name ?? "")) return name!;
  return AUTO_ORDER[Math.max(0, index) % AUTO_ORDER.length]!;
}
/** Colors of an option chip drawn on the canvas. */
export function optionChip(name: string | undefined, index = 0): { bg: string; fg: string; border: string; dot: string } {
  const s = CHIP_TOKEN[resolveOptionColor(name, index)]!;
  return { bg: token(`--${s}-bg`), fg: token(`--${s}`), border: token(`--${s}-border`), dot: token(`--${s}-dot`) };
}
/** CSS of an option chip for the parts drawn in HTML (`--chip-dot` is the color of the dot). */
export function optionChipVar(name: string | undefined, index = 0): React.CSSProperties {
  const s = CHIP_TOKEN[resolveOptionColor(name, index)]!;
  return { background: `var(--${s}-bg)`, color: `var(--${s})`, borderColor: `var(--${s}-border)`, ["--chip-dot" as string]: `var(--${s}-dot)` };
}
/** CSS variable of an option color (a swatch), for the parts drawn in HTML. `index`: position of the option, for one without a color. */
export function optionVar(name: string | undefined, index?: number): string {
  const c = index === undefined ? ((OPTION_COLORS as readonly string[]).includes(name ?? "") ? name : "gray") : resolveOptionColor(name, index);
  return `var(--opt-${c})`;
}

/** Waits until the fonts the grid draws with are ready (a canvas does not redraw by itself when a font arrives). */
export async function fontsReady(): Promise<void> {
  if (!("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load('400 14px "Be Vietnam Pro"', "Việt Nam ạảãàáâấầ"),
      document.fonts.load('600 14px "Be Vietnam Pro"', "Việt Nam"),
      document.fonts.load('400 14px "SoE Number"', "0123456789"),
      document.fonts.load('600 14px "SoE Number"', "0123456789"),
    ]);
  } catch {
    /* draw with the fallback font */
  }
}
