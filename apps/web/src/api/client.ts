import type { EndpointSpec, ErrorEnvelope, ResponseOf } from "@glim/contracts";
import { reportNetworkFailure, reportNetworkSuccess } from "./network";

/** A failed API call, carrying the error envelope (TRD §5.4). */
/** `Retry-After` as whole seconds from now: a number of seconds or an HTTP date; null if neither. */
export function retryAfterSeconds(header: string | null, now = new Date()): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (!/[a-z]/i.test(value) || Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope | null,
    /** How long the server asked to wait before trying again (`Retry-After`), if it said. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(envelope?.error.message ?? `Request failed (${String(status)})`);
  }

  get code(): string | undefined {
    return this.envelope?.error.code;
  }

  /** Field errors keyed by field name (the part after `body.`). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.envelope?.error.fieldErrors ?? [])
      out[f.path.replace(/^body\./, "")] = f.message;
    return out;
  }
}

let csrfToken: string | null = null;

/** Set from `GET /me`; sent as X-CSRF-Token on every write (§8.3). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * Calls an endpoint declared in the shared contracts. Only types come from the contracts, so no
 * schema code reaches the browser bundle; the server validates input and strips responses.
 */
export async function api<E extends EndpointSpec>(
  method: E["method"],
  path: E["path"],
  init: {
    body?: unknown;
    signal?: AbortSignal;
    /** Values for the path's `:params`. */
    params?: Record<string, string>;
    query?: Record<string, string | number | undefined>;
    headers?: Record<string, string>;
    /** Lets the request finish after the page is gone (progress sent on `pagehide`). */
    keepalive?: boolean;
  } = {},
): Promise<ResponseOf<E>> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken !== null) headers["x-csrf-token"] = csrfToken;
  let url = path.replaceAll(/:(\w+)/g, (_m, name: string) =>
    encodeURIComponent(init.params?.[name] ?? ""),
  );
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined && v !== "") search.set(k, String(v));
  const qs = search.toString();
  if (qs !== "") url += `?${qs}`;
  let res: Response;
  try {
    res = await fetch(`/api/v1${url}`, {
      method,
      credentials: "same-origin",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.keepalive === true ? { keepalive: true } : {}),
    });
  } catch (error) {
    // No answer at all, and not because the caller gave up: the device or network is offline.
    if (init.signal?.aborted !== true) reportNetworkFailure();
    throw error;
  }
  reportNetworkSuccess();
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(res.status, envelope, retryAfterSeconds(res.headers.get("retry-after")));
  }
  if (res.status === 204) return undefined as ResponseOf<E>;
  // A 202 may carry the queued resource (e.g. an import) or nothing at all.
  const text = await res.text();
  return (text === "" ? undefined : JSON.parse(text)) as ResponseOf<E>;
}
