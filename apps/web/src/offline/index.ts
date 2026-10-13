import { useEffect, useState } from "react";
import { api } from "../api/client";
import { reportNetworkSuccess, requestsFailing, subscribeNetwork } from "../api/network";
import {
  memoryStore,
  OfflineQueue,
  sendStep,
  storageStore,
  type FlushResult,
  type Merge,
  type Request,
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
 * IndexedDB when it opens; otherwise (some private windows refuse it) localStorage, so queued
 * work still survives a reload; and if that is refused too, memory, until the tab closes. Each
 * switch happens on the first failure and sticks.
 */
function availableStore(): QueueStore {
  const fallbacks: (() => QueueStore)[] = [
    () => storageStore(window.localStorage),
    () => memoryStore(),
  ];
  let store: QueueStore =
    typeof indexedDB === "undefined" ? (fallbacks.shift() ?? memoryStore)() : indexedDbStore();
  const use = async <T>(call: (s: QueueStore) => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await call(store);
      } catch (error) {
        const next = fallbacks.shift();
        if (next === undefined) throw error;
        store = next();
      }
    }
  };
  return {
    all: () => use((s) => s.all()),
    put: (work) => use((s) => s.put(work)),
    remove: (key) => use((s) => s.remove(key)),
  };
}

// The endpoint's type is chosen at runtime here; every queued path is a JSON call.
const apiRequest: Request = (method, path, init) =>
  api(method as "GET", path as never, init as never);

const send = (step: QueuedStep, key: string) => sendStep(step, key, apiRequest);

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
export async function queueWork(work: QueuedWork, merge?: Merge): Promise<void> {
  await offlineQueue.enqueue(work, merge);
  void flushAndRetry();
}

/** A screen's queued work: how much is waiting, what it is, and the outcome of the last send. */
export function useQueued(group: string): {
  count: number;
  items: QueuedWork[];
  last: FlushResult | null;
} {
  const [items, setItems] = useState<QueuedWork[]>([]);
  const [last, setLast] = useState<FlushResult | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = (result: FlushResult | null) => {
      void offlineQueue.list(group).then((waiting) => {
        if (live) setItems(waiting);
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
  return { count: items.length, items, last };
}
