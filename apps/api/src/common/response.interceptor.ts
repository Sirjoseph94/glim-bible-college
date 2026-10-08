import type { EndpointSpec, ResponseOf } from "@glim/contracts";
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, type Observable } from "rxjs";
import { Csv } from "@glim/shared";
import type { FastifyReply } from "fastify";
import { ENDPOINT_METADATA } from "./endpoint";

/**
 * Parses every response through its contract schema. Unknown fields are stripped, so a handler
 * can never leak data the contract doesn't declare (§5.4, INV-15).
 */
/** Dates become RFC 3339 strings (§5.4) before the contract parses the response. */
function toWire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toWire(v)]));
  }
  return value;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<EndpointSpec | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (spec === undefined) return next.handle();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (spec.successStatus === 204 || spec.successStatus === 302) return undefined;
        // A report asked for as CSV is sent as a download instead of the JSON contract.
        if (body instanceof Csv) {
          void reply
            .header("content-type", "text/csv; charset=utf-8")
            .header("content-disposition", `attachment; filename="${body.filename}"`);
          return body.text;
        }
        return spec.response.parse(toWire(body));
      }),
    );
  }
}

/**
 * What a handler may return for an endpoint: the contract's response, except that any string may
 * be a Date (dates are serialised as RFC 3339 by the interceptor).
 */
export type Reply<E extends EndpointSpec> = WithDates<ResponseOf<E>>;

/** What a handler may return for an endpoint that also offers `?format=csv`. */
export type ReplyOrCsv<E extends EndpointSpec> = Reply<E> | Csv;

type WithDates<T> = T extends string
  ? string | Date
  : T extends (infer U)[]
    ? WithDates<U>[]
    : T extends object
      ? { [K in keyof T]: WithDates<T[K]> }
      : T;
