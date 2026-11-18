/** One thing the person did that can be taken back. `undo` and `redo` talk to the server; they throw when the server refuses (for example a cell changed meanwhile). */
export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Undo and redo stacks of one open table. A new action clears what could be redone. */
export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  busy = false;

  constructor(private limit = 100) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.listeners.forEach((f) => f());
  }

  get canUndo(): boolean {
    return this.done.length > 0 && !this.busy;
  }
  get canRedo(): boolean {
    return this.undone.length > 0 && !this.busy;
  }

  push(e: UndoEntry): void {
    this.done.push(e);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.emit();
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.emit();
  }

  /** Returns the label of what was undone, or null when there is nothing to undo. A failure clears both stacks (the table moved on). */
  async undo(): Promise<string | null> {
    const e = this.done.at(-1);
    if (!e || this.busy) return null;
    return this.run(async () => {
      await e.undo();
      this.done.pop();
      this.undone.push(e);
    }, e.label);
  }

  async redo(): Promise<string | null> {
    const e = this.undone.at(-1);
    if (!e || this.busy) return null;
    return this.run(async () => {
      await e.redo();
      this.undone.pop();
      this.done.push(e);
    }, e.label);
  }

  /** Takes back one entry that is not necessarily the last (the "Hoàn tác" button of a toast). */
  async revert(e: UndoEntry): Promise<string | null> {
    if (this.done.at(-1) === e) return this.undo();
    const i = this.done.indexOf(e);
    if (i < 0 || this.busy) return null;
    return this.run(async () => {
      await e.undo();
      this.done.splice(i, 1);
      this.undone = [];
    }, e.label);
  }

  private async run(fn: () => Promise<void>, label: string): Promise<string> {
    this.busy = true;
    this.emit();
    try {
      await fn();
      return label;
    } catch (e) {
      this.clear();
      throw e;
    } finally {
      this.busy = false;
      this.emit();
    }
  }
}
