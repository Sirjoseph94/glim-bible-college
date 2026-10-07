import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One API endpoint, declared once and shared by the api (routing, validation, response
 * stripping), the OpenAPI document and the web client (TRD §5.4, §0.5 "contract first").
 * `path` is relative to `/api/v1` and uses `:param` segments.
 */
export interface EndpointSpec {
  method: HttpMethod;
  path: string;
  summary: string;
  tag: string;
  /** "public" endpoints need no session; everything else requires one (and CSRF for writes). */
  auth: "public" | "session";
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Responses are parsed through this schema, which strips fields the caller can't use. */
  response: z.ZodType;
  successStatus?: 200 | 201 | 202 | 204;
  /** Requires an `Idempotency-Key` header (§5.4). */
  idempotent?: boolean;
  /** Rate-limit class (§5.4); endpoints without one get the default 600/min. */
  rateLimit?: RateLimitClass;
}

export type RateLimitClass = "auth" | "apply" | "join" | "playback" | "progress" | "verify";

export function endpoint<const E extends EndpointSpec>(spec: E): E {
  return spec;
}

export type ResponseOf<E extends EndpointSpec> = z.infer<E["response"]>;
export type BodyOf<E extends EndpointSpec> = E["body"] extends z.ZodType
  ? z.infer<E["body"]>
  : never;
export type QueryOf<E extends EndpointSpec> = E["query"] extends z.ZodType
  ? z.input<E["query"]>
  : never;

export const API_PREFIX = "/api/v1";
