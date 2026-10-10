import { ApiError } from "../api/client";

/** One request of a piece of queued work. */
export interface QueuedStep {
  method: "PUT" | "POST" | "PATCH";
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  /**
   * For a write guarded by a version (If-Match): the version it was made against, and where to
   * read the latest one if someone else saved first. The write is then sent again on top of it,
   * as the screen itself would (last change wins, e.g. roll-call marks).
   */
  ifMatch?: { version: number; refreshFrom: string };
}

/**
 * Work the person did while offline, kept on the device until it can be sent (handoff §9.20,
 * §10.4). `key` is the Idempotency-Key every step is sent with, so a replay after a dropped
 * response is applied once.
 */
export interface QueuedWork {
  key: string;
  /** Which screen it belongs to, e.g. "assignment:<id>", for that screen's "waiting" pill. */
  group: string;
  steps: QueuedStep[];
}

interface Stored extends QueuedWork {
  queuedAt: string;
  /** Steps already accepted by the server; a retry starts after them. */
  done: number;
}

/** Where queued work lives: IndexedDB in the browser, memory in tests. */
export interface QueueStore {
  all(): Promise<Stored[]>;
  put(work: Stored): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryStore(): QueueStore {
  const items = new Map<string, Stored>();
  return {
    all: () => Promise.resolve([...items.values()]),
    put: (work) => {
      items.set(work.key, structuredClone(work));
      return Promise.resolve();
    },
    remove: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
}

export type Send = (step: QueuedStep, idempotencyKey: string) => Promise<void>;

/** The HTTP call `sendStep` makes; `api` in the app. */
export type Request = (
  method: string,
  path: string,
  init: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> },
) => Promise<unknown>;

/** How often a versioned write is retried on a newer version before it is given up. */
const VERSION_ATTEMPTS = 3;

/** Sends one step with its Idempotency-Key and, for a versioned write, If-Match (see `ifMatch`). */
export async function sendStep(step: QueuedStep, key: string, request: Request): Promise<void> {
  const params = step.params ? { params: step.params } : {};
  let version = step.ifMatch?.version;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await request(step.method, step.path, {
        ...params,
        ...(step.body === undefined ? {} : { body: step.body }),
        headers: {
          "idempotency-key": key,
          ...(version === undefined ? {} : { "if-match": `"${String(version)}"` }),
        },
      });
      return;
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 412;
      if (!stale || step.ifMatch === undefined || attempt >= VERSION_ATTEMPTS) throw error;
      const latest = (await request("GET", step.ifMatch.refreshFrom, params)) as {
        version: number;
      };
      version = latest.version;
    }
  }
}

export interface FlushResult {
  sent: QueuedWork[];
  /** Work the server refused (closed, invalid…): dropped from the queue, to tell the person. */
  rejected: { request: QueuedWork; error: ApiError }[];
}

/** Errors that mean "try again later" rather than "the server said no". */
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true; // the request never got an answer
  return error.status >= 500 || error.status === 429 || error.code === "IDEMPOTENCY_IN_PROGRESS";
}

export class OfflineQueue {
  private flushing: Promise<FlushResult> | null = null;
  private readonly listeners = new Set<(result: FlushResult | null) => void>();

  constructor(
    private readonly store: QueueStore,
    private readonly send: Send,
  ) {}

  async enqueue(work: QueuedWork): Promise<void> {
    await this.store.put({ ...work, queuedAt: new Date().toISOString(), done: 0 });
    this.notify(null);
  }

  async count(group?: string): Promise<number> {
    const all = await this.store.all();
    return all.filter((w) => group === undefined || w.group === group).length;
  }

  /** A group's waiting work, oldest first (to show it on screen until it is sent). */
  async list(group: string): Promise<QueuedWork[]> {
    return (await this.sorted())
      .filter((w) => w.group === group)
      .map(({ key, group: g, steps }) => ({ key, group: g, steps }));
  }

  private async sorted(): Promise<Stored[]> {
    return (await this.store.all()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  /** Called after each change: with the outcome when a flush sent or dropped work, else null. */
  subscribe(listener: (result: FlushResult | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Sends what is queued, oldest first. Overlapping calls share one run, so nothing is sent twice. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    const result: FlushResult = { sent: [], rejected: [] };
    const all = await this.sorted();
    try {
      for (const work of all) {
        try {
          for (let i = work.done; i < work.steps.length; i += 1) {
            const step = work.steps[i];
            if (step === undefined) break;
            await this.send(step, work.key);
            work.done = i + 1;
            await this.store.put(work);
          }
          await this.store.remove(work.key);
          result.sent.push(work);
        } catch (error) {
          if (retryable(error)) return result; // still offline: keep this and everything after
          await this.store.remove(work.key);
          result.rejected.push({ request: work, error: error as ApiError });
        }
      }
      return result;
    } finally {
      if (result.sent.length > 0 || result.rejected.length > 0) this.notify(result);
    }
  }

  private notify(result: FlushResult | null) {
    for (const listener of this.listeners) listener(result);
  }
}
