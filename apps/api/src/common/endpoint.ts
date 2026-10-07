import { API_PREFIX, type EndpointSpec } from "@glim/contracts";
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
import type { z } from "zod";

export const ENDPOINT_METADATA = "glim:endpoint";

const METHODS: Record<EndpointSpec["method"], RequestMethod> = {
  GET: RequestMethod.GET,
  POST: RequestMethod.POST,
  PUT: RequestMethod.PUT,
  PATCH: RequestMethod.PATCH,
  DELETE: RequestMethod.DELETE,
};

/** Routes a controller method to a contract endpoint; its response is parsed by the contract. */
export function Endpoint(spec: EndpointSpec): MethodDecorator {
  return applyDecorators(
    RequestMapping({ path: `${API_PREFIX}${spec.path}`, method: METHODS[spec.method] }),
    HttpCode(spec.successStatus ?? (spec.method === "POST" ? 201 : 200)),
    SetMetadata(ENDPOINT_METADATA, spec),
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
