import type { z } from "zod";
import type { Permission } from "./permissions";

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
  /**
   * The permission the caller needs (§7). Endpoints without one are open to any session (e.g. /me).
   * With `resource`, the decision is made for that resource, and one the caller can't see is a 404.
   */
  permission?: Permission;
  /**
   * `param` names a path parameter, or a query parameter with `in: "query"`. `ownPart` marks an
   * endpoint that only touches the caller's own part of the resource (their progress on a video),
   * so "own" rules in the matrix hold.
   */
  resource?: { type: ResourceType; param: string; in?: "path" | "query"; ownPart?: boolean };
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Responses are parsed through this schema, which strips fields the caller can't use. */
  response: z.ZodType;
  successStatus?: 200 | 201 | 202 | 204 | 302;
  /** Requires `If-Match: "<version>"` for optimistic concurrency (§5.4). */
  ifMatch?: boolean;
  /** Requires an `Idempotency-Key` header (§5.4). */
  idempotent?: boolean;
  /** Rate-limit class (§5.4); endpoints without one get the default 600/min. */
  rateLimit?: RateLimitClass;
}

/** Resource types whose owning module registers a ResourceContextLoader (§7.2). */
export type ResourceType =
  | "user"
  | "programme"
  | "course"
  | "curriculum"
  | "academic-session"
  | "semester"
  | "room"
  | "course-offering"
  | "lecturer"
  | "intake"
  | "application"
  | "semester-enrollment"
  | "course-enrollment"
  | "class-meeting"
  | "video"
  | "course-material"
  | "announcement";

export type RateLimitClass = "auth" | "apply" | "join" | "playback" | "progress" | "verify";

export function endpoint<const E extends EndpointSpec>(spec: E): E {
  return spec;
}

/** What a handler returns (and a client receives). */
export type ResponseOf<E extends EndpointSpec> = z.infer<E["response"]>;
/** The parsed request parts a handler receives. */
export type BodyOf<E extends EndpointSpec> = E["body"] extends z.ZodType
  ? z.infer<E["body"]>
  : never;
export type QueryOf<E extends EndpointSpec> = E["query"] extends z.ZodType
  ? z.infer<E["query"]>
  : never;
export type ParamsOf<E extends EndpointSpec> = E["params"] extends z.ZodType
  ? z.infer<E["params"]>
  : never;
/** What a client may send as the query string, before defaults apply. */
export type QueryInput<E extends EndpointSpec> = E["query"] extends z.ZodType
  ? z.input<E["query"]>
  : never;

export const API_PREFIX = "/api/v1";
