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
/** CSS variable of an option color, for the parts drawn in HTML. */
export function optionVar(name: string | undefined): string {
  return `var(--opt-${(OPTION_COLORS as readonly string[]).includes(name ?? "") ? name : "gray"})`;
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
