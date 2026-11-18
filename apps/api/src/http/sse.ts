import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Logger } from "pino";
import type { Audience } from "../core/events";

export const SSE_CHANNEL = "soe_sse";

export interface SseSignal {
  id: string;
  event: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  at: string;
  /** Who may receive it (computed by the worker from the event definition). Never sent to clients. */
  audience?: Audience | null;
}

type Listener = (s: SseSignal) => void;

/**
 * Receives signals published by the worker (`pg_notify`) and fans them out to open SSE connections in this process.
 * It carries signals only (event name + object id), never row data: the client re-fetches through authorized queries.
 */
export class SseHub {
  private client: pg.Client | null = null;
  private readonly listeners = new Map<string, Listener>();
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly connectionString: string,
    private readonly log: Logger,
  ) {}

  subscribe(fn: Listener): () => void {
    const id = randomUUID();
    this.listeners.set(id, fn);
    return () => this.listeners.delete(id);
  }

  get size(): number {
    return this.listeners.size;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString, application_name: "soe-sse" });
    client.on("notification", (msg) => {
      if (msg.channel !== SSE_CHANNEL || !msg.payload) return;
      try {
        const signal = JSON.parse(msg.payload) as SseSignal;
        for (const fn of this.listeners.values()) fn(signal);
      } catch (e) {
        this.log.warn({ err: e }, "bad SSE payload");
      }
    });
    const reconnect = () => {
      if (this.stopped || this.retryTimer) return;
      this.client = null;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect().catch(() => reconnect());
      }, 2000);
    };
    client.on("error", (e) => {
      this.log.warn({ err: e }, "SSE listener connection error");
      reconnect();
    });
    client.on("end", reconnect);
    await client.connect();
    await client.query(`LISTEN ${SSE_CHANNEL}`);
    this.client = client;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}
