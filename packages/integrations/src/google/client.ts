import {
  ProviderNotFoundError,
  ProviderPermanentError,
  ProviderRateLimitedError,
  ProviderUnavailableError,
} from "../live-provider/port";
import { TokenError, type FetchLike, type ServiceAccountTokens } from "./auth";
import { CircuitBreaker, type BreakerState } from "./breaker";
import type { GoogleRateLimiter, QuotaKind } from "./limiter";

export interface GoogleRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  /** The Workspace user to act as (DWD), or null for the service account itself. */
  subject: string | null;
  scopes: readonly string[];
  json?: unknown;
  headers?: Record<string, string>;
  /** Meet calls count against the quota buckets; Drive and Pub/Sub don't. */
  quota?: QuotaKind;
  /** Statuses the caller handles itself (returned, not thrown). */
  accept?: number[];
}

export interface GoogleClientOptions {
  fetch?: FetchLike;
  limiter?: GoogleRateLimiter;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Tries per call for 429, 5xx and network errors (TRD §11.7: ≤ 5). */
  maxTries?: number;
}

const BASE_MS = 1000;
const CAP_MS = 60_000;

/** Google's own error message, short, for logs and ops (never a token or a request body). */
async function reason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown; status?: unknown } };
    const message = body.error?.message;
    const status = body.error?.status;
    return [
      typeof status === "string" ? status : null,
      typeof message === "string" ? message : null,
    ]
      .filter((x) => x !== null)
      .join(": ")
      .slice(0, 300);
  } catch {
    return "";
  }
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Every Google call goes through here (TRD §11.7): a token for the right user and scopes, the
 * quota limiter, the per-host circuit breaker, and the retry taxonomy:
 * 429/5xx/network → full-jitter backoff (1 s base, 60 s cap, ≤ 5 tries) honouring Retry-After;
 * 401 → refresh the token once; 403 → permanent; 404 → not found.
 */
export class GoogleClient {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly tokens: ServiceAccountTokens,
    private readonly options: GoogleClientOptions = {},
  ) {}

  /** Breaker states by host account, for the integration status page. */
  breakerStates(): Record<string, BreakerState> {
    return Object.fromEntries([...this.breakers].map(([key, b]) => [key, b.state]));
  }

  private breaker(subject: string | null): CircuitBreaker {
    const key = subject ?? "service-account";
    let breaker = this.breakers.get(key);
    if (breaker === undefined) {
      breaker = new CircuitBreaker(this.options.now);
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  async json<T>(request: GoogleRequest): Promise<T> {
    const response = await this.send(request);
    const text = await response.text();
    return (text === "" ? {} : JSON.parse(text)) as T;
  }

  /** Sends the request; the body of the returned response is unread (for streaming). */
  async send(request: GoogleRequest): Promise<Response> {
    const breaker = this.breaker(request.subject);
    const wait = breaker.admit();
    if (wait > 0)
      throw new ProviderUnavailableError(
        `Google calls for ${request.subject ?? "the service account"} are paused after repeated failures.`,
        wait,
      );
    try {
      const response = await this.attempt(request);
      breaker.success();
      return response;
    } catch (error) {
      // Google answered (403, 404): the host is reachable. A local quota wait says nothing.
      if (error instanceof ProviderUnavailableError) breaker.failure();
      else if (!(error instanceof ProviderRateLimitedError)) breaker.success();
      throw error;
    }
  }

  private async attempt(request: GoogleRequest): Promise<Response> {
    const doFetch = this.options.fetch ?? fetch;
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = this.options.random ?? Math.random;
    const maxTries = this.options.maxTries ?? 5;
    const what = `${request.method} ${new URL(request.url).pathname}`;
    let refreshed = false;
    let lastProblem = "";
    let lastRetryAfter: number | null = null;

    for (let tryNo = 0; tryNo < maxTries;) {
      if (request.quota !== undefined && request.subject !== null)
        await this.options.limiter?.take(request.quota, request.subject);
      let token: string;
      try {
        token = await this.tokens.token(request.subject, request.scopes);
      } catch (error) {
        if (error instanceof TokenError && error.status < 500)
          throw new ProviderPermanentError(error.message, { cause: error });
        lastProblem = error instanceof Error ? error.message : String(error);
        tryNo++;
        if (tryNo < maxTries) await sleep(random() * Math.min(CAP_MS, BASE_MS * 2 ** tryNo));
        continue;
      }

      let response: Response;
      try {
        response = await doFetch(request.url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(request.json === undefined ? {} : { "content-type": "application/json" }),
            ...request.headers,
          },
          ...(request.json === undefined ? {} : { body: JSON.stringify(request.json) }),
        });
      } catch (error) {
        lastProblem = `network error: ${error instanceof Error ? error.message : String(error)}`;
        tryNo++;
        if (tryNo < maxTries) await sleep(random() * Math.min(CAP_MS, BASE_MS * 2 ** tryNo));
        continue;
      }

      if (response.ok || request.accept?.includes(response.status) === true) return response;
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.tokens.invalidate(request.subject, request.scopes);
        await response.body?.cancel();
        continue;
      }
      const problem = `${what}: HTTP ${String(response.status)} ${await reason(response)}`.trim();
      if (response.status === 404) throw new ProviderNotFoundError(problem);
      if (response.status === 429 || response.status >= 500) {
        lastProblem = problem;
        lastRetryAfter = retryAfterMs(response);
        tryNo++;
        if (tryNo < maxTries)
          await sleep(lastRetryAfter ?? random() * Math.min(CAP_MS, BASE_MS * 2 ** tryNo));
        continue;
      }
      // 401 after a refresh, 403 (scopes, suspended host), and other 4xx: retrying won't help.
      throw new ProviderPermanentError(problem);
    }
    throw new ProviderUnavailableError(lastProblem, lastRetryAfter);
  }
}
