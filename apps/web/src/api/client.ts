import type { EndpointSpec, ErrorEnvelope, ResponseOf } from "@glim/contracts";

/** A failed API call, carrying the error envelope (TRD §5.4). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope | null,
  ) {
    super(envelope?.error.message ?? `Request failed (${status})`);
  }
}

/**
 * Calls an endpoint declared in the shared contracts. Only types come from the contracts, so no
 * schema code reaches the browser bundle; the server already validates and strips responses.
 */
export async function api<E extends EndpointSpec>(
  method: E["method"],
  path: E["path"],
  init: { body?: unknown; signal?: AbortSignal } = {},
): Promise<ResponseOf<E>> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(res.status, envelope);
  }
  return (res.status === 204 ? undefined : await res.json()) as ResponseOf<E>;
}
