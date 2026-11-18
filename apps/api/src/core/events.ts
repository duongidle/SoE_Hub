import type { z } from "zod";
import type { Db } from "@soe/db";
import type { ScopeKind } from "../auth/access";

/**
 * Who may receive the SSE signal of an event (design module1 section 10: only people who may see the object).
 * An event without an audience sends no signal at all (safe default).
 * - `users`: exactly these accounts.
 * - `permission`: everyone holding this permission.
 * - `scope`: everyone whose data scope of this kind contains one of the owners.
 * Several fields = any of them.
 */
export interface Audience {
  users?: string[];
  permission?: string;
  scope?: { kind: ScopeKind; ownerIds: string[] };
}

/**
 * Event catalogue (design section 13). Events have a fixed, versioned schema.
 * Name: `<module>.<object>.<past-tense verb>`.
 */
export interface EventDef {
  name: string;
  version: number;
  schema: z.ZodType;
  description: string;
  /** Computes the SSE audience from the payload. Runs in the worker (may read the database). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audience?: (payload: any, db: Db) => Audience | null | Promise<Audience | null>;
}

export class EventRegistry {
  private readonly events = new Map<string, EventDef>();

  register(...defs: EventDef[]): this {
    for (const d of defs) {
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,3}$/.test(d.name)) throw new Error(`Tên sự kiện không hợp lệ: ${d.name}`);
      if (this.events.has(d.name)) throw new Error(`Sự kiện bị khai báo trùng: ${d.name}`);
      this.events.set(d.name, d);
    }
    return this;
  }

  get(name: string): EventDef | undefined {
    return this.events.get(name);
  }

  list(): EventDef[] {
    return [...this.events.values()];
  }
}
