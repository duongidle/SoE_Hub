import { applyPatch, diffConfig, type ViewConfig } from "./view-config";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Autosave of one view (design module2 section 5.2): every change shows at once and is sent after a short pause, as the
 * settings that changed. Several changes in a row go as one request; a change that arrives while a request is on its way
 * is sent right after it. When the server refuses, the screen goes back to what the server holds and says so.
 * The server decides where the change lands (shared view, the person's own copy, a personal view); this class does not.
 */
export class ViewAutosave {
  config: ViewConfig;
  status: SaveStatus = "idle";
  private saved: ViewConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(
    initial: ViewConfig,
    private opts: { save: (patch: Record<string, unknown>) => Promise<ViewConfig>; onError: (e: unknown) => void; delay?: number },
  ) {
    this.config = initial;
    this.saved = initial;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private emit(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** What the server holds now (another device saved, or the person pressed "Về mặc định"). Ignored while a change of ours is not saved yet. */
  adopt(config: ViewConfig): void {
    if (this.dirty || this.running) return;
    this.saved = config;
    this.config = config;
    this.emit();
  }

  /** Applies a change: a setting set to `undefined` is removed. */
  change(patch: Partial<Record<keyof ViewConfig, unknown>>): void {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) norm[k] = v === undefined ? null : v;
    this.config = applyPatch(this.config, norm);
    this.dirty = true;
    this.emit();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.delay ?? 400);
  }

  /** Sends what is not saved yet and resolves when everything is on the server. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      await this.running;
      if (!this.dirty) return;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      const patch = diffConfig(this.saved, this.config);
      if (!patch) break;
      this.status = "saving";
      this.emit();
      try {
        this.saved = await this.opts.save(patch);
        this.status = "saved";
      } catch (e) {
        this.status = "error";
        this.dirty = false;
        this.config = this.saved;
        this.opts.onError(e);
        break;
      }
      this.emit();
    }
    this.emit();
  }
}
