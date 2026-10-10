import { useEffect, useState } from "react";
import { api } from "../api/client";
import { reportNetworkSuccess } from "../api/network";
import {
  memoryStore,
  OfflineQueue,
  type FlushResult,
  type QueuedStep,
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

function availableStore(): QueueStore {
  try {
    if (typeof indexedDB !== "undefined") return indexedDbStore();
  } catch {
    // Some private windows block IndexedDB; the work then lasts until the tab closes.
  }
  return memoryStore();
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

/** Sends queued work when the app starts and whenever the device comes back online. */
export function startOfflineQueue(): void {
  window.addEventListener("online", () => {
    reportNetworkSuccess();
    void offlineQueue.flush();
  });
  void offlineQueue.flush();
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
