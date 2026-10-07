import { API_PREFIX, type EndpointSpec, type RateLimitClass } from "@glim/contracts";
import { AppError } from "@glim/shared";
import {
  applyDecorators,
  Body as NestBody,
  HttpCode,
  Param as NestParam,
  Query as NestQuery,
  RequestMapping,
  RequestMethod,
  SetMetadata,
  type PipeTransform,
} from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

export const ENDPOINT_METADATA = "glim:endpoint";

const METHODS: Record<EndpointSpec["method"], RequestMethod> = {
  GET: RequestMethod.GET,
  POST: RequestMethod.POST,
  PUT: RequestMethod.PUT,
  PATCH: RequestMethod.PATCH,
  DELETE: RequestMethod.DELETE,
};

const byIp = (req: FastifyRequest) => req.clientIp;
/** Per-user classes key on the session cookie (parsed before rate limiting), else the IP. */
const byUser = (req: FastifyRequest) => req.cookies["__Host-glim_sid"] ?? req.clientIp;

/** Rate-limit classes (§5.4). In-memory per instance, so the effective limit is × instances (§5.7). */
export const RATE_LIMITS: Record<
  RateLimitClass,
  { max: number; timeWindow: string; keyGenerator: (req: FastifyRequest) => string }
> = {
  auth: { max: 10, timeWindow: "1 minute", keyGenerator: byIp },
  apply: { max: 10, timeWindow: "1 minute", keyGenerator: byIp },
  join: { max: 20, timeWindow: "1 minute", keyGenerator: byUser },
  playback: { max: 60, timeWindow: "1 minute", keyGenerator: byUser },
  progress: { max: 12, timeWindow: "1 minute", keyGenerator: byUser },
  verify: { max: 30, timeWindow: "1 minute", keyGenerator: byIp },
};

/** Routes a controller method to a contract endpoint; its response is parsed by the contract. */
export function Endpoint(spec: EndpointSpec): MethodDecorator {
  return applyDecorators(
    RequestMapping({ path: `${API_PREFIX}${spec.path}`, method: METHODS[spec.method] }),
    HttpCode(spec.successStatus ?? (spec.method === "POST" ? 201 : 200)),
    SetMetadata(ENDPOINT_METADATA, spec),
    ...(spec.rateLimit === undefined
      ? []
      : [RouteConfig({ rateLimit: RATE_LIMITS[spec.rateLimit] })]),
  );
}

/** Parses external input with Zod at the edge (TRD §5.8); failures become VALIDATION_FAILED. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(
    private readonly schema: S,
    private readonly location: "body" | "query" | "params",
  ) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new AppError("VALIDATION_FAILED", "The request is invalid.", {
      fieldErrors: result.error.issues.map((issue) => ({
        path: [this.location, ...issue.path.map(String)].join("."),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}

function required(spec: EndpointSpec, key: "body" | "query" | "params"): z.ZodType {
  const schema = spec[key];
  if (schema === undefined)
    throw new Error(`${spec.method} ${spec.path} declares no ${key} schema`);
  return schema;
}

export const Body = (spec: EndpointSpec) => NestBody(new ZodPipe(required(spec, "body"), "body"));
export const Query = (spec: EndpointSpec) =>
  NestQuery(new ZodPipe(required(spec, "query"), "query"));
export const Params = (spec: EndpointSpec) =>
  NestParam(new ZodPipe(required(spec, "params"), "params"));
