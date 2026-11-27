import type { Locator, Page } from "@playwright/test";

/**
 * The data grid is a canvas, so a test finds a cell by its position: the layout (column widths, row height) is published by the
 * grid in `data-*` attributes, and values are read back through the clipboard (what Copy puts there is what the cell shows).
 */
export class GridDriver {
  constructor(readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId("grid");
  }

  private async layout() {
    const box = (await this.root.boundingBox())!;
    const widths = JSON.parse((await this.root.getAttribute("data-widths")) ?? "[]") as number[];
    const rowH = Number(await this.root.getAttribute("data-row-height"));
    const marker = Number(await this.root.getAttribute("data-marker-width"));
    return { box, widths, rowH, marker };
  }

  private async scrollX(): Promise<number> {
    return this.page.evaluate(() => (document.querySelector(".dvn-scroller") as HTMLElement | null)?.scrollLeft ?? 0);
  }

  /** Scrolls sideways so that column `c` is fully on screen, then returns the point at its middle in row `r`. */
  async point(c: number, r: number, edge = false): Promise<{ x: number; y: number }> {
    const { box, widths, rowH, marker } = await this.layout();
    const start = widths.slice(0, c).reduce((a, b) => a + b, 0);
    const w = widths[c] ?? 100;
    const view = box.width - marker;
    let sx = await this.scrollX();
    if (start < sx || start + w > sx + view) {
      sx = Math.max(0, Math.min(start - 8, start + w - view + 8));
      await this.page.evaluate((x) => ((document.querySelector(".dvn-scroller") as HTMLElement).scrollLeft = x), sx);
      await this.page.waitForTimeout(200);
      sx = await this.scrollX();
    }
    return { x: box.x + marker + (start - sx) + (edge ? 6 : Math.min(w, view) / 2), y: box.y + rowH + r * rowH + rowH / 2 };
  }

  async click(c: number, r: number, opts: { double?: boolean; edge?: boolean } = {}): Promise<void> {
    const p = await this.point(c, r, opts.edge);
    if (opts.double) await this.page.mouse.dblclick(p.x, p.y);
    else await this.page.mouse.click(p.x, p.y);
    // The grid reads its selection on the next frame; a key pressed in the same instant would go to the previous cell.
    await this.page.waitForTimeout(150);
  }

  /** The row marker (the number at the left) of row `r`. */
  async markerPoint(r: number): Promise<{ x: number; y: number }> {
    const { box, rowH, marker } = await this.layout();
    return { x: box.x + marker / 2, y: box.y + rowH + r * rowH + rowH / 2 };
  }

  /** Selects the row: a right click on its number (the left click opens the row panel). `append` keeps the rows already selected (Ctrl/Cmd). */
  async clickMarker(r: number, opts: { append?: boolean } = {}): Promise<void> {
    const p = await this.markerPoint(r);
    await this.page.mouse.move(p.x, p.y);
    if (opts.append) await this.page.keyboard.down("Control");
    await this.page.mouse.click(p.x, p.y, { button: "right" });
    if (opts.append) await this.page.keyboard.up("Control");
  }

  /** Opens the row panel: a left click on the row number. */
  async openMarker(r: number): Promise<void> {
    const p = await this.markerPoint(r);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.click(p.x, p.y);
  }

  /** Types into the cell: the first key opens the editor (Glide needs a moment), the rest goes into it. Enter saves. */
  async type(c: number, r: number, text: string, opts: { enter?: boolean } = {}): Promise<void> {
    await this.click(c, r);
    await this.page.keyboard.type(text.slice(0, 1), { delay: 60 });
    await this.page.waitForTimeout(250);
    if (text.length > 1) await this.page.keyboard.type(text.slice(1), { delay: 15 });
    if (opts.enter !== false) await this.page.keyboard.press("Enter");
  }

  /** What the cell shows (the text Copy puts on the clipboard). */
  async read(c: number, r: number): Promise<string> {
    // A second click on the selected cell opens its editor, and a click in the middle of a checkbox toggles it:
    // select a neighbour first, then the cell at its left edge.
    await this.page.keyboard.press("Escape");
    await this.click(c === 0 ? 1 : 0, r);
    await this.click(c, r, { edge: true });
    return this.copy();
  }

  async copy(): Promise<string> {
    await this.page.evaluate(() => navigator.clipboard.writeText("__empty__"));
    await this.page.keyboard.press("ControlOrMeta+c");
    await this.page.waitForTimeout(150);
    const t = await this.page.evaluate(() => navigator.clipboard.readText());
    return t === "__empty__" ? "" : t.replace(/\r?\n$/, "");
  }

  /** Puts text on the clipboard and pastes it at the selected cell. */
  async paste(text: string): Promise<void> {
    await this.page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await this.page.keyboard.press("ControlOrMeta+v");
  }
}
