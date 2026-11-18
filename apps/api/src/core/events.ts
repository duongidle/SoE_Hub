import type { z } from "zod";

/**
 * Event catalogue (design section 13). Events have a fixed, versioned schema.
 * Name: `<module>.<object>.<past-tense verb>`.
 */
export interface EventDef {
  name: string;
  version: number;
  schema: z.ZodType;
  description: string;
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
