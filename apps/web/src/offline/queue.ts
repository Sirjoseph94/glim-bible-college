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

const STORAGE_KEY = "glim-offline-queue";

/**
 * Queued work in Web Storage (localStorage): the fallback when IndexedDB is refused, so work
 * still survives a reload, as the old per-screen queues did. Throws when storage is refused too.
 */
export function storageStore(storage: Storage): QueueStore {
  const read = (): Stored[] => {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as Stored[]);
  };
  const write = (items: Stored[]) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  };
  return {
    all: () => Promise.resolve(read()),
    put: (work) => {
      write([...read().filter((w) => w.key !== work.key), work]);
      return Promise.resolve();
    },
    remove: (key) => {
      write(read().filter((w) => w.key !== key));
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

/**
 * Folds newer work into an older, unsent item of the same group (e.g. two answer batches). The
 * result goes out under the newer work's Idempotency-Key: its body differs from anything an
 * earlier, unanswered attempt may have sent under the older key.
 */
export type Merge = (older: QueuedWork, newer: QueuedWork) => QueuedWork;

export class OfflineQueue {
  private flushing: Promise<FlushResult> | null = null;
  /** The item being sent now, which a merge must leave alone. */
  private sending: string | null = null;
  /** Serialises merging and claiming an item to send, so neither sees the other half-done. */
  private lock: Promise<unknown> = Promise.resolve();
  /** Work queued while a flush runs: that flush runs again for it rather than leave it waiting. */
  private arrived = false;
  private readonly listeners = new Set<(result: FlushResult | null) => void>();

  constructor(
    private readonly store: QueueStore,
    private readonly send: Send,
  ) {}

  /**
   * Keeps work on the device until it can be sent. With `merge`, work is folded into the group's
   * newest item that hasn't started sending (keeping that item's key and place), so a burst of
   * offline changes goes out as one request.
   */
  async enqueue(work: QueuedWork, merge?: Merge): Promise<void> {
    if (this.flushing !== null) this.arrived = true;
    await this.locked(async () => {
      const target =
        merge === undefined
          ? undefined
          : (await this.sorted())
              .filter((w) => w.group === work.group && w.done === 0 && w.key !== this.sending)
              .at(-1);
      if (target && merge) {
        const merged = merge(target, work);
        await this.store.remove(target.key);
        await this.store.put({ ...merged, key: work.key, queuedAt: target.queuedAt, done: 0 });
      } else await this.store.put({ ...work, queuedAt: new Date().toISOString(), done: 0 });
    });
    this.notify(null);
  }

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.then(task, task);
    this.lock = run.catch(() => undefined);
    return run;
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
    this.flushing ??= this.runUntilSettled().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Runs again while work arrived mid-run and the last run got answers (it isn't offline). */
  private async runUntilSettled(): Promise<FlushResult> {
    const total: FlushResult = { sent: [], rejected: [] };
    for (;;) {
      this.arrived = false;
      const result = await this.run();
      total.sent.push(...result.sent);
      total.rejected.push(...result.rejected);
      const progressed = result.sent.length + result.rejected.length > 0;
      if (!this.arrivedDuringRun() || !progressed) return total;
    }
  }

  /** Read through a method: `run()` sets it, which a narrowed `this.arrived` can't show. */
  private arrivedDuringRun(): boolean {
    return this.arrived;
  }

  private async run(): Promise<FlushResult> {
    const result: FlushResult = { sent: [], rejected: [] };
    const all = await this.sorted();
    try {
      // A group whose item failed for now: its later items wait, so they stay in order.
      const held = new Set<string>();
      for (const listed of all) {
        if (held.has(listed.group)) continue;
        // Claim the item and read it again: a merge may have changed it since the list was read.
        const work = await this.locked(async () => {
          const current = (await this.store.all()).find((w) => w.key === listed.key);
          this.sending = current?.key ?? null;
          return current;
        });
        if (work === undefined) continue;
        try {
          for (let i = work.done; i < work.steps.length; i += 1) {
            const step = work.steps[i];
            if (step === undefined) break;
            await this.send(step, work.key);
            work.done = i + 1;
            await this.store.put(work);
          }
          await this.store.remove(work.key);
          this.sending = null;
          result.sent.push(work);
        } catch (error) {
          this.sending = null;
          // No answer at all: the connection is down, so nothing else would get through either.
          if (!(error instanceof ApiError)) return result;
          // The server is struggling with this one: hold its group, carry on with the others.
          if (retryable(error)) {
            held.add(work.group);
            continue;
          }
          await this.store.remove(work.key);
          result.rejected.push({ request: work, error: error });
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
