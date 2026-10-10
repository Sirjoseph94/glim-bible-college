import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { memoryStore, OfflineQueue, type QueuedStep } from "./queue";

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
