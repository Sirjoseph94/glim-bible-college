import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  memoryStore,
  OfflineQueue,
  sendStep,
  storageStore,
  type QueuedStep,
  type QueuedWork,
} from "./queue";

const submission = (key: string) => ({
  key,
  group: "assignment:a1",
  steps: [
    {
      method: "PUT",
      path: "/assignments/:id/my-submissions/draft",
      params: { id: "a1" },
      body: { textBody: "x" },
    },
    { method: "POST", path: "/assignments/:id/my-submissions/submit", params: { id: "a1" } },
  ] satisfies QueuedStep[],
});
const offline = () => new TypeError("Failed to fetch");
const rejected = (code: string, status = 422) =>
  new ApiError(status, { error: { code: code as never, message: "No.", requestId: "r1" } });

describe("OfflineQueue (handoff §9.20, §10.4)", () => {
  it("keeps queued work, and sends each step once, in order, with the same Idempotency-Key", async () => {
    const send = vi.fn<(step: QueuedStep, key: string) => Promise<void>>(() => Promise.resolve());
    const queue = new OfflineQueue(memoryStore(), send);
    await queue.enqueue(submission("key-000000000001"));
    expect(await queue.count("assignment:a1")).toBe(1);

    const result = await queue.flush();
    expect(send.mock.calls.map(([step, key]) => `${step.method} ${key}`)).toEqual([
      "PUT key-000000000001",
      "POST key-000000000001",
    ]);
    expect(result.sent.map((r) => r.key)).toEqual(["key-000000000001"]);
    expect(await queue.count("assignment:a1")).toBe(0);
  });

  it("stops at a network failure, keeps the work, and resumes at the step that failed", async () => {
    let failSubmit = true;
    const send = vi.fn((step: QueuedStep) =>
      step.method === "POST" && failSubmit ? Promise.reject(offline()) : Promise.resolve(),
    );
    const queue = new OfflineQueue(memoryStore(), send);
    await queue.enqueue(submission("key-000000000002"));
    expect((await queue.flush()).sent).toEqual([]);
    expect(await queue.count()).toBe(1);

    failSubmit = false;
    send.mockClear();
    await queue.flush();
    expect(send.mock.calls.map(([step]) => step.method)).toEqual(["POST"]);
    expect(await queue.count()).toBe(0);
  });

  it("drops work the server refuses and says so, but retries what it is still busy with", async () => {
    const queue = new OfflineQueue(memoryStore(), (step) =>
      Promise.reject(step.method === "PUT" ? rejected("SUBMISSION_CLOSED") : offline()),
    );
    await queue.enqueue(submission("key-000000000003"));
    const result = await queue.flush();
    expect(result.rejected.map((r) => r.request.key)).toEqual(["key-000000000003"]);
    expect(await queue.count()).toBe(0);

    const busy = new OfflineQueue(memoryStore(), () =>
      Promise.reject(rejected("IDEMPOTENCY_IN_PROGRESS", 409)),
    );
    await busy.enqueue(submission("key-000000000004"));
    expect((await busy.flush()).rejected).toEqual([]);
    expect(await busy.count()).toBe(1);
  });

  it("never sends the same work twice when flushes overlap", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(() => gate);
    const queue = new OfflineQueue(memoryStore(), send);
    await queue.enqueue({
      ...submission("key-000000000005"),
      steps: submission("k").steps.slice(1),
    });
    const first = queue.flush();
    const second = queue.flush();
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when the queue changes", async () => {
    const queue = new OfflineQueue(memoryStore(), () => Promise.resolve());
    const listener = vi.fn();
    queue.subscribe(listener);
    await queue.enqueue(submission("key-000000000006"));
    await queue.flush();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("sendStep: versioned writes (If-Match)", () => {
  const rollCall: QueuedStep = {
    method: "PUT",
    path: "/class-meetings/:id/roll-call",
    params: { id: "m1" },
    body: { marks: [] },
    ifMatch: { version: 3, refreshFrom: "/class-meetings/:id/roll-call" },
  };
  const stale = () =>
    new ApiError(412, {
      error: { code: "PRECONDITION_FAILED" as never, message: "Changed.", requestId: "r1" },
    });

  it("sends the version it was queued with", async () => {
    const request = vi.fn(() => Promise.resolve({}));
    await sendStep(rollCall, "key-000000000001", request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      "PUT",
      "/class-meetings/:id/roll-call",
      {
        params: { id: "m1" },
        body: { marks: [] },
        headers: { "idempotency-key": "key-000000000001", "if-match": '"3"' },
      },
    ]);
  });

  it("when someone else saved first, takes the latest version and sends again", async () => {
    const request = vi
      .fn<
        (
          method: string,
          path: string,
          init: { headers?: Record<string, string> },
        ) => Promise<unknown>
      >()
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ version: 7 })
      .mockResolvedValueOnce({});
    await sendStep(rollCall, "key-000000000001", request);
    expect(
      request.mock.calls.map(([method, , init]) => `${method} ${init.headers?.["if-match"] ?? ""}`),
    ).toEqual(['PUT "3"', "GET ", 'PUT "7"']);
  });

  it("gives up after three stale versions, so the queue can drop it", async () => {
    const request = vi.fn((method: string) =>
      method === "GET" ? Promise.resolve({ version: 9 }) : Promise.reject(stale()),
    );
    await expect(sendStep(rollCall, "key-000000000001", request)).rejects.toBeInstanceOf(ApiError);
    expect(request.mock.calls.filter(([method]) => method === "PUT")).toHaveLength(3);
  });

  it("does not retry a 412 for a step without If-Match", async () => {
    const request = vi.fn(() => Promise.reject(stale()));
    const { ifMatch: _, ...plain } = rollCall;
    await expect(sendStep(plain, "key-000000000001", request)).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("OfflineQueue.list", () => {
  it("returns a group's waiting work, oldest first", async () => {
    const queue = new OfflineQueue(memoryStore(), () => Promise.reject(offline()));
    await queue.enqueue(submission("key-000000000001"));
    await queue.enqueue({ ...submission("key-000000000002"), group: "other" });
    await queue.enqueue(submission("key-000000000003"));
    expect((await queue.list("assignment:a1")).map((w) => w.key)).toEqual([
      "key-000000000001",
      "key-000000000003",
    ]);
  });
});

describe("OfflineQueue.enqueue with merge (one request for a burst of offline changes)", () => {
  type Body = { answers: string[] };
  const save = (key: string, answers: string[], group = "quiz:q1"): QueuedWork => ({
    key,
    group,
    steps: [
      { method: "PATCH", path: "/quiz-attempts/:id", params: { id: "q1" }, body: { answers } },
    ],
  });
  const answersOf = (work: QueuedWork) => (work.steps[0]?.body as Body).answers;
  const merge = (older: QueuedWork, newer: QueuedWork): QueuedWork => ({
    ...newer,
    steps: newer.steps.map((step) => ({
      ...step,
      body: { answers: [...answersOf(older), ...answersOf(newer)] },
    })),
  });
  const deferred = () => {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it("folds new work into the group's newest unsent item", async () => {
    const queue = new OfflineQueue(memoryStore(), () => Promise.reject(offline()));
    await queue.enqueue(save("key-000000000001", ["a"]), merge);
    await queue.enqueue(save("key-000000000002", ["b"]), merge);
    const items = await queue.list("quiz:q1");
    // One item, under the newer key: its body changed, so it's a new request.
    expect(items.map((w) => w.key)).toEqual(["key-000000000002"]);
    expect((items[0]?.steps[0]?.body as Body).answers).toEqual(["a", "b"]);
  });

  it("never folds into an item that is being sent: the new work queues after it", async () => {
    const gate = deferred();
    const sent: string[][] = [];
    const queue = new OfflineQueue(memoryStore(), async (step) => {
      if (sent.length === 0) await gate.promise;
      sent.push((step.body as Body).answers);
    });
    await queue.enqueue(save("key-000000000001", ["a"]), merge);
    const flushing = queue.flush();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await queue.enqueue(save("key-000000000002", ["b"]), merge);
    gate.release();
    await flushing;
    await queue.flush();
    expect(sent).toEqual([["a"], ["b"]]);
  });

  it("sends what was folded in after a flush began, not the copy it started with", async () => {
    const gate = deferred();
    const sent: string[][] = [];
    const queue = new OfflineQueue(memoryStore(), async (step) => {
      const answers = (step.body as Body).answers;
      if (answers[0] === "other") await gate.promise;
      sent.push(answers);
    });
    await queue.enqueue(save("key-000000000001", ["other"], "quiz:other"));
    await queue.enqueue(save("key-000000000002", ["a"]), merge);
    const flushing = queue.flush();
    await new Promise((r) => setTimeout(r, 0));
    await queue.enqueue(save("key-000000000003", ["b"]), merge);
    gate.release();
    await flushing;
    expect(sent).toEqual([["other"], ["a", "b"]]);
    expect(await queue.count()).toBe(0);
  });
});

describe("OfflineQueue: one screen's stuck work doesn't hold up another's", () => {
  it("keeps sending other groups after a retryable failure, and keeps order within the failing one", async () => {
    const sent: string[] = [];
    const queue = new OfflineQueue(memoryStore(), (step) => {
      const id = step.params?.id ?? "";
      if (id === "stuck")
        return Promise.reject(
          new ApiError(503, {
            error: { code: "INTERNAL", message: "Down.", requestId: "r1" },
          }),
        );
      sent.push(id);
      return Promise.resolve();
    });
    const work = (key: string, group: string, id: string): QueuedWork => ({
      key,
      group,
      steps: [{ method: "PUT", path: "/x/:id", params: { id } }],
    });
    await queue.enqueue(work("key-000000000001", "assignment:a1", "stuck"));
    await queue.enqueue(work("key-000000000002", "quiz:q1", "answers"));
    await queue.enqueue(work("key-000000000003", "assignment:a1", "after-stuck"));
    const result = await queue.flush();
    expect(sent).toEqual(["answers"]);
    expect(result.sent.map((w) => w.key)).toEqual(["key-000000000002"]);
    expect((await queue.list("assignment:a1")).map((w) => w.key)).toEqual([
      "key-000000000001",
      "key-000000000003",
    ]);
  });
});

describe("OfflineQueue.flush picks up work queued while it was sending", () => {
  it("runs again for work that arrived mid-flush, instead of leaving it for the retry timer", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const queue = new OfflineQueue(memoryStore(), async (step) => {
      const id = step.params?.id ?? "";
      if (id === "first") await gate;
      sent.push(id);
    });
    const work = (key: string, id: string): QueuedWork => ({
      key,
      group: "quiz:q1",
      steps: [{ method: "PATCH", path: "/x/:id", params: { id } }],
    });
    await queue.enqueue(work("key-000000000001", "first"));
    const flushing = queue.flush();
    await new Promise((r) => setTimeout(r, 0));
    await queue.enqueue(work("key-000000000002", "second"));
    release();
    const result = await flushing;
    expect(sent).toEqual(["first", "second"]);
    expect(result.sent.map((w) => w.key)).toEqual(["key-000000000001", "key-000000000002"]);
    expect(await queue.count()).toBe(0);
  });
});

describe("storageStore (the fallback when IndexedDB is refused)", () => {
  const fakeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => {
        map.clear();
      },
      getItem: (k) => map.get(k) ?? null,
      key: (i) => [...map.keys()][i] ?? null,
      removeItem: (k) => {
        map.delete(k);
      },
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  };

  it("keeps queued work across a reload (a new store on the same storage)", async () => {
    const storage = fakeStorage();
    const before = new OfflineQueue(storageStore(storage), () => Promise.reject(offline()));
    await before.enqueue(submission("key-000000000001"));
    const after = new OfflineQueue(storageStore(storage), () => Promise.resolve());
    expect(await after.count("assignment:a1")).toBe(1);
    await after.flush();
    expect(await after.count()).toBe(0);
  });
});
