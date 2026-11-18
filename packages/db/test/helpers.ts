import { bigint, boolean, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import pg from "pg";
import type { Actor, ActorRef } from "@soe/shared";
import { createDb, standardColumns, type DbHandle } from "../src/index";

/** Business-like table created by test/global-setup.ts. */
export const testItems = pgTable("test_items", {
  ...standardColumns(),
  name: text("name").notNull(),
  status: text("status").notNull().default("new"),
  amount: bigint("amount", { mode: "number" }),
  closingDate: date("closing_date", { mode: "string" }),
  happenedAt: timestamp("happened_at", { withTimezone: true, mode: "date" }),
  done: boolean("done").notNull().default(false),
});

let handle: DbHandle | undefined;

/** Connection as the restricted runtime role (`soe_app`). */
export function appDb(): DbHandle {
  handle ??= createDb(process.env.TEST_DATABASE_URL!, { max: 5 });
  return handle;
}

/** Raw client as the schema owner, for checks that the runtime role cannot do. */
export async function ownerClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: process.env.TEST_OWNER_URL! });
  await c.connect();
  return c;
}

export const ACTOR_ID = "01900000-0000-7000-8000-000000000001";
export const actorRef: ActorRef = { userId: ACTOR_ID, via: "api", connectionId: null, automationId: null };
export const actor: Actor = { ...actorRef, sessionId: null, scopes: [], ip: "127.0.0.1", userAgent: "vitest" };
