import { lookupPeople, relationLabels } from "./api";

/**
 * Names for the ids that sit in cells: people (user, created by, modified by columns) and linked rows. The grid asks for an id the
 * first time it draws it; requests are grouped (up to 200 ids each) and the answers are remembered for the life of the table.
 */
export class LabelCache {
  readonly people = new Map<string, string>();
  readonly linked = new Map<string, string>();
  private wantedPeople = new Set<string>();
  private wantedLinked = new Map<string, Set<string>>();
  private requested = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(private tableId: string) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  wantPerson(id: string): void {
    if (this.people.has(id) || this.requested.has(id)) return;
    this.requested.add(id);
    this.wantedPeople.add(id);
    this.schedule();
  }

  wantLinked(columnKey: string, id: string): void {
    if (this.linked.has(id) || this.requested.has(id)) return;
    this.requested.add(id);
    (this.wantedLinked.get(columnKey) ?? this.wantedLinked.set(columnKey, new Set()).get(columnKey)!).add(id);
    this.schedule();
  }

  /** A person is known (picked from the list, or loaded elsewhere). */
  learnPerson(id: string, name: string): void {
    this.people.set(id, name);
  }

  /** A linked row is known (picked from the list). */
  learnLinked(id: string, label: string): void {
    this.linked.set(id, label);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), 80);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const people = [...this.wantedPeople];
    const linked = [...this.wantedLinked];
    this.wantedPeople = new Set();
    this.wantedLinked = new Map();
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < people.length; i += 200) {
      const ids = people.slice(i, i + 200);
      jobs.push(
        lookupPeople({ ids })
          .then((list) => {
            list.forEach((p) => this.people.set(p.id, p.full_name));
            // An id that is not a person any more shows a dash instead of "…" forever.
            ids.filter((x) => !this.people.has(x)).forEach((x) => this.people.set(x, "—"));
          })
          .catch(() => ids.forEach((x) => this.requested.delete(x))),
      );
    }
    for (const [key, set] of linked) {
      const all = [...set];
      for (let i = 0; i < all.length; i += 200) {
        const ids = all.slice(i, i + 200);
        jobs.push(
          relationLabels(this.tableId, key, ids)
            .then((list) => {
              list.forEach((l) => this.linked.set(l.id, l.label));
              ids.filter((x) => !this.linked.has(x)).forEach((x) => this.linked.set(x, "—"));
            })
            .catch(() => ids.forEach((x) => this.requested.delete(x))),
        );
      }
    }
    await Promise.all(jobs);
    this.listeners.forEach((f) => f());
  }
}
