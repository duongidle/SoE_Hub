import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Logger } from "pino";
import type { Audience } from "../core/events";

export const SSE_CHANNEL = "soe_sse";
/** Cache-clearing messages for the api processes (metrics answer cache); never sent to clients. */
export const CACHE_CHANNEL = "soe_metric_cache";

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
type CacheListener = (message: unknown) => void;

/**
 * Receives signals published by the worker (`pg_notify`) and fans them out to open SSE connections in this process.
 * It carries signals only (event name + object id), never row data: the client re-fetches through authorized queries.
 */
export class SseHub {
  private client: pg.Client | null = null;
  private readonly listeners = new Map<string, Listener>();
  private readonly cacheListeners = new Set<CacheListener>();
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

  /** Listens to the messages that say which cached answers to drop (the worker sends them before the matching SSE signal). */
  subscribeCache(fn: CacheListener): () => void {
    this.cacheListeners.add(fn);
    return () => this.cacheListeners.delete(fn);
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
      if (!msg.payload) return;
      if (msg.channel === CACHE_CHANNEL) {
        try {
          const m = JSON.parse(msg.payload) as unknown;
          for (const fn of this.cacheListeners) fn(m);
        } catch (e) {
          this.log.warn({ err: e }, "bad cache payload");
        }
        return;
      }
      if (msg.channel !== SSE_CHANNEL) return;
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
    await client.query(`LISTEN ${CACHE_CHANNEL}`);
    // Notifications sent while this connection was down are lost: drop every cached answer rather than serve a stale one.
    for (const fn of this.cacheListeners) fn({ all: true });
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
