import { useEffect, useState } from "react";
import { api } from "../api/client";
import { reportNetworkSuccess, requestsFailing, subscribeNetwork } from "../api/network";
import {
  memoryStore,
  OfflineQueue,
  type FlushResult,
  type QueuedStep,
  type QueuedWork,
  type QueueStore,
} from "./queue";

export type { QueuedStep, QueuedWork } from "./queue";

const DB = "glim-offline";
const STORE = "queue";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB request failed"));
    };
  });
}

/** Queued work in IndexedDB, so it survives closing the tab or restarting the phone. */
function indexedDbStore(): QueueStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        db = null; // let a later call try again
        reject(req.error ?? new Error("IndexedDB unavailable"));
      };
    });
    return db;
  };
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    all: async () => request((await tx("readonly")).getAll()),
    put: async (work) => {
      await request((await tx("readwrite")).put(work));
    },
    remove: async (key) => {
      await request((await tx("readwrite")).delete(key));
    },
  };
}

/**
 * IndexedDB when it opens; otherwise (some private windows refuse it) memory, so queued work at
 * least lasts until the tab closes. The switch happens on the first failure and sticks.
 */
function availableStore(): QueueStore {
  const memory = memoryStore();
  if (typeof indexedDB === "undefined") return memory;
  let store: QueueStore = indexedDbStore();
  const use = async <T>(call: (s: QueueStore) => Promise<T>): Promise<T> => {
    try {
      return await call(store);
    } catch {
      store = memory;
      return call(store);
    }
  };
  return {
    all: () => use((s) => s.all()),
    put: (work) => use((s) => s.put(work)),
    remove: (key) => use((s) => s.remove(key)),
  };
}

const send = async (step: QueuedStep, key: string) => {
  // The endpoint's type is chosen at runtime here; every queued path is a JSON write.
  await api(step.method, step.path as never, {
    ...(step.params ? { params: step.params } : {}),
    ...(step.body === undefined ? {} : { body: step.body }),
    headers: { "idempotency-key": key },
  });
};

/** The app's one queue of offline work (§9.20). */
export const offlineQueue = new OfflineQueue(availableStore(), send);

const RETRY_MS = 30_000;
let retryTimer: number | undefined;

/** Sends what is queued; while anything is left, tries again every 30 s with the tab visible. */
async function flushAndRetry(): Promise<void> {
  window.clearTimeout(retryTimer);
  await offlineQueue.flush();
  if ((await offlineQueue.count()) > 0)
    retryTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") void flushAndRetry();
      else retryTimer = undefined;
    }, RETRY_MS);
}

/**
 * Sends queued work (§9.20 "on reconnect: send"): when the app starts, when the browser comes
 * back online, when a request gets an answer again after failing, when the tab comes back into
 * view, and every 30 s while something is waiting.
 */
export function startOfflineQueue(): void {
  window.addEventListener("online", () => {
    reportNetworkSuccess();
    void flushAndRetry();
  });
  subscribeNetwork(() => {
    if (!requestsFailing()) void flushAndRetry();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushAndRetry();
  });
  void flushAndRetry();
}

/** Queues work and tries to send it straight away (the connection may already be back). */
export async function queueWork(work: QueuedWork): Promise<void> {
  await offlineQueue.enqueue(work);
  void flushAndRetry();
}

/** A screen's queued work: how much is waiting, and the outcome of the last send. */
export function useQueued(group: string): { count: number; last: FlushResult | null } {
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<FlushResult | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = (result: FlushResult | null) => {
      void offlineQueue.count(group).then((n) => {
        if (live) setCount(n);
      });
      if (result && live) {
        const mine = {
          sent: result.sent.filter((w) => w.group === group),
          rejected: result.rejected.filter((r) => r.request.group === group),
        };
        if (mine.sent.length > 0 || mine.rejected.length > 0) setLast(mine);
      }
    };
    refresh(null);
    const unsubscribe = offlineQueue.subscribe(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [group]);
  return { count, last };
}
